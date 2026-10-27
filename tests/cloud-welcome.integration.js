import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {WalletStore} from '../server/wallet.js';
import {FirestoreWalletStore} from '../server/firestore-wallet.js';
import {FirestoreWalletCore} from '../server/firestore-wallet-core.js';
import {firestoreImportPlan,importFirestore} from '../server/firestore-import.js';
import {SettlementQueue} from '../server/settlement-queue.js';
import {FirestoreRest} from '../cloud/firestore-rest.js';
import {CloudBackup} from '../cloud/backup.js';
import {CloudQuota,QUOTA_LIMITS} from '../cloud/quota.js';
import {CloudState,Sealer} from '../cloud/storage.js';
import {SnapshotVault} from '../cloud/snapshot.js';
import {snapshotForCloud,decodeCloudArchive,restoreCloudSnapshot} from '../server/cloud-handoff.js';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8787');

test('production REST opening credits back up and restore without refilling legacy zero wallets or issuing a second welcome',async t=>{
  const root=resolve('test-results/cloud-welcome');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'case-'));
  const guild='100000000000000001',legacy='100000000000000002',user='100000000000000003',spinner='100000000000000004',claimant='100000000000000005';
  const file=join(dir,'baseline.sqlite'),local=new WalletStore({filename:file,environment:'production',guildIds:[guild]});
  local.db.prepare('INSERT INTO wallets(guild,user,balance) VALUES(?,?,0)').run(guild,legacy);local.close();
  const settings={projectId:'demo-jokers-circus',namespace:'welcome-'+randomUUID()+'-production',environment:'production',schemaVersion:2,
    emulator:process.env.FIRESTORE_EMULATOR_HOST,quota:{filename:join(dir,'sdk-quota.sqlite'),projectId:'demo-jokers-circus'}};
  const sdk=new FirestoreWalletStore(settings,{guildIds:[guild]});t.after(()=>sdk.close());const plan=firestoreImportPlan(file,'production',{version:2});await importFirestore(sdk,plan);
  const sql=new DatabaseSync(join(dir,'durable.sqlite'));t.after(()=>sql.close());let nesting=0;
  const storage={sql:{exec:(q,...a)=>sql.prepare(q).all(...a).map(r=>({...r}))},transactionSync(fn){const id='s'+nesting++;sql.exec('SAVEPOINT '+id);try{const result=fn();sql.exec('RELEASE '+id);return result;}catch(e){sql.exec('ROLLBACK TO '+id);sql.exec('RELEASE '+id);throw e;}finally{nesting--;}}};
  let state=new CloudState(storage);const quota=new CloudQuota(storage,state);quota.seed({projectId:settings.projectId,exportedAt:Date.now(),scopes:Object.fromEntries(Object.entries(QUOTA_LIMITS).map(([k,v])=>[k,{limits:v,growth:0,usage:[],documents:[]}]))},settings.projectId);
  const key=randomBytes(32).toString('hex'),baseline=snapshotForCloud(file,'production',{upstreamImportFingerprint:plan.fingerprint});
  let vault=new SnapshotVault(storage,state,new Sealer(key));vault.save('baseline',baseline);vault.publish('baseline');
  const db=new FirestoreRest(settings),s=new FirestoreWalletCore(settings,{db,quota,guildIds:[guild],spinDelay:0,settlementQueue:new SettlementQueue()});await s.initialize();
  assert.equal((await s.state(guild,legacy)).balance,0);assert.equal((await s.state(guild,user)).balance,10000);assert.equal((await s.state(guild,user)).balance,10000);
  const spinId=randomUUID(),spin=await s.spin(guild,spinner,20,spinId);assert.equal(spin.round.before,10000);
  const claim=await s.checkin(guild,claimant);assert.equal(claim.entry.before,10000);assert.equal(claim.state.balance,10500);
  let backup=new CloudBackup(s,state,vault),steps=0;
  while(true){const result=await backup.step();steps++;if(result.complete)break;if(steps===1){state=new CloudState(storage);vault=new SnapshotVault(storage,state,new Sealer(key));backup=new CloudBackup(s,state,vault);}assert.ok(steps<10);}
  const snapshot=decodeCloudArchive(vault.archive(state.get('backup-latest')),key,'production');assert.equal(snapshot.tables.ledger.filter(e=>e.kind==='welcome').length,3);
  assert.equal(snapshot.tables.wallets.find(w=>w.user===legacy).balance,0);
  const target=join(dir,'restored.sqlite');restoreCloudSnapshot(snapshot,target,'production');
  const restored=new WalletStore({filename:target,environment:'production',guildIds:[guild]});t.after(()=>restored.close());
  for(const [id,balance] of [[legacy,0],[user,10000],[spinner,spin.round.after],[claimant,10500]])assert.equal(restored.state(guild,id).balance,balance);
  assert.equal(restored.checkin(guild,claimant).duplicate,true);assert.deepEqual(restored.spin(guild,spinner,20,spinId).round,spin.round);
  assert.deepEqual(snapshotForCloud(target,'production').tables,snapshot.tables);
  for(const version of [1,2]){
    const remote=new FirestoreWalletStore({...settings,namespace:`restored-${version}-${randomUUID()}-production`,schemaVersion:version},{guildIds:[guild]});t.after(()=>remote.close());
    await importFirestore(remote,firestoreImportPlan(target,'production',{version}));assert.equal((await remote.state(guild,legacy)).balance,0);assert.equal((await remote.state(guild,user)).balance,10000);
    assert.equal((await remote.history(guild,user)).filter(e=>e.kind==='welcome').length,1);
  }
});
