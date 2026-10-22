import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {WalletStore} from '../server/wallet.js';
import {inspectWalletDatabase} from '../server/database.js';
import {copyWalletDatabase} from '../server/database-maintenance.js';
import {LEGACY_MODELS,roundFromStops,drawStops} from '../src/game/index.js';

const guild='100000000000000001',user='100000000000000002',admin='100000000000000003';
const now=Date.parse('2026-10-22T06:00:00Z');
function fixture(t){
  const root=resolve('test-results/database-audit-tests');mkdirSync(root,{recursive:true});
  const directory=mkdtempSync(join(root,'case-')),filename=join(directory,'wallet.sqlite');
  const store=new WalletStore({filename,guildIds:[guild],clock:()=>now,spinDelay:0});
  t.after(()=>{store.close();assert.ok(directory.startsWith(root+sep));rmSync(directory,{recursive:true,force:true});});
  store.checkin(guild,user);
  const request=randomUUID(),round=store.spin(guild,user,20,request).round;
  return {store,filename,directory,request,round};
}
function rewriteRound(h,edit){const copy=structuredClone(h.round);edit(copy);h.store.db.prepare('UPDATE rounds SET data=?').run(JSON.stringify(copy));}
function rewriteSpin(h,edit){const key=`spin:${user}:${h.request}`,row=h.store.db.prepare('SELECT * FROM operations WHERE guild=? AND key=?').get(guild,key),result=JSON.parse(row.result);edit(result);h.store.db.prepare('UPDATE operations SET result=? WHERE guild=? AND key=?').run(JSON.stringify(result),guild,key);}
function rejected(h,pattern){h.store.close();const before=readFileSync(h.filename);const report=inspectWalletDatabase(h.filename,'test');assert.equal(report.ok,false,JSON.stringify(report));assert.ok(report.issues.some(issue=>pattern.test(issue)),JSON.stringify(report.issues));assert.deepEqual(readFileSync(h.filename),before);return report;}

test('audit accepts all wallet operation types and JSON key reordering without rewriting the database',t=>{
  const h=fixture(t),grant=h.store.grant(guild,admin,user,1000,'audit grant',randomUUID());
  h.store.reverse(guild,admin,grant.entry.id,'audit correction',randomUUID());
  const low='100000000000000004';h.store.tx(()=>{h.store.ensure(guild,low);h.store.once(guild,'local-fixture:qa-low','50',()=>({entry:h.store.credit(guild,low,-9950,'test_fixture',null,'local fixture')}));});
  const reversed=Object.fromEntries(Object.entries(h.round).reverse());
  h.store.db.prepare('UPDATE rounds SET data=? WHERE id=?').run(JSON.stringify(reversed),h.round.id);
  h.store.close();const before=readFileSync(h.filename),report=inspectWalletDatabase(h.filename,'test');
  assert.equal(report.ok,true,JSON.stringify(report.issues));assert.deepEqual(readFileSync(h.filename),before);
});

for(const [name,edit] of [
  ['mismatched round identity',round=>{round.id=randomUUID();}],
  ['incorrect payout arithmetic',round=>{round.payout++;}],
  ['unsupported rules',round=>{round.rules='future-rules';}],
  ['non-text rules identifiers',round=>{round.rules=['circus-20-v5'];}],
  ['forged winning combinations',round=>{round.wins=[{symbol:'wild',payout:999999}];}],
  ['a stop list that no longer produces the saved grid',round=>{round.stops=[-1,0,0,0,0];}],
])test('audit rejects '+name,t=>{const h=fixture(t);rewriteRound(h,edit);rejected(h,/Round settlement/);});

test('audit checks the immutable rules of every supported historical settlement',t=>{
  const h=fixture(t);
  for(const math of Object.values(LEGACY_MODELS)){
    const stops=[0,0,0,0,0],grid=math.gridFromStops(stops),bet=100,outcome=math.evaluateGrid(grid,bet),request=randomUUID();
    h.store.tx(()=>{
      const entry=h.store.credit(guild,user,outcome.payout-bet,'spin',user,'historical settlement',request);
      const round={...outcome,id:randomUUID(),bet,before:entry.before,after:entry.after,net:entry.delta,time:new Date(now).toISOString(),stops,grid,symbols:grid.map(col=>col[1]),rules:math.MODEL_VERSION,milestone:false};
      h.store.db.prepare('INSERT INTO rounds VALUES(?,?,?,?,?)').run(guild,user,round.id,JSON.stringify(round),now);
      h.store.db.prepare('INSERT INTO operations VALUES(?,?,?,?)').run(guild,`spin:${user}:${request}`,String(bet),JSON.stringify({round}));
    });
  }
  h.store.close();const report=inspectWalletDatabase(h.filename,'test');assert.equal(report.ok,true,JSON.stringify(report.issues));
});

test('audit rejects an altered cached spin even while balances and round JSON remain valid',t=>{
  const h=fixture(t);rewriteSpin(h,result=>{result.round.after++;});rejected(h,/Operation result/);
});

test('audit rejects spin fingerprints that disagree with the original wager',t=>{
  const h=fixture(t);h.store.db.prepare('UPDATE operations SET fingerprint=? WHERE key=?').run('500',`spin:${user}:${h.request}`);rejected(h,/Operation result/);
});

test('audit detects removed retry records, removed rounds, and duplicate retry records',async t=>{
  for(const mutation of ['missing operation','missing round','duplicate operation'])await t.test(mutation,t=>{
    const h=fixture(t),key=`spin:${user}:${h.request}`;
    if(mutation==='missing operation')h.store.db.prepare('DELETE FROM operations WHERE key=?').run(key);
    else if(mutation==='missing round')h.store.db.exec('DELETE FROM rounds');
    else h.store.db.prepare('INSERT INTO operations SELECT guild,?,fingerprint,result FROM operations WHERE key=?').run(`spin:${user}:${randomUUID()}`,key);
    rejected(h,/Spin (ledger|operation)|Operation result/);
  });
});

test('audit rejects a changed cached ledger result and an orphan checkin',async t=>{
  for(const mutation of ['changed result','missing checkin'])await t.test(mutation,t=>{
    const h=fixture(t),key=`daily:${user}:2026-10-22`;
    if(mutation==='changed result'){
      const result=JSON.parse(h.store.db.prepare('SELECT result FROM operations WHERE key=?').get(key).result);result.entry.delta++;
      h.store.db.prepare('UPDATE operations SET result=? WHERE key=?').run(JSON.stringify(result),key);
    }else h.store.db.prepare('DELETE FROM operations WHERE key=?').run(key);
    rejected(h,/Operation result|Ledger operation/);
  });
});

test('audit reports invalid JSON and valid JSON scalars without throwing',async t=>{
  for(const json of ['{','null','42','[]','{}'])await t.test(json,t=>{
    const h=fixture(t);h.store.db.prepare('UPDATE rounds SET data=?').run(json);h.store.db.prepare('UPDATE operations SET result=?').run(json);rejected(h,/round JSON|Round settlement/);
  });
});

test('backup refuses a ledger-consistent database with a forged settlement and leaves the source untouched',t=>{
  const h=fixture(t);rewriteRound(h,round=>{round.payout++;});h.store.close();
  const before=readFileSync(h.filename),target=join(h.directory,'bad-backup.sqlite');
  assert.throws(()=>copyWalletDatabase({source:h.filename,target,environment:'test'}),/failed verification/);
  assert.equal(existsSync(target),false);assert.deepEqual(readFileSync(h.filename),before);
});

test('audit keeps unsafe SQLite amounts diagnostic and does not leak player identifiers',t=>{
  const h=fixture(t);
  h.store.db.exec('DROP TRIGGER ledger_no_update; UPDATE ledger SET before=9007199254740992 WHERE id=(SELECT MIN(id) FROM ledger)');
  const report=rejected(h,/Invalid ledger amounts/);
  assert.ok(!JSON.stringify(report).includes(user));assert.ok(!JSON.stringify(report).includes(guild));
});

test('audit rejects cached results moved to a different player',t=>{
  const h=fixture(t);
  h.store.db.prepare('UPDATE operations SET key=? WHERE key=?').run(`spin:${admin}:${h.request}`,`spin:${user}:${h.request}`);
  rejected(h,/Operation result|Spin ledger/);
});

test('audit detects a reversal that targets another player grant',t=>{
  const h=fixture(t),other='100000000000000005';
  const first=h.store.grant(guild,admin,user,100,'first grant',randomUUID());
  const second=h.store.grant(guild,admin,other,100,'other grant',randomUUID());
  const request=randomUUID();h.store.reverse(guild,admin,first.entry.id,'correction',request);
  h.store.db.exec('DROP TRIGGER ledger_no_update');
  h.store.db.prepare("UPDATE ledger SET reference=? WHERE kind='reversal'").run(String(second.entry.id));
  const key=`admin:${request}`,op=h.store.db.prepare('SELECT fingerprint FROM operations WHERE key=?').get(key),fingerprint=JSON.parse(op.fingerprint);
  fingerprint[1]=second.entry.id;h.store.db.prepare('UPDATE operations SET fingerprint=? WHERE key=?').run(JSON.stringify(fingerprint),key);
  rejected(h,/Ledger reversal/);
});

test('audit detects a checkin day that no longer agrees with its recorded Taiwan time',t=>{
  const h=fixture(t);h.store.db.exec("DROP TRIGGER ledger_no_update; UPDATE ledger SET time='2026-10-23T06:00:00Z' WHERE kind='checkin'");
  rejected(h,/Ledger date/);
});

test('zero-net spins still require one distinct ledger link for each retry record',t=>{
  const h=fixture(t);let seed=19,stops;
  for(let attempt=0;attempt<20000;attempt++){
    const candidate=drawStops(()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;});
    if(roundFromStops(20,candidate).payout===20){stops=candidate;break;}
  }
  assert.ok(stops,'a deterministic break-even fixture must exist');
  const requests=[randomUUID(),randomUUID()];
  h.store.tx(()=>{
    for(const request of requests){
      const entry=h.store.credit(guild,user,0,'spin',user,'break-even',request);
      const round={...roundFromStops(20,stops),id:randomUUID(),bet:20,before:entry.before,after:entry.after,net:0,time:new Date(now).toISOString(),milestone:false};
      h.store.db.prepare('INSERT INTO rounds VALUES(?,?,?,?,?)').run(guild,user,round.id,JSON.stringify(round),now);
      h.store.db.prepare('INSERT INTO operations VALUES(?,?,?,?)').run(guild,`spin:${user}:${request}`,'20',JSON.stringify({round}));
    }
  });
  assert.equal(inspectWalletDatabase(h.filename,'test').ok,true);
  h.store.db.exec('DROP TRIGGER ledger_no_update');
  h.store.db.prepare("UPDATE ledger SET reference=? WHERE kind='spin' AND reference=?").run(requests[0],requests[1]);
  rejected(h,/Spin ledger duplicate links/);
});
