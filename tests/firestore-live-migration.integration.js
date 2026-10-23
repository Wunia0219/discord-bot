import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {FirestoreWalletStore} from '../server/firestore-wallet.js';
import {FirestoreQuota} from '../server/firestore-quota.js';
import {firestoreSettings} from '../server/firestore-settings.js';
import {firestoreImportPlan,importFirestore} from '../server/firestore-import.js';
import {operationsSettings} from '../server/operations-settings.js';
import {performFirestoreMaintenance,MaintenanceQuota} from '../server/firestore-backup.js';
import {checksum} from '../server/automatic-backup.js';
import {taipeiDay} from '../server/wallet.js';

assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8787');

test('actual snapshot migrates to v2, replays every original request, and rolls back new progress to v1',{
  skip:!process.env.FIRESTORE_RESTORE_SNAPSHOT,
},async t=>{
  const source=resolve(process.env.FIRESTORE_RESTORE_SNAPSHOT),hash=checksum(source);
  const plan=firestoreImportPlan(source,'test',{version:2});
  const root=resolve('test-results/firestore-live-migration');mkdirSync(root,{recursive:true});
  const directory=mkdtempSync(join(root,'case-')),stores=[];
  const env={APP_ENV:'test',WALLET_ENABLED:'true',WALLET_BACKEND:'firestore',FIRESTORE_SCHEMA_VERSION:'2',
    FIRESTORE_PROJECT_ID:'demo-jokers-circus',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8787',
    FIRESTORE_NAMESPACE:'real-restore-'+randomUUID()+'-test',FIRESTORE_QUOTA_PATH:join(directory,'emulator-only.sqlite'),
    BACKUP_DIRECTORY:join(directory,'backups'),FIRESTORE_BACKUP_BASELINE:source};
  const settings=firestoreSettings(env),wallets=plan.resources.filter(r=>/^wallets\/[^/]+$/.test(r.path));
  const guildIds=[...new Set(wallets.map(r=>r.data.guild))];
  // Exhaustive replay is emulator-only. Never load or reset the live project's allowance.
  const create=(config=settings)=>{
    assert.equal(config.projectId,'demo-jokers-circus');assert.equal(config.emulator,'127.0.0.1:8787');
    const quota=new FirestoreQuota({...config.quota,reads:1000000,writes:1000000,egressBytes:1024**3});
    const store=new FirestoreWalletStore(config,{guildIds,quota,spinDelay:0});stores.push(store);return store;
  };
  t.after(async()=>{for(const s of stores)await s.close();assert.ok(directory.startsWith(root+sep));rmSync(directory,{recursive:true,force:true});});
  const s=create();assert.equal((await importFirestore(s,plan)).verified,true);
  const db=new DatabaseSync(source,{readOnly:true});
  let operations,entries;
  try{operations=db.prepare('SELECT * FROM operations ORDER BY guild,key').all();entries=db.prepare('SELECT * FROM ledger ORDER BY id DESC').all();}
  finally{db.close();}

  for(const {data:expected} of wallets){
    const {guild,user}=expected;
    assert.deepEqual(await s.read(s.walletRef(guild,user)),expected);
    assert.equal((await s.state(guild,user,{compact:true})).balance,expected.balance);
    assert.equal((await s.state(guild,user,{compact:true})).claimed,expected.claimedDay===taipeiDay(Date.now()));
    assert.deepEqual(await s.auditSummary(guild,user),expected.summary);
    const rounds=[];let before=Number.MAX_SAFE_INTEGER;
    do{const page=await s.rounds(guild,user,{before,limit:100});rounds.push(...page.rows);before=page.next;}while(before);
    const expectedRounds=plan.resources.filter(r=>r.path.startsWith(`wallets/${guild}_${user}/rounds/`))
      .map(r=>({sequence:r.index.sequence,round:r.data})).sort((a,b)=>b.sequence-a.sequence);
    assert.deepEqual(rounds,expectedRounds);
    const ledger=[];before=Number.MAX_SAFE_INTEGER;
    for(;;){const page=await s.history(guild,user,before);ledger.push(...page);if(page.length<50)break;before=page.at(-1).id;}
    assert.deepEqual(ledger,entries.filter(e=>e.guild===guild&&e.user===user).map(e=>({...e})));
  }
  const replayAll=async store=>{
    const before=await store.read(store.meta),writes=store.quota.status().used.writes;
    for(const op of operations){
      const expected=JSON.parse(op.result);let result;
      if(op.key.startsWith('spin:')){
        const [,user,...request]=op.key.split(':');
        result=await store.spin(op.guild,user,Number(op.fingerprint),request.join(':'),{compact:true});
      }else{
        // Older SQLite results retain only entry ID and balances. Recover routing
        // fields from the original ledger while checking the exact saved result.
        const entry=entries.find(row=>row.id===expected.entry?.id);assert.ok(entry);
        store.clock=()=>Date.parse(entry.time);
        if(entry.kind==='checkin')result=await store.checkin(op.guild,entry.user,{compact:true});
        else{
          assert.ok(['grant','reversal','test_fixture'].includes(entry.kind));
          const request=op.key.slice('admin:'.length);
          if(entry.kind==='grant')result=await store.grant(op.guild,entry.actor,entry.user,entry.delta,entry.reason,request);
          else if(entry.kind==='reversal')result=await store.reverse(op.guild,entry.actor,Number(entry.reference),entry.reason,request);
          else result=await store.transact(op.guild,entry.user,{kind:'fixture',requestId:request,fingerprint:op.fingerprint},{compact:true});
        }
      }
      assert.equal(result.duplicate,true);
      for(const [key,value] of Object.entries(expected))assert.deepEqual(result[key],value);
    }
    store.clock=Date.now;
    assert.equal(store.quota.status().used.writes,writes,'all old requests perform zero writes');
    assert.deepEqual(await store.read(store.meta),before);
  };
  await replayAll(s);
  const settingsBackup=operationsSettings(env);
  const maintenance=new FirestoreWalletStore(settings,{guildIds,quota:new MaintenanceQuota(settingsBackup)});stores.push(maintenance);
  const backup=()=>performFirestoreMaintenance(settingsBackup,{store:maintenance,forceBackup:true});
  const first=await backup();assert.equal(first.backup?.created,true,JSON.stringify(first));
  assert.equal(firestoreImportPlan(join(settingsBackup.directory,first.backup.file),'test',{version:2}).fingerprint,plan.fingerprint);
  // New progress exists only in this isolated copy; rollback must preserve it too.
  const actor=wallets[0].data;const now=Math.max(Date.now(),...entries.map(e=>Date.parse(e.time)))+86400000;
  s.clock=()=>now;
  const claim=await s.checkin(actor.guild,actor.user,{compact:true});assert.equal(claim.duplicate,undefined);
  assert.equal((await s.checkin(actor.guild,actor.user,{compact:true})).duplicate,true);
  const request=randomUUID(),spin=await s.spin(actor.guild,actor.user,20,request,{compact:true});
  assert.equal(spin.duplicate,undefined);
  const second=await backup();assert.equal(second.backup?.created,true,JSON.stringify(second));
  const rollbackSource=join(settingsBackup.directory,second.backup.file),rollbackPlan=firestoreImportPlan(rollbackSource,'test');
  const restored=create({...settings,schemaVersion:1,namespace:'real-rollback-'+randomUUID()+'-test'});
  assert.equal((await importFirestore(restored,rollbackPlan)).verified,true);
  for(const row of rollbackPlan.resources.filter(r=>/^wallets\/[^/]+$/.test(r.path)))
    assert.deepEqual(await restored.read(restored.db.doc(restored.root.path+'/'+row.path)),row.data);
  await replayAll(restored);restored.clock=()=>now;
  assert.equal((await restored.checkin(actor.guild,actor.user,{compact:true})).duplicate,true);
  const replay=await restored.spin(actor.guild,actor.user,20,request,{compact:true});
  assert.equal(replay.duplicate,true);assert.deepEqual(replay.round,spin.round);assert.equal(replay.state.balance,spin.state.balance);
  assert.equal(checksum(source),hash);
  writeFileSync('test-results/firestore-live-migration-rehearsal.json',JSON.stringify({
    verifiedAt:new Date().toISOString(),emulatorOnly:true,source,sourceSha256:hash,counts:plan.audit.counts,
    v2Documents:plan.resources.length,v2Fingerprint:plan.fingerprint,allBalancesAndRecordsVerified:true,
    originalRequestsReplayedPerVersion:operations.length,replayVersions:[2,1],replaysWriteNothing:true,
    newCheckinAndSpinSurviveRollback:true,rollbackCounts:rollbackPlan.audit.counts,sourceUnchanged:true,
  },null,2)+'\n');
});
