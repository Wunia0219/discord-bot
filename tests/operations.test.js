import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,rmdirSync,readFileSync,writeFileSync,appendFileSync,existsSync,readdirSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {WalletStore} from '../server/wallet/wallet.js';
import {inspectWalletDatabase} from '../server/sqlite/database.js';
import {copyWalletDatabase} from '../server/sqlite/database-maintenance.js';
import {operationsSettings} from '../server/operations/operations-settings.js';
import {performMaintenance,automaticSnapshots,pruneAutomaticSnapshots} from '../server/recovery/automatic-backup.js';
import {Operations,maintenanceJob} from '../server/operations/operations.js';
import {checkOperationsStatus} from '../server/operations/operations-status.js';
import {createActivityServer} from '../server/http/app.js';

const guild='100000000000000001',user='100000000000000002',now=Date.parse('2026-10-22T08:00:00Z');
const plenty=()=>1024**4;
function fixture(t,overrides={}){
  const root=resolve('test-results/operations-tests');mkdirSync(root,{recursive:true});
  const directory=mkdtempSync(join(root,'case-')),filename=join(directory,'wallet.sqlite');
  const env={WALLET_ENABLED:'true',APP_ENV:'test',DATABASE_PATH:filename,BACKUP_DIRECTORY:join(directory,'backups')};
  const settings={...operationsSettings(env),keepMin:2,maxCount:3,...overrides};
  const store=new WalletStore({filename,guildIds:[guild],spinDelay:0});store.checkin(guild,user);
  const h={directory,filename,store,settings,env};
  t.after(async()=>{await h.beforeCleanup?.();store.close();assert.ok(resolve(directory).startsWith(root+sep));rmSync(directory,{recursive:true,force:true});});
  return h;
}
const run=(settings,time=now,extra={})=>performMaintenance(settings,{now:time,freeBytes:plenty,...extra});

test('operations defaults are bounded, source-isolated and reject invalid configuration',t=>{
  const h=fixture(t),settings=operationsSettings(h.env);
  assert.equal(settings.backupIntervalMs,6*3600000);assert.equal(settings.monitorIntervalMs,300000);
  assert.equal(settings.retentionMs,7*86400000);assert.equal(settings.keepMin,3);assert.equal(settings.maxCount,28);
  assert.equal(settings.backupMaxBytes,256*1024**2);
  assert.notEqual(operationsSettings({...h.env,DATABASE_PATH:join(h.directory,'another.sqlite')}).directory,settings.directory);
  assert.equal(operationsSettings({...h.env,OPERATIONS_ENABLED:'false'}),null);
  assert.equal(operationsSettings({WALLET_ENABLED:'false'}),null);
  for(const invalid of [{OPERATIONS_ENABLED:'yes'},{APP_ENV:''},{BACKUP_INTERVAL_MINUTES:'0'},
    {BACKUP_RETENTION_DAYS:'-1'},{BACKUP_KEEP_MIN:'3',BACKUP_MAX_COUNT:'2'},
    {BACKUP_MAX_TOTAL_MB:'NaN'},{MONITOR_INTERVAL_SECONDS:'0'},{DISK_MIN_FREE_MB:'0'}]){
    assert.throws(()=>operationsSettings({...h.env,...invalid}));
  }
});

test('the actual worker backs up committed WAL and the snapshot restores wallet and deduplication',async t=>{
  const h=fixture(t);h.store.db.exec('PRAGMA wal_autocheckpoint=0');
  const request=randomUUID(),round=h.store.spin(guild,user,20,request).round;
  const original=h.store.history(guild,user);
  const result=await maintenanceJob(h.settings);
  assert.equal(result.audit.ok,true);assert.equal(result.backup.created,true);assert.deepEqual(result.alerts,[]);
  const records=automaticSnapshots(h.settings);assert.equal(records.length,1);
  assert.equal(inspectWalletDatabase(records[0].path,'test').ok,true);
  const target=join(h.directory,'restored.sqlite');
  copyWalletDatabase({source:records[0].path,target,environment:'test'});
  const restored=new WalletStore({filename:target,guildIds:[guild],spinDelay:0});
  try{
    assert.deepEqual(restored.history(guild,user),original);
    assert.equal(restored.checkin(guild,user).duplicate,true);
    assert.deepEqual(restored.spin(guild,user,20,request).round,round);
  }finally{restored.close();}
  assert.deepEqual(h.store.history(guild,user),original);
});

test('recent verified backups are reused on restart, and become due at the configured interval',t=>{
  const h=fixture(t);
  assert.equal(run(h.settings).backup.created,true);
  assert.equal(run(h.settings,now+h.settings.backupIntervalMs-1).backup.created,false);
  assert.equal(automaticSnapshots(h.settings).length,1);
  assert.equal(run(h.settings,now+h.settings.backupIntervalMs).backup.created,true);
  assert.equal(automaticSnapshots(h.settings).length,2);
});

test('retention preserves manual, foreign and malformed files and keeps minimum valid snapshots',t=>{
  const h=fixture(t),manual=join(h.settings.backupDirectory,'manual.sqlite');
  mkdirSync(h.settings.directory,{recursive:true});writeFileSync(manual,'manual');
  const foreign=join(h.settings.directory,'test-2026-10-22T00-00-00-000Z-12345678.sqlite');writeFileSync(foreign,'foreign');
  writeFileSync(foreign+'.meta.json',JSON.stringify({sourceId:'other-source',environment:'test',file:foreign.split(/[\\/]/).at(-1),createdAt:0,sha256:'a'.repeat(64)}));
  writeFileSync(join(h.settings.directory,'bad.sqlite.meta.json'),'{');
  writeFileSync(join(h.settings.directory,'escape.sqlite.meta.json'),JSON.stringify({sourceId:h.settings.sourceId,environment:'test',file:'../../manual.sqlite'}));
  for(let i=0;i<4;i++)assert.equal(run(h.settings,now+i*h.settings.backupIntervalMs).backup.created,true);
  assert.equal(automaticSnapshots(h.settings).length,3);
  assert.equal(readFileSync(manual,'utf8'),'manual');assert.equal(readFileSync(foreign,'utf8'),'foreign');
  assert.equal(pruneAutomaticSnapshots(h.settings,null,now+100*86400000),0);
  run(h.settings,now+20*86400000);
  assert.equal(automaticSnapshots(h.settings).length,2,'age pruning never removes the configured minimum');
});

test('backup failure cannot prune old snapshots or modify the source ledger',t=>{
  const h=fixture(t);run(h.settings);
  const previous=automaticSnapshots(h.settings)[0],ledger=h.store.history(guild,user);
  const result=run(h.settings,now+h.settings.backupIntervalMs,{backupImpl:()=>{throw new Error('secret-storage-path');}});
  assert.ok(result.alerts.includes('BACKUP_FAILED'));assert.equal(result.backup.created,false);
  assert.equal(existsSync(previous.path),true);assert.equal(automaticSnapshots(h.settings).length,1);
  assert.deepEqual(h.store.history(guild,user),ledger);assert.ok(!JSON.stringify(result).includes('secret-storage-path'));
});

test('corrupt source data is reported and never replaces the last good backup',t=>{
  const h=fixture(t);run(h.settings);const previous=automaticSnapshots(h.settings)[0];
  h.store.db.exec('UPDATE wallets SET balance=balance+1');
  const result=run(h.settings,now+h.settings.backupIntervalMs);
  assert.equal(result.audit.ok,false);assert.ok(result.alerts.includes('DATABASE_AUDIT_FAILED'));
  assert.equal(automaticSnapshots(h.settings).length,1);assert.equal(inspectWalletDatabase(previous.path,'test').ok,true);
});

test('disk and storage-budget limits preserve every existing snapshot',t=>{
  const h=fixture(t);run(h.settings);const previous=automaticSnapshots(h.settings)[0];
  const low=run(h.settings,now+h.settings.backupIntervalMs,{freeBytes:()=>0});
  assert.ok(low.alerts.includes('DISK_SPACE_LOW'));assert.equal(low.backup.created,false);
  const budget=run({...h.settings,backupMaxBytes:1},now+3*h.settings.backupIntervalMs);
  assert.ok(budget.alerts.includes('BACKUP_BUDGET_EXCEEDED'));assert.ok(budget.alerts.includes('BACKUP_STALE'));
  assert.equal(existsSync(previous.path),true);assert.equal(automaticSnapshots(h.settings).length,1);
});

test('an unexpectedly oversized new copy is removed without deleting the last verified snapshot',t=>{
  const h=fixture(t);run(h.settings);const previous=automaticSnapshots(h.settings)[0];
  const temporary=join(h.settings.directory,'oversized.sqlite');
  const result=run({...h.settings,backupMaxBytes:1024**2},now+h.settings.backupIntervalMs,{
    backupImpl:()=>{writeFileSync(temporary,Buffer.alloc(2*1024**2));return {database:temporary};},
  });
  assert.ok(result.alerts.includes('BACKUP_BUDGET_EXCEEDED'));assert.equal(existsSync(temporary),false);
  assert.equal(existsSync(previous.path),true);assert.equal(inspectWalletDatabase(previous.path,'test').ok,true);
});

test('checksum damage is detected and a fresh verified snapshot is created without modifying the source',t=>{
  const h=fixture(t);run(h.settings);const previous=automaticSnapshots(h.settings)[0];
  appendFileSync(previous.path,'corrupt-tail');
  const result=run(h.settings,now+1000);
  assert.ok(result.alerts.includes('BACKUP_CHECKSUM_FAILED'));assert.equal(result.backup.created,true);
  assert.equal(result.audit.ok,true);assert.equal(automaticSnapshots(h.settings).length,2);
});

test('a missing source database is not created by monitoring',t=>{
  const h=fixture(t),filename=join(h.directory,'does-not-exist.sqlite');
  const result=run({...h.settings,filename});
  assert.ok(result.alerts.includes('DATABASE_UNAVAILABLE'));assert.equal(existsSync(filename),false);
});

test('automatic intervals run independently of traffic, coalesce overlap, and stop on shutdown',async t=>{
  const h=fixture(t);let time=now,callback,cleared=false,calls=0;
  const ops=new Operations(h.settings,{clock:()=>time,setIntervalImpl:fn=>{callback=fn;return 1;},clearIntervalImpl:()=>{cleared=true;},
    job:async settings=>{calls++;return run(settings,time);}});
  assert.equal(ops.isReady(),false);ops.start();const first=ops.running;
  callback();callback();assert.equal(calls,1);await first;assert.equal(ops.isReady(),true);
  time+=h.settings.backupIntervalMs;callback();await ops.running;
  assert.equal(calls,2);assert.equal(automaticSnapshots(h.settings).length,2);
  await ops.close();assert.equal(cleared,true);assert.equal(ops.status().running,false);
  callback();await ops.running;assert.equal(calls,2);
});

test('monitoring deduplicates alerts, logs recovery and reports stale checks',async t=>{
  const h=fixture(t);let time=now,unhealthy=true;
  const ops=new Operations(h.settings,{clock:()=>time,job:async()=>({checkedAt:new Date(time).toISOString(),audit:{ok:!unhealthy},alerts:unhealthy?['DATABASE_AUDIT_FAILED']:[]})});
  await ops.tick();await ops.tick();
  let events=readFileSync(h.settings.logFile,'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(events.filter(row=>row.event==='monitor.alert').length,1);
  unhealthy=false;await ops.tick();
  events=readFileSync(h.settings.logFile,'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(events.filter(row=>row.event==='monitor.recovered').length,1);
  time+=h.settings.monitorIntervalMs*2+120001;assert.ok(ops.status().alerts.includes('MONITOR_STALE'));
  await ops.close();
});

test('worker exceptions are reduced to safe monitor alerts and a later run recovers',async t=>{
  const h=fixture(t);let fail=true;
  const ops=new Operations(h.settings,{clock:()=>now,job:async()=>{if(fail)throw new Error('provider-secret');return run(h.settings);}});
  await ops.tick();assert.deepEqual(ops.status().alerts,['MAINTENANCE_FAILED']);
  assert.ok(!readFileSync(h.settings.logFile,'utf8').includes('provider-secret'));
  fail=false;await ops.tick();assert.deepEqual(ops.status().alerts,[]);await ops.close();
});

test('a timed-out worker is terminated before its failure is returned',async t=>{
  const h=fixture(t);
  await assert.rejects(maintenanceJob(h.settings,{timeoutMs:0}),/Maintenance worker failed/);
});

test('status-file failures are reported and recover after storage becomes writable',async t=>{
  const h=fixture(t),ops=new Operations(h.settings,{job:async()=>run(h.settings),clock:()=>now});
  mkdirSync(h.settings.statusFile);
  await ops.tick();assert.ok(ops.status().alerts.includes('OPERATIONS_STATUS_UNAVAILABLE'));
  rmdirSync(h.settings.statusFile);
  await ops.tick();assert.ok(!ops.status().alerts.includes('OPERATIONS_STATUS_UNAVAILABLE'));
  assert.equal(JSON.parse(readFileSync(h.settings.statusFile,'utf8')).lastCheck.audit.ok,true);
  await ops.close();
});

test('operational logs rotate at a bounded size and status writes are complete JSON',async t=>{
  const h=fixture(t),ops=new Operations(h.settings,{logLimit:100});
  for(let i=0;i<15;i++)ops.emit('info','fixture.event',{index:i});
  const files=readdirSync(join(h.settings.directory,'operations')).filter(file=>file.startsWith('events.jsonl'));
  assert.equal(files.length,3);
  for(const file of files)for(const line of readFileSync(join(h.settings.directory,'operations',file),'utf8').trim().split('\n'))assert.ok(JSON.parse(line));
  await ops.close();assert.equal(JSON.parse(readFileSync(h.settings.statusFile,'utf8')).running,false);
});

test('status checks reject stale green files and unreachable services',async t=>{
  const h=fixture(t);mkdirSync(join(h.settings.directory,'operations'),{recursive:true});
  const status={sourceId:h.settings.sourceId,updatedAt:new Date(now).toISOString(),running:true,ok:true};
  writeFileSync(h.settings.statusFile,JSON.stringify(status));
  assert.equal((await checkOperationsStatus(h.settings,{clock:()=>now,fetchImpl:async()=>new Response('',{status:200})})).ok,true);
  assert.equal((await checkOperationsStatus(h.settings,{clock:()=>now,fetchImpl:async()=>{throw new Error('offline');}})).ok,false);
  assert.equal((await checkOperationsStatus(h.settings,{clock:()=>now+2*h.settings.monitorIntervalMs+120001,fetchImpl:async()=>new Response('',{status:200})})).stale,true);
});

test('HTTP monitoring correlates failures while omitting secrets, query strings and identities',async t=>{
  const h=fixture(t),ops=new Operations(h.settings,{job:async()=>run(h.settings),clock:()=>now});
  ops.start();await ops.running;
  const server=createActivityServer({clientId:'100000000000000003',clientSecret:'fixture-only',publicKey:'a'.repeat(64),
    operations:ops,wallet:{store:h.store,service:{authorize:async()=>{throw new Error('secret-token-123 user-999');}}}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  h.beforeCleanup=async()=>{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await ops.close();};
  const initial=await fetch(`http://127.0.0.1:${server.address().port}/readyz`);
  assert.equal(initial.status,200);assert.deepEqual(await initial.json(),{ok:true});
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/wallet?code=secret-query`,{headers:{Authorization:'Bearer secret-header','X-Request-Id':'forged-id'}});
  assert.equal(response.status,502);const requestId=response.headers.get('X-Request-Id');assert.notEqual(requestId,'forged-id');
  await response.text();
  const log=readFileSync(h.settings.logFile,'utf8'),record=JSON.parse(log.trim().split('\n').at(-1));
  assert.equal(record.requestId,requestId);assert.equal(record.route,'/api/wallet');assert.equal(record.code,'UNEXPECTED_ERROR');
  for(const secret of ['secret-token-123','user-999','secret-query','secret-header',guild,user])assert.ok(!log.includes(secret));
  h.store.db.exec('UPDATE wallets SET balance=balance+1');await ops.tick();
  const ready=await fetch(`http://127.0.0.1:${server.address().port}/readyz`);assert.equal(ready.status,503);assert.deepEqual(await ready.json(),{ok:false});
});
