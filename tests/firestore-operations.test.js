import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {operationsSettings} from '../server/operations-settings.js';
import {MaintenanceQuota,performFirestoreMaintenance} from '../server/firestore-backup.js';
import {FirestoreQuota} from '../server/firestore-quota.js';
import {WalletStore} from '../server/wallet.js';
import {checksum} from '../server/automatic-backup.js';
import {Operations} from '../server/operations.js';

function fixture(t,extra={}){
  const root=resolve('test-results/firestore-operations');mkdirSync(root,{recursive:true});const directory=mkdtempSync(join(root,'case-'));
  const env={WALLET_ENABLED:'true',WALLET_BACKEND:'firestore',APP_ENV:'test',FIRESTORE_PROJECT_ID:'demo-circus',
    FIRESTORE_EMULATOR_HOST:'127.0.0.1:8787',FIRESTORE_QUOTA_PATH:join(directory,'quota.sqlite'),BACKUP_DIRECTORY:join(directory,'backups'),...extra};
  const settings=operationsSettings(env);mkdirSync(settings.directory,{recursive:true});
  const quota=new MaintenanceQuota(settings);t.after(()=>{quota.close();assert.ok(directory.startsWith(root+sep));rmSync(directory,{recursive:true,force:true});});
  const store={quota,checkMeta:meta=>assert.equal(meta.status,'ready'),async read(){quota.reserve({reads:6});return {status:'ready'};}};
  return {env,settings,store,quota,directory};
}
function snapshot(h,now){
  const file=`test-${new Date(now).toISOString().replace(/[:.]/g,'-')}-abcdef01.sqlite`,path=join(h.settings.directory,file);
  const store=new WalletStore({filename:path,guildIds:['100000000000000001']});store.close();
  const row={format:1,backend:'firestore',sourceId:h.settings.sourceId,environment:'test',projectId:h.settings.firestore.projectId,
    namespace:h.settings.firestore.namespace,file,createdAt:now,revision:0,sha256:checksum(path)};
  writeFileSync(path+'.meta.json',JSON.stringify(row));return {path,row};
}
const freeBytes=()=>1024**3;

test('Firestore maintenance uses slower Spark defaults, isolated identity and bounded settings',t=>{
  const h=fixture(t),s=h.settings;
  assert.equal(s.backupIntervalMs,86400000);assert.equal(s.monitorIntervalMs,600000);
  assert.equal(s.maintenanceQuota.reads,6000);assert.equal(s.maxCount,7);assert.equal(s.keepMin,3);
  assert.notEqual(operationsSettings({...h.env,FIRESTORE_NAMESPACE:'other-test'}).sourceId,s.sourceId);
  for(const invalid of [{FIRESTORE_MONITOR_INTERVAL_SECONDS:'59'},{FIRESTORE_BACKUP_INTERVAL_MINUTES:'59'},
    {FIRESTORE_MAINTENANCE_READ_BUDGET:'40001'},{BACKUP_KEEP_MIN:'8'},{FIRESTORE_MAINTENANCE_EGRESS_MB:'0'}])assert.throws(()=>operationsSettings({...h.env,...invalid}));
  assert.equal(operationsSettings({...h.env,OPERATIONS_ENABLED:'false'}),null);
  assert.equal(operationsSettings({...h.env,LOCAL_WALLET_TEST:'true'}),null);
  assert.equal(operationsSettings({...h.env,LOCAL_WALLET_TEST:'true',OPERATIONS_ENABLED:'true'}).backend,'firestore');
});

test('persistent maintenance sub-budget shares total usage but leaves capacity for gameplay',t=>{
  const h=fixture(t,{FIRESTORE_MAINTENANCE_READ_BUDGET:'12'}),q=h.quota;
  q.reserve({reads:12});assert.throws(()=>q.reserve({reads:6}),{code:'FIRESTORE_MAINTENANCE_BUDGET'});
  assert.equal(q.status().used.reads,12);assert.equal(q.status().maintenance.used.reads,12);
  const game=new FirestoreQuota(h.settings.firestore.quota);game.reserve({reads:6});assert.equal(q.status().used.reads,18);game.close();
  const reopened=new MaintenanceQuota(h.settings);assert.throws(()=>reopened.reserve({reads:6}),{code:'FIRESTORE_MAINTENANCE_BUDGET'});reopened.close();
  assert.throws(()=>q.reserve({writes:1}),{code:'BACKUP_REMOTE_WRITE_REFUSED'});assert.equal(q.status().used.writes,0);
});

test('project-wide exhaustion prevents a remote reservation and does not refund uncertainty',t=>{
  const h=fixture(t,{FIRESTORE_READ_BUDGET:'12',FIRESTORE_MAINTENANCE_READ_BUDGET:'12'});
  const game=new FirestoreQuota(h.settings.firestore.quota);game.reserve({reads:12});game.close();
  assert.throws(()=>h.quota.reserve({reads:6}),{code:'FIRESTORE_BUDGET'});
  assert.equal(h.quota.status().used.reads,12);assert.equal(h.quota.status().maintenance.used.reads,6);
});

test('a probe crossing the project limit is immediately visible and blocks readiness',async t=>{
  const h=fixture(t,{FIRESTORE_READ_BUDGET:'12',FIRESTORE_MAINTENANCE_READ_BUDGET:'12'}),now=Date.now();snapshot(h,now);h.quota.reserve({reads:6});
  const result=await performFirestoreMaintenance(h.settings,{store:h.store,now,freeBytes});
  assert.ok(result.alerts.includes('FIRESTORE_QUOTA_EXHAUSTED'));
  const operations=new Operations(h.settings,{job:async()=>result});operations.start();await operations.running;
  assert.equal(operations.isReady(),false);await operations.close();
});

test('fresh snapshots survive restarts with one metadata probe and no full scan',async t=>{
  const h=fixture(t),now=Date.now(),previous=snapshot(h,now);
  for(let i=0;i<2;i++){
    const result=await performFirestoreMaintenance(h.settings,{store:h.store,now:now+i*600000,freeBytes,createSnapshot:()=>assert.fail('fresh backup must be reused')});
    assert.equal(result.audit.ok,true);assert.equal(result.backup.created,false);assert.deepEqual(result.alerts,[]);
  }
  assert.equal(h.quota.status().used.reads,12);assert.equal(checksum(previous.path),previous.row.sha256);
});

test('backup failure preserves last good snapshot, skips retention and redacts provider details',async t=>{
  const h=fixture(t),now=Date.now(),previous=snapshot(h,now-3*86400000);
  const result=await performFirestoreMaintenance(h.settings,{store:h.store,now,freeBytes,
    createSnapshot:()=>{throw new Error('private-key token player-id C:/secret.json');}});
  assert.deepEqual(result.alerts,['BACKUP_FAILED','BACKUP_STALE']);assert.equal(result.backup.verified,true);
  assert.equal(checksum(previous.path),previous.row.sha256);assert.doesNotMatch(JSON.stringify(result),/private-key|token|player-id|secret\.json/);
});

test('disk pressure blocks backup; remote outage is unhealthy without deleting backups',async t=>{
  const h=fixture(t),now=Date.now(),previous=snapshot(h,now);
  const disk=await performFirestoreMaintenance(h.settings,{store:h.store,now,forceBackup:true,freeBytes:()=>0,createSnapshot:()=>assert.fail('disk guard')});
  assert.ok(disk.alerts.includes('DISK_SPACE_LOW'));
  h.store.read=()=>{throw new Error('provider secret');};
  const outage=await performFirestoreMaintenance(h.settings,{store:h.store,now,freeBytes});
  assert.equal(outage.audit.ok,false);assert.ok(outage.alerts.includes('DATABASE_UNAVAILABLE'));assert.ok(existsSync(previous.path));
});

test('maintenance exhaustion stops network work, flags degraded verification and retains snapshot',async t=>{
  const h=fixture(t,{FIRESTORE_MAINTENANCE_READ_BUDGET:'6'}),now=Date.now();snapshot(h,now);h.quota.reserve({reads:6});
  const result=await performFirestoreMaintenance(h.settings,{store:h.store,now,freeBytes});
  assert.equal(result.audit.remoteVerified,false);assert.deepEqual(result.alerts,['FIRESTORE_MAINTENANCE_BUDGET']);
  assert.equal(result.backup.created,false);assert.equal(h.quota.status().used.reads,6);
});

test('corrupt backup is reported; only owned interrupted candidates are cleaned',async t=>{
  const h=fixture(t),now=Date.now(),previous=snapshot(h,now);writeFileSync(previous.path,'damaged');
  const file='test-2026-10-23T01-00-00-000Z-1234abcd.sqlite.partial',candidate=join(h.settings.directory,file);
  writeFileSync(candidate,'interrupted');writeFileSync(candidate+'.meta.json',JSON.stringify({sourceId:h.settings.sourceId,environment:'test',file}));
  for(const suffix of ['-journal','-wal','-shm'])writeFileSync(candidate+suffix,'interrupted SQLite journal');
  const foreign=join(h.settings.directory,'foreign.sqlite.partial');writeFileSync(foreign,'preserve');
  const result=await performFirestoreMaintenance(h.settings,{store:h.store,now,freeBytes,createSnapshot:()=>{throw new Error('failed');}});
  assert.ok(result.alerts.includes('BACKUP_CHECKSUM_FAILED'));assert.ok(result.alerts.includes('BACKUP_MISSING'));
  assert.equal(existsSync(candidate),false);assert.equal(readFileSync(foreign,'utf8'),'preserve');assert.ok(existsSync(previous.path));
  for(const suffix of ['-journal','-wal','-shm'])assert.equal(existsSync(candidate+suffix),false);
});

test('local lock prevents independent workers from overlapping cloud scans',async t=>{
  const h=fixture(t);mkdirSync(join(h.settings.directory,'operations'),{recursive:true});
  const lock=new DatabaseSync(h.settings.lockFile);lock.exec('CREATE TABLE mutex(id INTEGER PRIMARY KEY); BEGIN IMMEDIATE');
  try{
    const result=await performFirestoreMaintenance(h.settings,{store:h.store,freeBytes});
    assert.deepEqual(result.alerts,['MAINTENANCE_BUSY']);assert.equal(h.quota.status().used.reads,0);
  }finally{lock.exec('ROLLBACK');lock.close();}
});
