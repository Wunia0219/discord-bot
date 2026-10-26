import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {WalletStore} from '../server/wallet.js';
import {snapshotForCloud,decodeCloudArchive,restoreCloudSnapshot} from '../server/cloud-handoff.js';

test('real workerd audits and exports over 8MiB without a full-history SQL rewrite',async t=>{
 const root=resolve('test-results/segmented-workerd');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'run-'));
 await build({entryPoints:['tests/fixtures/segmented-worker.js'],bundle:true,format:'esm',platform:'node',external:['cloudflare:workers'],outfile:join(dir,'worker.js'),logLevel:'silent'});
 const file=join(dir,'source.sqlite'),guild='100000000000000001',user='100000000000000002',wallet=new WalletStore({filename:file,environment:'test',guildIds:[guild],spinDelay:0});
 wallet.grant(guild,user,user,100000,'isolated workerd fixture',randomUUID());for(let i=0;i<6000;i++)wallet.spin(guild,user,20,randomUUID());wallet.close();
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
