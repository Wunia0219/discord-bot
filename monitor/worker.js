import {DurableObject} from 'cloudflare:workers';
import {APP_VERSION} from '../src/version.js';
import {ServiceMonitor,monitorSettings} from './check.js';
import {timingSafeEqual} from 'node:crypto';

// Separate Worker/DO: no Firestore credentials, wallet bindings or backup writes.
export class CircusMonitor extends DurableObject {
  constructor(ctx,env){super(ctx,env);this.storage=ctx.storage;this.monitor=new ServiceMonitor(ctx.storage,env);}
  async fetch(request){
    if(request.method==='GET'&&new URL(request.url).pathname==='/status'){
      const state=await this.storage.get('monitor-state');
      return Response.json({checkedAt:state?.checkedAt??null,alerts:state?.alerts||[],confirmed:(state?.count||0)>=2,delivery:state?.pending?.status||'idle',nextAttempt:state?.pending?.nextAttempt??null},{headers:{'Cache-Control':'no-store'}});
    }
    if(request.method!=='POST'||new URL(request.url).pathname!=='/check')return new Response(null,{status:404});
    return Response.json(await this.monitor.check());
  }
}
export default {
  async scheduled(controller,env,ctx){
    let settings;try{settings=monitorSettings(env);}catch{return;}
    const check=env.CIRCUS_MONITOR.get(env.CIRCUS_MONITOR.idFromName(settings.origin.origin)).fetch('https://monitor.internal/check',{method:'POST'});
    ctx.waitUntil(check.then(async response=>{if(!response.ok)throw new Error('Monitor check failed');await response.arrayBuffer();}));
  },
  async fetch(request,env){
    if(request.method==='GET'&&new URL(request.url).pathname==='/__ops/status'){
      let settings;try{settings=monitorSettings(env);}catch{return new Response(null,{status:503});}
      const token=request.headers.get('authorization')?.replace(/^Bearer /,'')||'';
      if(!/^[a-f0-9]{64}$/i.test(token)||!timingSafeEqual(Buffer.from(token),Buffer.from(settings.token)))return new Response(null,{status:403});
      return env.CIRCUS_MONITOR.get(env.CIRCUS_MONITOR.idFromName(settings.origin.origin)).fetch('https://monitor.internal/status');
    }
    if(request.method!=='GET'||new URL(request.url).pathname!=='/healthz')return new Response(null,{status:404});
    let configured=false;try{monitorSettings(env);configured=true;}catch{}
    return Response.json({ok:configured,notificationsConfigured:configured&&Boolean(env.MONITOR_WEBHOOK_URL),version:APP_VERSION},{status:configured?200:503,headers:{'Cache-Control':'no-store'}});
  },
};
