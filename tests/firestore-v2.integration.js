import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {FirestoreWalletStore} from '../server/firestore-wallet.js';
import {firestoreSettings} from '../server/firestore-settings.js';
import {firestoreImportPlan,importFirestore} from '../server/firestore-import.js';
import {WalletStore} from '../server/wallet.js';
import {roundFromStops} from '../src/game/index.js';
import {createActivityServer} from '../server/app.js';
import {createWalletClient} from '../src/platform/wallet-client.js';
import {operationsSettings} from '../server/operations-settings.js';
import {MaintenanceQuota,performFirestoreMaintenance} from '../server/firestore-backup.js';
import {checksum} from '../server/automatic-backup.js';

assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8787');
const guild='100000000000000001',user='100000000000000002',admin='100000000000000003',other='100000000000000004';
async function fixture(t){
  const root=resolve('test-results/firestore-v2');mkdirSync(root,{recursive:true});const directory=mkdtempSync(join(root,'case-')),stores=[];
  const env={APP_ENV:'test',WALLET_ENABLED:'true',WALLET_BACKEND:'firestore',FIRESTORE_SCHEMA_VERSION:'2',
    FIRESTORE_PROJECT_ID:'demo-jokers-circus',FIRESTORE_EMULATOR_HOST:process.env.FIRESTORE_EMULATOR_HOST,
    FIRESTORE_NAMESPACE:'v2-'+randomUUID()+'-test',FIRESTORE_QUOTA_PATH:join(directory,'quota.sqlite'),BACKUP_DIRECTORY:join(directory,'backups')};
  const settings=firestoreSettings(env);
  const create=async(config=settings,options={},initialize=true)=>{
    const store=new FirestoreWalletStore(config,{guildIds:[guild,other],spinDelay:0,...options});stores.push(store);if(initialize)await store.initialize();return store;
  };
  t.after(async()=>{for(const s of stores)await s.close();assert.ok(directory.startsWith(root+sep));rmSync(directory,{recursive:true,force:true});});
  const s=await create();return {s,settings,env,directory,create};
}
const compact={compact:true};

for(const version of [1,2])test(`v${version} reset and concurrent play serialize from authoritative balances; retained state, read-only report and retry survive restart`,async t=>{
  const h=await fixture(t),settings={...h.settings,schemaVersion:version,namespace:`reset-v${version}-${randomUUID()}-test`};
  let now=Date.parse('2026-10-26T00:00:00Z');const options={clock:()=>now},a=await h.create(settings,options),b=await h.create(settings,options);
  await a.checkin(guild,user,compact);await a.checkin(guild,other,compact);await a.state(other,user,compact);
  const prior=await a.spin(guild,user,20,randomUUID(),compact),checkin=await a.state(guild,user,compact),before=await a.auditSummary(guild,user);
  const readMany=a.readMany.bind(a);let release,arrived;const gate=new Promise(r=>release=r),ready=new Promise(r=>arrived=r);let held=false;
  // Hold the reset after its first transactional read. A second service's spin
  // either commits before a retried reset, or waits and uses the reset balance.
  a.readMany=async(refs,tx)=>{const data=await readMany(refs,tx);if(!held&&refs.length===2){held=true;arrived();await gate;}return data;};
  const id=randomUUID(),resetPromise=a.resetWallets(guild,admin,id);await ready;
  const spinPromise=b.spin(guild,user,20,randomUUID(),compact);release();
  const [reset,spin]=await Promise.all([resetPromise,spinPromise]);a.readMany=readMany;
  const entry=reset.entries.find(e=>e.user===user),history=await a.history(guild,user),resetLedger=history.find(e=>e.kind==='reset'),spinLedger=history.find(e=>e.kind==='spin'&&e.id!==prior.state.revision);
  assert.equal(entry.before,resetLedger.before);
  if(spinLedger.id<resetLedger.id)assert.equal(entry.before,spin.round.after);else{assert.equal(spin.round.before,10000);assert.equal(entry.before,prior.round.after);}
  assert.equal(reset.entries.length,2);assert.equal(reset.entries.find(e=>e.user===other).before,10100);
  a.cache.clear();b.cache.clear();const after=await a.state(guild,user,compact);
  assert.deepEqual(after.weeklyCheckin,checkin.weeklyCheckin);assert.equal(after.balanceReset.roundId,spinLedger.id<resetLedger.id?spin.round.id:prior.round.id);
  assert.equal((await a.auditSummary(guild,user)).game.rounds,before.game.rounds+1);assert.equal((await a.auditSummary(guild,user)).checkin.days,1);
  assert.equal((await a.state(other,user,compact)).balance,10000);
  const usage=a.quota.status().used.writes,again=await a.resetWallets(guild,admin,id);assert.deepEqual(again,{...reset,duplicate:true});assert.equal(a.quota.status().used.writes,usage);
  assert.deepEqual(await a.walletResetReport(guild,admin,id),{...reset,duplicate:true});assert.equal(a.quota.status().used.writes,usage);
  await assert.rejects(a.resetWallets(guild,other,id),{code:'REQUEST_CONFLICT'});
  const roster=await a.playerWallets(guild);assert.deepEqual(roster.rows.map(w=>w.user),[user,other]);assert.equal(a.quota.status().used.writes,usage);
  const c=await h.create(settings,options);assert.deepEqual(await c.walletResetReport(guild,admin,id),{...reset,duplicate:true});
  assert.equal((await c.auditHistory(guild,user,{category:'rewards'})).rows[0].kind,'reset');
  const snap=await c.read(c.walletRef(guild,user)),meta=await c.read(c.meta);c.quota.limits.writes=c.quota.status().used.writes+3;
  await assert.rejects(c.resetWallets(guild,admin,randomUUID()),{code:'FIRESTORE_BUDGET'});
  assert.deepEqual(JSON.parse((await c.walletRef(guild,user).get()).get('json')),snap);assert.deepEqual(JSON.parse((await c.meta.get()).get('json')),meta);
});

test('v2 reset writes only two documents per existing player plus one receipt and counter; pagination never creates wallets',async t=>{
  const h=await fixture(t),s=h.s;
  for(let i=0;i<21;i++)await s.state(guild,String(100000000000000100n+BigInt(i)),compact);
  const used=s.quota.status().used.writes,list=await s.playerWallets(guild),next=await s.playerWallets(guild,{after:list.next});
  assert.equal(list.rows.length,20);assert.equal(next.rows.length,1);assert.equal(next.next,null);assert.equal(s.quota.status().used.writes,used);
  const reset=await s.resetWallets(guild,admin,randomUUID());assert.equal((s.quota.status().used.writes-used)/2,44);assert.equal(reset.reset.changed,0);
  assert.equal(reset.entries.length,21);assert.ok(reset.entries.every(e=>e.delta===0));
});

for(const version of [1,2])test(`v${version} empty and excessive guild resets refuse atomically before changing any records`,async t=>{
  const h=await fixture(t),s=await h.create({...h.settings,schemaVersion:version,namespace:`reset-limit-${version}-${randomUUID()}-test`});
  const writes=s.quota.status().used.writes;await assert.rejects(s.resetWallets(guild,admin,randomUUID()),{code:'RESET_EMPTY'});assert.equal(s.quota.status().used.writes,writes);
  const file=join(h.directory,'limit.sqlite'),local=new WalletStore({filename:file,guildIds:[guild]});
  for(let i=0;i<(version===1?61:101);i++)local.state(guild,String(100000000000000100n+BigInt(i)));local.checkin(guild,'100000000000000100');local.close();
  await importFirestore(s,firestoreImportPlan(file,'test',{version}));const meta=await s.read(s.meta),before=s.quota.status().used.writes;
  await assert.rejects(s.resetWallets(guild,admin,randomUUID()),{code:'RESET_LIMIT'});assert.equal(s.quota.status().used.writes,before);assert.deepEqual(await s.read(s.meta),meta);
  assert.equal((await s.state(guild,'100000000000000100',compact)).balance,10100);
});

for(const version of [1,2])test(`v${version} weekly claims persist across devices, cycle, interruptions, configuration changes and replay`,async t=>{
  const h=await fixture(t),settings={...h.settings,schemaVersion:version,namespace:`weekly-v${version}-${randomUUID()}-test`};
  let now=Date.parse('2026-12-28T15:59:59.999Z');const options={clock:()=>now};
  let a=await h.create(settings,options),b=await h.create(settings,options);let total=10000;
  for(let i=0;i<9;i++){
    const cycleDay=i%7+1;
    const result=await Promise.all([a.checkin(guild,user,compact),b.checkin(guild,user,compact)]);
    assert.equal(result.filter(r=>r.duplicate).length,1);assert.deepEqual(result[0].entry,result[1].entry);assert.deepEqual(result[0].checkin,result[1].checkin);
    total+=cycleDay*100;assert.equal(result[0].state.balance,total);assert.equal(result[0].checkin.cycleDay,cycleDay);
    assert.equal(result[0].state.weeklyCheckin.nextReward,(cycleDay%7+1)*100);
    const before=a.quota.status().used.writes,again=await a.checkin(guild,user,compact);
    assert.equal(again.duplicate,true);assert.equal(a.quota.status().used.writes,before);
    await a.close();a=await h.create(settings,options);assert.equal((await a.state(guild,user,compact)).claimed,true);
    now+=86400000;
  }
  assert.deepEqual((await a.auditSummary(guild,user)).checkin,{days:9,total:3100});
  now+=86400000;assert.equal((await a.state(guild,user,compact)).weeklyCheckin.day,1);
  const reset=await a.checkin(guild,user,compact);assert.equal(reset.entry.delta,100);
  const changed=await h.create(settings,{...options,weeklyRewards:[10,40,90,160,250,360,490]});
  assert.equal((await changed.state(guild,user,compact)).daily,100);assert.equal((await changed.state(guild,user,compact)).weeklyCheckin.nextReward,40);
  assert.deepEqual((await changed.checkin(guild,user,compact)).checkin,reset.checkin);
  now+=86400000;assert.equal((await changed.checkin(guild,user,compact)).entry.delta,40);
  assert.equal((await a.checkin(other,user,compact)).entry.delta,100);
});

function source(h,count=0){
  const filename=join(h.directory,'source.sqlite'),s=new WalletStore({filename,guildIds:[guild],spinDelay:0});
  s.checkin(guild,user);for(let i=0;i<count;i++)s.spin(guild,user,20,randomUUID());
  const granted=s.grant(guild,admin,user,100,'保留原獎勵',randomUUID());s.reverse(guild,admin,granted.entry.id,'原更正',randomUUID());s.close();return filename;
}

test('v2 reduces a settled spin to six writes and lightweight state while retaining all 105 imported rounds',async t=>{
  const h=await fixture(t),filename=source(h,105);
  const old=await h.create({...h.settings,schemaVersion:1,namespace:'v1-'+randomUUID()+'-test'});
  const plan1=firestoreImportPlan(filename,'test'),plan2=firestoreImportPlan(filename,'test',{version:2});
  await importFirestore(old,plan1);await importFirestore(h.s,plan2);
  const settledAt=Date.now()+2000;old.clock=h.s.clock=()=>settledAt;
  const measure=async s=>{
    let writeBytes=0;const write=s.write.bind(s);s.write=(tx,ref,data,options)=>{
      writeBytes+=Buffer.byteLength(JSON.stringify({json:JSON.stringify(data),...options?.index}));return write(tx,ref,data,options);
    };
    const before=s.quota.status().used;
    const result=await s.transact(guild,user,{kind:'spin',bet:20,requestId:'fixed-v2-benchmark-1234',fingerprint:'20',
      outcome:roundFromStops(20,[0,0,0,0,0]),roundId:'fixed-round-v2-benchmark'},compact);
    const after=s.quota.status().used;s.write=write;
    const wallet=await s.read(s.walletRef(guild,user));
    return {writes:(after.writes-before.writes)/2,readJsonBytes:after.egressBytes-before.egressBytes,writeJsonBytes:writeBytes,
      responseBytes:Buffer.byteLength(JSON.stringify(result)),walletBytes:Buffer.byteLength(JSON.stringify(wallet)),result};
  };
  const a=await measure(old),b=await measure(h.s);assert.equal(a.writes,10);assert.equal(b.writes,6);
  for(const key of ['readJsonBytes','writeJsonBytes','responseBytes','walletBytes'])assert.ok(b[key]<a[key]*.3,`${key}: ${a[key]} -> ${b[key]}`);
  assert.equal(b.result.state.history,undefined);assert.deepEqual(b.result.round,a.result.round);
  const all=[];let before=Number.MAX_SAFE_INTEGER;
  do{const page=await h.s.rounds(guild,user,{before,limit:50});all.push(...page.rows);before=page.next;}while(before);
  assert.equal(all.length,106);assert.equal(new Set(all.map(r=>r.round.id)).size,106);
  assert.equal((await h.s.state(guild,user)).history.length,100);
  assert.equal((await h.s.auditSummary(guild,user)).game.rounds,106);
  assert.equal((await h.s.walletRef(guild,user).collection('ledger').get()).size,0);
  h.s.cache.clear();h.s.histories.clear();
  const coldBefore=h.s.quota.status().used.reads,state=await h.s.state(guild,user,compact);
  const recent=await h.s.rounds(guild,user,{through:state.historyRevision});
  assert.equal(recent.rows.length,100);assert.ok(recent.next);
  assert.equal(h.s.quota.status().used.reads-coldBefore,6,'cold login and recent history use one wallet read');
  const {result:ar,...v1}=a,{result:br,...v2}=b;
  writeFileSync('test-results/spark-v2-metrics.json',JSON.stringify({sample:'105 identical imported rounds; one identical new round; no retries',v1,v2,
    coldLoginDocumentReads:{v1:1,v2:1},importDocuments:{v1:plan1.resources.length,v2:plan2.resources.length}},null,2));
});

test('v2 concurrent duplicate spins and checkins settle once, survive restart, and roll back on budget exhaustion',async t=>{
  const h=await fixture(t),a=h.s,b=await h.create(),request=randomUUID();
  const claims=await Promise.all([a.checkin(guild,user,compact),b.checkin(guild,user,compact)]);assert.equal(claims.filter(r=>r.duplicate).length,1);
  const spins=await Promise.all([a.spin(guild,user,20,request,compact),b.spin(guild,user,20,request,compact)]);
  assert.deepEqual(spins[0].round,spins[1].round);assert.equal(spins.filter(r=>r.duplicate).length,1);
  await a.close();const c=await h.create(),again=await c.spin(guild,user,20,request,compact);assert.equal(again.duplicate,true);
  assert.deepEqual(again.round,spins[0].round);await assert.rejects(c.spin(guild,user,100,request,compact),{code:'REQUEST_CONFLICT'});
  const original=await c.read(c.walletRef(guild,user)),ledger=await c.history(guild,user);
  c.quota.limits.writes=c.quota.status().used.writes+5;
  await assert.rejects(c.spin(guild,user,20,randomUUID(),compact),{code:'FIRESTORE_BUDGET'});
  assert.deepEqual(JSON.parse((await c.walletRef(guild,user).get()).get('json')),original);
  assert.deepEqual(await c.history(guild,user),ledger);
});

test('v2 single-field ledger indexes preserve categories, dates, cursors, reversals and account isolation',async t=>{
  const h=await fixture(t);let now=Date.parse('2026-10-23T00:00:00Z');h.s.clock=()=>now;
  const grants=[];for(let i=0;i<13;i++)grants.push(await h.s.grant(guild,admin,user,1,'期間內',randomUUID()));
  now=Date.parse('2026-08-01T00:00:00Z');for(let i=0;i<12;i++)await h.s.grant(guild,admin,user,1,'期間外',randomUUID());
  now=Date.parse('2026-10-23T00:00:00Z');const reversal=await h.s.reverse(guild,admin,grants[0].entry.id,'更正',randomUUID());
  await h.s.checkin(guild,user,compact);await h.s.spin(guild,user,20,randomUUID(),compact);
  await h.s.grant(other,admin,user,100,'別群',randomUUID());await h.s.grant(guild,admin,other,100,'別人',randomUUID());
  const first=await h.s.auditHistory(guild,user,{category:'rewards',days:30}),second=await h.s.auditHistory(guild,user,{category:'rewards',days:30,before:first.next});
  const rows=[...first.rows,...second.rows];assert.equal(rows.length,14);assert.equal(second.next,null);
  assert.equal(rows.find(r=>r.id===grants[0].entry.id).reversal_id,reversal.entry.id);
  assert.ok(rows.every(r=>r.guild===guild&&r.user===user&&r.day==='2026-10-23'));
  for(const [category,count] of [['game',1],['checkin',1]])assert.equal((await h.s.auditHistory(guild,user,{category,days:1})).rows.length,count);
  assert.ok((await h.s.auditHistory(guild,user,{category:'all',days:1})).next);
  assert.ok((await h.s.history(guild,user)).every(r=>r.guild===guild&&r.user===user));
});

test('v2 import resumes after interruption, rejects v1 namespace reuse and preserves original request results',async t=>{
  const h=await fixture(t),filename=source(h,3),plan=firestoreImportPlan(filename,'test',{version:2}),hash=checksum(filename),write=h.s.write;let interrupted=false;
  h.s.write=function(tx,ref,data,options){if(ref.path===this.meta.path&&data.status==='importing'&&data.importDone>2&&!interrupted){interrupted=true;throw new Error('shutdown');}return write.call(this,tx,ref,data,options);};
  await assert.rejects(importFirestore(h.s,plan,{batchSize:2}),/shutdown/);assert.equal(await h.s.isReady(),false);h.s.write=write;
  assert.equal((await importFirestore(h.s,plan,{batchSize:2})).verified,true);assert.equal((await importFirestore(h.s,plan)).alreadyImported,true);
  const spin=plan.resources.find(r=>r.path.startsWith('operations/')&&r.data.result.round),round=spin.data.result.round;
  const entry=plan.resources.find(r=>r.path.startsWith('ledger/')&&r.data.kind==='spin'&&r.data.time===round.time&&r.data.before===round.before).data;
  const replay=await h.s.spin(guild,user,round.bet,entry.reference,compact);assert.equal(replay.duplicate,true);assert.deepEqual(replay.round,round);
  assert.equal(checksum(filename),hash);
  const incompatible=await h.create({...h.settings,schemaVersion:1},{},false);
  await assert.rejects(incompatible.initialize(),{code:'FIRESTORE_SCHEMA'});
  await assert.rejects(importFirestore(incompatible,firestoreImportPlan(filename,'test')),/schema version.*mismatch/);
});

test('v2 migration rechecks schema inside its transaction if another service changes an empty target',async t=>{
  const h=await fixture(t),plan=firestoreImportPlan(source(h),'test',{version:2}),read=h.s.read.bind(h.s);let changed=false;
  h.s.read=async(ref,tx)=>{
    const data=await read(ref,tx);
    if(!tx&&!changed&&ref.path===h.s.meta.path){changed=true;await h.s.meta.set({json:JSON.stringify({...data,version:1})});}
    return data;
  };
  await assert.rejects(importFirestore(h.s,plan),/schema version.*mismatch/);
  const meta=JSON.parse((await h.s.meta.get()).get('json'));
  assert.equal(meta.version,1);assert.equal(meta.status,'ready');assert.equal(meta.nextId,0);
  assert.equal((await h.s.root.collection('wallets').get()).size,0);
});

test('v2 full and incremental backups restore to both v2 and v1 without losing original deduplication',async t=>{
  const h=await fixture(t),request=randomUUID(),s=h.s;await s.checkin(guild,user,compact);const spin=await s.spin(guild,user,20,request,compact);
  const grant=await s.grant(guild,admin,user,100,'reward',randomUUID());await s.reverse(guild,admin,grant.entry.id,'correction',randomUUID());
  const settings=operationsSettings(h.env),maintenance=await h.create(h.settings,{quota:new MaintenanceQuota(settings)},false);
  const run=()=>performFirestoreMaintenance(settings,{store:maintenance,freeBytes:()=>1024**3,forceBackup:true});
  const first=await run();assert.equal(first.backup?.verified,true,JSON.stringify(first));
  const resetId=randomUUID(),reset=await s.resetWallets(guild,admin,resetId);
  await s.spin(guild,user,20,randomUUID(),compact);const next=await run();assert.equal(next.backup?.verified,true,JSON.stringify(next));
  const filename=join(settings.directory,next.backup.file);
  for(const version of [2,1]){
    const restored=await h.create({...h.settings,schemaVersion:version,namespace:'restore-'+version+'-'+randomUUID()+'-test'});
    await importFirestore(restored,firestoreImportPlan(filename,'test',{version}));
    assert.equal((await restored.state(guild,user)).balance,(await s.state(guild,user,compact)).balance);
    const replay=await restored.spin(guild,user,20,request,compact);assert.equal(replay.duplicate,true);assert.deepEqual(replay.round,spin.round);
    assert.equal((await restored.auditSummary(guild,user)).game.rounds,2);
    assert.deepEqual(await restored.resetWallets(guild,admin,resetId),{...reset,duplicate:true});
    assert.equal((await restored.state(guild,user,compact)).balanceReset.roundId,spin.round.id);
  }
});

test('real compact HTTP clients preserve recent history across devices and can load older rounds privately',async t=>{
  const h=await fixture(t);await importFirestore(h.s,firestoreImportPlan(source(h,105),'test',{version:2}));
  const server=createActivityServer({wallet:{store:h.s,service:{authorize:async header=>{
    if(!header)throw Object.assign(new Error('登入已過期'),{status:401});return {guild,user};
  }}},clientId:admin,clientSecret:'fixture',publicKey:'a'.repeat(64)});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const base=`http://127.0.0.1:${server.address().port}`,paths=[];
  const fetchImpl=(path,options)=>{paths.push(path);return fetch(base+path,options);};
  const session={guildId:guild,userId:user,token:'test'},a=createWalletClient(session,fetchImpl,null),b=createWalletClient(session,fetchImpl,null);
  let current=await a.state();assert.equal(current.state.history.length,100);
  const before=paths.filter(p=>p.startsWith('/api/rounds')).length;
  const spin=await a.spin(20);assert.equal(spin.state.history.length,100);assert.equal(spin.state.history[0].id,spin.round.id);
  assert.equal(paths.filter(p=>p.startsWith('/api/rounds')).length,before);
  await b.state();const remote=await b.spin(20);current=await a.state();assert.equal(current.state.history[0].id,remote.round.id);
  assert.equal(new Set(current.state.history.map(r=>r.id)).size,100);
  const older=await a.rounds(current.state.historyBefore);assert.equal(older.rows.length,7);assert.equal(older.next,null);
  assert.equal((await fetch(base+'/api/rounds')).status,401);
  assert.equal((await fetch(base+'/api/rounds?limit=10000',{headers:{Authorization:'Bearer test'}})).status,400);
  // Old clients still receive the full snapshot, with no protocol negotiation.
  assert.equal((await (await fetch(base+'/api/wallet',{headers:{Authorization:'Bearer test'}})).json()).state.history.length,100);
});
