import {TestDataReset} from './test-data-reset.js';
import {DurableObject} from 'cloudflare:workers';
import {secureResponse} from '../server/http/security-headers.js';
import {timingSafeEqual,randomUUID} from 'node:crypto';
import {FirestoreRest} from './firestore-rest.js';
import {FirestoreWalletCore} from '../server/firestore/wallet-core.js';
import {FirestoreHighlights} from '../server/firestore/highlights-core.js';
import {SettlementQueue} from '../server/wallet/settlement-queue.js';
import {WalletService} from '../server/wallet/wallet-service.js';
import {highlightSettings} from '../server/discord/highlights.js';
import {createActivityHandler} from '../server/http/app-handler.js';
import {CloudState,CloudSessions,CloudLoginLimit,Sealer} from './storage.js';
import {CloudQuota} from './quota.js';
import {auditSnapshot,SnapshotVault,BACKUP_MAX_PARTS} from './snapshot.js';
import {verifyCloudSnapshot} from './verify.js';
import {CloudBackup} from './backup.js';
import {MODEL_VERSION} from '../src/game/slot-math.js';
import {audioAsset} from './audio-asset.js';
import {handleFetch} from './http-bridge.js';
import {APP_VERSION} from '../src/version.js';
import {commandChannels} from '../server/discord/discord-channel-scope.js';
import {operationsHealth} from './operations-health.js';
import {CasinoBot} from '../server/discord/casino-bot.js';
import {CasinoVisits,casinoVisitStatus} from '../server/discord/casino-visits.js';

// Workers supports manual redirects; every caller rejects non-2xx responses.
const cloudFetch=(url,options={})=>globalThis.fetch(url,{...options,redirect:options.redirect==='error'?'manual':options.redirect});
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const apiPaths=new Set(['/healthz','/readyz','/api/token','/api/interactions','/api/wallet','/api/spin','/api/checkin','/api/ledger','/api/rounds','/api/casino-visit']);
function identity(env){
  if(env.CLOUD_PLAN!=='free'||!['test','production'].includes(env.APP_ENV)||!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(env.FIRESTORE_PROJECT_ID||'')||!/^[-a-z0-9]{3,80}$/.test(env.FIRESTORE_NAMESPACE||'')||!env.FIRESTORE_NAMESPACE.endsWith('-'+env.APP_ENV))throw new Error('Cloud identity not configured');
  if(env.LOCAL_WALLET_TEST==='true'||env.FIRESTORE_EMULATOR_HOST)throw new Error('Fixture configuration is not deployable');
  return {projectId:env.FIRESTORE_PROJECT_ID,namespace:env.FIRESTORE_NAMESPACE,environment:env.APP_ENV,schemaVersion:2};
}
const authorized=(req,env,name='CLOUD_ADMIN_TOKEN')=>{const expected=env[name];if(!/^[a-f0-9]{64}$/i.test(expected||''))return false;const value=req.headers.get('authorization')?.replace(/^Bearer /,'')||'';return /^[a-f0-9]{64}$/i.test(value)&&timingSafeEqual(Buffer.from(value),Buffer.from(expected));};
async function body(req,limit=12*1024**2){let n=0,parts=[];for await(const chunk of req.body||[]){n+=chunk.length;if(n>limit)throw new Error('Body too large');parts.push(chunk);}return JSON.parse(Buffer.concat(parts).toString('utf8'));}

export class CircusProject extends DurableObject {
  constructor(ctx,env){super(ctx,env);Object.assign(this,{ctx,env});this.state=new CloudState(ctx.storage);this.quota=new CloudQuota(ctx.storage,this.state);this.active=new Set();this.opsTail=Promise.resolve();}
  track(promise){this.active.add(promise);void promise.finally(()=>this.active.delete(promise)).catch(()=>{});return promise;}
  backupStep(rt){this.backupPending ||= this.track(rt.backup.step()).finally(()=>this.backupPending=null);return this.backupPending;}
  async runtime(){
    if(this.instance)return this.instance;
    this.initializing ||= this.makeRuntime().then(x=>this.instance=x).finally(()=>this.initializing=null);return this.initializing;
  }
  async makeRuntime(){
    const settings=identity(this.env),saved=this.state.get('source');if(!saved||saved.projectId!==settings.projectId||saved.namespace!==settings.namespace||this.quota.identity().projectId!==settings.projectId)throw new Error('Handoff is required');
    const credentials=JSON.parse(this.env.GOOGLE_SERVICE_ACCOUNT_JSON||'null');if(credentials?.type!=='service_account'||credentials.project_id!==settings.projectId||!credentials.private_key||!credentials.client_email)throw new Error('Credentials mismatch');
    const sealer=new Sealer(this.env.CLOUD_ENCRYPTION_KEY),vault=new SnapshotVault(this.ctx.storage,this.state,sealer),guildIds=(this.env.ALLOWED_GUILD_IDS||'').split(',').map(x=>x.trim());
    const transport=()=>new FirestoreRest({...settings,credentials,fetchImpl:cloudFetch,endpoint:this.env.FIRESTORE_ENDPOINT}),options={guildIds,weeklyRewards:this.env.WEEKLY_CHECKIN_REWARDS,grantMax:Number(this.env.ADMIN_GRANT_MAX||100000),grantDaily:Number(this.env.ADMIN_DAILY_MAX||1000000)};
    // This sole writer refreshes wallets after every committed operation.
    const store=new FirestoreWalletCore(settings,{...options,db:transport(),quota:this.quota,settlementQueue:new SettlementQueue(),stateCacheMs:30000});
    // Never initialize an empty remote namespace from a public request.
    const meta=await store.read(store.meta);store.checkMeta(meta);store.walletEpoch=meta.walletEpoch;store.resetAt=meta.resetAt;store.ready=true;store.readyAt=Date.now();
    const service=new WalletService(store,{fetchImpl:cloudFetch,sessions:new CloudSessions(this.ctx.storage,sealer)}),hs=highlightSettings(this.env,store);
    const bot=hs?.botSettings?new CasinoBot({...hs.botSettings,fetchImpl:cloudFetch}):null;
    const visits=bot?new CasinoVisits({state:this.state,bot,readAccount:(guild,user)=>store.casinoAccount(guild,user),wake:()=>this.ctx.waitUntil(this.schedule(1000)),warn:message=>console.warn(message)}):null;
    const highlights=hs?new FirestoreHighlights(new FirestoreWalletCore(settings,{...options,db:transport(),quota:new CloudQuota(this.ctx.storage,this.state,{scope:'highlights'})}),{...hs,bot,fetchImpl:cloudFetch}):null;
    if(hs)store.highlightsGuild=hs.guild;
    const backup=new CloudBackup(new FirestoreWalletCore(settings,{...options,db:transport(),quota:new CloudQuota(this.ctx.storage,this.state,{scope:'maintenance'})}),this.state,vault);
    const wallet={store,service,visits,commandChannelIds:commandChannels(this.env),adminRoles:(this.env.ADMIN_ROLE_IDS||'').split(',').filter(Boolean),highlights:highlights?{enqueue:(session,id,round)=>{if(highlights.enqueue(session,id,round)){this.state.set('highlights-dirty',true);this.ctx.waitUntil(this.schedule(bot?1000:10000));}}}:null};
    const handler=createActivityHandler({fetchImpl:cloudFetch,clientId:this.env.DISCORD_CLIENT_ID,clientSecret:this.env.DISCORD_CLIENT_SECRET,publicKey:this.env.DISCORD_PUBLIC_KEY,wallet,loginLimiter:new CloudLoginLimit(this.state),defer:p=>this.ctx.waitUntil(this.track(p)),operations:{isReady:()=>this.ready(),recordRequest:()=>{}}});
    return {settings,store,service,highlights,visits,backup,vault,handler};
  }
  ready(){const b=this.state.get('backup-status');return this.state.get('mode')==='active'&&b?.ok===true&&Date.now()-b.at<48*3600000;}
  async schedule(delay){const now=Date.now(),due=now+delay,old=await this.ctx.storage.getAlarm();if(!old||old>due)await this.ctx.storage.setAlarm(due);}
  async fetch(request){
    const url=new URL(request.url);
    if(url.pathname.startsWith('/__ops/')){
      const monitorRead=url.pathname==='/__ops/status'&&request.method==='GET'&&authorized(request,this.env,'CLOUD_MONITOR_TOKEN');
      if(!authorized(request,this.env)&&!monitorRead)return json({error:'Forbidden'},403);
      try{const operation=this.opsTail.then(()=>this.admin(url.pathname,request));this.opsTail=operation.catch(()=>{});return await operation;}catch{return json({error:'Cloud operation refused; inspect status before retrying'},409);}
    }
    if(url.pathname==='/healthz')return json({ok:true,version:APP_VERSION,model:MODEL_VERSION});
    if(!apiPaths.has(url.pathname))return json({error:'找不到此功能。'},404);
    if(!this.ready())return json({error:'帳號戲籌正在維護，請稍後再試。'},503);
    const origin=request.headers.get('origin');if(origin&&origin!==`https://${this.env.DISCORD_CLIENT_ID}.discordsays.com`)return json({error:'不允許的來源。'},403);
    const run=async()=>{try{const rt=await this.runtime();if(!this.ready())return json({error:'服務正在維護。'},503);return await handleFetch(rt.handler,request);}catch(error){return json({error:'暫時無法完成請求，請沿用原請求重試。',...(error?.code==='FIRESTORE_BUDGET'?{code:error.code}:{})},503);}};
    return this.track(run());
  }
  async admin(path,request){
    const settings=identity(this.env);
    if(path==='/__ops/status'&&request.method==='GET'){
      const quota=this.state.get('quota-identity')?this.quota.status():null;
      if(quota)quota.scopes=Object.fromEntries(['maintenance','highlights'].map(scope=>[scope,{used:this.quota.totals(scope),limits:this.quota.identity().limits[scope],...(quota.enforcement?{enforcement:quota.enforcement}: {})}]));
      const backup=this.state.get('backup-status'),manifest=this.state.get('backup:'+this.state.get('backup-latest'));
      const status={version:APP_VERSION,mode:this.state.get('mode')||'unseeded',source:this.state.get('source'),backup:backup?{...backup,...(Number.isSafeInteger(manifest?.bytes)?{bytes:manifest.bytes,limitBytes:manifest.limitBytes,parts:manifest.parts,limitParts:manifest.format===2?BACKUP_MAX_PARTS:200}: {})}:null,alarm:this.state.get('alarm-status'),quota};
      const casino=casinoVisitStatus(this.state.get('casino-visits'));
      if(casino)status.casino=casino;
      return json({...status,operations:operationsHealth(status)});
    }
    if(request.method!=='POST')return json({error:'POST required'},405);
    if(path==='/__ops/quota-limits'){
      if(this.quota.identity().projectId!==settings.projectId)throw new Error('Quota identity mismatch');
      return json(this.quota.raiseDocumentLimits(await body(request,1024)));
    }
    if(path==='/__ops/quota-policy'){
      if(this.quota.identity().projectId!==settings.projectId)throw new Error('Quota identity mismatch');
      const input=await body(request,1024);if(input.mode!=='notify-only')throw new Error('Unsupported quota policy');
      return json(this.quota.enableNotificationsOnly(input));
    }
    if(path==='/__ops/test-reset'){
      if(settings.environment!=='test'||!this.env.TEST_DATA_RESET_ID||this.state.get('mode')!=='paused'||this.active.size)throw new Error('Test reset unavailable');
      const input=await body(request,2*1024**2),vault=new SnapshotVault(this.ctx.storage,this.state,new Sealer(this.env.CLOUD_ENCRYPTION_KEY));
      const reset=new TestDataReset({state:this.state,storage:this.ctx.storage,db:new FirestoreRest({...settings,credentials:JSON.parse(this.env.GOOGLE_SERVICE_ACCOUNT_JSON),fetchImpl:cloudFetch,endpoint:this.env.FIRESTORE_ENDPOINT}),quota:this.quota,vault,settings,enabledId:this.env.TEST_DATA_RESET_ID});
      const result=input.action==='prepare'?await reset.start(input):input.action==='step'?await reset.step(input):null;
      if(!result)throw new Error('Unknown reset action');this.instance=null;return json(result);
    }
    if(this.state.get('test-reset')&&this.state.get('test-reset').phase!=='complete')throw new Error('Finish test reset before other mutations');
    if(path==='/__ops/seed'){
      if(this.state.get('source'))throw new Error('Already seeded');const input=await body(request);
      if(input.projectId!==settings.projectId||input.namespace!==settings.namespace||input.writersStopped!==true)throw new Error('Stopped source required');
      auditSnapshot(input.snapshot,settings.environment);const vault=new SnapshotVault(this.ctx.storage,this.state,new Sealer(this.env.CLOUD_ENCRYPTION_KEY));
      // A baseline alone never activates the cloud writer.
      this.ctx.storage.transactionSync(()=>{this.quota.seed(input.quota,settings.projectId);vault.save('baseline',input.snapshot);vault.publish('baseline');this.state.set('source',{...settings,revision:input.snapshot.revision});this.state.set('mode','paused');this.state.set('backup-status',{ok:true,at:Date.now(),revision:input.snapshot.revision});});
      return json({seeded:true,active:false});
    }
    if(path==='/__ops/pause'){if(this.state.get('mode')==='released')throw new Error('Ownership already released');this.state.set('mode','paused');await Promise.allSettled([...this.active]);this.instance?.store.invalidateCache();await this.ctx.storage.deleteAlarm();return json({paused:true,drained:true});}
    if(path==='/__ops/activate'){
      if(this.state.get('mode')!=='paused')throw new Error('Paused ownership required');
      const input=await body(request,1024);if(input.writersStopped!==true||input.freePlanVerified!==true)throw new Error('Cutover prerequisites');
      const r=await this.runtime(),snapshot=r.vault.load(this.state.get('backup-latest')),meta=await r.store.read(r.store.meta);r.store.checkMeta(meta);
      if(meta.nextId!==snapshot.revision||snapshot.upstreamImportFingerprint!==(meta.importFingerprint??null))throw new Error('Source moved since backup');
      for(const w of snapshot.tables.wallets){const actual=await r.store.read(r.store.walletRef(w.guild,w.user));if(!actual||actual.balance!==w.balance||Number(actual.milestone)!==w.milestone||actual.last_spin!==w.last_spin)throw new Error('Wallet mismatch');}
      r.store.invalidateCache();this.state.set('mode','active');await this.schedule(1000);return json({active:true});
    }
    if(path==='/__ops/verify'){if(this.state.get('mode')!=='paused'||this.active.size)throw new Error('Paused writer required');const r=await this.runtime(),db=new FirestoreRest({...settings,credentials:JSON.parse(this.env.GOOGLE_SERVICE_ACCOUNT_JSON),fetchImpl:cloudFetch,readOnly:true}),store=new FirestoreWalletCore(settings,{db,quota:this.quota,guildIds:[...r.store.guildIds]});return json(await verifyCloudSnapshot(r.vault.load(this.state.get('backup-latest')),store));}
    if(path==='/__ops/backup'){if(this.state.get('mode')==='released')throw new Error('Ownership released');const r=await this.runtime();return json(await this.backupStep(r));}
    if(path==='/__ops/archive-manifest'){
      const v=new SnapshotVault(this.ctx.storage,this.state,new Sealer(this.env.CLOUD_ENCRYPTION_KEY));
      return json({source:this.state.get('source'),archive:{manifest:v.manifest(this.state.get('backup-latest'))},released:this.state.get('mode')==='released'});
    }
    if(path==='/__ops/archive-page'){
      const input=await body(request,2048),v=new SnapshotVault(this.ctx.storage,this.state,new Sealer(this.env.CLOUD_ENCRYPTION_KEY));
      if(!(this.state.get('backup-retained')||[]).includes(input.generation)||!Number.isSafeInteger(input.start)||input.start<0||!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>16)throw new Error('Invalid archive page');
      const m=v.manifest(input.generation);if(input.start>=m.parts)throw new Error('Archive page range');
      return json({generation:m.generation,start:input.start,sha256:m.sha256,chunks:Array.from({length:Math.min(input.limit,m.parts-input.start)},(_,i)=>v.part(m.generation,input.start+i,m))});
    }
    if(path==='/__ops/archive'){const v=new SnapshotVault(this.ctx.storage,this.state,new Sealer(this.env.CLOUD_ENCRYPTION_KEY));return json({source:this.state.get('source'),archive:v.archive(this.state.get('backup-latest')),released:this.state.get('mode')==='released'});}
    if(path==='/__ops/export'){
      const options=await body(request,2048);
      const released=this.state.get('released-export');if(released){const v=new SnapshotVault(this.ctx.storage,this.state,new Sealer(this.env.CLOUD_ENCRYPTION_KEY));return json({...released,archive:options.paged?{manifest:v.manifest(released.generation)}:v.archive(released.generation)});}
      if(this.state.get('mode')!=='paused'||this.active.size||this.state.get('backup-job'))throw new Error('Pause and finish backup first');
      const r=await this.runtime(),generation=this.state.get('backup-latest'),archive=options.paged?{manifest:r.vault.manifest(generation)}:r.vault.archive(generation),meta=await r.store.read(r.store.meta);
      if(meta.nextId!==archive.manifest.revision)throw new Error('Finish latest backup');
      const exported={exportId:randomUUID(),released:true,generation:archive.manifest.generation,source:this.state.get('source'),quota:this.quota.export()};
      this.ctx.storage.transactionSync(()=>{this.state.set('mode','released');this.state.set('released-export',exported);});return json({...exported,archive});
    }
    return json({error:'Unknown operation'},404);
  }
  async alarm(){if(this.state.get('mode')!=='active')return;await this.track(this.runAlarm());}
  async runAlarm(){
    if(this.env.DISCORD_CASINO_ENABLED!=='true')return this.runMaintenanceAlarm();
    const now=Date.now(),due=this.state.get('casino-maintenance-at')||0;
    // Short presence deadlines must not turn ten-minute Firestore housekeeping
    // into a per-second database poll. Notification failures never pause play.
    try{
      const r=await this.runtime();
      const highlightDue=r.highlights&&(!r.casinoMaintenanceChecked||this.state.get('highlights-dirty'))&&now>=r.highlights.nextAttempt;
      if(now>=due||highlightDue||this.state.get('backup-job')){await this.runMaintenanceAlarm();r.casinoMaintenanceChecked=true;if(now>=due)this.state.set('casino-maintenance-at',now+600000);}
      await r.visits.sweep();await r.visits.flush();
      await this.schedule(r.visits.nextDelay());
    }catch{console.warn('Casino visit announcements deferred');await this.schedule(30000);}
  }
  async runMaintenanceAlarm(){
    try{
      this.ctx.storage.sql.exec('DELETE FROM sessions WHERE expires<=?',Date.now());
      const r=await this.runtime(),meta=await r.store.read(r.store.meta);r.store.checkMeta(meta);
      const revision=meta.highlightsRevision??(meta.highlights?meta.nextId:0);
      if(r.highlights&&(this.state.get('highlights-dirty')||revision!==(this.state.get('highlights-revision')||0))){
        r.highlights.dirty=true;await r.highlights.flush();this.state.set('highlights-dirty',r.highlights.dirty);if(!r.highlights.dirty)this.state.set('highlights-revision',revision);
        if(r.highlights.dirty)await this.schedule(Math.max(10000,r.highlights.nextAttempt-Date.now()));
      }
      const b=this.state.get('backup-status');if(this.state.get('backup-job')||!b||Date.now()-b.at>=24*3600000){const result=await this.backupStep(r);if(!result.complete)await this.schedule(10000);}
      this.ctx.storage.sql.exec('DELETE FROM quota_usage WHERE slot<?',Date.now()-86520000);
      this.state.set('alarm-status',{ok:true,at:Date.now()});
    }catch{this.state.set('alarm-status',{ok:false,at:Date.now()});}
    finally{if(this.state.get('mode')==='active')await this.schedule(600000);}
  }
}

async function routeRequest(request,env){
  const path=new URL(request.url).pathname;
  if(path.startsWith('/api/')||path.startsWith('/__ops/')||apiPaths.has(path)){
    try{const settings=identity(env);return await env.CIRCUS_PROJECT.get(env.CIRCUS_PROJECT.idFromName(settings.projectId)).fetch(request);}catch{return json({error:'服務尚未就緒。'},503);}
  }
  if(!['GET','HEAD'].includes(request.method))return json({error:'不支援此操作。'},405);
  if(path.startsWith('/assets/')&&path.endsWith('.mp3'))return audioAsset(request,env.ASSETS);
  return env.ASSETS.fetch(request);
}

export default {async fetch(request,env){return secureResponse(await routeRequest(request,env));}};
