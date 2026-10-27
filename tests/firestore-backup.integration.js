import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,mkdirSync,rmSync,readdirSync,readFileSync,appendFileSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {FirestoreWalletStore} from '../server/firestore/wallet.js';
import {operationsSettings} from '../server/operations/operations-settings.js';
import {MaintenanceQuota,performFirestoreMaintenance,createFirestoreSnapshot} from '../server/firestore/backup.js';
import {firestoreImportPlan,importFirestore} from '../server/firestore/import.js';
import {WalletStore} from '../server/wallet/wallet.js';
import {inspectWalletDatabase} from '../server/sqlite/database.js';
import {checksum,automaticSnapshots} from '../server/recovery/automatic-backup.js';
import {maintenanceJob,Operations} from '../server/operations/operations.js';

assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8787');
const guild='100000000000000001',user='100000000000000002',admin='100000000000000003';
async function fixture(t,{baseline=false,environment='test'}={}){
  const root=resolve('test-results/firestore-backups');mkdirSync(root,{recursive:true});const directory=mkdtempSync(join(root,'case-'));
  const env={WALLET_ENABLED:'true',WALLET_BACKEND:'firestore',APP_ENV:'test',FIRESTORE_PROJECT_ID:'demo-jokers-circus',
    FIRESTORE_EMULATOR_HOST:process.env.FIRESTORE_EMULATOR_HOST,FIRESTORE_NAMESPACE:'backup-'+randomUUID()+'-test',
    FIRESTORE_QUOTA_PATH:join(directory,'quota.sqlite'),BACKUP_DIRECTORY:join(directory,'backups')};
  const settings=operationsSettings(env),stores=[];
  // Production shape can be tested on this demo emulator without real credentials.
  if(environment==='production'){
    settings.environment=settings.firestore.environment='production';settings.firestore.namespace+='-production';
  }
  const create=async(options={},config=settings.firestore)=>{
    const store=new FirestoreWalletStore(config,{guildIds:[guild],spinDelay:0,...options});stores.push(store);await store.initialize();return store;
  };
  const game=await create();
  if(baseline){
    const path=join(directory,'baseline.sqlite'),sqlite=new WalletStore({filename:path,guildIds:[guild],spinDelay:0});
    sqlite.grant(guild,admin,user,100,'existing grant',randomUUID());sqlite.spin(guild,user,20,randomUUID());sqlite.close();
    await importFirestore(game,firestoreImportPlan(path,'test'));settings.baseline=path;
  }
  const maintenance=new FirestoreWalletStore(settings.firestore,{guildIds:[guild],quota:new MaintenanceQuota(settings)});stores.push(maintenance);
  t.after(async()=>{for(const store of stores)await store.close();assert.ok(directory.startsWith(root+sep));rmSync(directory,{recursive:true,force:true});});
  const run=options=>performFirestoreMaintenance(settings,{store:maintenance,freeBytes:()=>1024**3,...options});
  return {directory,settings,game,maintenance,create,run};
}
function backupPlan(h,result){
  assert.equal(result.backup?.created,true,JSON.stringify(result));assert.equal(result.backup?.verified,true);
  const path=join(h.settings.directory,result.backup.file);assert.equal(inspectWalletDatabase(path,h.settings.environment).ok,true);
  return {path,plan:firestoreImportPlan(path,h.settings.environment)};
}

test('full cold backup and incremental backup restore claims, grants, reversals and spin deduplication',async t=>{
  const h=await fixture(t),s=h.game,request=randomUUID(),grantId=randomUUID(),reverseId=randomUUID();
  await s.checkin(guild,user);const spin=await s.spin(guild,user,20,request);
  const grant=await s.grant(guild,admin,user,100,'reward',grantId);await s.reverse(guild,admin,grant.entry.id,'correction',reverseId);
  const before=(await s.read(s.meta)).nextId,writes=s.quota.status().used.writes;
  const first=await h.run();backupPlan(h,first);assert.equal(s.quota.status().used.writes,writes);
  const next=randomUUID(),secondSpin=await s.spin(guild,user,100,next);
  const second=await h.run({forceBackup:true,now:Date.now()+1000}),backup=backupPlan(h,second);
  const restored=await h.create({}, {...h.settings.firestore,namespace:'restore-'+randomUUID()+'-test'});
  await importFirestore(restored,backup.plan);
  assert.deepEqual(await restored.state(guild,user),await s.state(guild,user));
  assert.equal((await restored.checkin(guild,user)).duplicate,true);
  for(const [id,result,bet] of [[request,spin,20],[next,secondSpin,100]]){
    const replay=await restored.spin(guild,user,bet,id);assert.equal(replay.duplicate,true);assert.deepEqual(replay.round,result.round);
  }
  assert.equal((await restored.grant(guild,admin,user,100,'reward',grantId)).duplicate,true);
  assert.equal((await restored.reverse(guild,admin,grant.entry.id,'correction',reverseId)).duplicate,true);
  await assert.rejects(restored.reverse(guild,admin,grant.entry.id,'again',randomUUID()),{code:'GRANT_REVERSED'});
  assert.equal((await s.read(s.meta)).nextId,before+1);
});

test('verified migration baseline avoids rescanning historical Firestore documents',async t=>{
  const h=await fixture(t,{baseline:true}),s=h.game,baselineHash=checksum(h.settings.baseline);
  await s.checkin(guild,user);await s.spin(guild,user,20,randomUUID());
  const before=h.maintenance.quota.status().used.reads,result=await h.run();const backup=backupPlan(h,result);
  assert.ok(h.maintenance.quota.status().used.reads-before<200);
  assert.equal(checksum(h.settings.baseline),baselineHash);assert.equal(backup.plan.audit.counts.ledger,5);
  assert.equal(backup.plan.audit.counts.operations,4);assert.equal(backup.plan.audit.counts.rounds,2);
  const restored=await h.create({}, {...h.settings.firestore,namespace:'baseline-restore-'+randomUUID()+'-test'});
  await importFirestore(restored,backup.plan);assert.deepEqual(await restored.state(guild,user),await s.state(guild,user));
});

test('incompatible baseline is refused, cloud and source files remain unchanged',async t=>{
  const h=await fixture(t,{baseline:true}),s=h.game,path=join(h.directory,'wrong.sqlite');
  const source=new WalletStore({filename:path,guildIds:[guild]});source.checkin(guild,admin);source.close();h.settings.baseline=path;
  const hash=checksum(path),meta=await s.read(s.meta),result=await h.run();
  assert.ok(result.alerts.includes('BACKUP_BASELINE_MISMATCH'));assert.equal(result.backup,null);
  assert.equal(checksum(path),hash);assert.deepEqual(await s.read(s.meta),meta);
  assert.equal(readdirSync(h.settings.directory).filter(name=>name.endsWith('.partial')||name.endsWith('.sqlite.meta.json')).length,0);
});

test('failed publish and quota shortage preserve previous valid snapshot with no retention',async t=>{
  const h=await fixture(t);await h.game.checkin(guild,user);const first=await h.run(),backup=backupPlan(h,first),hash=checksum(backup.path);
  await h.game.spin(guild,user,20,randomUUID());
  const failed=await h.run({forceBackup:true,createSnapshot:(store,settings,options)=>createFirestoreSnapshot(store,settings,{...options,beforePublish:()=>{throw new Error('simulated power loss');}})});
  assert.ok(failed.alerts.includes('BACKUP_FAILED'));assert.equal(checksum(backup.path),hash);
  assert.equal(readdirSync(h.settings.directory).filter(name=>name.includes('.partial')).length,0);
  h.maintenance.quota.maintenance.limits.reads=h.maintenance.quota.status().maintenance.used.reads+6;
  const blocked=await h.run({forceBackup:true});assert.ok(blocked.alerts.includes('FIRESTORE_MAINTENANCE_BUDGET'));
  assert.equal(checksum(backup.path),hash);assert.equal(automaticSnapshots(h.settings).length,1);
});

test('retention prunes only after a verified replacement; capacity shortage preserves all good copies',async t=>{
  const h=await fixture(t);h.settings.keepMin=1;h.settings.maxCount=2;await h.game.checkin(guild,user);
  const now=Date.now();
  for(let i=0;i<3;i++)backupPlan(h,await h.run({forceBackup:true,now:now+i*1000}));
  assert.equal(automaticSnapshots(h.settings).length,2);
  h.settings.backupMaxBytes=1;const result=await h.run({forceBackup:true,now:now+4000});
  assert.ok(result.alerts.includes('BACKUP_BUDGET_EXCEEDED'));assert.equal(automaticSnapshots(h.settings).length,2);
});

test('production zero-balance wallets without ledger events are included and audited',async t=>{
  const h=await fixture(t,{environment:'production'}),file=join(h.directory,'legacy-zero.sqlite');
  const local=new WalletStore({filename:file,environment:'production',guildIds:[guild]});local.db.prepare('INSERT INTO wallets(guild,user,balance) VALUES(?,?,0)').run(guild,user);local.close();
  await importFirestore(h.game,firestoreImportPlan(file,'production'));assert.equal((await h.game.state(guild,user)).balance,0);
  const result=await h.run(),backup=backupPlan(h,result);assert.equal(backup.plan.audit.counts.wallets,1);assert.equal(backup.plan.nextId,0);
  backupPlan(h,await h.run({forceBackup:true,now:Date.now()+1000}));
});

test('retention minimum counts good copies even when a newer backup has been damaged',async t=>{
  const h=await fixture(t);h.settings.keepMin=3;h.settings.maxCount=3;await h.game.checkin(guild,user);
  const now=Date.now();for(let i=0;i<3;i++)backupPlan(h,await h.run({forceBackup:true,now:now+i*1000}));
  appendFileSync(automaticSnapshots(h.settings)[0].path,'damaged tail');
  const result=await h.run({forceBackup:true,now:now+4000});backupPlan(h,result);assert.ok(result.alerts.includes('BACKUP_CHECKSUM_FAILED'));
  const survivors=automaticSnapshots(h.settings);assert.equal(survivors.length,3);
  for(const row of survivors)assert.equal(checksum(row.path),row.sha256);
});

test('background worker publishes private status and restart reuses the fresh backup',async t=>{
  const h=await fixture(t);await h.game.checkin(guild,user);
  const operations=new Operations(h.settings);operations.start();await operations.running;
  assert.equal(operations.isReady(),true);assert.equal(operations.status().lastCheck.backup.created,true);
  const document=readFileSync(h.settings.statusFile,'utf8');assert.doesNotMatch(document,/private_key|client_email|100000000000000002|10500/);
  await operations.close();
  const result=await maintenanceJob(h.settings);assert.equal(result.backup.created,false);assert.equal(result.audit.ok,true);
});

test('a concurrent settlement stays outside the read-only snapshot and enters the next backup',async t=>{
  const h=await fixture(t),s=h.game;await s.checkin(guild,user);
  const original=h.maintenance.read.bind(h.maintenance);let interleaved=false;
  h.maintenance.read=async(ref,tx)=>{
    const value=await original(ref,tx);
    if(tx&&ref.path===h.maintenance.meta.path&&!interleaved){interleaved=true;await s.spin(guild,user,20,randomUUID());}
    return value;
  };
  const first=backupPlan(h,await h.run());assert.equal(interleaved,true);assert.equal(first.plan.audit.counts.rounds,0);
  const next=backupPlan(h,await h.run({forceBackup:true,now:Date.now()+1000}));assert.equal(next.plan.audit.counts.rounds,1);
});

test('missing authoritative round refuses the candidate and preserves the last good snapshot',async t=>{
  const h=await fixture(t);await h.game.checkin(guild,user);const previous=backupPlan(h,await h.run());
  const spin=await h.game.spin(guild,user,20,randomUUID());await h.game.walletRef(guild,user).collection('rounds').doc(spin.round.id).delete();
  const result=await h.run({forceBackup:true});assert.ok(result.alerts.includes('BACKUP_FAILED'));
  assert.equal(automaticSnapshots(h.settings).length,1);assert.equal(inspectWalletDatabase(previous.path,'test').ok,true);
});

test('complete live snapshot can be restored and reverified on the emulator only',{
  skip:!process.env.FIRESTORE_RESTORE_SNAPSHOT,
},async t=>{
  const h=await fixture(t),source=resolve(process.env.FIRESTORE_RESTORE_SNAPSHOT),hash=checksum(source),plan=firestoreImportPlan(source,'test');
  await importFirestore(h.game,plan);
  for(const row of plan.resources.filter(row=>/^wallets\/[^/]+$/.test(row.path))){
    const actual=await h.game.read(h.game.root.collection('wallets').doc(row.path.split('/')[1]));assert.deepEqual(actual,row.data);
  }
  const db=new DatabaseSync(source,{readOnly:true});
  try{
    for(const row of db.prepare("SELECT guild,key,fingerprint,result FROM operations WHERE key LIKE 'spin:%' ORDER BY rowid DESC LIMIT 2").all()){
      h.game.guildIds.add(row.guild);const [,user,request]=row.key.split(':'),result=await h.game.spin(row.guild,user,Number(row.fingerprint),request);
      assert.equal(result.duplicate,true);assert.deepEqual(result.round,JSON.parse(row.result).round);
    }
  }finally{db.close();}
  assert.equal(checksum(source),hash);
});
