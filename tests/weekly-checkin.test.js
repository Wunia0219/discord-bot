import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {WalletStore} from '../server/wallet/wallet.js';
import {inspectWalletDatabase} from '../server/sqlite/database.js';
import {checkinRewards,previousDay,weeklyCheckinState} from '../server/wallet/weekly-checkin.js';
import {firestoreImportPlan} from '../server/firestore/import.js';
import {snapshotForCloud,restoreCloudSnapshot} from '../server/recovery/cloud-handoff.js';
import {auditSnapshot} from '../cloud/snapshot.js';
import {auditRows} from '../cloud/snapshot-audit.js';
import {dailyRewardView} from '../src/ui/player/player-copy.js';

const guild='100000000000000001',user='100000000000000002',other='100000000000000003';
const dayMs=86400000,rewards=[500,500,1000,1000,1000,2000,4000];
function fixture(t){
  const root=resolve('test-results/weekly-checkin');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'case-')),filename=join(dir,'wallet.sqlite');
  let now=Date.parse('2026-10-25T16:00:00Z');const stores=[];
  const open=(extra={})=>{const s=new WalletStore({filename,guildIds:[guild,other],environment:'production',clock:()=>now,...extra});stores.push(s);return s;};
  t.after(()=>{for(const s of stores)s.close();assert.ok(dir.startsWith(root+sep));rmSync(dir,{recursive:true,force:true});});
  return {dir,filename,open,advance:(n=1)=>{now+=n*dayMs;},setTime:time=>{now=Date.parse(time);}};
}

test('weekly rewards repeat for 15 consecutive days, with immutable once-per-day receipts',t=>{
  const f=fixture(t),s=f.open();let total=10000;
  for(let i=0;i<15;i++){
    const day=i%7+1,amount=rewards[day-1],state=s.state(guild,user);
    assert.equal(state.claimed,false);assert.equal(state.weeklyCheckin.day,day);assert.equal(state.daily,amount);
    const r=s.checkin(guild,user);total+=amount;
    assert.equal(r.entry.delta,amount);assert.equal(r.state.balance,total);assert.equal(r.checkin.cycleDay,day);
    assert.equal(r.state.claimed,true);assert.equal(r.state.weeklyCheckin.nextReward,rewards[day%7]);
    const again=s.checkin(guild,user);assert.equal(again.duplicate,true);assert.deepEqual(again.checkin,r.checkin);assert.deepEqual(again.entry,r.entry);
    f.advance();
  }
  assert.deepEqual({...s.auditSummary(guild,user).checkin},{days:15,total:20500});assert.equal(inspectWalletDatabase(f.filename,'production').ok,true);
});

test('missing one or many Taipei dates resets, even at a cycle boundary, with isolated guilds/users',t=>{
  const f=fixture(t),s=f.open();s.checkin(guild,user);f.advance();assert.equal(s.checkin(guild,user).entry.delta,500);
  f.advance(2);assert.equal(s.state(guild,user).weeklyCheckin.day,1);assert.equal(s.checkin(guild,user).entry.delta,500);
  for(let i=0;i<6;i++){f.advance();s.checkin(guild,user);}
  f.advance(9);assert.equal(s.checkin(guild,user).entry.delta,500);
  assert.equal(s.checkin(other,user).checkin.cycleDay,1);assert.equal(s.checkin(guild,other).checkin.cycleDay,1);
});

test('Taipei calendar continuity includes midnight, leap days and year boundaries',t=>{
  assert.equal(previousDay('2028-03-01'),'2028-02-29');assert.equal(previousDay('2027-01-01'),'2026-12-31');
  const f=fixture(t),s=f.open();f.setTime('2026-12-31T15:59:59.999Z');const first=s.checkin(guild,user);
  assert.equal(first.state.nextCheckin,'2026-12-31T16:00:00.000Z');
  f.setTime('2026-12-31T16:00:00.000Z');const second=s.checkin(guild,user);
  assert.equal(second.checkin.cycleDay,2);assert.equal(second.entry.delta,500);
  assert.equal(s.history(guild,user)[0].day,'2027-01-01');
});

test('reopen and reward configuration changes preserve claimed receipts and uninterrupted progress',t=>{
  const f=fixture(t),s=f.open(),first=s.checkin(guild,user);s.close();
  const updated=f.open({weeklyRewards:[10,40,90,160,250,360,490]});
  assert.equal(updated.state(guild,user).daily,500);assert.equal(updated.state(guild,user).weeklyCheckin.nextReward,40);
  assert.deepEqual(updated.checkin(guild,user).entry,first.entry);assert.deepEqual(updated.checkin(guild,user).checkin,first.checkin);
  f.advance();const second=updated.checkin(guild,user);assert.equal(second.entry.delta,40);assert.equal(second.checkin.cycleDay,2);
  assert.equal(inspectWalletDatabase(f.filename,'production').ok,true);
});

test('existing flat claims keep their original deduplication, then enter day one of the weekly cycle',t=>{
  const f=fixture(t),s=f.open();s.db.prepare('INSERT INTO wallets(guild,user,balance) VALUES(?,?,0)').run(guild,user);
  s.tx(()=>s.once(guild,`daily:${user}:2026-10-26`,'daily',()=>({entry:s.credit(guild,user,500,'checkin',user,'每日簽到')})));
  assert.equal(s.checkin(guild,user).duplicate,true);assert.equal(s.state(guild,user).balance,500);
  assert.equal(s.state(guild,user).weeklyCheckin.nextReward,500);
  f.advance();assert.equal(s.checkin(guild,user).entry.delta,500);assert.equal(inspectWalletDatabase(f.filename,'production').ok,true);
});

test('balance rejection rolls back receipt and progress, allowing the same day to be retried',t=>{
  const f=fixture(t),s=f.open({weeklyRewards:[100,1e12,300,400,500,600,700]});s.checkin(guild,user);f.advance();
  const before=s.history(guild,user);assert.throws(()=>s.checkin(guild,user),{code:'BALANCE_LIMIT'});
  assert.deepEqual(s.history(guild,user),before);assert.equal(s.state(guild,user).claimed,false);assert.equal(s.state(guild,user).weeklyCheckin.day,2);
  const b=f.open();assert.equal(b.checkin(guild,user).entry.delta,500);
});

test('cloud archive/SQLite restore and v1/v2 import reconstruct the latest weekly receipt',t=>{
  const f=fixture(t),s=f.open();for(let i=0;i<4;i++){s.checkin(guild,user);f.advance();}
  const original=s.state(guild,user),snapshot=snapshotForCloud(f.filename,'production');
  assert.equal(auditRows(snapshot,t=>snapshot.tables[t],'production',()=>new Map()).revision,snapshot.revision);
  const target=join(f.dir,'restored.sqlite');restoreCloudSnapshot(snapshot,target,'production');const restored=f.open({filename:target});
  assert.deepEqual(restored.state(guild,user),original);assert.equal(restored.checkin(guild,user).entry.delta,1000);
  for(const version of [1,2]){
    const plan=firestoreImportPlan(f.filename,'production',{version});
    const wallet=plan.resources.find(r=>r.path===`wallets/${guild}_${user}`).data;
    assert.equal(wallet.checkin.cycleDay,4);assert.equal(wallet.claimedDay,'2026-10-29');assert.deepEqual(wallet.checkin.rewards,rewards);
  }
  const bad=structuredClone(snapshot),row=bad.tables.operations.find(o=>o.key.endsWith('2026-10-29'));
  const result=JSON.parse(row.result);result.checkin.cycleDay=7;row.result=JSON.stringify(result);
  assert.throws(()=>auditSnapshot(bad,'production'),/Checkin mismatch/);
  assert.throws(()=>auditRows(bad,t=>bad.tables[t],'production',()=>new Map()),/Checkin mismatch/);
  s.db.prepare('UPDATE operations SET result=? WHERE guild=? AND key=?').run(row.result,row.guild,row.key);
  assert.equal(inspectWalletDatabase(f.filename,'production').ok,false);
});

test('invalid reward tables fail closed; frontend shows actual day and tomorrow reward including wrap',()=>{
  for(const value of ['',[],[1,2,3],Array(7),Array(7).fill(0),Array(7).fill(-1),Array(7).fill(0.5),Array(7).fill(1e12+1),'100,200,300,400,500,600,no','1e2,2,3,4,5,6,7'])assert.throws(()=>checkinRewards(value),/WEEKLY_CHECKIN_REWARDS/);
  assert.deepEqual(checkinRewards('500, 500,1000,1000,1000,2000,4000'),rewards);
  const progress=weeklyCheckinState('2026-10-25',{version:1,cycleDay:6,rewards},'2026-10-26',rewards);
  assert.deepEqual(dailyRewardView({ready:true,...progress}),{title:'週簽到・第 7 天',detail:'可領 4,000 戲籌',disabled:false});
  const claimed=weeklyCheckinState('2026-10-26',{version:1,cycleDay:7,rewards},'2026-10-26',rewards);
  assert.deepEqual(dailyRewardView({ready:true,...claimed}),{title:'週簽到・已領取',detail:'明日 500 戲籌',disabled:false});
});
