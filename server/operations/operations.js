import {Worker} from 'node:worker_threads';
import {mkdirSync,writeFileSync,renameSync,appendFileSync,statSync,existsSync,unlinkSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';

export function maintenanceJob(settings,{timeoutMs=120000}={}){
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./maintenance-worker.js',import.meta.url),{workerData:{settings},execArgv:[]});
    let settled=false;
    const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(new Error('Maintenance worker failed'));else resolve(result);};
    const timer=setTimeout(()=>{void worker.terminate().then(()=>finish(true),()=>finish(true));},timeoutMs);
    worker.once('message',message=>finish(!message?.ok,message?.result));
    worker.once('error',()=>finish(true));
    worker.once('exit',()=>finish(true));
  });
}

export class Operations {
  constructor(settings,{job=maintenanceJob,clock=Date.now,setIntervalImpl=setInterval,clearIntervalImpl=clearInterval,logLimit=1048576}={}){
    Object.assign(this,{settings,job,clock,setIntervalImpl,clearIntervalImpl,logLimit});
    this.started=false;this.stopping=false;this.timer=null;this.running=null;this.last=null;this.alerts=[];
    this.requests={total:0,clientErrors:0,serverErrors:0,maxDurationMs:0};this.logFailed=false;this.statusFailed=false;
    mkdirSync(dirname(settings.statusFile),{recursive:true});
  }
  emit(level,event,fields={}){
    const record={time:new Date(this.clock()).toISOString(),level,event,...fields};
    try{
      if(existsSync(this.settings.logFile)&&statSync(this.settings.logFile).size>=this.logLimit){
        if(existsSync(this.settings.logFile+'.2'))unlinkSync(this.settings.logFile+'.2');
        if(existsSync(this.settings.logFile+'.1'))renameSync(this.settings.logFile+'.1',this.settings.logFile+'.2');
        renameSync(this.settings.logFile,this.settings.logFile+'.1');
      }
      appendFileSync(this.settings.logFile,JSON.stringify(record)+'\n',{mode:0o600});
      this.logFailed=false;
    }catch{
      if(!this.logFailed)console.error(JSON.stringify({level:'error',event:'OPERATIONS_LOG_UNAVAILABLE'}));
      this.logFailed=true;
    }
  }
  status(){
    const now=this.clock(),ageMs=this.last?Math.max(0,now-Date.parse(this.last.checkedAt)):null;
    const stale=ageMs!==null&&ageMs>this.settings.monitorIntervalMs*2+120000;
    const alerts=[...this.alerts];
    if(stale)alerts.push('MONITOR_STALE');if(this.logFailed)alerts.push('OPERATIONS_LOG_UNAVAILABLE');if(this.statusFailed)alerts.push('OPERATIONS_STATUS_UNAVAILABLE');
    const ready=this.started&&!!this.last?.audit?.ok&&!this.stopping&&!stale
      &&!alerts.some(code=>['DISK_SPACE_LOW','DISK_CHECK_FAILED','DATABASE_UNAVAILABLE','MAINTENANCE_FAILED','FIRESTORE_QUOTA_EXHAUSTED'].includes(code));
    return {version:1,sourceId:this.settings.sourceId,updatedAt:new Date(now).toISOString(),running:this.started&&!this.stopping,
      ready,ok:ready&&alerts.length===0,alerts:[...new Set(alerts)],lastCheck:this.last,requests:{...this.requests}};
  }
  isReady(){return this.status().ready;}
  persist(){
    const temporary=this.settings.statusFile+'.'+randomUUID()+'.tmp';
    try{this.statusFailed=false;writeFileSync(temporary,JSON.stringify(this.status(),null,2)+'\n',{mode:0o600});renameSync(temporary,this.settings.statusFile);}
    catch{try{unlinkSync(temporary);}catch{}this.emit('error','OPERATIONS_STATUS_UNAVAILABLE');this.statusFailed=true;}
  }
  tick(){
    if(this.stopping)return Promise.resolve();
    this.running ||= (async()=>{
      let result;
      try{
        result=await this.job(this.settings);
        if(!result||!Array.isArray(result.alerts)||!Number.isFinite(Date.parse(result.checkedAt)))throw new Error('Invalid monitor result');
      }
      catch{result={checkedAt:new Date(this.clock()).toISOString(),audit:null,alerts:['MAINTENANCE_FAILED']};}
      const next=result.alerts||[];
      for(const code of next)if(!this.alerts.includes(code))this.emit('error','monitor.alert',{code});
      for(const code of this.alerts)if(!next.includes(code))this.emit('info','monitor.recovered',{code});
      if(result.backup?.created)this.emit('info','backup.completed',{pruned:result.backup.pruned||0});
      this.last=result;this.alerts=next;this.persist();
    })().finally(()=>{this.running=null;});
    return this.running;
  }
  start(){
    if(this.started)return;this.started=true;
    this.timer=this.setIntervalImpl(()=>{void this.tick();},this.settings.monitorIntervalMs);this.timer?.unref?.();
    void this.tick();
  }
  recordRequest({requestId,method,route,status,durationMs,errorCode}){
    this.requests.total++;if(status>=400&&status<500)this.requests.clientErrors++;if(status>=500)this.requests.serverErrors++;
    this.requests.maxDurationMs=Math.max(this.requests.maxDurationMs,Math.round(durationMs));
    if(status>=500)this.emit('error','http.failure',{requestId,method,route,status,durationMs:Math.round(durationMs),...(errorCode?{code:errorCode}:{})});
  }
  async close(){this.stopping=true;this.clearIntervalImpl(this.timer);await this.running;this.persist();}
}
