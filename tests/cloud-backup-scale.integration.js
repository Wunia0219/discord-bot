import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {WalletStore} from '../server/wallet/wallet.js';
import {FirestoreWalletStore} from '../server/firestore/wallet.js';
import {firestoreImportPlan,importFirestore} from '../server/firestore/import.js';
import {FirestoreWalletCore} from '../server/firestore/wallet-core.js';
import {FirestoreRest} from '../cloud/firestore-rest.js';
import {CloudState,Sealer} from '../cloud/storage.js';
import {CloudQuota,QUOTA_LIMITS} from '../cloud/quota.js';
import {SnapshotVault} from '../cloud/snapshot.js';
import {SettlementQueue} from '../server/wallet/settlement-queue.js';
import {CloudBackup} from '../cloud/backup.js';
import {snapshotForCloud,decodeCloudArchive,restoreCloudSnapshot} from '../server/recovery/cloud-handoff.js';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8787');

test('20-player 1000-round incremental backup fits unchanged maintenance cap and restores every original result',async t=>{
 const started=performance.now(),root=resolve('test-results/backup-scale');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'run-'));
 const guild='100000000000000001',users=Array.from({length:20},(_,i)=>String(100000000000000100n+BigInt(i))),filename=join(dir,'source.sqlite');
 const wallet=new WalletStore({filename,environment:'test',guildIds:[guild],spinDelay:0});
 for(const user of users)wallet.grant(guild,user,user,100000,'isolated scale fixture',randomUUID());
 const baseline=snapshotForCloud(filename,'test');
 for(let i=0;i<1000;i++)wallet.spin(guild,users[i%20],20,randomUUID());wallet.close();
 const settings={projectId:'demo-jokers-circus',namespace:'scale-'+randomUUID()+'-test',environment:'test',schemaVersion:2,emulator:process.env.FIRESTORE_EMULATOR_HOST,quota:{filename:join(dir,'import-quota.sqlite'),projectId:'demo-jokers-circus'}};
 const sdk=new FirestoreWalletStore(settings,{guildIds:[guild]}),plan=firestoreImportPlan(filename,'test',{version:2});t.after(()=>sdk.close());await importFirestore(sdk,plan);
 const sql=new DatabaseSync(join(dir,'durable.sqlite'));t.after(()=>sql.close());let nested=0;
 const storage={sql:{exec:(query,...args)=>sql.prepare(query).all(...args).map(x=>({...x}))},transactionSync(fn){const name='s'+nested++;sql.exec('SAVEPOINT '+name);try{const result=fn();sql.exec('RELEASE '+name);return result;}catch(e){sql.exec('ROLLBACK TO '+name);sql.exec('RELEASE '+name);throw e;}finally{nested--;}}};
 let state=new CloudState(storage);const global=new CloudQuota(storage,state);global.seed({projectId:settings.projectId,exportedAt:Date.now(),scopes:Object.fromEntries(Object.entries(QUOTA_LIMITS).map(([k,v])=>[k,{limits:v,growth:0,usage:[],documents:[]}]))},settings.projectId);
 baseline.upstreamImportFingerprint=plan.fingerprint;const key=randomBytes(32).toString('hex');let vault=new SnapshotVault(storage,state,new Sealer(key));vault.save('baseline',baseline);vault.publish('baseline');
 let wireReads=0;const db=new FirestoreRest({...settings,fetchImpl:async(url,options)=>{const body=JSON.parse(options.body);wireReads+=body.documents?.length||body.structuredQuery?.limit||0;return fetch(url,options);}});
 const store=new FirestoreWalletCore(settings,{db,quota:new CloudQuota(storage,state,{scope:'maintenance'}),guildIds:[guild]});
 let backup=new CloudBackup(store,state,vault),steps=0;const backupStarted=performance.now();
 while(true){const r=await backup.step();steps++;if(r.complete)break;if(steps===10){state=new CloudState(storage);vault=new SnapshotVault(storage,state,new Sealer(key));backup=new CloudBackup(store,state,vault);}assert.ok(steps<70);}
 const used=store.quota.totals().reads;assert.equal(used,3041);assert.equal(used,wireReads);assert.ok(used<6000);assert.equal(global.status().used.reads,used);
 const recovered=decodeCloudArchive(vault.archive(state.get('backup-latest')),key,'test'),expected=snapshotForCloud(filename,'test');assert.deepEqual(recovered.tables,expected.tables);
 restoreCloudSnapshot(recovered,join(dir,'restored.sqlite'),'test');assert.deepEqual(snapshotForCloud(join(dir,'restored.sqlite'),'test').tables,expected.tables);
 const backupMs=Math.round(performance.now()-backupStarted);
 // Simultaneous authoritative transactions; every retry retains its original key.
 const play=new FirestoreWalletCore(settings,{db,quota:global,guildIds:[guild],settlementQueue:new SettlementQueue()});await play.initialize();
 const ids=users.map(()=>randomUUID()),concurrentStarted=performance.now();
 const attempts=await Promise.allSettled(users.map((user,i)=>play.spin(guild,user,20,ids[i],{compact:true})));
 const initialRejected=attempts.filter(x=>x.status==='rejected').length;assert.equal(initialRejected,0,'bounded queue removes shared-counter conflicts');
 const settlements=[];for(let i=0;i<users.length;i++)settlements.push(attempts[i].status==='fulfilled'?attempts[i].value:await play.spin(guild,users[i],20,ids[i],{compact:true}));
 for(let i=0;i<users.length;i++){const duplicate=await play.spin(guild,users[i],20,ids[i],{compact:true});assert.equal(duplicate.duplicate,true);assert.deepEqual(duplicate.round,settlements[i].round);}
 const meta=await play.read(play.meta);assert.equal(meta.nextId,expected.revision+20,'exactly one ledger entry per player');
 const scenarios=[];play.spinDelay=0;
 for(const count of [2,5,8,10]){
   const start=performance.now(),keys=users.slice(0,count).map(()=>randomUUID());
   const values=await Promise.all(users.slice(0,count).map(async(user,i)=>{await new Promise(resolve=>setTimeout(resolve,i*60));return play.spin(guild,user,20,keys[i],{compact:true});}));
   assert.equal(new Set(values.map(x=>x.round.id)).size,count);
   scenarios.push({players:count,staggerMs:60,settled:values.length,elapsedMs:Math.round(performance.now()-start)});
 }
 const report={scenarios,ok:true,emulatorOnly:true,players:20,newRounds:1000,backupSteps:steps,maintenanceReadUnits:used,previousReservationUnits:used*6,unchangedMaintenanceCap:6000,allSevenTablesEqual:true,restartedMidBackup:true,snapshotBytes:Buffer.byteLength(JSON.stringify(recovered)),backupMs,concurrent:{players:20,initialRejected,allSettledAfterSameKeyRetry:true,duplicateSettlements:0,elapsedMs:Math.round(performance.now()-concurrentStarted)},totalMs:Math.round(performance.now()-started),scope:'Incremental backup and concurrent emulator transactions; not simultaneous browser play or real Cloudflare CPU'};
 // A group reset spans multiple 20-entry checkpoints. Its immutable receipt
 // must be backed up once, including across a Durable Object reconstruction.
 await play.state(guild,'100000000000000199',{compact:true});
 const resetId=randomUUID(),reset=await play.resetWallets(guild,users[0],resetId);assert.equal(reset.entries.length,21);
 const post=await play.spin(guild,users[0],20,randomUUID(),{compact:true});assert.equal(post.round.before,10000);
 let resetSteps=0;while(true){const r=await backup.step();resetSteps++;if(r.complete)break;if(resetSteps===2){state=new CloudState(storage);vault=new SnapshotVault(storage,state,new Sealer(key));backup=new CloudBackup(store,state,vault);}assert.ok(resetSteps<20);}
 const resetSnapshot=decodeCloudArchive(vault.archive(state.get('backup-latest')),key,'test');
 assert.equal(resetSnapshot.tables.operations.filter(o=>o.key==='reset:'+resetId).length,1);assert.equal(resetSnapshot.tables.ledger.filter(e=>e.kind==='reset').length,21);
 const resetFile=join(dir,'reset-restored.sqlite');restoreCloudSnapshot(resetSnapshot,resetFile,'test');
 const restored=new WalletStore({filename:resetFile,environment:'test',guildIds:[guild],spinDelay:0});
 try{assert.deepEqual(restored.resetWallets(guild,users[0],resetId),{...reset,duplicate:true});assert.equal(restored.state(guild,users[0]).balance,post.round.after);}finally{restored.close();}
 report.reset={players:21,checkpointSteps:resetSteps,receiptCopies:1,restartedMidBackup:true,replayedWithoutOverwritingPostResetSpin:true};
 writeFileSync('test-results/backup-scale-report.json',JSON.stringify(report,null,2));
});
