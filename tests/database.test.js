import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { DATABASE_VERSION, inspectWalletDatabase, openWalletDatabase } from '../server/sqlite/database.js';
import { backupWalletDatabase, copyWalletDatabase, databaseSettings } from '../server/sqlite/database-maintenance.js';
import { WalletStore } from '../server/wallet/wallet.js';
import { walletConfig } from '../server/config.js';

const guild='1441097301685698703', user='1561284960986599626', admin='1561284960986599627';
function fixture(t) {
  const root=resolve('test-results/database-tests');
  mkdirSync(root,{recursive:true});
  const directory=mkdtempSync(join(root,'case-'));
  t.after(()=>{
    assert.ok(directory.startsWith(root+sep));
    rmSync(directory,{recursive:true,force:true});
  });
  return {directory,filename:join(directory,'wallet.sqlite')};
}
function wallet(filename,environment='test') {
  return new WalletStore({filename,environment,guildIds:[guild],spinDelay:0});
}

test('fresh databases have a versioned schema, readiness and no wallets until the first player arrives',t=>{
  const {filename}=fixture(t),s=wallet(filename,'production');
  assert.equal(s.db.prepare('PRAGMA user_version').get().user_version,DATABASE_VERSION);
  assert.equal(s.isReady(),true);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM wallets').get().n,0);
  assert.equal(s.state(guild,user).balance,10000);
  s.close();s.close();assert.equal(s.isReady(),false);
  const report=inspectWalletDatabase(filename,'production');
  assert.equal(report.ok,true);assert.equal(report.counts.wallets,1);assert.equal(report.counts.ledger,1);
});

test('legacy migration preserves balances, settled retries, IDs and append-only protection across reopen',t=>{
  const {filename}=fixture(t),request=randomUUID();
  let s=wallet(filename);
  s.checkin(guild,user);
  const round=s.spin(guild,user,100,request).round;
  const balance=s.state(guild,user).balance;
  s.db.exec('DROP TABLE highlight_events; DROP TABLE highlight_boards; PRAGMA user_version=0;');
  const before=s.history(guild,user);s.close();
  const report=inspectWalletDatabase(filename,'test');
  assert.equal(report.ok,true);assert.equal(report.needsMigration,true);
  s=wallet(filename);
  assert.equal(s.state(guild,user).balance,balance);
  assert.deepEqual(s.spin(guild,user,100,request).round,round);
  assert.deepEqual(s.history(guild,user),before);
  assert.throws(()=>s.db.exec('DELETE FROM ledger'),/append only/);
  assert.equal(s.db.prepare('PRAGMA user_version').get().user_version,DATABASE_VERSION);
  s.close();s=wallet(filename);assert.equal(s.state(guild,user).balance,balance);s.close();
});

test('wrong environment, unknown database and future schema are refused without changing existing files',t=>{
  const {filename,directory}=fixture(t);
  const s=wallet(filename);s.state(guild,user);s.close();
  const before=readFileSync(filename);
  assert.throws(()=>wallet(filename,'production'),/mix test and production/);
  assert.deepEqual(readFileSync(filename),before);
  const db=new DatabaseSync(filename);db.exec('PRAGMA user_version=999');db.close();
  const future=readFileSync(filename);
  assert.throws(()=>wallet(filename),/newer/);
  assert.deepEqual(readFileSync(filename),future);
  const unknown=join(directory,'foreign.sqlite');
  const other=new DatabaseSync(unknown);other.exec('CREATE TABLE unrelated(value TEXT)');other.close();
  const original=readFileSync(unknown);
  assert.throws(()=>wallet(unknown),/recognized wallet database/);
  assert.deepEqual(readFileSync(unknown),original);
});

test('a failed schema migration rolls back every new table and its version change',t=>{
  const {filename}=fixture(t),db=new DatabaseSync(filename);
  db.exec("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO settings VALUES('environment','test'); CREATE TABLE wallets(guild TEXT,user TEXT,PRIMARY KEY(guild,user));");
  db.close();
  assert.throws(()=>wallet(filename),/Incomplete wallet schema/);
  const after=new DatabaseSync(filename,{readOnly:true});
  assert.equal(after.prepare('PRAGMA user_version').get().user_version,0);
  assert.deepEqual(after.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name),['settings','wallets']);
  after.close();
});

test('audit is read-only and detects bad balances, broken ledger chains and missing guards',t=>{
  const {filename}=fixture(t),s=wallet(filename);s.checkin(guild,user);
  assert.equal(inspectWalletDatabase(filename,'test').ok,true);
  s.db.exec('UPDATE wallets SET balance=balance+1');
  assert.ok(inspectWalletDatabase(filename,'test').issues.some(x=>x.includes('balance mismatches')));
  s.db.exec('DROP TRIGGER ledger_no_update; UPDATE ledger SET before=1 WHERE id=(SELECT MIN(id) FROM ledger)');
  const report=inspectWalletDatabase(filename,'test');
  assert.ok(report.issues.some(x=>x.includes('continuity')));
  assert.ok(report.issues.some(x=>x.includes('Missing ledger protection')));
  s.close();
  assert.throws(()=>wallet(filename),/Missing ledger protection/);
});

test('WAL backups and safe restore preserve balances, checkins and deduplication without touching the original',t=>{
  const {filename,directory}=fixture(t),s=wallet(filename),request=randomUUID();
  s.db.exec('PRAGMA wal_autocheckpoint=0');
  s.checkin(guild,user);const settled=s.spin(guild,user,100,request).round;
  const report=backupWalletDatabase({filename,backupDirectory:join(directory,'backups'),environment:'test'});
  assert.equal(report.ok,true);assert.equal(report.counts.rounds,1);
  const restored=join(directory,'restored.sqlite');
  assert.equal(copyWalletDatabase({source:report.database,target:restored,environment:'test'}).ok,true);
  const second=wallet(restored);
  assert.equal(second.state(guild,user).balance,s.state(guild,user).balance);
  assert.equal(second.checkin(guild,user).duplicate,true);
  assert.deepEqual(second.spin(guild,user,100,request).round,settled);
  const grant=s.grant(guild,admin,user,100,'after backup',randomUUID());
  assert.equal(grant.entry.after-second.state(guild,user).balance,100);
  second.close();s.close();
});

test('five database connections settle retries once while 100 distinct player wallets stay consistent',{timeout:20000},async t=>{
  const {filename}=fixture(t),initial=wallet(filename);initial.close();
  const moduleUrl=new URL('../server/wallet/wallet.js',import.meta.url).href;
  const workerCode=`
    const {parentPort,workerData}=require('node:worker_threads');
    import(workerData.moduleUrl).then(({WalletStore})=>{
      const {filename,guild,user,index}=workerData;
      const s=new WalletStore({filename,guildIds:[guild],spinDelay:0,clock:()=>1792386000000});
      parentPort.once('message',()=>{
        try {
          for(let i=0;i<10;i++)s.checkin(guild,user);
          const result=s.spin(guild,user,20,'shared-request-11111111-2222-3333');
          for(let i=0;i<20;i++){
            const player=String(1600000000000000000n+BigInt(index*20+i));
            s.checkin(guild,player);s.spin(guild,player,20,'individual-11111111-2222-3333');
          }
          parentPort.postMessage({roundId:result.round.id});
        } finally {s.close();parentPort.close();}
      });
      parentPort.postMessage({ready:true});
    });`;
  const workers=Array.from({length:5},(_,index)=>new Worker(workerCode,{eval:true,workerData:{moduleUrl,filename,guild,user,index}}));
  try {
    await Promise.all(workers.map(worker=>once(worker,'message').then(([message])=>assert.equal(message.ready,true))));
    const completed=workers.map(worker=>once(worker,'message'));
    const exited=workers.map(worker=>new Promise((resolve,reject)=>{worker.once('exit',resolve);worker.once('error',reject);}));
    workers.forEach(worker=>worker.postMessage('start'));
    const results=await Promise.all(completed);
    await Promise.all(exited);
    assert.equal(new Set(results.map(([message])=>message.roundId)).size,1);
    const report=inspectWalletDatabase(filename,'test');
    assert.equal(report.ok,true,JSON.stringify(report.issues));
    assert.equal(report.counts.wallets,101);assert.equal(report.counts.rounds,101);
    assert.equal(report.counts.ledger,303);assert.equal(report.counts.operations,202);
  } finally { await Promise.all(workers.map(worker=>worker.terminate())); }
});

test('restore never overwrites a destination, copies an invalid database or changes environments',t=>{
  const {filename,directory}=fixture(t),s=wallet(filename);s.state(guild,user);s.close();
  const before=readFileSync(filename);
  assert.throws(()=>copyWalletDatabase({source:filename,target:filename,environment:'test'}),/different/);
  const target=join(directory,'target.sqlite');
  copyWalletDatabase({source:filename,target,environment:'test'});
  const original=readFileSync(target);
  assert.throws(()=>copyWalletDatabase({source:filename,target,environment:'test'}),/EEXIST/);
  assert.deepEqual(readFileSync(target),original);
  const wrong=join(directory,'wrong.sqlite');
  assert.throws(()=>copyWalletDatabase({source:filename,target:wrong,environment:'production'}),/mix test and production/);
  assert.equal(existsSync(wrong),false);assert.deepEqual(readFileSync(filename),before);
  const tampered=wallet(filename);tampered.db.exec('UPDATE wallets SET balance=balance+1');tampered.close();
  assert.throws(()=>copyWalletDatabase({source:filename,target:wrong,environment:'test'}),/failed verification/);
  assert.equal(existsSync(wrong),false);
});

test('maintenance tools require an explicit environment and never create a missing database during check',t=>{
  const {filename,directory}=fixture(t);
  assert.throws(()=>databaseSettings({}),/environment/);
  assert.throws(()=>inspectWalletDatabase(filename,'test'));
  assert.equal(existsSync(filename),false);
  const env={...process.env,APP_ENV:'test',DATABASE_PATH:filename,BACKUP_DIRECTORY:join(directory,'backups')};
  const run=(script,args=[])=>spawnSync(process.execPath,[`scripts/admin/${script}.js`,...args],{env,encoding:'utf8',timeout:15000});
  assert.notEqual(run('check-db').status,0);assert.equal(existsSync(filename),false);
  assert.equal(run('init-db').status,0);
  assert.equal(JSON.parse(run('check-db').stdout).ok,true);
  const backup=run('backup-db');assert.equal(backup.status,0,backup.stderr);
  const backupFile=JSON.parse(backup.stdout).database;
  const restored=join(directory,'cli-restore.sqlite');
  const restore=run('restore-db',['--from',backupFile,'--to',restored]);
  assert.equal(restore.status,0,restore.stderr);assert.equal(inspectWalletDatabase(restored,'test').ok,true);
  assert.notEqual(run('restore-db',['--from',backupFile,'--to',restored]).status,0);
});

test('invalid admin roles are rejected before creating a database and failed optional setup releases its connection',t=>{
  const {filename}=fixture(t),env={WALLET_ENABLED:'true',APP_ENV:'test',DATABASE_PATH:filename,ALLOWED_GUILD_IDS:guild,
    DISCORD_CLIENT_ID:user,DISCORD_CLIENT_SECRET:'test-secret',DISCORD_PUBLIC_KEY:'ab'.repeat(32)};
  assert.throws(()=>walletConfig({...env,CHIP_ADMIN_ROLE_IDS:'invalid'}),/Invalid CHIP_ADMIN_ROLE_IDS/);
  assert.equal(existsSync(filename),false);
  assert.throws(()=>walletConfig({...env,DISCORD_HIGHLIGHTS_WEBHOOK_URL:'https://example.com/private'}),/Invalid DISCORD_HIGHLIGHTS_WEBHOOK_URL/);
  assert.equal(inspectWalletDatabase(filename,'test').ok,true);
});

test('Discord startup requires explicit environment and credentials before touching any database path',t=>{
  const {directory}=fixture(t),filename=join(directory,'must-not-be-created','wallet.sqlite');
  const valid={WALLET_ENABLED:'true',APP_ENV:'test',DATABASE_PATH:filename,ALLOWED_GUILD_IDS:guild,
    DISCORD_CLIENT_ID:user,DISCORD_CLIENT_SECRET:'test-secret',DISCORD_PUBLIC_KEY:'ab'.repeat(32)};
  for(const invalid of [{APP_ENV:undefined},{APP_ENV:''},{APP_ENV:'prod'},
    {DISCORD_CLIENT_ID:undefined},{DISCORD_CLIENT_ID:'not-an-id'},
    {DISCORD_CLIENT_SECRET:''},{DISCORD_CLIENT_SECRET:'   '},
    {DISCORD_PUBLIC_KEY:undefined},{DISCORD_PUBLIC_KEY:'ab'.repeat(31)},{DISCORD_PUBLIC_KEY:'z'.repeat(64)}]){
    assert.throws(()=>walletConfig({...valid,...invalid}),/environment|Discord wallet requires/);
    assert.equal(existsSync(filename),false);assert.equal(existsSync(join(directory,'must-not-be-created')),false);
  }
  const env={...process.env,...valid,APP_ENV:'',HOST:'127.0.0.1',PORT:'4188',LOCAL_WALLET_TEST:'false'};
  const child=spawnSync(process.execPath,['server/index.js'],{env,encoding:'utf8',timeout:5000});
  assert.notEqual(child.status,0);assert.match(child.stderr,/Invalid wallet environment/);
  assert.ok(!child.stdout.includes('Activity server:'));assert.equal(existsSync(filename),false);
});

test('explicit Discord test and production configurations both start new wallets at 10000',t=>{
  const {directory}=fixture(t);
  for(const environment of ['test','production']){
    const wallet=walletConfig({WALLET_ENABLED:'true',APP_ENV:environment,DATABASE_PATH:join(directory,environment+'.sqlite'),
      ALLOWED_GUILD_IDS:guild,DISCORD_CLIENT_ID:user,DISCORD_CLIENT_SECRET:'test-secret',DISCORD_PUBLIC_KEY:'ab'.repeat(32)});
    try{assert.equal(wallet.store.environment,environment);assert.equal(wallet.store.state(guild,user).balance,10000);}
    finally{wallet.store.close();}
  }
});
