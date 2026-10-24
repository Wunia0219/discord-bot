import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions,Response as MFResponse} from 'miniflare';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {WalletStore} from '../server/wallet.js';
import {FirestoreWalletStore} from '../server/firestore-wallet.js';
import {firestoreImportPlan,importFirestore} from '../server/firestore-import.js';
import {snapshotForCloud,decodeCloudArchive,restoreCloudSnapshot} from '../server/cloud-handoff.js';
import {setTimeout as delay} from 'node:timers/promises';
import {roundFromStops} from '../src/game/index.js';
import {QUOTA_LIMITS} from '../cloud/quota.js';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8787');
test('real workerd persists quotas/sessions, runs Discord API, backs up new progress, releases ownership and restores for rollback',async t=>{
 const root=resolve('test-results/cloud-runtime');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'case-')),guild='100000000000000001',user='100000000000000002',client='100000000000000003',namespace='runtime-'+randomUUID()+'-test';
 const source=join(dir,'source.sqlite'),local=new WalletStore({filename:source,environment:'test',guildIds:[guild],clock:()=>Date.now()-86400000,spinDelay:0});local.checkin(guild,user);local.spin(guild,user,20,'runtime-original-spin-0001');local.close();
 const settings={projectId:'demo-jokers-circus',environment:'test',namespace,schemaVersion:2,emulator:process.env.FIRESTORE_EMULATOR_HOST,quota:{filename:join(dir,'sdk-quota.sqlite'),projectId:'demo-jokers-circus'}};
 const sdk=new FirestoreWalletStore(settings,{guildIds:[guild]});t.after(()=>sdk.close());const plan=firestoreImportPlan(source,'test',{version:2});await importFirestore(sdk,plan);
 const rsa=generateKeyPairSync('rsa',{modulusLength:2048}),ed=generateKeyPairSync('ed25519'),key=randomBytes(32).toString('hex'),admin=randomBytes(32).toString('hex'),replies=[],announcements=[];
 const config={modules:true,scriptPath:'test-results/cloud-bundle/worker.js',compatibilityDate:'2026-07-30',compatibilityFlags:['nodejs_compat'],durableObjects:{CIRCUS_PROJECT:{className:'CircusProject',useSQLite:true}},resourcePersistencePath:join(dir,'durable'),bindings:{CLOUD_PLAN:'free',APP_ENV:'test',FIRESTORE_PROJECT_ID:settings.projectId,FIRESTORE_NAMESPACE:namespace,DISCORD_CLIENT_ID:client,DISCORD_CLIENT_SECRET:'isolated-fixture-secret',DISCORD_HIGHLIGHTS_WEBHOOK_URL:'https://discord.com/api/webhooks/100000000000000005/isolated-fake-webhook',DISCORD_PUBLIC_KEY:ed.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('hex'),ALLOWED_GUILD_IDS:guild,CLOUD_ADMIN_TOKEN:admin,CLOUD_ENCRYPTION_KEY:key,GOOGLE_SERVICE_ACCOUNT_JSON:JSON.stringify({type:'service_account',project_id:settings.projectId,client_email:'fixture@example.invalid',private_key:rsa.privateKey.export({format:'pem',type:'pkcs8'})})},outboundService:async request=>{
   const u=new URL(request.url);if(u.hostname==='oauth2.googleapis.com')return MFResponse.json({access_token:'emulator-only',expires_in:3600});
   if(u.hostname==='firestore.googleapis.com'){assert.ok(u.pathname.includes('/projects/demo-jokers-circus/'));const r=await fetch('http://127.0.0.1:8787'+u.pathname+u.search,{method:request.method,headers:{'Content-Type':'application/json',Authorization:'Bearer owner'},body:await request.text()});return new MFResponse(await r.text(),{status:r.status,headers:{'Content-Type':'application/json'}});}
   if(request.url==='https://discord.com/api/oauth2/token')return MFResponse.json({access_token:'fixture-oauth-secret',scope:'identify guilds.members.read',expires_in:3600});
   if(u.pathname==='/api/v10/users/@me')return MFResponse.json({id:user,username:'isolated-runtime-test'});
   if(u.pathname===`/api/v10/users/@me/guilds/${guild}/member`)return MFResponse.json({user:{id:user,bot:false},pending:false});
   if(u.pathname==='/api/webhooks/100000000000000005/isolated-fake-webhook'){if(request.method==='GET')return MFResponse.json({type:1,guild_id:guild,channel_id:'100000000000000006'});announcements.push(await request.json());return MFResponse.json({id:'100000000000000007'});}
   if(u.pathname.endsWith('/messages/@original')&&request.method==='PATCH'){replies.push(await request.json());return MFResponse.json({});}
   throw new Error('Unapproved external request in test');
 }};
 let mf=new Miniflare(convertV4MiniflareOptions(config));t.after(()=>mf.dispose());const call=async(path,{body,token,adminAuth=false,headers={},method}={})=>{const r=await mf.dispatchFetch('http://localhost'+path,{method:method||(body?'POST':'GET'),headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{}),...(adminAuth?{Authorization:'Bearer '+admin}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();return {status:r.status,data};};
 assert.equal((await call('/api/wallet')).status,503);assert.equal((await call('/__ops/status')).status,403);
 const snapshot=snapshotForCloud(source,'test',{upstreamImportFingerprint:plan.fingerprint}),quota={projectId:settings.projectId,exportedAt:Date.now(),scopes:Object.fromEntries(Object.entries(QUOTA_LIMITS).map(([k,v])=>[k,{limits:{...v},growth:300,usage:[{slot:Math.floor(Date.now()/60000)*60000,reads:37,writes:k==='maintenance'?0:13,egressBytes:3}],documents:[]}]))};
 const seeded=await call('/__ops/seed',{adminAuth:true,body:{projectId:settings.projectId,namespace,writersStopped:true,snapshot,quota}});assert.equal(seeded.status,200,JSON.stringify(seeded));assert.equal((await call('/__ops/seed',{adminAuth:true,body:{}})).status,409);
 assert.equal((await call('/__ops/activate',{adminAuth:true,body:{writersStopped:true,freePlanVerified:true}})).status,200);assert.equal((await call('/readyz')).status,200);
 const login=await call('/api/token',{body:{code:'fixture-code',guildId:guild}});assert.equal(login.status,200,JSON.stringify(login));const token=login.data.session.token;assert.equal((await call('/api/wallet',{token,headers:{origin:'https://untrusted.invalid'}})).status,403);assert.equal((await call('/api/wallet')).status,401);
 assert.equal((await call('/api/wallet',{token})).data.state.balance,snapshot.tables.wallets[0].balance);
 const retry=await call('/api/spin',{token,body:{bet:20,requestId:'runtime-original-spin-0001'}});assert.equal(retry.data.duplicate,true);assert.deepEqual(retry.data.round,JSON.parse(snapshot.tables.rounds[0].data));
 const checkin=await call('/api/checkin',{token,body:{}});assert.equal(checkin.status,200);assert.equal((await call('/api/checkin',{token,body:{}})).data.duplicate,true);
 const spin=await call('/api/spin',{token,body:{bet:20,requestId:'runtime-new-spin-request-0002'},headers:{'x-wallet-view':'compact-v1'}});assert.equal(spin.status,200,JSON.stringify(spin));
 sdk.highlightsGuild=guild;sdk.spinDelay=0;const examples=JSON.parse(readFileSync('docs/data/math-report.json','utf8')).examples;
 const forced=await sdk.transact(guild,user,{kind:'spin',requestId:randomUUID(),fingerprint:'20',bet:20,outcome:roundFromStops(20,examples.mega.stops),roundId:randomUUID()},{compact:true,profileName:'isolated announcement fixture'});
 await mf.dispose();mf=new Miniflare(convertV4MiniflareOptions(config));const after=await call('/api/wallet',{token});assert.equal(after.status,200,JSON.stringify(after));assert.equal(after.data.state.balance,forced.state.balance);assert.equal((await call('/api/spin',{token,body:{bet:20,requestId:'runtime-new-spin-request-0002'}})).data.duplicate,true);
 assert.equal((await call('/api/interactions',{body:{type:1}})).status,401);
 const interaction={type:2,id:'100000000000000004',application_id:client,guild_id:guild,token:'fixture-interaction-token',member:{user:{id:user,bot:false},permissions:'0'},data:{name:'籌碼'}},raw=JSON.stringify(interaction),timestamp=String(Math.floor(Date.now()/1000)),signature=sign(null,Buffer.from(timestamp+raw),ed.privateKey).toString('hex');
 const r=await mf.dispatchFetch('http://localhost/api/interactions',{method:'POST',headers:{'x-signature-timestamp':timestamp,'x-signature-ed25519':signature,'Content-Type':'application/json'},body:raw});assert.deepEqual(await r.json(),{type:5,data:{flags:64}});
 assert.equal((await call('/__ops/pause',{adminAuth:true,body:{}})).status,200);assert.equal(replies.length,1);assert.equal((await call('/api/checkin',{token,body:{}})).status,503);
 for(let i=0;i<20;i++){const b=await call('/__ops/backup',{adminAuth:true,body:{}});assert.equal(b.status,200,JSON.stringify(b));if(i===0)await sdk.grant(guild,user,user,7,'concurrent readTime fixture',randomUUID());if(b.data.complete)break;if(i===19)assert.fail('Backup did not finish');}
 assert.equal((await call('/__ops/export',{adminAuth:true,body:{}})).status,409,'backup readTime excludes later progress, so export is refused');
 for(let i=0;i<20;i++){const b=await call('/__ops/backup',{adminAuth:true,body:{}});assert.equal(b.status,200);if(b.data.complete)break;if(i===19)assert.fail('Latest backup did not finish');}
 assert.equal((await call('/__ops/activate',{adminAuth:true,body:{writersStopped:true,freePlanVerified:true}})).status,200);
 for(let i=0;i<100&&!announcements.length;i++)await delay(100);
 assert.ok(announcements.length,'durable alarm recovers outbox without enqueue hint');
 assert.equal((await call('/__ops/pause',{adminAuth:true,body:{}})).status,200);
 for(let i=0;i<20;i++){const b=await call('/__ops/backup',{adminAuth:true,body:{}});assert.equal(b.status,200);if(i===0){await mf.dispose();mf=new Miniflare(convertV4MiniflareOptions(config));}if(b.data.complete)break;if(i===19)assert.fail('Resumed backup did not finish');}
 const archive=await call('/__ops/archive',{adminAuth:true,body:{}});assert.equal(archive.status,200);assert.equal(archive.data.released,false);assert.equal(decodeCloudArchive(archive.data.archive,key,'test').tables.rounds.length,3);
 const released=await call('/__ops/export',{adminAuth:true,body:{}});assert.equal(released.status,200,JSON.stringify(released));assert.equal(released.data.released,true);assert.deepEqual((await call('/__ops/export',{adminAuth:true,body:{}})).data,released.data);assert.equal((await call('/__ops/activate',{adminAuth:true,body:{writersStopped:true,freePlanVerified:true}})).status,409);
 const restored=decodeCloudArchive(released.data.archive,key,'test');assert.equal(restored.tables.rounds.length,3);assert.equal(restored.tables.ledger.length,snapshot.tables.ledger.length+4);assert.equal(restored.tables.highlight_events.find(e=>e.round_id===forced.round.id).status,'sent');assert.equal(restored.tables.highlight_boards[0].message_id,'100000000000000007');assert.equal(restoreCloudSnapshot(restored,join(dir,'cloud-restored.sqlite'),'test').ok,true);
 const rollbackSettings={...settings,namespace:'rollback-'+randomUUID()+'-test'},rollback=new FirestoreWalletStore(rollbackSettings,{guildIds:[guild]});t.after(()=>rollback.close());await importFirestore(rollback,firestoreImportPlan(join(dir,'cloud-restored.sqlite'),'test',{version:2}));assert.equal((await rollback.state(guild,user)).balance,forced.state.balance+7);assert.equal((await rollback.spin(guild,user,20,'runtime-new-spin-request-0002')).duplicate,true);
 assert.ok(released.data.quota.scopes.global.usage.reduce((n,x)=>n+x.reads,0)>37);writeFileSync('test-results/cloud-runtime-report.json',JSON.stringify({emulatorOnly:true,realWorkerd:true,persistentSessions:true,originalQuotaCarried:true,cloudBackupRestored:true,newProgressSurvivesRollback:true,privateCommandReply:true,alarmRecoversOutbox:true,backupResumesAfterRestart:true,consistentReadTime:true,staleExportRefused:true,actualCloudDeployment:false},null,2));
});
