import {DurableObject} from 'cloudflare:workers';
import {timingSafeEqual,randomUUID} from 'node:crypto';
import {FirestoreRest} from './firestore-rest.js';
import {FirestoreWalletCore} from '../server/firestore-wallet-core.js';
import {FirestoreHighlights} from '../server/firestore-highlights-core.js';
import {WalletService} from '../server/wallet-service.js';
import {highlightSettings} from '../server/highlights.js';
import {createActivityHandler} from '../server/app-handler.js';
import {CloudState,CloudSessions,CloudLoginLimit,Sealer} from './storage.js';
import {CloudQuota} from './quota.js';
import {auditSnapshot,SnapshotVault} from './snapshot.js';
import {verifyCloudSnapshot} from './verify.js';
import {CloudBackup} from './backup.js';
import {MODEL_VERSION} from '../src/game/slot-math.js';
import {handleFetch} from './http-bridge.js';

// Workers supports manual redirects; every caller rejects non-2xx responses.
const cloudFetch=(url,options={})=>globalThis.fetch(url,{...options,redirect:options.redirect==='error'?'manual':options.redirect});
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const apiPaths=new Set(['/healthz','/readyz','/api/token','/api/interactions','/api/wallet','/api/spin','/api/checkin','/api/ledger','/api/rounds']);
function identity(env){
  if(env.CLOUD_PLAN!=='free'||!['test','production'].includes(env.APP_ENV)||!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(env.FIRESTORE_PROJECT_ID||'')||!/^[-a-z0-9]{3,80}$/.test(env.FIRESTORE_NAMESPACE||'')||!env.FIRESTORE_NAMESPACE.endsWith('-'+env.APP_ENV))throw new Error('Cloud identity not configured');
  if(env.LOCAL_WALLET_TEST==='true'||env.FIRESTORE_EMULATOR_HOST)throw new Error('Fixture configuration is not deployable');
  return {projectId:env.FIRESTORE_PROJECT_ID,namespace:env.FIRESTORE_NAMESPACE,environment:env.APP_ENV,schemaVersion:2};
}
const authorized=(req,env)=>{const expected=env.CLOUD_ADMIN_TOKEN;if(!/^[a-f0-9]{64}$/i.test(expected||''))return false;const value=req.headers.get('authorization')?.replace(/^Bearer /,'')||'';return value.length===expected.length&&timingSafeEqual(Buffer.from(value),Buffer.from(expected));};
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
    const transport=()=>new FirestoreRest({...settings,credentials,fetchImpl:cloudFetch}),options={guildIds,daily:Number(this.env.DAILY_CHIPS||500),grantMax:Number(this.env.ADMIN_GRANT_MAX||100000),grantDaily:Number(this.env.ADMIN_DAILY_MAX||1000000)};
    const store=new FirestoreWalletCore(settings,{...options,db:transport(),quota:this.quota});
    // Never initialize an empty remote namespace from a public request.
    store.checkMeta(await store.read(store.meta));store.ready=true;store.readyAt=Date.now();
    const service=new WalletService(store,{fetchImpl:cloudFetch,sessions:new CloudSessions(this.ctx.storage,sealer)}),hs=highlightSettings(this.env,store);
    const highlights=hs?new FirestoreHighlights(new FirestoreWalletCore(settings,{...options,db:transport(),quota:new CloudQuota(this.ctx.storage,this.state,{scope:'highlights'})}),{...hs,fetchImpl:cloudFetch}):null;
    if(hs)store.highlightsGuild=hs.guild;
    const backup=new CloudBackup(new FirestoreWalletCore(settings,{...options,db:transport(),quota:new CloudQuota(this.ctx.storage,this.state,{scope:'maintenance'})}),this.state,vault);
    const wallet={store,service,adminRoles:(this.env.ADMIN_ROLE_IDS||'').split(',').filter(Boolean),highlights:highlights?{enqueue:(session,id,round)=>{if(highlights.enqueue(session,id,round)){this.state.set('highlights-dirty',true);this.ctx.waitUntil(this.schedule(10000));}}}:null};
    const handler=createActivityHandler({fetchImpl:cloudFetch,clientId:this.env.DISCORD_CLIENT_ID,clientSecret:this.env.DISCORD_CLIENT_SECRET,publicKey:this.env.DISCORD_PUBLIC_KEY,wallet,loginLimiter:new CloudLoginLimit(this.state),defer:p=>this.ctx.waitUntil(this.track(p)),operations:{isReady:()=>this.ready(),recordRequest:()=>{}}});
    return {settings,store,service,highlights,backup,vault,handler};
  }
  ready(){const b=this.state.get('backup-status');return this.state.get('mode')==='active'&&b?.ok===true&&Date.now()-b.at<48*3600000;}
  async schedule(delay){const now=Date.now(),due=now+delay,old=await this.ctx.storage.getAlarm();if(!old||old>due)await this.ctx.storage.setAlarm(due);}
  async fetch(request){
    const url=new URL(request.url);
    if(url.pathname.startsWith('/__ops/')){
      if(!authorized(request,this.env))return json({error:'Forbidden'},403);
      try{const operation=this.opsTail.then(()=>this.admin(url.pathname,request));this.opsTail=operation.catch(()=>{});return await operation;}catch{return json({error:'Cloud operation refused; existing data retained'},409);}
    }
    if(url.pathname==='/healthz')return json({ok:true,version:'0.2.6',model:MODEL_VERSION});
    if(!apiPaths.has(url.pathname))return json({error:'找不到此功能。'},404);
    if(!this.ready())return json({error:'帳號籌碼正在維護，請稍後再試。'},503);
    const origin=request.headers.get('origin');if(origin&&origin!==`https://${this.env.DISCORD_CLIENT_ID}.discordsays.com`)return json({error:'不允許的來源。'},403);
    const run=async()=>{try{const rt=await this.runtime();if(!this.ready())return json({error:'服務正在維護。'},503);return await handleFetch(rt.handler,request);}catch{return json({error:'暫時無法完成請求，請沿用原請求重試。'},503);}};
    return this.track(run());
  }
  async admin(path,request){
    const settings=identity(this.env);
    if(path==='/__ops/status'&&request.method==='GET')return json({mode:this.state.get('mode')||'unseeded',source:this.state.get('source'),backup:this.state.get('backup-status'),alarm:this.state.get('alarm-status'),quota:this.state.get('quota-identity')?this.quota.status():null});
    if(request.method!=='POST')return json({error:'POST required'},405);
    if(path==='/__ops/seed'){
      if(this.state.get('source'))throw new Error('Already seeded');const input=await body(request);
      if(input.projectId!==settings.projectId||input.namespace!==settings.namespace||input.writersStopped!==true)throw new Error('Stopped source required');
      auditSnapshot(input.snapshot,settings.environment);const vault=new SnapshotVault(this.ctx.storage,this.state,new Sealer(this.env.CLOUD_ENCRYPTION_KEY));
      // A baseline alone never activates the cloud writer.
      this.ctx.storage.transactionSync(()=>{this.quota.seed(input.quota,settings.projectId);vault.save('baseline',input.snapshot);vault.publish('baseline');this.state.set('source',{...settings,revision:input.snapshot.revision});this.state.set('mode','paused');this.state.set('backup-status',{ok:true,at:Date.now(),revision:input.snapshot.revision});});
      return json({seeded:true,active:false});
    }
    if(path==='/__ops/pause'){if(this.state.get('mode')==='released')throw new Error('Ownership already released');this.state.set('mode','paused');await Promise.allSettled([...this.active]);await this.ctx.storage.deleteAlarm();return json({paused:true,drained:true});}
    if(path==='/__ops/activate'){
      if(this.state.get('mode')!=='paused')throw new Error('Paused ownership required');
      const input=await body(request,1024);if(input.writersStopped!==true||input.freePlanVerified!==true)throw new Error('Cutover prerequisites');
      const r=await this.runtime(),snapshot=r.vault.load(this.state.get('backup-latest')),meta=await r.store.read(r.store.meta);r.store.checkMeta(meta);
      if(meta.nextId!==snapshot.revision||snapshot.upstreamImportFingerprint!==(meta.importFingerprint??null))throw new Error('Source moved since backup');
      for(const w of snapshot.tables.wallets){const actual=await r.store.read(r.store.walletRef(w.guild,w.user));if(!actual||actual.balance!==w.balance||Number(actual.milestone)!==w.milestone||actual.last_spin!==w.last_spin)throw new Error('Wallet mismatch');}
      this.state.set('mode','active');await this.schedule(1000);return json({active:true});
    }
    if(path==='/__ops/verify'){if(this.state.get('mode')!=='paused'||this.active.size)throw new Error('Paused writer required');const r=await this.runtime(),db=new FirestoreRest({...settings,credentials:JSON.parse(this.env.GOOGLE_SERVICE_ACCOUNT_JSON),fetchImpl:cloudFetch,readOnly:true}),store=new FirestoreWalletCore(settings,{db,quota:this.quota,guildIds:[...r.store.guildIds]});return json(await verifyCloudSnapshot(r.vault.load(this.state.get('backup-latest')),store));}
    if(path==='/__ops/backup'){if(this.state.get('mode')==='released')throw new Error('Ownership released');const r=await this.runtime();return json(await this.backupStep(r));}
    if(path==='/__ops/archive'){const v=new SnapshotVault(this.ctx.storage,this.state,new Sealer(this.env.CLOUD_ENCRYPTION_KEY));return json({source:this.state.get('source'),archive:v.archive(this.state.get('backup-latest')),released:this.state.get('mode')==='released'});}
    if(path==='/__ops/export'){
      const released=this.state.get('released-export');if(released){const v=new SnapshotVault(this.ctx.storage,this.state,new Sealer(this.env.CLOUD_ENCRYPTION_KEY));return json({...released,archive:v.archive(released.generation)});}
      if(this.state.get('mode')!=='paused'||this.active.size||this.state.get('backup-job'))throw new Error('Pause and finish backup first');
      const r=await this.runtime(),archive=r.vault.archive(this.state.get('backup-latest')),meta=await r.store.read(r.store.meta);
      if(meta.nextId!==archive.manifest.revision)throw new Error('Finish latest backup');
      const exported={exportId:randomUUID(),released:true,generation:archive.manifest.generation,source:this.state.get('source'),quota:this.quota.export()};
      this.ctx.storage.transactionSync(()=>{this.state.set('mode','released');this.state.set('released-export',exported);});return json({...exported,archive});
    }
    return json({error:'Unknown operation'},404);
  }
  async alarm(){if(this.state.get('mode')!=='active')return;await this.track(this.runAlarm());}
  async runAlarm(){
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

export default {async fetch(request,env){
  const path=new URL(request.url).pathname;
  if(path.startsWith('/api/')||path.startsWith('/__ops/')||apiPaths.has(path)){
    try{const settings=identity(env);return await env.CIRCUS_PROJECT.get(env.CIRCUS_PROJECT.idFromName(settings.projectId)).fetch(request);}catch{return json({error:'服務尚未就緒。'},503);}
  }
  if(!['GET','HEAD'].includes(request.method))return json({error:'不支援此操作。'},405);
  return env.ASSETS.fetch(request);
}};
