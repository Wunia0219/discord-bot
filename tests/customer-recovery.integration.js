import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions,Response as MFResponse} from 'miniflare';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID,randomBytes,generateKeyPairSync} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {WalletStore} from '../server/wallet.js';
import {FirestoreWalletStore} from '../server/firestore-wallet.js';
import {firestoreImportPlan,importFirestore} from '../server/firestore-import.js';
import {snapshotForCloud,decodeCloudArchive,restoreCloudSnapshot} from '../server/cloud-handoff.js';
import {QUOTA_LIMITS} from '../cloud/quota.js';

assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8787');
test('single customer guild: 60 wallets, five concurrent players, full backup and cold workerd recovery',async t=>{
  const started=performance.now(),root=resolve('test-results/customer-recovery');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'run-'));
  const guild='100000000000000001',other='100000000000000009',users=Array.from({length:60},(_,i)=>String(100000000000000100n+BigInt(i)));
  const file=join(dir,'source.sqlite'),wallet=new WalletStore({filename:file,environment:'production',guildIds:[guild],clock:()=>Date.now()-86400000,spinDelay:0});
  for(const user of users)wallet.state(guild,user);
  for(const user of users.slice(0,5)){wallet.checkin(guild,user);wallet.spin(guild,user,20,randomUUID());}
  const resetId=randomUUID(),reset=wallet.resetWallets(guild,users[0],resetId);assert.equal(reset.entries.length,60);wallet.close();
  const initial=snapshotForCloud(file,'production');assert.equal(initial.tables.wallets.length,60);assert.equal(initial.tables.ledger.filter(e=>e.kind==='welcome').length,60);assert.equal(initial.tables.ledger.some(e=>e.kind==='test_seed'),false);
  const settings={projectId:'demo-jokers-circus',environment:'production',namespace:'customer-'+randomUUID()+'-production',schemaVersion:2,emulator:process.env.FIRESTORE_EMULATOR_HOST,quota:{filename:join(dir,'import-quota.sqlite'),projectId:'demo-jokers-circus'}};
  const sdk=new FirestoreWalletStore(settings,{guildIds:[guild]});t.after(()=>sdk.close());const plan=firestoreImportPlan(file,'production',{version:2});await importFirestore(sdk,plan);
  const rsa=generateKeyPairSync('rsa',{modulusLength:2048}),key=randomBytes(32).toString('hex'),admin=randomBytes(32).toString('hex'),client='100000000000000003';
  const makeConfig=(namespace,persistence)=>({modules:true,scriptPath:process.env.TEST_CLOUD_BUNDLE||'test-results/cloud-bundle/worker.js',compatibilityDate:'2026-07-30',compatibilityFlags:['nodejs_compat'],durableObjects:{CIRCUS_PROJECT:{className:'CircusProject',useSQLite:true}},resourcePersistencePath:persistence,
    bindings:{CLOUD_PLAN:'free',APP_ENV:'production',FIRESTORE_PROJECT_ID:settings.projectId,FIRESTORE_NAMESPACE:namespace,DISCORD_CLIENT_ID:client,DISCORD_CLIENT_SECRET:'isolated-fixture-secret',DISCORD_PUBLIC_KEY:'0'.repeat(64),ALLOWED_GUILD_IDS:guild,CLOUD_ADMIN_TOKEN:admin,CLOUD_ENCRYPTION_KEY:key,GOOGLE_SERVICE_ACCOUNT_JSON:JSON.stringify({type:'service_account',project_id:settings.projectId,client_email:'fixture@example.invalid',private_key:rsa.privateKey.export({format:'pem',type:'pkcs8'})})},
    outboundService:async request=>{
      const url=new URL(request.url);
      if(url.hostname==='oauth2.googleapis.com')return MFResponse.json({access_token:'emulator-only',expires_in:3600});
      if(url.hostname==='firestore.googleapis.com'){
        assert.ok(url.pathname.includes('/projects/demo-jokers-circus/'));
        const response=await fetch('http://127.0.0.1:8787'+url.pathname+url.search,{method:request.method,headers:{'Content-Type':'application/json',Authorization:'Bearer owner'},body:await request.text()});
        return new MFResponse(await response.text(),{status:response.status,headers:{'Content-Type':'application/json'}});
      }
      if(url.hostname==='discord.com'){
        if(url.pathname==='/api/oauth2/token'){const code=new URLSearchParams(await request.text()).get('code');assert.ok(users.includes(code));return MFResponse.json({access_token:'fixture-'+code,scope:'identify guilds.members.read',expires_in:3600});}
        const user=request.headers.get('authorization')?.replace('Bearer fixture-','');assert.ok(users.includes(user));
        if(url.pathname==='/api/v10/users/@me')return MFResponse.json({id:user,username:'isolated-customer'});
        if(url.pathname===`/api/v10/users/@me/guilds/${guild}/member`)return MFResponse.json({user:{id:user,bot:false},pending:false});
      }
      throw new Error('Recovery test forbids real external services');
    }});
  let mf=new Miniflare(convertV4MiniflareOptions(makeConfig(settings.namespace,join(dir,'original-do'))));t.after(()=>mf.dispose());
  const call=async(path,{body,token,adminAuth=false}={})=>{
    const response=await mf.dispatchFetch('http://localhost'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Wallet-View':'compact-v1',...(token?{Authorization:'Bearer '+token}:{}),...(adminAuth?{Authorization:'Bearer '+admin}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,data:await response.json()};
  };
  const ok=async(path,options)=>{const result=await call(path,options);assert.equal(result.status,200,JSON.stringify(result));return result.data;};
  const quota={projectId:settings.projectId,exportedAt:Date.now(),scopes:Object.fromEntries(Object.entries(QUOTA_LIMITS).map(([scope,limits])=>[scope,{limits,growth:0,usage:[{slot:Math.floor(Date.now()/60000)*60000,reads:37,writes:scope==='global'?13:0,egressBytes:0}],documents:[]}]))};
  const seed=async(namespace,snapshot,usage)=>{
    await ok('/__ops/seed',{adminAuth:true,body:{projectId:settings.projectId,namespace,writersStopped:true,snapshot,quota:usage}});
    await ok('/__ops/activate',{adminAuth:true,body:{writersStopped:true,freePlanVerified:true}});
  };
  await seed(settings.namespace,{...initial,upstreamImportFingerprint:plan.fingerprint},quota);
  assert.equal((await call('/api/token',{body:{code:users[0],guildId:other}})).status,403);
  const login=async user=>(await ok('/api/token',{body:{code:user,guildId:guild}})).session.token;
  const tokens=await Promise.all(users.slice(0,5).map(login)),keys=users.slice(0,5).map(()=>randomUUID());
  const concurrentStarted=performance.now();
  const spins=await Promise.all(tokens.map((token,i)=>ok('/api/spin',{token,body:{bet:20,requestId:keys[i]}})));
  const concurrentMs=Math.round(performance.now()-concurrentStarted);assert.equal(new Set(spins.map(s=>s.round.id)).size,5);
  for(let i=0;i<5;i++){const duplicate=await ok('/api/spin',{token:tokens[i],body:{bet:20,requestId:keys[i]}});assert.equal(duplicate.duplicate,true);assert.deepEqual(duplicate.round,spins[i].round);}
  await ok('/__ops/pause',{adminAuth:true,body:{}});assert.equal((await call('/api/spin',{token:tokens[0],body:{bet:20,requestId:randomUUID()}})).status,503);
  let backupSteps=0;
  for(;;){const progress=await ok('/__ops/backup',{adminAuth:true,body:{}});backupSteps++;if(progress.complete)break;assert.ok(backupSteps<30);}
  const manifest=await ok('/__ops/archive-manifest',{adminAuth:true,body:{}}),chunks=[];
  while(chunks.length<manifest.archive.manifest.parts){const page=await ok('/__ops/archive-page',{adminAuth:true,body:{generation:manifest.archive.manifest.generation,start:chunks.length,limit:16}});chunks.push(...page.chunks);}
  const snapshot=decodeCloudArchive({manifest:manifest.archive.manifest,chunks},key,'production');
  assert.equal(snapshot.tables.wallets.length,60);assert.equal(snapshot.tables.ledger.length,initial.tables.ledger.length+5);
  for(let i=0;i<5;i++)assert.equal(snapshot.tables.wallets.find(w=>w.user===users[i]).balance,spins[i].state.balance);
  assert.equal(snapshot.tables.operations.filter(o=>o.key==='reset:'+resetId).length,1);
  const released=await ok('/__ops/export',{adminAuth:true,body:{paged:true}});assert.equal(released.released,true);
  assert.equal((await call('/__ops/activate',{adminAuth:true,body:{writersStopped:true,freePlanVerified:true}})).status,409);
  const recoveryStarted=performance.now(),restoredFile=join(dir,'restored.sqlite');restoreCloudSnapshot(snapshot,restoredFile,'production');assert.deepEqual(snapshotForCloud(restoredFile,'production').tables,snapshot.tables);
  const recoveredSettings={...settings,namespace:'recovered-'+randomUUID()+'-production',quota:{...settings.quota,filename:join(dir,'recovered-import-quota.sqlite')}};
  const recovered=new FirestoreWalletStore(recoveredSettings,{guildIds:[guild]});t.after(()=>recovered.close());const restoredPlan=firestoreImportPlan(restoredFile,'production',{version:2});await importFirestore(recovered,restoredPlan);
  await assert.rejects(importFirestore(recovered,firestoreImportPlan(file,'production',{version:2})),/not empty|changed|fingerprint/i);
  await mf.dispose();mf=new Miniflare(convertV4MiniflareOptions(makeConfig(recoveredSettings.namespace,join(dir,'recovered-do'))));
  await seed(recoveredSettings.namespace,{...snapshot,upstreamImportFingerprint:restoredPlan.fingerprint},released.quota);
  assert.equal((await call('/api/wallet',{token:tokens[0]})).status,401,'new cloud instance requires a fresh login');
  let verified=0;
  for(const wallet of snapshot.tables.wallets){const token=await login(wallet.user),state=(await ok('/api/wallet',{token})).state;assert.equal(state.balance,wallet.balance);verified++;}
  const recoveredTokens=await Promise.all(users.slice(0,5).map(login));
  for(let i=0;i<5;i++){const replay=await ok('/api/spin',{token:recoveredTokens[i],body:{bet:20,requestId:keys[i]}});assert.equal(replay.duplicate,true);assert.deepEqual(replay.round,spins[i].round);}
  const resetReplay=await recovered.resetWallets(guild,users[0],resetId);assert.equal(resetReplay.duplicate,true);
  for(let i=0;i<5;i++){const state=(await ok('/api/wallet',{token:recoveredTokens[i]})).state;assert.equal(state.balance,spins[i].state.balance);}
  const meta=await recovered.read(recovered.meta);assert.equal(meta.nextId,snapshot.revision,'all recovery queries and replays are non-mutating');
  const recoveredQuota=(await ok('/__ops/status',{adminAuth:true})).quota;
  const exportedReads=released.quota.scopes.global.usage.reduce((sum,row)=>sum+row.reads,0);assert.ok(recoveredQuota.used.reads>=exportedReads);
  const recoveryMs=Math.round(performance.now()-recoveryStarted);
  writeFileSync('test-results/customer-recovery-report.json',JSON.stringify({ok:true,emulatorOnly:true,realWorkerd:true,singleGuild:true,wallets:verified,concurrentPlayers:5,concurrentMs,backupSteps,allSevenTablesEqual:true,originalSpinsReplayed:5,compact60WalletResetReplayed:true,noDuplicateCredits:true,oldWriterReleased:true,freshCloudState:true,freshLoginRequired:true,nonemptyRestoreRefused:true,originalQuotaCarried:true,recoveryMs,totalMs:Math.round(performance.now()-started),scope:'Isolated Firestore emulator and local workerd cold recovery; excludes real provider redeployment, Discord OAuth, DNS and operator response time'},null,2));
});
