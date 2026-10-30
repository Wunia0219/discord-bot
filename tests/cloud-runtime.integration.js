import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions,Response as MFResponse} from 'miniflare';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {WalletStore} from '../server/wallet/wallet.js';
import {FirestoreWalletStore} from '../server/firestore/wallet.js';
import {firestoreImportPlan,importFirestore} from '../server/firestore/import.js';
import {snapshotForCloud,decodeCloudArchive,restoreCloudSnapshot} from '../server/recovery/cloud-handoff.js';
import {setTimeout as delay} from 'node:timers/promises';
import {roundFromStops} from '../src/game/index.js';
import {QUOTA_LIMITS} from '../cloud/quota.js';
import {APP_VERSION} from '../src/version.js';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8787');

test('real workerd supplies mobile audio byte ranges even when its static asset binding returns full files',async t=>{
 const bytes=new Uint8Array([0x49,0x44,0x33,1,2,3]);
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:process.env.TEST_CLOUD_BUNDLE||'test-results/cloud-bundle/worker.js',compatibilityDate:'2026-07-30',compatibilityFlags:['nodejs_compat'],serviceBindings:{ASSETS:async request=>{
   if(new URL(request.url).pathname.endsWith('.mp3')){assert.equal(request.headers.has('range'),false);return new MFResponse(request.method==='HEAD'?null:bytes,{headers:{'Content-Type':'audio/mpeg','Content-Length':'6'}});}
   return new MFResponse('ordinary asset');
 }},outboundService:()=>{throw new Error('Audio test must not access external services');}}));
 t.after(()=>mf.dispose());
 const response=await mf.dispatchFetch('http://localhost/assets/music.mp3',{headers:{Range:'bytes=0-1'}});
 assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),'bytes 0-1/6');assert.equal(response.headers.get('content-length'),'2');
 assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[0x49,0x44]);
 const head=await fetch(new URL('/assets/music.mp3',await mf.ready),{method:'HEAD'});
 assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),'6');assert.equal(await head.text(),'');
 assert.equal(await (await mf.dispatchFetch('http://localhost/assets/main.js')).text(),'ordinary asset');
});

for(const casino of [false,true])test(`real workerd persists quotas/sessions, Discord API and recovery (${casino?'casino bot':'legacy webhook'})`,async t=>{
 const root=resolve('test-results/cloud-runtime');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'case-')),guild='100000000000000001',user='100000000000000002',client='100000000000000003',namespace='runtime-'+randomUUID()+'-test';
 const source=join(dir,'source.sqlite'),local=new WalletStore({filename:source,environment:'test',guildIds:[guild],clock:()=>Date.now()-86400000,spinDelay:0});local.checkin(guild,user);local.spin(guild,user,20,'runtime-original-spin-0001');local.close();
 const settings={projectId:'demo-jokers-circus',environment:'test',namespace,schemaVersion:2,emulator:process.env.FIRESTORE_EMULATOR_HOST,quota:{filename:join(dir,'sdk-quota.sqlite'),projectId:'demo-jokers-circus'}};
 const sdk=new FirestoreWalletStore(settings,{guildIds:[guild]});t.after(()=>sdk.close());const plan=firestoreImportPlan(source,'test',{version:2});await importFirestore(sdk,plan);
 const rsa=generateKeyPairSync('rsa',{modulusLength:2048}),ed=generateKeyPairSync('ed25519'),key=randomBytes(32).toString('hex'),admin=randomBytes(32).toString('hex'),replies=[],announcements=[];
 const config={modules:true,scriptPath:process.env.TEST_CLOUD_BUNDLE||'test-results/cloud-bundle/worker.js',compatibilityDate:'2026-07-30',compatibilityFlags:['nodejs_compat'],durableObjects:{CIRCUS_PROJECT:{className:'CircusProject',useSQLite:true}},resourcePersistencePath:join(dir,'durable'),bindings:{CLOUD_PLAN:'free',APP_ENV:'test',FIRESTORE_PROJECT_ID:settings.projectId,FIRESTORE_NAMESPACE:namespace,DISCORD_CLIENT_ID:client,DISCORD_CLIENT_SECRET:'isolated-fixture-secret',DISCORD_HIGHLIGHTS_WEBHOOK_URL:'https://discord.com/api/webhooks/100000000000000005/isolated-fake-webhook',DISCORD_PUBLIC_KEY:ed.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('hex'),ALLOWED_GUILD_IDS:guild,CLOUD_ADMIN_TOKEN:admin,CLOUD_ENCRYPTION_KEY:key,GOOGLE_SERVICE_ACCOUNT_JSON:JSON.stringify({type:'service_account',project_id:settings.projectId,client_email:'fixture@example.invalid',private_key:rsa.privateKey.export({format:'pem',type:'pkcs8'})})},outboundService:async request=>{
   const u=new URL(request.url);if(u.hostname==='oauth2.googleapis.com')return MFResponse.json({access_token:'emulator-only',expires_in:3600});
   if(u.hostname==='firestore.googleapis.com'||u.hostname==='firestore.asia-east1.rep.googleapis.com'){assert.ok(u.pathname.includes('/projects/demo-jokers-circus/'));const r=await fetch('http://127.0.0.1:8787'+u.pathname+u.search,{method:request.method,headers:{'Content-Type':'application/json',Authorization:'Bearer owner'},body:await request.text()});return new MFResponse(await r.text(),{status:r.status,headers:{'Content-Type':'application/json'}});}
   if(request.url==='https://discord.com/api/oauth2/token')return MFResponse.json({access_token:'fixture-oauth-secret',scope:'identify guilds.members.read',expires_in:3600});
   if(u.pathname==='/api/v10/users/@me')return MFResponse.json(request.headers.get('authorization')?.startsWith('Bot ')?{id:client,bot:true}:{id:user,username:'isolated-runtime-test'});
   if(u.pathname==='/api/v10/channels/100000000000000006')return MFResponse.json({id:'100000000000000006',guild_id:guild,type:0});
   if(u.pathname==='/api/v10/channels/100000000000000006/messages'){announcements.push(await request.json());return MFResponse.json({id:'100000000000000007',channel_id:'100000000000000006'});}
   if(u.pathname===`/api/v10/users/@me/guilds/${guild}/member`)return MFResponse.json({user:{id:user,bot:false},pending:false});
   if(u.pathname==='/api/webhooks/100000000000000005/isolated-fake-webhook'){if(request.method==='GET')return MFResponse.json({type:1,guild_id:guild,channel_id:'100000000000000006'});announcements.push(await request.json());return MFResponse.json({id:'100000000000000007'});}
   if(u.pathname.endsWith('/messages/@original')&&request.method==='PATCH'){replies.push(await request.json());return MFResponse.json({});}
   throw new Error('Unapproved external request in test');
 }};
 if(casino)Object.assign(config.bindings,{DISCORD_HIGHLIGHTS_WEBHOOK_URL:'',DISCORD_CASINO_ENABLED:'true',DISCORD_CASINO_CHANNEL_ID:'100000000000000006',DISCORD_BOT_TOKEN:'isolated-bot-token-not-real-0000000000'});
 config.bindings.FIRESTORE_ENDPOINT='https://firestore.asia-east1.rep.googleapis.com';
 const monitorToken=randomBytes(32).toString('hex');config.bindings.CLOUD_MONITOR_TOKEN=monitorToken;
 let mf=new Miniflare(convertV4MiniflareOptions(config));t.after(()=>mf.dispose());const call=async(path,{body,token,adminAuth=false,headers={},method}={})=>{const r=await mf.dispatchFetch('http://localhost'+path,{method:method||(body?'POST':'GET'),headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{}),...(adminAuth?{Authorization:'Bearer '+admin}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();return {status:r.status,data};};
 assert.equal((await call('/api/wallet')).status,503);assert.equal((await call('/__ops/status')).status,403);
 assert.equal((await call('/healthz')).data.version,APP_VERSION);
 const monitorHeaders={Authorization:'Bearer '+monitorToken};
 const beforeSeed=await call('/__ops/status',{headers:monitorHeaders});assert.equal(beforeSeed.status,200);assert.equal(beforeSeed.data.mode,'unseeded');assert.equal(beforeSeed.data.operations.ok,false);
 for(const path of ['/__ops/seed','/__ops/pause','/__ops/activate','/__ops/backup','/__ops/archive','/__ops/export','/__ops/verify','/__ops/status'])assert.equal((await call(path,{body:{},headers:monitorHeaders})).status,403,path+' is not authorized by a monitor token');
 const snapshot=snapshotForCloud(source,'test',{upstreamImportFingerprint:plan.fingerprint}),quota={projectId:settings.projectId,exportedAt:Date.now(),scopes:Object.fromEntries(Object.entries(QUOTA_LIMITS).map(([k,v])=>[k,{limits:{...v},growth:300,usage:[{slot:Math.floor(Date.now()/60000)*60000,reads:37,writes:k==='maintenance'?0:13,egressBytes:3}],documents:[]}]))};
 const seeded=await call('/__ops/seed',{adminAuth:true,body:{projectId:settings.projectId,namespace,writersStopped:true,snapshot,quota}});assert.equal(seeded.status,200,JSON.stringify(seeded));assert.equal((await call('/__ops/seed',{adminAuth:true,body:{}})).status,409);
 const aggregate=await call('/__ops/status',{headers:monitorHeaders});assert.equal(aggregate.data.version,APP_VERSION);assert.deepEqual(Object.keys(aggregate.data.quota.scopes).sort(),['highlights','maintenance']);assert.equal(aggregate.data.quota.used.reads,37,'private status does not consume Firestore quota');
 assert.equal((await call('/__ops/activate',{adminAuth:true,body:{writersStopped:true,freePlanVerified:true}})).status,200);assert.equal((await call('/readyz')).status,200);
 const login=await call('/api/token',{body:{code:'fixture-code',guildId:guild}});assert.equal(login.status,200,JSON.stringify(login));const token=login.data.session.token;assert.equal((await call('/api/wallet',{token,headers:{origin:'https://untrusted.invalid'}})).status,403);assert.equal((await call('/api/wallet')).status,401);
 assert.equal((await call('/api/wallet',{token})).data.state.balance,snapshot.tables.wallets[0].balance);
 const visitId=randomUUID();
 if(casino){
   assert.equal(login.data.session.casinoNotifications,true);
   assert.equal((await call('/api/casino-visit',{token,body:{action:'enter',instanceId:visitId}})).data.active,true);
   const before=(await call('/__ops/status',{headers:monitorHeaders})).data.quota.used.reads;
   assert.equal((await call('/api/casino-visit',{token,body:{action:'heartbeat',instanceId:visitId}})).data.active,true);
   assert.equal((await call('/__ops/status',{headers:monitorHeaders})).data.quota.used.reads,before,'visit heartbeats do not read Firestore');
 }
 const retry=await call('/api/spin',{token,body:{bet:20,requestId:'runtime-original-spin-0001'}});assert.equal(retry.data.duplicate,true);assert.deepEqual(retry.data.round,JSON.parse(snapshot.tables.rounds[0].data));
 const checkin=await call('/api/checkin',{token,body:{}});assert.equal(checkin.status,200);assert.equal((await call('/api/checkin',{token,body:{}})).data.duplicate,true);
 const spin=await call('/api/spin',{token,body:{bet:20,requestId:'runtime-new-spin-request-0002'},headers:{'x-wallet-view':'compact-v1'}});assert.equal(spin.status,200,JSON.stringify(spin));
 const statusWithoutMeasurements=await call('/__ops/status?database=info',{adminAuth:true});assert.equal(statusWithoutMeasurements.status,200);assert.equal('spinTiming' in statusWithoutMeasurements.data,false);assert.equal('database' in statusWithoutMeasurements.data,false);
 if(casino){
   for(let i=0;i<150&&!announcements.some(p=>p.content?.includes('進入賭場'));i++)await delay(100);
   assert.ok(announcements.some(p=>p.content?.includes('進入賭場')),'initial maintenance has run before the cold-restart recovery case');
 }
 sdk.highlightsGuild=guild;sdk.spinDelay=0;const examples=JSON.parse(readFileSync('docs/data/math-report.json','utf8')).examples;
 const forced=await sdk.transact(guild,user,{kind:'spin',requestId:randomUUID(),fingerprint:'20',bet:20,outcome:roundFromStops(20,examples.mega.stops),roundId:randomUUID()},{compact:true,profileName:'isolated announcement fixture'});
 await mf.dispose();mf=new Miniflare(convertV4MiniflareOptions(config));const after=await call('/api/wallet',{token});assert.equal(after.status,200,JSON.stringify(after));assert.equal(after.data.state.balance,forced.state.balance);assert.equal((await call('/api/spin',{token,body:{bet:20,requestId:'runtime-new-spin-request-0002'}})).data.duplicate,true);
 assert.equal((await call('/api/interactions',{body:{type:1}})).status,401);
 const interaction={type:2,id:'100000000000000004',application_id:client,guild_id:guild,token:'fixture-interaction-token',member:{user:{id:user,bot:false},permissions:'0'},data:{name:'戲籌'}},raw=JSON.stringify(interaction),timestamp=String(Math.floor(Date.now()/1000)),signature=sign(null,Buffer.from(timestamp+raw),ed.privateKey).toString('hex');
 const r=await mf.dispatchFetch('http://localhost/api/interactions',{method:'POST',headers:{'x-signature-timestamp':timestamp,'x-signature-ed25519':signature,'Content-Type':'application/json'},body:raw});assert.deepEqual(await r.json(),{type:5,data:{flags:64}});
 const resetId='100000000000000008',resetInteraction={...interaction,id:resetId,member:{...interaction.member,permissions:'8'},data:{name:'戲籌管理',options:[{name:'重設戲籌',options:[{name:'確認',value:true}]}]}};
 const resetRaw=JSON.stringify(resetInteraction),resetSignature=sign(null,Buffer.from(timestamp+resetRaw),ed.privateKey).toString('hex');
 const resetReply=await mf.dispatchFetch('http://localhost/api/interactions',{method:'POST',headers:{'x-signature-timestamp':timestamp,'x-signature-ed25519':resetSignature,'Content-Type':'application/json'},body:resetRaw});assert.deepEqual(await resetReply.json(),{type:5,data:{flags:64}});
 assert.equal((await call('/__ops/pause',{adminAuth:true,body:{}})).status,200);assert.equal(replies.length,2);assert.equal(replies[1].embeds[0].title,'戲籌已重設');assert.match(replies[1].embeds[0].fields[0].value,new RegExp(forced.state.balance.toLocaleString('en-US')+' → 10,000'));assert.equal((await call('/api/checkin',{token,body:{}})).status,503);
 for(let i=0;i<20;i++){const b=await call('/__ops/backup',{adminAuth:true,body:{}});assert.equal(b.status,200,JSON.stringify(b));if(i===0)await sdk.grant(guild,user,user,7,'concurrent readTime fixture',randomUUID());if(b.data.complete)break;if(i===19)assert.fail('Backup did not finish');}
 assert.equal((await call('/__ops/export',{adminAuth:true,body:{}})).status,409,'backup readTime excludes later progress, so export is refused');
 for(let i=0;i<20;i++){const b=await call('/__ops/backup',{adminAuth:true,body:{}});assert.equal(b.status,200);if(b.data.complete)break;if(i===19)assert.fail('Latest backup did not finish');}
 assert.equal((await call('/__ops/activate',{adminAuth:true,body:{writersStopped:true,freePlanVerified:true}})).status,200);
 const hasWin=()=>announcements.some(p=>p.embeds?.[0]?.title?.includes('MEGA WIN'));
 for(let i=0;i<150&&!hasWin();i++)await delay(100);
 assert.ok(hasWin(),'durable alarm recovers outbox without enqueue hint');
 if(casino){
   const previousBackup=(await call('/__ops/status',{headers:monitorHeaders})).data.backup.at;
   const started=await call('/__ops/backup',{adminAuth:true,body:{}});
   assert.equal(started.status,200);assert.equal(started.data.complete,false);
   await call('/api/casino-visit',{token,body:{action:'leave',instanceId:visitId}});
   for(let i=0;i<150&&!announcements.some(p=>p.content?.includes('離開賭場'));i++)await delay(100);
   assert.equal(announcements.filter(p=>p.content?.includes('進入賭場')).length,1);
   const exits=announcements.filter(p=>p.content?.includes('離開賭場'));assert.equal(exits.length,1);assert.match(exits[0].content,/本次遊戲盈虧/);
   assert.ok(announcements.every(p=>p.enforce_nonce===true&&!('flags' in p)));
   const deadline=Date.now()+90000;let completed;
   do{completed=(await call('/__ops/status',{headers:monitorHeaders})).data.backup;if(completed.at>previousBackup)break;await delay(250);}while(Date.now()<deadline);
   assert.ok(completed.at>previousBackup,'short casino alarms must continue an active backup without waiting ten minutes');
 }
 assert.equal((await call('/__ops/pause',{adminAuth:true,body:{}})).status,200);
 for(let i=0;i<20;i++){const b=await call('/__ops/backup',{adminAuth:true,body:{}});assert.equal(b.status,200);if(i===0){await mf.dispose();mf=new Miniflare(convertV4MiniflareOptions(config));}if(b.data.complete)break;if(i===19)assert.fail('Resumed backup did not finish');}
 const verification=await call('/__ops/verify',{adminAuth:true,body:{}});assert.equal(verification.status,200,JSON.stringify(verification));assert.equal(verification.data.readOnly,true);
 const archive=await call('/__ops/archive',{adminAuth:true,body:{}});assert.equal(archive.status,200);assert.equal(archive.data.released,false);assert.equal(decodeCloudArchive(archive.data.archive,key,'test').tables.rounds.length,3);
 const manifestPage=await call('/__ops/archive-manifest',{adminAuth:true,body:{}});assert.equal(manifestPage.status,200);const m=manifestPage.data.archive.manifest,download=[];
 for(let start=0;start<m.parts;start+=2){const page=await call('/__ops/archive-page',{adminAuth:true,body:{generation:m.generation,start,limit:2}});assert.equal(page.status,200);assert.equal(page.data.sha256,m.sha256);download.push(...page.data.chunks);}
 assert.deepEqual(decodeCloudArchive({manifest:m,chunks:download},key,'test'),decodeCloudArchive(archive.data.archive,key,'test'));
 assert.equal((await call('/__ops/archive-page',{adminAuth:true,body:{generation:m.generation,start:-1,limit:2}})).status,409);
 const released=await call('/__ops/export' ,{adminAuth:true,body:{}});assert.equal(released.status,200,JSON.stringify(released));assert.equal(released.data.released,true);assert.deepEqual((await call('/__ops/export',{adminAuth:true,body:{}})).data,released.data);assert.equal((await call('/__ops/activate',{adminAuth:true,body:{writersStopped:true,freePlanVerified:true}})).status,409);
 const restored=decodeCloudArchive(released.data.archive,key,'test');assert.equal(restored.tables.rounds.length,3);assert.equal(restored.tables.ledger.length,snapshot.tables.ledger.length+5);assert.equal(restored.tables.highlight_events.find(e=>e.round_id===forced.round.id).status,'sent');assert.equal(restored.tables.highlight_boards[0].message_id,'100000000000000007');assert.equal(restoreCloudSnapshot(restored,join(dir,'cloud-restored.sqlite'),'test').ok,true);
 const rollbackSettings={...settings,namespace:'rollback-'+randomUUID()+'-test'},rollback=new FirestoreWalletStore(rollbackSettings,{guildIds:[guild]});t.after(()=>rollback.close());await importFirestore(rollback,firestoreImportPlan(join(dir,'cloud-restored.sqlite'),'test',{version:2}));assert.equal((await rollback.state(guild,user)).balance,10007);assert.equal((await rollback.spin(guild,user,20,'runtime-new-spin-request-0002')).duplicate,true);
 assert.equal((await rollback.resetWallets(guild,user,resetId)).duplicate,true);assert.equal((await rollback.state(guild,user)).balance,10007);
 assert.ok(released.data.quota.scopes.global.usage.reduce((n,x)=>n+x.reads,0)>37);writeFileSync('test-results/cloud-runtime-report.json',JSON.stringify({emulatorOnly:true,realWorkerd:true,persistentSessions:true,originalQuotaCarried:true,cloudBackupRestored:true,newProgressSurvivesRollback:true,privateCommandReply:true,alarmRecoversOutbox:true,backupResumesAfterRestart:true,consistentReadTime:true,staleExportRefused:true,actualCloudDeployment:false},null,2));
});
