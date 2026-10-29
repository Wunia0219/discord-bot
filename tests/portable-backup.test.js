import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,readFileSync,writeFileSync,existsSync,readdirSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {WalletStore} from '../server/wallet/wallet.js';
import {WALLET_TABLES} from '../server/sqlite/database.js';
import {createBackupKey,exportPortableBackup,verifyPortableBackup,restorePortableBackup} from '../server/recovery/portable-backup.js';

const guild='100000000000000001',user='100000000000000002',now=Date.parse('2026-10-23T06:00:00Z');
function fixture(t){
  const root=resolve('test-results/portable-backup-tests');mkdirSync(root,{recursive:true});
  const directory=mkdtempSync(join(root,'case-')),source=join(directory,'source.sqlite'),keyFile=join(directory,'private.key'),workDirectory=join(directory,'private-work'),target=join(directory,'encrypted','backup.jcbak');
  const store=new WalletStore({filename:source,environment:'test',guildIds:[guild],clock:()=>now,spinDelay:0});
  store.checkin(guild,user);const request=randomUUID(),round=store.spin(guild,user,100,request).round;
  createBackupKey(keyFile);
  t.after(()=>{store.close();assert.ok(directory.startsWith(root+sep));rmSync(directory,{recursive:true,force:true});});
  return {directory,store,request,round,options:{source,keyFile,workDirectory,target,environment:'test'}};
}
function rows(file){const db=new DatabaseSync(file,{readOnly:true});try{return Object.fromEntries(WALLET_TABLES.map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));}finally{db.close();}}

test('encrypted export includes committed WAL and restores all data and original request deduplication',t=>{
  const {directory,store,request,round,options}=fixture(t);
  // Delivery metadata is preserved verbatim, including legacy fractional deadlines.
  store.db.prepare('INSERT INTO highlight_boards VALUES(?,?,?,?,?,?)').run(guild,'100000000000000099',now,0,'[]',now+10.5);
  const before=rows(options.source),result=exportPortableBackup(options);
  assert.equal(result.ok,true);assert.deepEqual(rows(options.source),before);
  const archive=readFileSync(options.target);assert.equal(archive.includes(Buffer.from('SQLite format 3')),false);assert.equal(archive.includes(Buffer.from(user)),false);
  const checked=verifyPortableBackup({...options,source:options.target});assert.deepEqual(checked.counts,result.counts);
  const restored=join(directory,'restored.sqlite');restorePortableBackup({...options,source:options.target,target:restored});assert.deepEqual(rows(restored),before);
  const wallet=new WalletStore({filename:restored,environment:'test',guildIds:[guild],clock:()=>now,spinDelay:0});
  try{assert.equal(wallet.checkin(guild,user).duplicate,true);assert.deepEqual(wallet.spin(guild,user,100,request).round,round);assert.deepEqual(rows(restored),before);}finally{wallet.close();}
  assert.deepEqual(readdirSync(options.workDirectory),[]);
});

test('each export has fresh authenticated encryption even for the same snapshot and key',t=>{
  const {directory,options}=fixture(t);const first=exportPortableBackup(options);
  const second=exportPortableBackup({...options,target:join(directory,'second.jcbak')});
  assert.equal(first.snapshotSha256,second.snapshotSha256);assert.notEqual(first.archiveSha256,second.archiveSha256);
});

test('wrong key and wrong environment never publish restored data or retain decrypted staging files',t=>{
  const {directory,options}=fixture(t);exportPortableBackup(options);
  const wrong=join(directory,'wrong.key');createBackupKey(wrong);
  for(const override of [{keyFile:wrong},{environment:'production'}]){
    const target=join(directory,'refused.sqlite');
    assert.throws(()=>restorePortableBackup({...options,source:options.target,target,...override}));
    assert.equal(existsSync(target),false);assert.ok(!readdirSync(directory).some(name=>name.startsWith('.restore-')));
  }
});

test('tampered header, ciphertext, tag, truncation and trailing bytes are rejected before publication',t=>{
  const {directory,options}=fixture(t);exportPortableBackup(options);const original=readFileSync(options.target);
  const length=original.readUInt32BE(8),header=JSON.parse(original.subarray(12,12+length));
  for(const [name,mutate] of [
    ['header',bytes=>{const changed={...header,sha256:(header.sha256[0]==='0'?'1':'0')+header.sha256.slice(1)};Buffer.from(JSON.stringify(changed)).copy(bytes,12);return bytes;}],
    ['ciphertext',bytes=>{bytes[12+length+20]^=1;return bytes;}],
    ['tag',bytes=>{bytes[bytes.length-1]^=1;return bytes;}],
    ['truncate',bytes=>bytes.subarray(0,bytes.length-1)],
    ['trailing',bytes=>Buffer.concat([bytes,Buffer.from('x')])],
    ['huge-header',bytes=>{bytes.writeUInt32BE(0xffffffff,8);return bytes;}],
  ]){
    const source=join(directory,name+'.jcbak'),target=join(directory,name+'.sqlite');writeFileSync(source,mutate(Buffer.from(original)));
    assert.throws(()=>restorePortableBackup({...options,source,target}),name);assert.equal(existsSync(target),false,name);
  }
  assert.ok(!readdirSync(directory).some(name=>name.startsWith('.restore-')));
});

test('existing archive, live database and key can never be overwritten',t=>{
  const {options}=fixture(t);exportPortableBackup(options);const encrypted=readFileSync(options.target),before=rows(options.source),key=readFileSync(options.keyFile);
  assert.throws(()=>exportPortableBackup(options),/already exists/);
  assert.throws(()=>restorePortableBackup({...options,source:options.target,target:options.source}),/already exists/);
  assert.throws(()=>createBackupKey(options.keyFile),/already exists/);
  assert.deepEqual(readFileSync(options.target),encrypted);assert.deepEqual(rows(options.source),before);assert.deepEqual(readFileSync(options.keyFile),key);
});

test('invalid key, corrupt wallet and non-file source fail without final archive',t=>{
  const {directory,store,options}=fixture(t);
  const invalid=join(directory,'invalid.key');writeFileSync(invalid,'not-a-32-byte-random-key');
  assert.throws(()=>exportPortableBackup({...options,keyFile:invalid}),/32/);
  assert.throws(()=>exportPortableBackup({...options,source:directory}),/regular file/);
  store.db.prepare('UPDATE wallets SET balance=balance+1').run();
  assert.throws(()=>exportPortableBackup(options),/verification/);assert.equal(existsSync(options.target),false);
  assert.deepEqual(readdirSync(options.workDirectory),[]);
});

test('CLI rejects missing arguments and reports no key material on failures',t=>{
  const {directory,options}=fixture(t);exportPortableBackup(options);
  const script=resolve('scripts/admin/portable-backup.js'),wrong=join(directory,'wrong.key');createBackupKey(wrong);
  for(const args of [['export'],['restore','--from',options.target,'--to',join(directory,'cli.sqlite'),'--key-file',wrong,'--environment','test']]){
    const result=spawnSync(process.execPath,[script,...args],{encoding:'utf8'});assert.equal(result.status,1);assert.equal(result.stdout,'');
    assert.ok(!result.stderr.includes(readFileSync(options.keyFile).toString('hex')));assert.equal(existsSync(join(directory,'cli.sqlite')),false);
  }
});
