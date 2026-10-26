import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {SnapshotVault,auditSnapshot,digest,manifestDigest} from '../cloud/snapshot.js';
import {CloudState,Sealer} from '../cloud/storage.js';
import {WalletStore} from '../server/wallet.js';
import {snapshotForCloud,decodeCloudArchive,restoreCloudSnapshot} from '../server/cloud-handoff.js';

function fixture(t){
  const root=resolve('test-results/segmented');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'case-')),sql=new DatabaseSync(join(dir,'vault.sqlite'));t.after(()=>sql.close());let nesting=0;
  const storage={sql:{exec:(q,...a)=>sql.prepare(q).all(...a).map(r=>({...r}))},transactionSync(fn){const id='s'+nesting++;sql.exec('SAVEPOINT '+id);try{const value=fn();sql.exec('RELEASE '+id);return value;}catch(e){sql.exec('ROLLBACK TO '+id);sql.exec('RELEASE '+id);throw e;}finally{nesting--;}}};
  const state=new CloudState(storage),key=randomBytes(32).toString('hex'),sealer=new Sealer(key),vault=new SnapshotVault(storage,state,sealer);
  const file=join(dir,'source.sqlite'),guild='100000000000000001',user='100000000000000002',wallet=new WalletStore({filename:file,environment:'test',guildIds:[guild],spinDelay:0});t.after(()=>wallet.close());wallet.grant(guild,user,user,100000,'isolated backup fixture',randomUUID());
  return {dir,sql,storage,state,key,sealer,vault,file,guild,user,wallet};
}
test('legacy archive remains readable; immutable encrypted segments are reused and failed candidate cannot replace baseline',t=>{
  const f=fixture(t),s=snapshotForCloud(f.file,'test'),text=JSON.stringify(s),m={format:1,generation:'old',parts:1,environment:'test',revision:s.revision,sha256:digest(text)};
  f.sql.prepare('INSERT INTO backup_chunks VALUES(?,?,?)').run('old',0,f.sealer.seal(text,'backup:old:0'));f.state.set('backup:old',m);f.vault.publish('old');
  assert.deepEqual(decodeCloudArchive(f.vault.archive('old'),f.key,'test'),s);
  f.vault.fork('new','old');f.vault.append('new',{wallets:s.tables.wallets});assert.deepEqual(f.vault.audit('new'),auditSnapshot(s,'test'));f.vault.publish('new');
  const payloads=f.sql.prepare('SELECT * FROM backup_segments ORDER BY id').all();
  f.vault.fork('next','new');f.vault.append('next',{wallets:s.tables.wallets});f.vault.audit('next');assert.deepEqual(f.sql.prepare('SELECT * FROM backup_segments ORDER BY id').all(),payloads);
  f.vault.append('next',{ledger:[s.tables.ledger[0]]});assert.throws(()=>f.vault.audit('next'),/Ledger continuity/);assert.equal(f.state.get('backup-latest'),'new');f.vault.discard('next');assert.deepEqual(f.vault.load('new').tables,s.tables);
  const archive=f.vault.archive('new');archive.chunks.reverse();assert.throws(()=>decodeCloudArchive(archive,f.key,'test'));
  const altered=f.vault.archive('new');altered.manifest.segments[0].table='rounds';assert.throws(()=>decodeCloudArchive(altered,f.key,'test'));
  for(const generation of ['three','four','five']){f.vault.save(generation,s);f.vault.publish(generation);}
  assert.equal(f.state.get('backup:old'),null);assert.deepEqual(f.vault.load('five').tables,s.tables);assert.throws(()=>f.vault.discard('five'));
});
test('greater-than-8MiB full history audits from bounded segments, restores all seven tables and survives reconstruction',t=>{
  const f=fixture(t),started=performance.now();
  for(let i=0;i<6000;i++)f.wallet.spin(f.guild,f.user,20,randomUUID());
  const s=snapshotForCloud(f.file,'test');assert.ok(Buffer.byteLength(JSON.stringify(s))>8*1024**2);
  const manifest=f.vault.save('large',s),auditStarted=performance.now();assert.deepEqual(f.vault.audit('large'),auditSnapshot(s,'test'));const auditMs=Math.round(performance.now()-auditStarted);f.vault.publish('large');
  const restarted=new SnapshotVault(f.storage,new CloudState(f.storage),f.sealer),decoded=decodeCloudArchive(restarted.archive('large'),f.key,'test');assert.deepEqual(decoded,s);
  restoreCloudSnapshot(decoded,join(f.dir,'restored.sqlite'),'test');assert.deepEqual(snapshotForCloud(join(f.dir,'restored.sqlite'),'test').tables,s.tables);
  // Capacity/integrity errors leave the last verified snapshot intact.
  const bad=structuredClone(manifest);bad.bytes++;bad.sha256=manifestDigest(bad);f.state.set('backup:bad',bad);assert.throws(()=>restarted.load('bad'));assert.equal(f.state.get('backup-latest'),'large');
  writeFileSync('test-results/segmented-backup-report.json',JSON.stringify({ok:true,rounds:6000,bytes:manifest.bytes,parts:manifest.parts,auditMs,totalMs:Math.round(performance.now()-started),allSevenTablesEqual:true,legacyCompatible:true,scope:'isolated local SQLite; not production CPU'},null,2));
});
