import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {randomUUID,generateKeyPairSync,sign} from 'node:crypto';
import {FirestoreWalletStore} from '../server/firestore-wallet.js';
import {firestoreSettings} from '../server/firestore-settings.js';
import {walletConfig} from '../server/config.js';
import {createActivityServer} from '../server/app.js';
import {MODEL_VERSION,roundFromStops} from '../src/game/index.js';
import {WalletStore} from '../server/wallet.js';
import {firestoreImportPlan,importFirestore} from '../server/firestore-import.js';
import {APP_VERSION} from '../src/version.js';

assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8787','Integration tests require the isolated local emulator');
const guild='100000000000000001',user='100000000000000002',admin='100000000000000003',other='100000000000000004';
async function fixture(t,options={}){
  const root=resolve('test-results/firestore-integration');mkdirSync(root,{recursive:true});const directory=mkdtempSync(join(root,'case-'));
  const env={APP_ENV:'test',FIRESTORE_PROJECT_ID:'demo-jokers-circus',FIRESTORE_EMULATOR_HOST:process.env.FIRESTORE_EMULATOR_HOST,
    FIRESTORE_NAMESPACE:'case-'+randomUUID()+'-test',FIRESTORE_QUOTA_PATH:join(directory,'quota.sqlite')};
  const settings=firestoreSettings(env),stores=[];
  const create=async extra=>{const store=new FirestoreWalletStore(settings,{guildIds:[guild,other],spinDelay:0,...options,...extra});stores.push(store);await store.initialize();return store;};
  const h={directory,settings,env,create};
  t.after(async()=>{await h.beforeCleanup?.();for(const store of stores)await store.close();assert.ok(directory.startsWith(root+sep));rmSync(directory,{recursive:true,force:true});});
  h.store=await create();return h;
}
const raw=async ref=>{const doc=await ref.get();return doc.exists?JSON.parse(doc.get('json')):null;};

test('Firestore seeds once, isolates guilds/accounts, persists restarts and credits new production wallets',async t=>{
  const h=await fixture(t),s=h.store;
  assert.equal((await s.state(guild,user)).balance,10000);assert.equal((await s.state(guild,user)).balance,10000);
  await s.checkin(guild,user);assert.equal((await s.state(other,user)).balance,10000);assert.equal((await s.state(guild,admin)).balance,10000);
  await s.close();const reopened=await h.create();assert.equal((await reopened.state(guild,user)).balance,10500);
  assert.equal((await reopened.history(guild,user)).filter(row=>row.kind==='test_seed').length,1);
  const prod=new FirestoreWalletStore({...h.settings,namespace:h.settings.namespace+'-production',environment:'production'},{guildIds:[guild]});
  try{await prod.initialize();assert.equal((await prod.state(guild,user)).balance,10000);assert.equal((await prod.history(guild,user))[0].kind,'welcome');}finally{await prod.close();}
  await assert.rejects(reopened.state('999999999999999999',user),{code:'GUILD_CLOSED'});
});

test('concurrent checkins from independent devices credit one Taipei daily claim',async t=>{
  let now=Date.parse('2026-10-22T15:59:59Z');const h=await fixture(t,{clock:()=>now}),a=h.store,b=await h.create();
  const results=await Promise.all([a.checkin(guild,user),b.checkin(guild,user)]);
  assert.equal(results.filter(result=>result.duplicate).length,1);assert.equal((await a.history(guild,user)).filter(row=>row.kind==='checkin').length,1);
  a.cache.clear();assert.equal((await a.state(guild,user)).balance,10500);
  now+=2000;assert.equal((await b.checkin(guild,user)).state.balance,11000);
  assert.equal((await a.auditSummary(guild,user,1)).checkin.days,1);
});

test('same spin sent concurrently settles once and survives a lost response plus restart',async t=>{
  const h=await fixture(t),a=h.store,b=await h.create(),request=randomUUID();
  const results=await Promise.all([a.spin(guild,user,20,request),b.spin(guild,user,20,request)]);
  assert.deepEqual(results[0].round,results[1].round);assert.equal(results.filter(result=>result.duplicate).length,1);
  assert.equal(results[0].round.rules,MODEL_VERSION);assert.deepEqual(roundFromStops(20,results[0].round.stops).payout,results[0].round.payout);
  await a.close();const c=await h.create(),again=await c.spin(guild,user,20,request);
  assert.equal(again.duplicate,true);assert.deepEqual(again.round,results[0].round);
  assert.equal((await c.history(guild,user)).filter(row=>row.kind==='spin').length,1);
  await assert.rejects(c.spin(guild,user,100,request),{code:'REQUEST_CONFLICT'});
});

test('two distinct concurrent spins preserve ledger continuity and the balance equation',async t=>{
  const h=await fixture(t),a=h.store,b=await h.create();await a.state(guild,user);
  const results=await Promise.all([a.spin(guild,user,20,randomUUID()),b.spin(guild,user,20,randomUUID())]);
  a.cache.clear();const state=await a.state(guild,user),entries=(await a.history(guild,user)).reverse();
  assert.equal(state.balance,10000+results.reduce((sum,row)=>sum+row.round.net,0));
  for(let i=1;i<entries.length;i++)assert.equal(entries[i].before,entries[i-1].after);
});

test('cooldowns, insufficient funds and invalid requests cannot partially commit',async t=>{
  let now=Date.parse('2026-10-22T00:00:00Z');const h=await fixture(t,{clock:()=>now,spinDelay:2000}),s=h.store;
  await s.spin(guild,user,20,randomUUID());const before=await s.history(guild,user);
  const reads=s.quota.status().used.reads,writes=s.quota.status().used.writes;
  await assert.rejects(s.spin(guild,user,20,randomUUID()),{code:'SPIN_COOLDOWN'});
  // The daily summary now shares the first batch; denied rounds reserve the
  // same four-document read budget as accepted rounds and still write nothing.
  assert.equal(s.quota.status().used.reads-reads,24);assert.equal(s.quota.status().used.writes,writes);
  assert.deepEqual(await s.history(guild,user),before);assert.throws(()=>s.spin(guild,user,21,randomUUID()),/無效/);
  await s.ensureFixture(guild,admin,0,'zero');await assert.rejects(s.spin(guild,admin,20,randomUUID()),/戲籌不足/);
  assert.equal((await s.state(guild,admin)).balance,0);
});

test('grants, reversals and actor daily limits remain idempotent across devices',async t=>{
  const h=await fixture(t,{grantDaily:1000}),s=h.store,b=await h.create();
  const id=randomUUID(),grant=await s.grant(guild,admin,user,1000,'獎勵',id);
  assert.equal((await b.grant(guild,admin,user,1000,'獎勵',id)).duplicate,true);
  await assert.rejects(s.grant(guild,admin,user,1,'超額',randomUUID()),{code:'GRANT_DAILY'});
  const request=randomUUID(),reversal=await b.reverse(guild,admin,grant.entry.id,'更正',request);
  assert.equal(reversal.entry.after,10000);assert.equal((await s.reverse(guild,admin,grant.entry.id,'更正',request)).duplicate,true);
  await assert.rejects(s.reverse(guild,admin,grant.entry.id,'再次',randomUUID()),{code:'GRANT_REVERSED'});
  await assert.rejects(s.reverse(other,admin,grant.entry.id,'跨群',randomUUID()),{code:'GRANT_MISSING'});
  const audit=await s.auditHistory(guild,user);assert.equal(audit.rows.find(row=>row.kind==='grant').reversal_id,reversal.entry.id);
});

test('bounded wallet snapshots retain 100 rounds while summaries include all history',async t=>{
  const h=await fixture(t),s=h.store;
  let payout=0;for(let i=0;i<105;i++)payout+=(await s.spin(guild,user,20,randomUUID())).round.payout;
  const state=await s.state(guild,user),summary=await s.auditSummary(guild,user);
  assert.equal(state.history.length,100);assert.equal(summary.game.rounds,105);assert.equal(summary.game.bet,2100);assert.equal(summary.game.payout,payout);
  const first=await s.auditHistory(guild,user,{category:'game'}),second=await s.auditHistory(guild,user,{category:'game',before:first.next});
  assert.equal(first.rows.length,10);assert.equal(second.rows.length,10);assert.ok(first.rows.every(row=>row.id>second.rows[0].id));
});

test('querying selected Taipei days includes older rewards without scanning spins',async t=>{
  let now=Date.parse('2026-10-21T15:59:59Z');const h=await fixture(t,{clock:()=>now}),s=h.store;
  await s.grant(guild,admin,user,100,'昨天',randomUUID());await s.checkin(guild,user);
  now+=2000;await s.grant(guild,admin,user,200,'今天',randomUUID());await s.checkin(guild,user);
  const today=await s.auditHistory(guild,user,{days:1,category:'rewards'}),week=await s.auditHistory(guild,user,{days:7,category:'rewards'});
  assert.equal(today.rows.length,1);assert.equal(week.rows.length,2);assert.equal((await s.auditSummary(guild,user,7)).checkin.days,2);
});

test('audit fallback on existing daily indexes handles clock rollback and paginates without loss',async t=>{
  let now=Date.parse('2026-10-23T00:00:00Z');const h=await fixture(t,{clock:()=>now}),s=h.store;
  for(let i=0;i<13;i++)await s.grant(guild,admin,user,1,'期間內',randomUUID());
  now=Date.parse('2026-08-01T00:00:00Z');
  for(let i=0;i<12;i++)await s.grant(guild,admin,user,1,'舊日期較大編號',randomUUID());
  now=Date.parse('2026-10-23T00:00:00Z');
  const first=await s.auditHistory(guild,user,{category:'rewards',days:30});
  const second=await s.auditHistory(guild,user,{category:'rewards',days:30,before:first.next});
  assert.equal(first.rows.length,10);assert.equal(second.rows.length,3);assert.equal(second.next,null);
  const rows=[...first.rows,...second.rows];assert.equal(new Set(rows.map(row=>row.id)).size,13);
  assert.ok(rows.every(row=>row.reason==='期間內'));
});

test('summary date range includes only selected Taipei days and returns zeros for empty ranges',async t=>{
  let now=Date.parse('2026-09-23T16:00:00Z');const h=await fixture(t,{clock:()=>now}),s=h.store;
  await s.checkin(guild,user); // First included day for October 23 / 30 days.
  now-=86400000;await s.checkin(guild,user); // Just outside.
  now=Date.parse('2026-10-23T00:00:00Z');await s.checkin(guild,user);
  now+=86400000;await s.checkin(guild,user); // Future day must not leak in.
  now-=86400000;
  assert.equal((await s.auditSummary(guild,user,30)).checkin.days,2);
  assert.equal((await s.auditSummary(guild,user,1)).checkin.days,1);
  assert.equal((await s.auditSummary(guild,other,30)).checkin.days,0);
});

test('concurrent readiness probes share one remote read after freshness expires',async t=>{
  let now=Date.parse('2026-10-23T00:00:00Z');const h=await fixture(t,{clock:()=>now}),s=h.store;now+=60001;
  const before=s.quota.status().used.reads;
  assert.ok((await Promise.all(Array.from({length:20},()=>s.isReady()))).every(Boolean));
  assert.equal(s.quota.status().used.reads-before,6);
});

test('cache and concurrent read coalescing reduce polling without serving a stale local settlement',async t=>{
  const h=await fixture(t),s=h.store;await s.state(guild,user);s.cache.clear();
  const before=s.quota.status().used.reads;await Promise.all(Array.from({length:20},()=>s.state(guild,user)));
  assert.equal(s.quota.status().used.reads-before,6);await s.checkin(guild,user);assert.equal((await s.state(guild,user)).balance,10500);
});

test('budget exhaustion inside a transaction leaves wallet, ledger and dedup unchanged',async t=>{
  const h=await fixture(t),s=h.store;await s.state(guild,user);
  const before=await raw(s.walletRef(guild,user));s.quota.limits.writes=s.quota.status().used.writes+1;
  await assert.rejects(s.spin(guild,user,20,randomUUID()),{code:'FIRESTORE_BUDGET'});
  assert.deepEqual(await raw(s.walletRef(guild,user)),before);assert.equal((await s.walletRef(guild,user).collection('rounds').get()).size,0);
});

test('metadata/environment mismatch and provider errors fail closed without raw messages',async t=>{
  const h=await fixture(t),s=h.store;await s.meta.set({json:JSON.stringify({version:99,environment:'production',status:'ready',nextId:0})});
  await assert.rejects(s.checkin(guild,user),{code:'FIRESTORE_SCHEMA'});
  const failure=s.safe(Object.assign(new Error('provider-private-key / path'),{status:400}));assert.equal(failure.status,503);assert.doesNotMatch(failure.message,/private-key|path/);
});

test('HTTP wallet API awaits Firestore transactions and never serializes a Promise',async t=>{
  const h=await fixture(t),s=h.store;
  const server=createActivityServer({wallet:{store:s,service:{authorize:async()=>({guild,user})}},clientId:admin,clientSecret:'fixture',publicKey:'a'.repeat(64)});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));h.beforeCleanup=()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base+'/readyz')).status,200);
  assert.equal((await (await fetch(base+'/api/wallet')).json()).state.balance,10000);
  const response=await fetch(base+'/api/spin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bet:20,requestId:randomUUID()})});
  const data=await response.json();assert.equal(response.status,200);assert.equal(typeof data.state.balance,'number');assert.ok(data.round.id);
  assert.equal((await (await fetch(base+'/api/ledger')).json()).entries.filter(row=>row.kind==='spin').length,1);
});

test('signed Discord commands await Firestore while preserving private replies and permission checks',async t=>{
  const h=await fixture(t),keys=generateKeyPairSync('ed25519'),publicKey=keys.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('hex');
  const replies=[];
  const server=createActivityServer({publicKey,clientId:admin,clientSecret:'fixture',wallet:{store:h.store,adminRoles:[]},
    fetchImpl:async(url,options)=>{replies.push({url,options});return new Response('{}',{status:200});}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));h.beforeCleanup=()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
  const body=JSON.stringify({type:2,application_id:admin,id:randomUUID(),token:'fixture-token-1234567890',guild_id:guild,member:{user:{id:user},permissions:'0'},data:{name:'簽到'}}),timestamp=String(Math.floor(Date.now()/1000));
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/interactions`,{method:'POST',headers:{
    'x-signature-timestamp':timestamp,'x-signature-ed25519':sign(null,Buffer.concat([Buffer.from(timestamp),Buffer.from(body)]),keys.privateKey).toString('hex')},body});
  const result=await response.json();assert.equal(response.status,200);assert.equal(result.type,5);assert.equal(result.data.flags,64);
  await server.drainCommands();assert.equal(replies.length,1);assert.equal(replies[0].options.method,'PATCH');
  const privateResult=JSON.parse(replies[0].options.body);assert.match(privateResult.embeds[0].description,/10,500/);assert.deepEqual(privateResult.allowed_mentions,{parse:[]});
});

test('local browser QA requires a separate namespace and retains fixture state on restart',async t=>{
  const h=await fixture(t);await h.store.close();
  const env={...h.env,WALLET_ENABLED:'true',WALLET_BACKEND:'firestore',HOST:'127.0.0.1',LOCAL_WALLET_TEST:'true',FIRESTORE_NAMESPACE:h.settings.namespace.replace(/-test$/,'-qa-test')};
  const a=await walletConfig(env);
  try{const overview=await a.localOverview();assert.equal(overview.version,APP_VERSION);assert.deepEqual(overview.profiles.map(row=>row.balance),[10000,10000,50,0]);
    await a.store.checkin(guild,'100000000000000011');}finally{await a.store.close();}
  const b=await walletConfig(env);try{assert.equal((await b.localOverview()).profiles[0].balance,10500);}finally{await b.store.close();}
  await assert.rejects(walletConfig({...env,FIRESTORE_NAMESPACE:h.settings.namespace}),/separate namespace/);
});

test('anonymous clients cannot read or write wallet documents under production-style rules',async t=>{
  const h=await fixture(t);await h.store.state(guild,user);
  const url=`http://127.0.0.1:8787/v1/projects/demo-jokers-circus/databases/(default)/documents/circus_wallet_v1/${h.settings.namespace}/wallets/${guild}_${user}`;
  assert.equal((await fetch(url)).status,403);
  assert.equal((await fetch(url,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({fields:{balance:{integerValue:'999999'}}})})).status,403);
});

function importSource(h){
  const filename=join(h.directory,'source.sqlite'),source=new WalletStore({filename,guildIds:[guild],spinDelay:0});
  source.checkin(guild,user);const request=randomUUID(),round=source.spin(guild,user,20,request).round;
  const grant=source.grant(guild,admin,user,100,'獎勵',randomUUID());source.reverse(guild,admin,grant.entry.id,'更正',randomUUID());
  const state=source.state(guild,user),history=source.history(guild,user);source.close();
  return {filename,request,round,state,history,plan:firestoreImportPlan(filename,'test')};
}
test('SQLite migration preserves balances, original rounds, ledger, claims and request deduplication',async t=>{
  const h=await fixture(t),source=importSource(h),result=await importFirestore(h.store,source.plan);
  assert.equal(result.verified,true);assert.deepEqual(await h.store.state(guild,user),source.state);
  assert.equal(JSON.stringify(await h.store.history(guild,user)),JSON.stringify(source.history));
  assert.equal((await h.store.checkin(guild,user)).duplicate,true);
  const again=await h.store.spin(guild,user,20,source.request);assert.equal(again.duplicate,true);assert.deepEqual(again.round,source.round);
  assert.equal((await importFirestore(h.store,source.plan)).alreadyImported,true);
  assert.equal(firestoreImportPlan(source.filename,'test').fingerprint,source.plan.fingerprint);
});
test('interrupted migration stays unavailable, resumes atomically, and refuses populated targets',async t=>{
  const h=await fixture(t),source=importSource(h),s=h.store,write=s.write;let failed=false;
  s.write=function(tx,ref,data,options){if(ref.path===s.meta.path&&data.status==='importing'&&data.importDone>2&&!failed){failed=true;throw new Error('simulated shutdown');}return write.call(s,tx,ref,data,options);};
  await assert.rejects(importFirestore(s,source.plan,{batchSize:2}),/simulated shutdown/);
  assert.equal(await s.isReady(),false);assert.equal((await raw(s.meta)).importDone,2);
  s.write=write;assert.equal((await importFirestore(s,source.plan,{batchSize:2})).verified,true);
  assert.equal((await s.state(guild,user)).balance,source.state.balance);
  const populated=await h.create();populated.settings={...h.settings};
  // A different source fingerprint cannot replace a completed namespace.
  await assert.rejects(importFirestore(populated,{...source.plan,fingerprint:'different'}),/not empty/);
});
test('migration cannot start when the full copy and verification exceed the local allowance',async t=>{
  const h=await fixture(t),source=importSource(h),s=h.store;
  s.quota.limits.writes=s.quota.status().used.writes+1;
  await assert.rejects(importFirestore(s,source.plan),/Insufficient application allowance/);
  assert.equal((await raw(s.meta)).status,'ready');assert.equal((await s.root.collection('wallets').get()).size,0);
});
