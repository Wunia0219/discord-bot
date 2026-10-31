import {operationsHealth,alertFingerprint,notificationPayload} from '../cloud/operations-health.js';
import {operationsWebhook,postNotification} from './discord.js';

const EMPTY=alertFingerprint([]),TIMEOUT=10000,MIN_CHECK_GAP=60000;
export function monitorSettings(env){
  if(!['free','paid'].includes(env.CLOUD_PLAN)||env.MONITOR_ENABLED!=='true')throw new Error('Monitor is disabled');
  const origin=new URL(env.MONITORED_ORIGIN);
  if(origin.protocol!=='https:'||!/^[-a-z0-9]+\.[-a-z0-9]+\.workers\.dev$/.test(origin.hostname)||origin.pathname!=='/'||origin.port||origin.search||origin.hash||origin.username||origin.password||!/^[a-f0-9]{64}$/i.test(env.MONITORED_TOKEN||''))throw new Error('Monitor configuration required');
  let webhook=null;
  if(env.MONITOR_WEBHOOK_URL){
    webhook=operationsWebhook(env.MONITOR_WEBHOOK_URL);
    if(env.DISCORD_HIGHLIGHTS_WEBHOOK_URL)throw new Error('Game announcement credentials must not be configured in the monitor');
  }
  return {origin,token:env.MONITORED_TOKEN,webhook};
}

async function probe(settings,fetchImpl,now){
  let response;
  try{response=await fetchImpl(new URL('/__ops/status',settings.origin),{method:'GET',headers:{Authorization:'Bearer '+settings.token},redirect:'manual',signal:AbortSignal.timeout(TIMEOUT)});}
  catch{return [{code:'SERVICE_UNREACHABLE',severity:'critical'}];}
  if(response.status===401||response.status===403)return [{code:'STATUS_UNAUTHORIZED',severity:'critical'}];
  if(!response.ok)return [{code:'SERVICE_UNREACHABLE',severity:'critical'}];
  try{
    const status=await response.json();
    if(!status||!['active','paused','released','unseeded'].includes(status.mode))throw new Error('Invalid status');
    return operationsHealth(status,{now}).alerts;
  }catch{return [{code:'STATUS_INVALID',severity:'critical'}];}
}

// Persistent intent is saved BEFORE POST. Unknown outcomes are never blindly resent.
export class ServiceMonitor {
  constructor(storage,env,{fetchImpl=globalThis.fetch.bind(globalThis),clock=Date.now}={}){Object.assign(this,{storage,env,fetchImpl,clock});}
  check(){this.running ||= this.run().finally(()=>this.running=null);return this.running;}
  async run(){
    let settings;try{settings=monitorSettings(this.env);}catch{return {configured:false,delivery:'disabled'};}
    const now=this.clock(),state=await this.storage.get('monitor-state')||{notified:EMPTY,count:0};
    if(state.pending?.status==='sending'){
      state.pending.status='uncertain';state.notified=state.pending.fingerprint;
      await this.storage.put('monitor-state',state);
    }
    if(Number.isSafeInteger(state.checkedAt)&&now-state.checkedAt<MIN_CHECK_GAP)return {configured:true,checkedAt:state.checkedAt,alerts:state.alerts||[],confirmed:state.count>=2,delivery:state.pending?.status||'idle'};
    const alerts=await probe(settings,this.fetchImpl,now),fingerprint=alertFingerprint(alerts);
    state.count=state.observed===fingerprint?Math.min(2,state.count+1):1;
    state.observed=fingerprint;state.checkedAt=now;state.alerts=alerts;
    const save=async()=>{await this.storage.put('monitor-state',state);return {configured:true,checkedAt:now,alerts,confirmed:state.count>=2,delivery:state.pending?.status||'idle'};};
    if(state.count<2)return save();
    if(fingerprint===state.notified){
      if(state.pending?.status==='retry'||state.pending?.fingerprint!==fingerprint)state.pending=null;
      return save();
    }
    if(state.pending?.fingerprint!==fingerprint)state.pending={fingerprint,status:'pending'};
    const pending=state.pending;
    if(['uncertain','blocked'].includes(pending.status))return save();
    if(!settings.webhook){pending.status='unconfigured';return save();}
    if(pending.nextAttempt>now)return save();
    pending.status='sending';pending.at=now;await this.storage.put('monitor-state',state);
    Object.assign(pending,await postNotification(settings.webhook,notificationPayload(alerts,now),{fetchImpl:this.fetchImpl,now}));
    if(['sent','uncertain'].includes(pending.status))state.notified=fingerprint;
    return save();
  }
}
