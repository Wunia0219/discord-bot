import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {WalletStore} from '../server/wallet.js';
import {inspectWalletDatabase} from '../server/database.js';
import {snapshotForCloud,restoreCloudSnapshot} from '../server/cloud-handoff.js';
import {auditSnapshot} from '../cloud/snapshot.js';
import {auditRows} from '../cloud/snapshot-audit.js';
import {firestoreImportPlan} from '../server/firestore-import.js';
import {handleCommand,commandDefinitions} from '../server/commands.js';

const guild='100000000000000001',other='100000000000000009',admin='100000000000000003',user='100000000000000002',checkinOnly='100000000000000004';
function fixture(t,options={}){
  const root=resolve('test-results/reset');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'case-')),filename=join(dir,'wallet.sqlite');
  const s=new WalletStore({filename,guildIds:[guild,other],spinDelay:0,...options});t.after(()=>s.close());return {s,filename,dir};
}
const command=(name,args={},permissions='8')=>({type:2,id:randomUUID(),guild_id:guild,member:{user:{id:admin},permissions,roles:[]},data:{name:'戲籌管理',options:[{name,options:Object.entries(args).map(([name,value])=>({name,value}))}]}});
const auditStream=s=>auditRows(s,t=>s.tables[t].values(),'test',()=>new Map());

test('reset snapshots current existing wallets atomically, retains weekly progress/history/cooldown, and retries never reset new play',t=>{
  let now=Date.parse('2026-10-26T00:00:00Z');const {s,filename,dir}=fixture(t,{clock:()=>now});
  s.checkin(guild,checkinOnly);s.checkin(guild,user);now+=86400000;s.checkin(guild,user);
  s.grant(guild,admin,user,1500,'original reward',randomUUID());const prior=s.spin(guild,user,20,randomUUID());
  s.state(other,user);const zero='100000000000000005';s.state(guild,zero);
  s.tx(()=>s.once(guild,'local-fixture:zero','0',()=>({entry:s.credit(guild,zero,-10000,'test_fixture',null,'zero')})));
  const before=s.playerWallets(guild),state=s.state(guild,user),summary=s.auditSummary(guild,user),wallet={...s.db.prepare('SELECT * FROM wallets WHERE guild=? AND user=?').get(guild,user)},request=randomUUID();
  const r=s.resetWallets(guild,admin,request);
  assert.deepEqual(r.entries.map(e=>[e.user,e.before]),before.rows.map(w=>[w.user,w.balance]));assert.equal(r.entries.length,3);
  assert.ok(r.entries.every(e=>e.after===10000));assert.equal(r.reset.totalBefore,String(before.rows.reduce((n,w)=>n+w.balance,0)));
  const after=s.state(guild,user);assert.equal(after.balance,10000);assert.deepEqual(after.weeklyCheckin,state.weeklyCheckin);assert.deepEqual(after.history,state.history);assert.equal(after.balanceReset.roundId,prior.round.id);
  assert.deepEqual(s.auditSummary(guild,user),summary);const saved=s.db.prepare('SELECT * FROM wallets WHERE guild=? AND user=?').get(guild,user);
  assert.equal(saved.last_spin,wallet.last_spin);assert.equal(saved.milestone,wallet.milestone);assert.equal(s.state(other,user).balance,10000);
  assert.equal(s.db.prepare('SELECT 1 FROM wallets WHERE guild=? AND user=?').get(guild,admin),undefined);
  const post=s.spin(guild,user,20,randomUUID());assert.equal(post.round.before,10000);
  assert.deepEqual(s.resetWallets(guild,admin,request),{...r,duplicate:true});assert.equal(s.state(guild,user).balance,post.state.balance);
  assert.throws(()=>s.resetWallets(guild,checkinOnly,request),{code:'REQUEST_CONFLICT'});
  assert.deepEqual(s.walletResetReport(guild,admin,request),{...r,duplicate:true});assert.throws(()=>s.walletResetReport(other,admin,request),{code:'RESET_MISSING'});
  s.close();const reopened=new WalletStore({filename,guildIds:[guild,other],clock:()=>now,spinDelay:0});t.after(()=>reopened.close());
  assert.deepEqual(reopened.walletResetReport(guild,admin,request),{...r,duplicate:true});assert.equal(reopened.state(guild,user).balanceReset.roundId,prior.round.id);
  assert.equal(inspectWalletDatabase(filename,'test').ok,true);
  const snapshot=snapshotForCloud(filename,'test');assert.deepEqual(auditStream(snapshot),auditSnapshot(snapshot,'test'));
  const target=join(dir,'restored.sqlite');assert.equal(restoreCloudSnapshot(snapshot,target,'test').ok,true);assert.deepEqual(snapshotForCloud(target,'test').tables,snapshot.tables);
  for(const version of [1,2]){
    const plan=firestoreImportPlan(filename,'test',{version}),rows=plan.resources.filter(x=>/^ledger\//.test(x.path)&&x.data.kind==='reset');
    assert.equal(rows.filter(x=>x.index.operationKey===`reset:${request}`).length,1);assert.equal(rows.filter(x=>x.index.operationKey===null).length,2);
    assert.equal(plan.resources.find(x=>x.path===`wallets/${guild}_${user}`).data.balanceReset.roundId,prior.round.id);
  }
  for(const mutate of [r=>r.reset.count++,r=>r.entries[0].before++,r=>r.entries.pop(),r=>r.entries[0].user=admin,r=>r.entries=[null],r=>r.entries={}]){
    const bad=structuredClone(snapshot),op=bad.tables.operations.find(o=>o.key===`reset:${request}`),data=JSON.parse(op.result);mutate(data);op.result=JSON.stringify(data);
    assert.throws(()=>auditSnapshot(bad,'test'),/Reset|Missing/);assert.throws(()=>auditStream(bad),/Reset|Missing/);
  }
  reopened.db.prepare('UPDATE operations SET result=? WHERE guild=? AND key=?').run(JSON.stringify({...r,entries:{}}),guild,'reset:'+request);
  assert.equal(inspectWalletDatabase(filename,'test').ok,false);
  reopened.db.prepare('UPDATE operations SET result=? WHERE guild=? AND key=?').run(JSON.stringify(r),guild,'reset:'+request);
});

test('roster is read only, guild scoped and paginated; empty and oversize resets leave every wallet untouched',t=>{
  const {s}=fixture(t);assert.throws(()=>s.resetWallets(guild,admin,randomUUID()),{code:'RESET_EMPTY'});
  for(let i=0;i<21;i++)s.state(guild,String(100000000000000100n+BigInt(i)));s.state(other,user);
  const count=s.db.prepare('SELECT COUNT(*) n FROM ledger').get().n,first=s.playerWallets(guild),last=s.playerWallets(guild,{after:first.next});
  assert.equal(first.rows.length,20);assert.equal(last.rows.length,1);assert.equal(last.next,null);assert.equal(new Set([...first.rows,...last.rows].map(w=>w.user)).size,21);assert.equal(s.db.prepare('SELECT COUNT(*) n FROM ledger').get().n,count);
  const r=s.resetWallets(guild,admin,randomUUID());assert.equal(r.reset.changed,0);assert.equal(r.entries.length,21);assert.ok(r.entries.every(e=>e.delta===0));
  for(let i=21;i<101;i++)s.state(guild,String(100000000000000100n+BigInt(i)));
  const revision=s.db.prepare('SELECT MAX(id) n FROM ledger').get().n;
  assert.throws(()=>s.resetWallets(guild,admin,randomUUID()),{code:'RESET_LIMIT'});assert.equal(s.db.prepare('SELECT MAX(id) n FROM ledger').get().n,revision);
  assert.throws(()=>s.playerWallets(guild,{after:'wrong'}),{code:'WALLET_CURSOR'});
});

test('a failure while writing the second reset rolls back the first player and batch receipt as well',t=>{
  const {s,filename}=fixture(t,{clock:()=>Date.parse('2026-10-26T00:00:00Z')});s.checkin(guild,user);s.checkin(guild,checkinOnly);
  const before=s.playerWallets(guild),ledger=s.db.prepare('SELECT * FROM ledger').all(),id=randomUUID();
  s.db.exec(`CREATE TRIGGER reset_fixture_abort BEFORE INSERT ON ledger WHEN NEW.kind='reset' AND NEW.user='${checkinOnly}' BEGIN SELECT RAISE(ABORT,'isolated failure'); END`);
  assert.throws(()=>s.resetWallets(guild,admin,id),/isolated failure/);assert.deepEqual(s.playerWallets(guild),before);assert.deepEqual(s.db.prepare('SELECT * FROM ledger').all(),ledger);
  assert.throws(()=>s.walletResetReport(guild,admin,id),{code:'RESET_MISSING'});
  s.db.exec('DROP TRIGGER reset_fixture_abort');assert.equal(s.resetWallets(guild,admin,id).entries.length,2);assert.equal(inspectWalletDatabase(filename,'test').ok,true);
});

test('two admin subcommands enforce permissions/confirmation and render exact before/after without reset deltas',async t=>{
  const {s}=fixture(t);s.checkin(guild,user);s.grant(guild,admin,user,500,'reward',randomUUID());
  const subcommands=commandDefinitions.find(c=>c.name==='戲籌管理').options.map(c=>c.name);assert.ok(subcommands.includes('玩家戲籌')&&subcommands.includes('重設戲籌'));
  for(const name of ['玩家戲籌','重設戲籌'])assert.match((await handleCommand(command(name,{'確認':true},'0'),s)).data.embeds[0].description,/需要管理員/);
  const list=(await handleCommand(command('玩家戲籌'),s)).data;assert.equal(list.flags,64);assert.deepEqual(list.allowed_mentions,{parse:[]});assert.match(list.embeds[0].fields[0].value,/10,600/);
  assert.match((await handleCommand(command('重設戲籌'),s)).data.embeds[0].title,/確認/);assert.equal(s.state(guild,user).balance,10600);
  const i=command('重設戲籌',{'確認':true}),first=(await handleCommand(i,s)).data.embeds[0];assert.equal(first.title,'戲籌已重設');assert.match(first.fields[0].value,/10,600 → 10,000/);assert.equal(s.state(guild,user).balance,10000);
  s.spin(guild,user,20,randomUUID());const balance=s.state(guild,user).balance;
  const report=(await handleCommand(command('重設戲籌',{'紀錄編號':i.id,'確認':true}),s)).data.embeds[0];assert.match(report.description,/沒有再次重設/);assert.deepEqual(report.fields,first.fields);assert.equal(s.state(guild,user).balance,balance);
  const history=command('紀錄',{'成員':user});history.data.resolved={members:{[user]:{}},users:{[user]:{bot:false}}};
  const row=(await handleCommand(history,s)).data.embeds[0].fields.find(f=>f.name.includes('餘額重設'));assert.match(row.name,/重設為 10,000/);assert.doesNotMatch(row.name,/[+-]\d/);assert.doesNotMatch(row.value,/[-+]600/);
});
