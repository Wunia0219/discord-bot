import test from 'node:test';
import assert from 'node:assert/strict';
import {operationsHealth,alertFingerprint,notificationPayload} from '../cloud/operations-health.js';
import {ServiceMonitor,monitorSettings} from '../monitor/check.js';

const START=Date.UTC(2026,9,24,12),TEN_MINUTES=600000;
const quota=()=>({used:{reads:10,writes:0,egressBytes:0,storageBytes:10},limits:{reads:100,writes:100,egressBytes:1000,storageBytes:1000},blocked:false});
const healthy=(now=START)=>({mode:'active',backup:{ok:true,at:now-1000},alarm:{ok:true,at:now},quota:{...quota(),scopes:{maintenance:quota(),highlights:quota()}}});
const webhook='https://discord.com/api/webhooks/100000000000000005/isolated-operations-fixture';

test('casino delivery failures warn without exposing player amounts or changing game availability',()=>{
 const status={...healthy(),casino:{activeVisits:1,pending:2,oldestPendingAt:START-600001,uncertain:1}};
 const health=operationsHealth(status,{now:START});assert.equal(health.level,'warning');assert.equal(health.alerts.length,2);
 const text=notificationPayload(health.alerts,START).content;assert.match(text,/出入場公告/);assert.doesNotMatch(text,/餘額|token|玩家名稱/);
 assert.equal(status.mode,'active');assert.equal(status.backup.ok,true);
});
test('backup capacity warns before the full-history limit without treating legacy metadata as a failure',()=>{
 const s=healthy();assert.equal(operationsHealth(s,{now:START}).ok,true);
 s.backup.bytes=80;s.backup.limitBytes=100;assert.ok(operationsHealth(s,{now:START}).alerts.some(a=>a.code==='BACKUP_CAPACITY_HIGH'));
 s.backup.bytes=100;const alerts=operationsHealth(s,{now:START}).alerts;assert.ok(alerts.some(a=>a.code==='BACKUP_CAPACITY_EXHAUSTED'&&a.severity==='critical'));
 assert.match(notificationPayload(alerts,START).content,/完整備份容量已達上限/);
 s.backup.bytes=1;s.backup.parts=80;s.backup.limitParts=100;assert.ok(operationsHealth(s,{now:START}).alerts.some(a=>a.code==='BACKUP_CAPACITY_HIGH'));
 s.backup.parts=100;assert.equal(operationsHealth(s,{now:START}).alerts.filter(a=>a.code==='BACKUP_CAPACITY_EXHAUSTED').length,1);
});
function fixture(){
  let now=START,target=()=>Response.json(healthy(now)),delivery=()=>Response.json({id:'100000000000000007'});
  const values=new Map(),messages=[],requests=[];
  const storage={async get(key){return structuredClone(values.get(key));},async put(key,value){values.set(key,structuredClone(value));}};
  const env={CLOUD_PLAN:'free',MONITOR_ENABLED:'true',MONITORED_ORIGIN:'https://circus.fixture.workers.dev',MONITORED_TOKEN:'b'.repeat(64),MONITOR_WEBHOOK_URL:webhook};
  const fetchImpl=async(url,options)=>{
    requests.push({url:String(url),method:options.method});assert.equal(options.redirect,'manual');
    if(new URL(url).pathname==='/__ops/status'){
      assert.equal(options.method,'GET');assert.equal(options.headers.Authorization,'Bearer '+env.MONITORED_TOKEN);return target();
    }
    assert.equal(String(url),webhook+'?wait=true');assert.equal(options.method,'POST');assert.equal(options.headers.Authorization,undefined);
    const message=JSON.parse(options.body);assert.deepEqual(message.allowed_mentions,{parse:[]});messages.push(message);return delivery();
  };
  const create=()=>new ServiceMonitor(storage,env,{fetchImpl,clock:()=>now});
  return {env,values,storage,messages,requests,create,get now(){return now;},advance(ms=TEN_MINUTES){now+=ms;},target(fn){target=fn;},delivery(fn){delivery=fn;}};
}
const tick=async(f,monitor)=>{f.advance();return monitor.check();};

test('maintenance health reports backup/alarm failures and every quota scope without exposing player data',()=>{
  const status=healthy();assert.equal(operationsHealth(status,{now:START}).ok,true);
  status.backup.at=START-49*3600000;status.alarm.ok=false;status.quota.scopes.maintenance.used.reads=80;status.quota.scopes.highlights.used.reads=100;
  const result=operationsHealth(status,{now:START});
  assert.deepEqual(result.alerts.map(a=>[a.code,a.scope||null]),[['ALARM_FAILED',null],['BACKUP_STALE',null],['QUOTA_EXHAUSTED','highlights'],['QUOTA_HIGH','maintenance']]);
  assert.equal(result.quotaPercent.maintenance.reads,80);assert.equal(result.level,'critical');
  status.backup.at=START+61000;status.alarm.at=0;status.quota=null;
  assert.deepEqual(operationsHealth(status,{now:START}).alerts.map(a=>a.code),['ALARM_MISSING','BACKUP_MISSING','QUOTA_UNAVAILABLE']);
});

test('backup lateness, stale alarms and invalid quota fail visibly at the documented thresholds',()=>{
  const status=healthy();status.backup.at=START-26*3600000;status.alarm.at=START-30*60000;status.quota.used.reads=NaN;
  assert.deepEqual(operationsHealth(status,{now:START}).alerts.map(a=>a.code),['ALARM_STALE','BACKUP_DELAYED','QUOTA_UNAVAILABLE']);
  status.mode='paused';assert.ok(operationsHealth(status,{now:START}).alerts.some(a=>a.code==='SERVICE_NOT_ACTIVE'));
});

test('disabled or unsafe monitor configuration never contacts a target or notification endpoint',async()=>{
  for(const change of [{MONITOR_ENABLED:'false'},{CLOUD_PLAN:'paid'},{MONITORED_ORIGIN:'http://127.0.0.1'},{MONITORED_ORIGIN:'https://circus.fixture.workers.dev/other'},{MONITORED_ORIGIN:'https://user:secret@circus.fixture.workers.dev'},{MONITORED_TOKEN:'missing'},{MONITOR_WEBHOOK_URL:'https://untrusted.invalid/token'},{DISCORD_HIGHLIGHTS_WEBHOOK_URL:webhook}]){
    const f=fixture();Object.assign(f.env,change);assert.throws(()=>monitorSettings(f.env));assert.deepEqual(await f.create().check(),{configured:false,delivery:'disabled'});assert.equal(f.requests.length,0);
  }
});

test('unchanged healthy checks stay quiet; persistent alerts and recovery each notify once across restart',async()=>{
  const f=fixture();let monitor=f.create();await monitor.check();await tick(f,monitor);assert.equal(f.messages.length,0);
  f.target(()=>new Response(null,{status:503}));await tick(f,monitor);assert.equal(f.messages.length,0);await tick(f,monitor);assert.equal(f.messages.length,1);
  monitor=f.create();await tick(f,monitor);assert.equal(f.messages.length,1);
  f.target(()=>Response.json(healthy(f.now)));await tick(f,monitor);await tick(f,monitor);assert.equal(f.messages.length,2);assert.match(f.messages[1].content,/服務恢復/);
  await tick(f,f.create());assert.equal(f.messages.length,2);assert.ok(!JSON.stringify([...f.values]).includes(f.env.MONITORED_TOKEN));
});

test('quota percentage changes do not spam while a newly exhausted budget gets a new alert',async()=>{
  const f=fixture();let used=80;f.target(()=>{const s=healthy(f.now);s.quota.used.reads=used;return Response.json(s);});const monitor=f.create();
  await monitor.check();await tick(f,monitor);assert.equal(f.messages.length,1);
  used=90;await tick(f,monitor);assert.equal(f.messages.length,1);
  used=100;await tick(f,monitor);await tick(f,monitor);assert.equal(f.messages.length,2);
});

test('missing notification destination records confirmed health without sending; later configuration can notify',async()=>{
  const f=fixture();delete f.env.MONITOR_WEBHOOK_URL;f.target(()=>new Response(null,{status:503}));const monitor=f.create();
  await monitor.check();assert.equal((await tick(f,monitor)).delivery,'unconfigured');assert.equal(f.messages.length,0);
  f.env.MONITOR_WEBHOOK_URL=webhook;assert.equal((await tick(f,f.create())).delivery,'sent');assert.equal(f.messages.length,1);
});

test('transient errors recover quietly and simultaneous/duplicate checks use a single probe',async()=>{
  const f=fixture();let resolve;f.target(()=>new Promise(r=>resolve=r));const monitor=f.create();const a=monitor.check(),b=monitor.check();
  await new Promise(r=>setImmediate(r));resolve(new Response(null,{status:503}));await Promise.all([a,b]);assert.equal(f.requests.length,1);
  await f.create().check();assert.equal(f.requests.length,1,'same-minute duplicate is suppressed after restart');
  f.target(()=>Response.json(healthy(f.now)));await tick(f,monitor);await tick(f,monitor);assert.equal(f.messages.length,0);
});

test('429 honors Retry-After across restart and cancels an unsent alert when service recovers',async()=>{
  const f=fixture();f.target(()=>new Response(null,{status:503}));f.delivery(()=>Response.json({retry_after:7200},{status:429}));let monitor=f.create();
  await monitor.check();assert.equal((await tick(f,monitor)).delivery,'retry');assert.equal(f.messages.length,1);
  monitor=f.create();await tick(f,monitor);assert.equal(f.messages.length,1);
  f.target(()=>Response.json(healthy(f.now)));await tick(f,monitor);await tick(f,monitor);assert.equal(f.messages.length,1);assert.equal(f.values.get('monitor-state').pending,null);
});

test('429 retries only after the declared interval and acknowledges the successful notification',async()=>{
  const f=fixture();f.target(()=>new Response(null,{status:503}));f.delivery(()=>new Response('{}',{status:429,headers:{'retry-after':'1800'}}));const monitor=f.create();
  await monitor.check();await tick(f,monitor);await tick(f,monitor);assert.equal(f.messages.length,1);
  f.delivery(()=>Response.json({id:'100000000000000008'}));f.advance(1800000);assert.equal((await f.create().check()).delivery,'sent');assert.equal(f.messages.length,2);
  await tick(f,f.create());assert.equal(f.messages.length,2);
});

test('lost POST responses and interrupted sending intents remain uncertain and are never blindly repeated',async()=>{
  for(const failure of ['network','server','bad-message','interrupted']){
    const f=fixture();f.target(()=>new Response(null,{status:503}));const monitor=f.create();
    if(failure==='network')f.delivery(()=>{throw new Error('secret upstream body');});
    if(failure==='server')f.delivery(()=>new Response(null,{status:500}));
    if(failure==='bad-message')f.delivery(()=>Response.json({unexpected:'not-a-message'}));
    await monitor.check();
    if(failure==='interrupted'){
      const fp=alertFingerprint([{code:'SERVICE_UNREACHABLE',severity:'critical'}]);
      const state=f.values.get('monitor-state');state.pending={fingerprint:fp,status:'sending'};f.values.set('monitor-state',state);
    }else assert.equal((await tick(f,monitor)).delivery,'uncertain');
    const sent=f.messages.length;assert.equal((await tick(f,f.create())).delivery,'uncertain');await tick(f,f.create());assert.equal(f.messages.length,sent);
    assert.ok(!JSON.stringify([...f.values]).includes('secret upstream body'));
  }
});

test('definitive notification rejection stays blocked and no unapproved redirects are followed',async()=>{
  const f=fixture();f.target(()=>new Response(null,{status:503}));f.delivery(()=>new Response(null,{status:403}));const monitor=f.create();
  await monitor.check();assert.equal((await tick(f,monitor)).delivery,'blocked');await tick(f,f.create());assert.equal(f.messages.length,1);
  const g=fixture();g.target(()=>new Response(null,{status:302,headers:{location:'https://untrusted.invalid'}}));await g.create().check();assert.equal(g.requests.length,1);
});

test('monitor does not post unless its persistent sending intent has been saved',async()=>{
  const f=fixture();f.target(()=>new Response(null,{status:503}));const monitor=f.create();await monitor.check();
  const put=f.storage.put;f.storage.put=async(key,value)=>{if(value.pending?.status==='sending')throw new Error('Storage unavailable');return put(key,value);};
  f.advance();await assert.rejects(monitor.check(),/Storage unavailable/);assert.equal(f.messages.length,0);
});

test('401, malformed responses and arbitrary player fields produce only safe aggregate notification text',async()=>{
  for(const response of [()=>new Response(null,{status:401}),()=>Response.json({playerId:'private-player',mode:'invalid'}),()=>{throw new Error('token=private-token');}]){
    const f=fixture();f.target(response);const monitor=f.create();await monitor.check();await tick(f,monitor);assert.equal(f.messages.length,1);
    assert.ok(!JSON.stringify(f.messages).includes('private-'));assert.ok(!JSON.stringify([...f.values]).includes('private-'));
  }
  const payload=notificationPayload([{code:'<@everyone>',scope:'secret',severity:'critical'}],START);assert.ok(!payload.content.includes('<@'));assert.deepEqual(payload.allowed_mentions,{parse:[]});
});
