import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions,Response as MFResponse} from 'miniflare';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {APP_VERSION} from '../src/version.js';

test('separate real workerd scheduled handler persists deduplication, reports recovery and exposes no public control',async t=>{
  const root=resolve('test-results/monitor-runtime');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'case-'));
  // Only this isolated test wrapper supplies a controlled clock; production has no clock override.
  const script=resolve('test-results/monitor-bundle/runtime-fixture.mjs');
  writeFileSync(script,"import worker,{CircusMonitor} from './worker.js';\nexport class TestMonitor extends CircusMonitor {constructor(ctx,env){super(ctx,env);this.monitor.clock=()=>Number(env.FIXTURE_NOW);}}\nexport default {...worker,async fetch(req,env,ctx){if(new URL(req.url).pathname==='/fixture-scheduled'){await worker.scheduled({cron:'*/10 * * * *'},env,ctx);return new Response('ok');}return worker.fetch(req,env,ctx);}};\n");
  let now=Date.now(),down=true,mf,probes=0;const messages=[],token='c'.repeat(64),origin='https://circus.fixture.workers.dev';
  const q=()=>({used:{reads:0,writes:0,egressBytes:0,storageBytes:0},limits:{reads:100,writes:100,egressBytes:100,storageBytes:100}});
  const config=()=>({name:'monitor-fixture',modules:[{type:'ESModule',path:script},{type:'ESModule',path:resolve('test-results/monitor-bundle/worker.js')}],modulesRoot:resolve('.'),compatibilityDate:'2026-07-30',compatibilityFlags:['nodejs_compat'],durableObjects:{CIRCUS_MONITOR:{className:'TestMonitor',useSQLite:true}},resourcePersistencePath:join(dir,'durable'),bindings:{CLOUD_PLAN:'free',MONITOR_ENABLED:'true',MONITORED_ORIGIN:origin,MONITORED_TOKEN:token,MONITOR_WEBHOOK_URL:'https://discord.com/api/webhooks/100000000000000005/isolated-operations-fixture',FIXTURE_NOW:String(now)},outboundService:async request=>{
    const url=new URL(request.url);
    if(url.origin===origin&&url.pathname==='/__ops/status'){
      probes++;assert.equal(request.method,'GET');assert.equal(request.headers.get('authorization'),'Bearer '+token);
      return down?new MFResponse(null,{status:503}):MFResponse.json({mode:'active',backup:{ok:true,at:now-1000},alarm:{ok:true,at:now},quota:{...q(),scopes:{maintenance:q(),highlights:q()}}});
    }
    if(url.hostname==='discord.com'&&url.pathname==='/api/webhooks/100000000000000005/isolated-operations-fixture'){
      assert.equal(request.method,'POST');assert.equal(request.headers.has('authorization'),false);assert.equal(url.searchParams.get('wait'),'true');
      const message=await request.json();assert.deepEqual(message.allowed_mentions,{parse:[]});messages.push(message);return MFResponse.json({id:'100000000000000007'});
    }
    throw new Error('External calls are not permitted by this isolated test');
  }});
  const restart=async()=>{if(mf)await mf.dispose();mf=new Miniflare(convertV4MiniflareOptions(config()));};t.after(()=>mf?.dispose());
  const status=async()=>{const response=await mf.dispatchFetch('http://localhost/__ops/status',{headers:{Authorization:'Bearer '+token}});assert.equal(response.status,200);return response.json();};
  const cron=async()=>{
    const response=await mf.dispatchFetch('http://localhost/fixture-scheduled');assert.equal(response.status,200,await response.text());
    for(let i=0;i<40;i++){const state=await status();if(state.checkedAt===now&&state.delivery!=='sending')return state;await delay(50);}
    assert.fail('Scheduled handler did not finish the isolated monitor check');
  };
  await restart();const health=await (await mf.dispatchFetch('http://localhost/healthz')).json();assert.equal(health.version,APP_VERSION);assert.equal(health.notificationsConfigured,true);
  assert.equal((await mf.dispatchFetch('http://localhost/__ops/status')).status,403);
  assert.equal((await mf.dispatchFetch('http://localhost/check',{method:'POST'})).status,404);
  assert.equal((await mf.dispatchFetch('http://localhost/__ops/backup',{method:'POST',headers:{Authorization:'Bearer '+token}})).status,404);
  assert.equal((await cron()).confirmed,false);assert.equal(messages.length,0);
  now+=600000;await restart();assert.equal((await cron()).delivery,'sent');assert.equal(messages.length,1);
  now+=600000;await restart();await cron();assert.equal(messages.length,1,'sent incident survives DO/process restart');
  down=false;now+=600000;await restart();await cron();assert.equal(messages.length,1);
  now+=600000;await restart();await cron();assert.equal(messages.length,2);assert.match(messages[1].content,/服務恢復/);
  await cron();assert.equal(messages.length,2);assert.equal(probes,5,'duplicate Cron in the same minute is suppressed');
  writeFileSync(join(dir,'report.json'),JSON.stringify({realWorkerd:true,scheduledHandler:true,actualCloudCron:false,restartDeduplication:true,recovery:true,noProductionRequests:true,readOnlyProbe:true},null,2));
});
