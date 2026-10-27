import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {WalletStore} from '../server/wallet.js';
import {snapshotForCloud} from '../server/cloud-handoff.js';
import {CloudState,Sealer} from '../cloud/storage.js';
import {SnapshotVault} from '../cloud/snapshot.js';
import {downloadRecoveryArchive,recoverySummary,recoveryNotification,sendRecoveryNotification} from '../server/wallet-recovery.js';

const guild='100000000000000001',other='100000000000000009',channel='100000000000000003',key='a'.repeat(64);
const source={projectId:'demo-jokers-circus',namespace:'customer-production',environment:'production'};
const webhook='https://discord.com/api/webhooks/100000000000000004/fixture-only-secret';
function fixture(t,{players=1}={}){
  const root=resolve('test-results/wallet-recovery');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'run-'));
  const file=join(dir,'source.sqlite'),wallet=new WalletStore({filename:file,environment:'production',guildIds:[guild],clock:()=>Date.now()-86400000,spinDelay:0});
  for(let i=0;i<players;i++){const user=String(100000000000000100n+BigInt(i));wallet.state(guild,user);if(i<5){wallet.checkin(guild,user);wallet.spin(guild,user,20,randomUUID());}}
  wallet.resetWallets(guild,'100000000000000099',randomUUID());wallet.spin(guild,'100000000000000100',20,randomUUID());wallet.close();
  const snapshot=snapshotForCloud(file,'production'),sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
  const storage={sql:{exec:(q,...args)=>sql.prepare(q).all(...args).map(x=>({...x}))},transactionSync(fn){sql.exec('SAVEPOINT fixture');try{const result=fn();sql.exec('RELEASE fixture');return result;}catch(error){sql.exec('ROLLBACK TO fixture; RELEASE fixture');throw error;}}};
  const state=new CloudState(storage),vault=new SnapshotVault(storage,state,new Sealer(key));vault.save('fixture',snapshot);vault.publish('fixture');
  const envelope={source,archive:vault.archive('fixture'),released:false};
  return {dir,snapshot,envelope};
}
function downloadFixture(envelope){
  const requests=[];
  const options={origin:'https://fixture.example.workers.dev',token:'b'.repeat(64),source,
    fetchImpl:async(url,request)=>{
      const path=url.pathname;requests.push(path);assert.equal(request.redirect,'error');
      if(path==='/__ops/status'){assert.equal(request.method,'GET');return Response.json({source});}
      if(path==='/__ops/archive-manifest')return Response.json({...envelope,archive:{manifest:envelope.archive.manifest}});
      assert.equal(path,'/__ops/archive-page');const body=JSON.parse(request.body),m=envelope.archive.manifest;
      return Response.json({generation:m.generation,sha256:m.sha256,start:body.start,chunks:envelope.archive.chunks.slice(body.start,body.start+body.limit)});
    }};
  return {options,requests};
}

test('downloads a fixed encrypted generation without backup writes or ownership changes',async t=>{
  const f=fixture(t),d=downloadFixture(f.envelope),envelope=await downloadRecoveryArchive(d.options);
  assert.deepEqual(envelope,f.envelope);
  const {summary}=recoverySummary(envelope,key,'production',{guildId:guild});
  assert.equal(summary.walletCount,1);assert.equal(summary.totalBalance,String(f.snapshot.tables.wallets[0].balance));
  assert.equal(summary.revision,f.snapshot.revision);assert.ok(d.requests.every(p=>['/__ops/status','/__ops/archive-manifest','/__ops/archive-page'].includes(p)));
  assert.throws(()=>recoverySummary(envelope,'c'.repeat(64),'production'));
  assert.throws(()=>recoverySummary(envelope,key,'test'));
  assert.throws(()=>recoverySummary(envelope,key,'production',{guildId:other}),/another guild/);
});

test('wrong source, unsafe origins, missing pages and changed generations fail closed',async t=>{
  const f=fixture(t);
  for(const change of [{origin:'http://localhost'},{origin:'https://user:secret@fixture.example.workers.dev'},{token:'bad'},{source:{...source,namespace:'other-production'}}]){
    const d=downloadFixture(f.envelope);await assert.rejects(downloadRecoveryArchive({...d.options,...change}));
    assert.ok(!d.requests.includes('/__ops/archive-manifest'));
  }
  for(const change of [{generation:'changed'},{sha256:'wrong'},{start:999},{chunks:[]}]){
    const d=downloadFixture(f.envelope),original=d.options.fetchImpl;
    d.options.fetchImpl=async(url,options)=>{const r=await original(url,options);return url.pathname.endsWith('/archive-page')?Response.json({...await r.json(),...change}):r;};
    await assert.rejects(downloadRecoveryArchive(d.options),/changed or incomplete/);
  }
});

function notificationFixture(){
  const report={operation:'drill',status:'complete',walletCount:60,revision:135,finishedAt:new Date().toISOString(),privatePlayer:'private-player',secret:'private-secret'};
  const posts=[],saved=[];
  const options={webhook,guildId:guild,channelId:channel,report,save:async r=>saved.push(structuredClone(r)),fetchImpl:async(url,request)=>{
    if(request.method==='GET')return Response.json({guild_id:guild,channel_id:channel});
    assert.equal(saved.at(-1).notification.status,'sending');assert.equal(url.searchParams.get('wait'),'true');posts.push(JSON.parse(request.body));return Response.json({id:'100000000000000005',channel_id:channel});
  }};
  return {report,posts,saved,options};
}
test('maintenance messages verify destination, redact private fields and persist receipts before sending',async()=>{
  const f=notificationFixture();assert.equal((await sendRecoveryNotification(f.options)).status,'sent');
  assert.equal(f.posts.length,1);assert.ok(!JSON.stringify(f.posts).includes('private-'));assert.deepEqual(f.posts[0].allowed_mentions,{parse:[]});
  await sendRecoveryNotification(f.options);assert.equal(f.posts.length,1);
  assert.match(recoveryNotification({...f.report,status:'failed'}).content,/失敗/);
  assert.throws(()=>recoveryNotification({...f.report,status:'started'}));
});
test('wrong channel, failed receipt writes and unknown POST outcomes never cause blind re-sends',async()=>{
  const wrong=notificationFixture();wrong.options.channelId=other;await assert.rejects(sendRecoveryNotification(wrong.options),/mismatch/);assert.equal(wrong.posts.length,0);
  const storage=notificationFixture();storage.options.save=async()=>{throw new Error('disk full');};await assert.rejects(sendRecoveryNotification(storage.options));assert.equal(storage.posts.length,0);
  const f=notificationFixture(),original=f.options.fetchImpl;f.options.fetchImpl=async(url,options)=>{if(options.method==='POST')throw new Error('private network error');return original(url,options);};
  assert.equal((await sendRecoveryNotification(f.options)).status,'uncertain');assert.equal((await sendRecoveryNotification(f.options)).status,'uncertain');
  assert.ok(!JSON.stringify(f.saved).includes('private network error'));
  const interrupted=notificationFixture();interrupted.report.notification={status:'sending'};assert.equal((await sendRecoveryNotification(interrupted.options)).status,'uncertain');assert.equal(interrupted.posts.length,0);
  const finalSave=notificationFixture(),save=finalSave.options.save;finalSave.options.save=async report=>{if(report.notification.status==='sent')throw new Error('disk full after POST');await save(report);};
  await assert.rejects(sendRecoveryNotification(finalSave.options));assert.equal(finalSave.report.notification.status,'sent');assert.equal(finalSave.posts.length,1);
});

test('60-wallet CLI recovery preserves compact resets, original requests and source; refuses overwrite',t=>{
  const f=fixture(t,{players:60}),archive=join(f.dir,'archive.json'),keyFile=join(f.dir,'key.txt'),out=join(f.dir,'drill');
  writeFileSync(archive,JSON.stringify(f.envelope));writeFileSync(keyFile,key,{mode:0o600});const before=readFileSync(archive);
  const args=['scripts/admin/wallet-recovery.js','drill','--archive',archive,'--key-file',keyFile,'--environment','production','--guild',guild,'--out',out];
  const run=()=>spawnSync(process.execPath,args,{encoding:'utf8',windowsHide:true});
  const result=run();assert.equal(result.status,0,result.stderr+result.stdout);
  const report=JSON.parse(readFileSync(join(out,'report.json')));assert.equal(report.status,'complete');assert.equal(report.walletCount,60);
  assert.equal(report.drill.allSevenTablesUnchanged,true);assert.equal(report.drill.originalRequestsReplayed,12);assert.equal(report.drill.externalServicesAccessed,false);
  assert.deepEqual(readFileSync(archive),before);assert.equal(run().status,1);assert.ok(!result.stdout.includes(key));
  const badOut=join(f.dir,'wrong-key');writeFileSync(join(f.dir,'wrong.txt'),'c'.repeat(64));
  const bad=spawnSync(process.execPath,['scripts/admin/wallet-recovery.js','drill','--archive',archive,'--key-file',join(f.dir,'wrong.txt'),'--environment','production','--out',badOut],{encoding:'utf8',windowsHide:true});
  assert.equal(bad.status,1);const failure=JSON.parse(readFileSync(join(badOut,'report.json')));assert.equal(failure.status,'failed');assert.equal(failure.failedStage,'verify');assert.equal(existsSync(join(badOut,'local-drill','restored.sqlite')),false);
});
