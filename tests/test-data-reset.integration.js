import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions,Response as MFResponse} from 'miniflare';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID,randomBytes,generateKeyPairSync} from 'node:crypto';
import {WalletStore} from '../server/wallet/wallet.js';
import {FirestoreWalletStore} from '../server/firestore/wallet.js';
import {firestoreImportPlan,importFirestore} from '../server/firestore/import.js';
import {snapshotForCloud,decodeCloudArchive} from '../server/recovery/cloud-handoff.js';
import {QUOTA_LIMITS} from '../cloud/quota.js';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8787');

test('paused test cleanup survives restart, retains quota/backups, removes dependent data and rejects old sessions',async t=>{
 const root=resolve('test-results/test-data-reset');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'run-'));
 const guild='100000000000000001',user='100000000000000002',other='100000000000000004',client='100000000000000003';
 const source=join(dir,'source.sqlite'),wallet=new WalletStore({filename:source,environment:'test',guildIds:[guild],spinDelay:0});
 wallet.state(guild,user);wallet.checkin(guild,user);wallet.spin(guild,user,20,randomUUID());wallet.grant(guild,user,other,100,'fixture',randomUUID());wallet.close();
 const settings={projectId:'demo-jokers-circus',environment:'test',namespace:'reset-'+randomUUID()+'-test',schemaVersion:2,emulator:process.env.FIRESTORE_EMULATOR_HOST,quota:{filename:join(dir,'import-quota.sqlite'),projectId:'demo-jokers-circus'}};
 const sdk=new FirestoreWalletStore(settings,{guildIds:[guild]});t.after(()=>sdk.close());const plan=firestoreImportPlan(source,'test',{version:2});await importFirestore(sdk,plan);
 const snapshot=snapshotForCloud(source,'test',{upstreamImportFingerprint:plan.fingerprint});
 const rsa=generateKeyPairSync('rsa',{modulusLength:2048}),key=randomBytes(32).toString('hex'),admin=randomBytes(32).toString('hex'),operationId=randomBytes(16).toString('hex');
 let loseDeleteResponse=false;
 const config={modules:true,scriptPath:'test-results/cloud-bundle/worker.js',compatibilityDate:'2026-07-30',compatibilityFlags:['nodejs_compat'],durableObjects:{CIRCUS_PROJECT:{className:'CircusProject',useSQLite:true}},resourcePersistencePath:join(dir,'durable'),
 bindings:{CLOUD_PLAN:'free',APP_ENV:'test',FIRESTORE_PROJECT_ID:settings.projectId,FIRESTORE_NAMESPACE:settings.namespace,DISCORD_CLIENT_ID:client,DISCORD_CLIENT_SECRET:'isolated-fixture',DISCORD_PUBLIC_KEY:'0'.repeat(64),ALLOWED_GUILD_IDS:guild,CLOUD_ADMIN_TOKEN:admin,CLOUD_ENCRYPTION_KEY:key,TEST_DATA_RESET_ID:operationId,GOOGLE_SERVICE_ACCOUNT_JSON:JSON.stringify({type:'service_account',project_id:settings.projectId,client_email:'fixture@example.invalid',private_key:rsa.privateKey.export({format:'pem',type:'pkcs8'})})},
 outboundService:async request=>{
  const url=new URL(request.url);
  if(url.hostname==='oauth2.googleapis.com')return MFResponse.json({access_token:'emulator-only',expires_in:3600});
  if(url.hostname==='firestore.googleapis.com'){
   assert.ok(url.pathname.includes('/projects/demo-jokers-circus/'));const body=await request.text();
   const response=await fetch('http://127.0.0.1:8787'+url.pathname+url.search,{method:request.method,headers:{'Content-Type':'application/json',Authorization:'Bearer owner'},body});
   if(loseDeleteResponse&&url.pathname.endsWith(':commit')&&JSON.parse(body).writes?.some(w=>w.delete)){loseDeleteResponse=false;return MFResponse.json({error:{status:'UNAVAILABLE'}},{status:503});}
   return new MFResponse(await response.text(),{status:response.status,headers:{'Content-Type':'application/json'}});
  }
  if(url.pathname==='/api/oauth2/token')return MFResponse.json({access_token:'fixture-oauth',scope:'identify guilds.members.read',expires_in:3600});
  if(url.pathname==='/api/v10/users/@me')return MFResponse.json({id:user,username:'QA'});
  if(url.pathname===`/api/v10/users/@me/guilds/${guild}/member`)return MFResponse.json({user:{id:user,bot:false},pending:false});
  throw new Error('No external calls permitted');
 }};
 let mf=new Miniflare(convertV4MiniflareOptions(config));t.after(()=>mf.dispose());
 const call=async(path,body,token=admin,extra={})=>{const response=await mf.dispatchFetch('http://localhost'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...extra},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};};
 const quota={projectId:settings.projectId,exportedAt:Date.now(),scopes:Object.fromEntries(Object.entries(QUOTA_LIMITS).map(([scope,limits])=>[scope,{limits:{...limits},growth:300,usage:[{slot:Math.floor(Date.now()/60000)*60000,reads:37,writes:scope==='maintenance'?0:13,egressBytes:3}],documents:[]}]))};
 assert.equal((await call('/__ops/seed',{projectId:settings.projectId,namespace:settings.namespace,writersStopped:true,snapshot,quota})).status,200);
 assert.equal((await call('/__ops/activate',{writersStopped:true,freePlanVerified:true})).status,200);
 const login=await call('/api/token',{code:'fixture',guildId:guild});assert.equal(login.status,200);const oldToken=login.data.session.token;
 const archive=(await call('/__ops/archive',{})).data;
 const input={action:'prepare',id:operationId,projectId:settings.projectId,namespace:settings.namespace,confirm:'DELETE ALL TEST PLAYERS',generation:archive.archive.manifest.generation,sha256:archive.archive.manifest.sha256,revision:snapshot.revision,paths:plan.resources.map(r=>r.path)};
 assert.equal((await call('/__ops/test-reset',input)).status,409,'active service cannot be cleared');
 assert.equal((await call('/__ops/pause',{})).status,200);
 for(const changed of [{namespace:'wrong-test'},{id:'0'.repeat(32)},{sha256:'0'.repeat(64)},{paths:[...input.paths,'meta/state']},{paths:input.paths.filter(p=>!p.startsWith('ledger/'))}])assert.equal((await call('/__ops/test-reset',{...input,...changed})).status,409);
 assert.equal((await call('/__ops/test-reset',input,'unauthorized')).status,403);
 assert.equal((await call('/__ops/test-reset',input)).status,200);
 assert.equal((await call('/__ops/activate',{writersStopped:true,freePlanVerified:true})).status,409);
 assert.equal((await call('/__ops/test-reset',{action:'step',id:operationId})).data.phase,'deleting');
 loseDeleteResponse=true;
 assert.equal((await call('/__ops/test-reset',{action:'step',id:operationId})).status,409,'lost commit response stays paused and resumable');
 await mf.dispose();mf=new Miniflare(convertV4MiniflareOptions(config));
 let result;
 for(let i=0;i<100;i++){result=await call('/__ops/test-reset',{action:'step',id:operationId});assert.equal(result.status,200,JSON.stringify(result));if(result.data.complete)break;}
 assert.equal(result.data.complete,true);
 for(const item of plan.resources)assert.equal((await sdk.root.collection(item.path.split('/')[0]).doc(item.path.split('/').slice(1).join('/')).get()).exists,false);
 const after=(await call('/__ops/status')).data;
 assert.deepEqual(after.quota.limits,QUOTA_LIMITS.global);assert.ok(after.quota.used.reads>=37&&after.quota.used.writes>=13);assert.equal(after.backup.revision,0);
 const empty=(await call('/__ops/archive',{})).data;
 assert.equal(decodeCloudArchive(empty.archive,key,'test').tables.wallets.length,0);
 assert.deepEqual(decodeCloudArchive(archive.archive,key,'test').tables,snapshot.tables);
 assert.equal((await call('/__ops/test-reset',{action:'step',id:operationId})).data.complete,true);
 assert.equal((await call('/__ops/activate',{writersStopped:true,freePlanVerified:true})).status,200);
 assert.equal((await call('/api/wallet',undefined,oldToken)).status,401);
 const fresh=(await call('/api/token',{code:'new-fixture',guildId:guild})).data.session;assert.equal(fresh.walletEpoch,operationId);
 assert.equal((await call('/api/wallet',undefined,fresh.token)).status,401,'old clients without epoch cannot reuse pending bets');
 const first=await call('/api/wallet',undefined,fresh.token,{'X-Wallet-Epoch':fresh.walletEpoch});assert.equal(first.data.state.balance,10000);assert.equal(first.data.state.history.length,0);assert.equal(first.data.state.claimed,false);
 const second=await call('/api/wallet',undefined,fresh.token,{'X-Wallet-Epoch':fresh.walletEpoch});assert.equal(second.data.state.revision,first.data.state.revision);
 writeFileSync(join(dir,'report.json'),JSON.stringify({ok:true,documents:plan.resources.length,newWalletBalance:first.data.state.balance,oldSessionRejected:true,lostCommitResumed:true,quotaPreserved:true}));
});
