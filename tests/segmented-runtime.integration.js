import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {WalletStore} from '../server/wallet/wallet.js';
import {snapshotForCloud,decodeCloudArchive,restoreCloudSnapshot} from '../server/recovery/cloud-handoff.js';

test('real workerd reduces session and foreground settlement rows without changing durable authorization or balances',async t=>{
 const root=resolve('test-results/cloud-cost');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'run-'));
 await build({entryPoints:['tests/fixtures/cloud-cost-worker.js'],bundle:true,format:'esm',platform:'node',external:['cloudflare:workers'],outfile:join(dir,'worker.js'),logLevel:'silent'});
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:join(dir,'worker.js'),compatibilityDate:'2026-07-30',compatibilityFlags:['nodejs_compat'],durableObjects:{COST:{className:'CloudCostFixture',useSQLite:true}},outboundService:()=>{throw new Error('No external services permitted');}}));t.after(()=>mf.dispose());
 const results={};for(const kind of ['sessions','spins']){
  const pair={};for(const mode of ['previous','optimized']){const r=await mf.dispatchFetch('http://localhost/'+kind+'/'+mode);assert.equal(r.status,200);pair[mode]=await r.json();}
  assert.ok(pair.optimized.rowsWritten<pair.previous.rowsWritten);
  for(const field of ['used','balance','rounds','persistedSession','firestoreReads','firestoreWrites'])assert.deepEqual(pair.optimized[field],pair.previous[field]);
  assert.equal(pair.optimized.firestoreWrites,kind==='spins'?400:0);assert.equal(pair.optimized.firestoreReads,kind==='spins'?400:0);
  results[kind]=pair;
 }
 writeFileSync('test-results/cloud-cost-report.json',JSON.stringify({realWorkerd:true,results,scope:'100 deterministic compact spins or 100 authorizations with synthetic Firestore REST responses; excludes backups, casino delivery, alarms and production CPU billing'},null,2));
});

test('real workerd SQL row accounting drops when identical quota reservations are batched',async t=>{
 const root=resolve('test-results/quota-rows');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'run-'));
 await build({entryPoints:['tests/fixtures/quota-rows-worker.js'],bundle:true,format:'esm',platform:'node',external:['cloudflare:workers'],outfile:join(dir,'worker.js'),logLevel:'silent'});
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:join(dir,'worker.js'),compatibilityDate:'2026-07-30',compatibilityFlags:['nodejs_compat'],durableObjects:{QUOTA:{className:'QuotaRowsFixture',useSQLite:true}},outboundService:()=>{throw new Error('No external services permitted');}}));t.after(()=>mf.dispose());
 const single=await (await mf.dispatchFetch('http://localhost/single')).json(),batch=await (await mf.dispatchFetch('http://localhost/batch')).json();
 assert.deepEqual(batch.used,single.used);assert.deepEqual(batch.documents,single.documents);assert.ok(batch.rowsWritten<single.rowsWritten);
 writeFileSync('test-results/quota-rows-report.json',JSON.stringify({realWorkerd:true,single,batch,scope:'Identical four-write quota reservations only; excludes sessions, alarms, backups and actual settlements'},null,2));
});

test('real workerd audits and exports over 8MiB without a full-history SQL rewrite',async t=>{
 const root=resolve('test-results/segmented-workerd');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'run-'));
 await build({entryPoints:['tests/fixtures/segmented-worker.js'],bundle:true,format:'esm',platform:'node',external:['cloudflare:workers'],outfile:join(dir,'worker.js'),logLevel:'silent'});
 const file=join(dir,'source.sqlite'),guild='100000000000000001',user='100000000000000002',wallet=new WalletStore({environment:'test',guildIds:[guild],spinDelay:0});
 // Generate only this synthetic source in memory, then materialize one complete
 // snapshot. Actual durability, import, recovery and workerd checks stay intact.
 wallet.grant(guild,user,user,100000,'isolated workerd fixture',randomUUID());for(let i=0;i<6000;i++)wallet.spin(guild,user,20,randomUUID());
 wallet.db.prepare('VACUUM INTO ?').run(file);wallet.close();
 const s=snapshotForCloud(file,'test');assert.ok(Buffer.byteLength(JSON.stringify(s))>8*1024**2);
 const config={modules:true,scriptPath:join(dir,'worker.js'),compatibilityDate:'2026-07-30',compatibilityFlags:['nodejs_compat'],durableObjects:{BACKUP:{className:'BackupFixture',useSQLite:true}},resourcePersistencePath:join(dir,'durable'),outboundService:()=>{throw new Error('No external services permitted');}};
 let mf=new Miniflare(convertV4MiniflareOptions(config));t.after(()=>mf.dispose());
 const call=async(path,input)=>{const r=await mf.dispatchFetch('http://localhost'+path,{method:'POST',body:JSON.stringify(input||{}),headers:{'Content-Type':'application/json'}});assert.equal(r.status,200);return r.json();};
 await call('/seed',s);await mf.dispose();mf=new Miniflare(convertV4MiniflareOptions(config));
 const started=performance.now(),result=await call('/audit'),auditMs=Math.round(performance.now()-started);assert.equal(result.counts.rounds,6000);
 const chunks=[];while(chunks.length<result.manifest.parts)chunks.push(...(await call('/page',{start:chunks.length,limit:16})).chunks);
 const restored=decodeCloudArchive({manifest:result.manifest,chunks},'a'.repeat(64),'test');assert.deepEqual(restored,s);restoreCloudSnapshot(restored,join(dir,'restored.sqlite'),'test');
 writeFileSync('test-results/segmented-workerd-report.json',JSON.stringify({ok:true,realWorkerd:true,rounds:6000,bytes:result.manifest.bytes,parts:result.manifest.parts,auditMs,allSevenTablesEqual:true,scope:'isolated workerd; not a production CPU or latency guarantee'},null,2));
});
