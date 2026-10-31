import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fetchUsage,parseUsage,usageQuery,usageWindow} from '../monitor/usage/analytics.js';
import {prepareUsage,readUsageState,usageSummary} from '../monitor/usage/notifications.js';
import {usageRisks} from '../monitor/usage/policy.js';
import {operationsWebhook,postNotification} from '../monitor/discord.js';
import {previousUsageArtifact,runUsageCommand} from '../scripts/cloud/cloudflare-usage.js';

const HOUR=3600000,NOW=Date.UTC(2026,9,31,12),ACCOUNT='a'.repeat(32);
const WEBHOOK='https://discord.com/api/webhooks/100000000000000005/isolated-usage-fixture';
function body({writes=0,hourWrites=0,storage=0}={}){
  const groups=written=>({Workers:[{sum:{requests:100}}],Objects:[{sum:{requests:101}}],Sql:[{sum:{rowsRead:1000,rowsWritten:written,duration:128.5}}]});
  return {data:{viewer:{accounts:[{
    ...Object.fromEntries(Object.entries(groups(writes)).map(([key,value])=>['day'+key,value])),
    ...Object.fromEntries(Object.entries(groups(hourWrites)).map(([key,value])=>['hour'+key,value])),
    storage:[{dimensions:{namespaceId:'b'.repeat(32)},max:{storedBytes:storage}}],
  }]}}};
}
const snapshot=(options={},now=NOW)=>parseUsage(body(options),now);
const sent=result=>({...result.state,pending:result.state.pending?{...result.state.pending,status:'sent'}:null});

test('Paid observations never announce Free daily exhaustion or imply monthly billing coverage',()=>{
  const data=snapshot({writes:200000,hourWrites:100000,storage:6e9});
  const result=prepareUsage(undefined,data,{now:NOW,plan:'paid'});
  assert.equal(result.send,false);
  assert.ok(result.risks.every(metric=>metric.keys.length===0&&metric.quotaStage===0&&metric.forecastStage===0));
  assert.match(usageSummary(result),/Paid 每日觀測/);
  assert.match(usageSummary(result),/未量測月累計/);
  assert.doesNotMatch(usageSummary(result),/免費參考線|200\.0%|用盡/);
  assert.throws(()=>prepareUsage(undefined,data,{now:NOW,plan:'pro'}));
});

test('Free to Paid transition cancels quota retries and preserves API failure and recovery alerts',()=>{
  const first=prepareUsage(undefined,snapshot({writes:90000}),{now:NOW});
  const previous={...first.state,pending:{...first.state.pending,status:'retry',nextAttempt:NOW+HOUR}};
  const paid=prepareUsage(previous,snapshot({writes:120000}),{now:NOW,plan:'paid'});
  assert.equal(paid.send,false);assert.equal(paid.state.pending,null);assert.deepEqual(paid.state.notified,[]);
  const failure=prepareUsage(paid.state,null,{now:NOW,plan:'paid'});
  assert.equal(failure.send,true);assert.deepEqual(failure.state.pending.keys,['api:failure']);
  assert.match(failure.state.pending.content,/Paid/);
  const repeated=prepareUsage(sent(failure),null,{now:NOW,plan:'paid'});
  assert.equal(repeated.send,false);
  const recovery=prepareUsage(repeated.state,snapshot(),{now:NOW,plan:'paid'});
  assert.equal(recovery.send,true);assert.deepEqual(recovery.state.pending.keys,['api:recovery']);
  const oldState={...sent(first)};delete oldState.plan;
  assert.equal(prepareUsage(oldState,snapshot({writes:120000}),{now:NOW,plan:'paid'}).send,false);
  assert.throws(()=>readUsageState({...paid.state,plan:'pro'},NOW),/state is invalid/);
});

test('a plan change never resends an uncertain notification',()=>{
  const first=prepareUsage(undefined,snapshot({writes:90000}),{now:NOW});
  const result=prepareUsage(first.state,snapshot({writes:120000}),{now:NOW,plan:'paid'});
  assert.equal(result.send,false);assert.equal(result.state.pending.status,'uncertain');
});

test('official query aggregates the entire account without namespace truncation of daily counters',()=>{
  const query=usageQuery(ACCOUNT,NOW);
  assert.equal(query.variables.account,ACCOUNT);
  assert.doesNotMatch(query.query,/scriptName|objectId/);
  assert.match(query.query,/dayWorkers: workersInvocationsAdaptive\(limit:1/);
  assert.match(query.query,/rowsRead rowsWritten duration/);
  assert.match(query.query,/dimensions\{namespaceId\}/);
  assert.match(query.query,/2026-10-31T00:00:00.000Z/);
  assert.match(query.query,/2026-10-31T11:00:00.000Z/);
  assert.throws(()=>usageQuery('untrusted query input',NOW),/CF_ACCOUNT_ID/);
});

test('UTC daily windows reset at Taipei 08:00 and never forecast across that reset',()=>{
  const midnight=Date.UTC(2026,10,1);
  assert.equal(usageWindow(midnight-1).day,'2026-10-31');
  assert.equal(usageWindow(midnight).day,'2026-11-01');
  assert.equal(usageWindow(midnight+60000).hourStart,midnight);
  const risks=usageRisks(snapshot({writes:79000,hourWrites:2000},midnight-60000));
  assert.equal(risks.find(m=>m.id==='writes').forecastStage,0);
  assert.throws(()=>usageWindow(NaN));
});

test('thresholds escalate once at 80, 90 and 100; ordinary percentage changes stay quiet',()=>{
  let previous;
  for(const [writes,expected] of [[79000,false],[80000,true],[81000,false],[90000,true],[99000,false],[100000,true],[110000,false],[80000,false]]){
    const result=prepareUsage(previous,snapshot({writes}),{now:NOW});
    assert.equal(result.send,expected,`writes=${writes}`);
    if(expected)assert.match(result.state.pending.content,/SQLite 寫入/);
    previous=sent(result);
  }
});

test('hourly burn predicts exhaustion before reset, escalates within two hours, and ignores sparse initial data',()=>{
  let first=prepareUsage(undefined,snapshot({writes:10000,hourWrites:10000}),{now:NOW});
  assert.equal(first.send,true);assert.match(first.state.pending.content,/9.0 小時/);
  let result=prepareUsage(sent(first),snapshot({writes:30000,hourWrites:10000}),{now:NOW});
  assert.equal(result.send,false);
  result=prepareUsage(sent(result),snapshot({writes:30000,hourWrites:40000}),{now:NOW});
  assert.equal(result.send,true);assert.match(result.state.pending.content,/1.8 小時/);
  const early=Date.UTC(2026,9,31,0,14);
  assert.equal(usageRisks(snapshot({writes:10000,hourWrites:10000},early)).find(m=>m.id==='writes').forecastStage,0);
});

test('daily notification keys reset; storage warnings persist across days until below hysteresis',()=>{
  const first=prepareUsage(undefined,snapshot({writes:80000,storage:4e9}),{now:NOW});
  const tomorrow=NOW+24*HOUR;
  let next=prepareUsage(sent(first),snapshot({storage:4e9},tomorrow),{now:tomorrow});
  assert.equal(next.send,false);assert.deepEqual(next.state.notified,['storage:quota80']);
  next=prepareUsage(next.state,snapshot({storage:3.4e9},tomorrow),{now:tomorrow});
  next=prepareUsage(next.state,snapshot({storage:4e9},tomorrow),{now:tomorrow});
  assert.equal(next.send,true);
});

test('all data and GraphQL errors fail visibly instead of becoming zero usage',()=>{
  for(const change of [b=>b.errors=[{message:'private upstream token'}],b=>b.data.viewer.accounts=[],b=>delete b.data.viewer.accounts[0].daySql,b=>b.data.viewer.accounts[0].daySql[0].sum.rowsWritten='0',b=>b.data.viewer.accounts[0].hourSql[0].sum.duration=-1,b=>b.data.viewer.accounts[0].storage.push(b.data.viewer.accounts[0].storage[0]),b=>b.data.viewer.accounts[0].storage=Array(1000).fill({})]){
    const b=body();change(b);assert.throws(()=>parseUsage(b,NOW),/Cloudflare/);
  }
  const b=body();for(const key of ['dayWorkers','dayObjects','daySql','hourWorkers','hourObjects','hourSql','storage'])b.data.viewer.accounts[0][key]=[];
  assert.deepEqual(parseUsage(b,NOW).used,{workers:0,objects:0,reads:0,writes:0,duration:0,storage:0});
});

test('storage adds namespace peaks and duration stays in the provider GB-s unit',()=>{
  const b=body({storage:100});b.data.viewer.accounts[0].storage.push({dimensions:{namespaceId:'c'.repeat(32)},max:{storedBytes:200}});
  const result=parseUsage(b,NOW);assert.equal(result.used.storage,300);assert.equal(result.used.duration,128.5);
});

test('analytics requests have a fixed HTTPS endpoint, timeout, no redirects and safe errors',async()=>{
  const result=await fetchUsage({account:ACCOUNT,token:'fixture-token',now:NOW,fetchImpl:async(url,options)=>{
    assert.equal(url,'https://api.cloudflare.com/client/v4/graphql');assert.equal(options.redirect,'error');
    assert.equal(options.headers.Authorization,'Bearer fixture-token');assert.ok(options.signal);return Response.json(body());
  }});assert.equal(result.used.writes,0);
  for(const response of [()=>{throw new Error('private token');},()=>new Response('private token',{status:403}),()=>Response.json({errors:[{message:'private token'}]}),()=>new Response('not JSON')]){
    await assert.rejects(fetchUsage({account:ACCOUNT,token:'fixture-token',now:NOW,fetchImpl:response}),error=>!error.message.includes('private')&&/Cloudflare/.test(error.message));
  }
});

test('API outage and recovery each notify once, preserving metric history and unknown usage',()=>{
  const first=prepareUsage(undefined,undefined,{now:NOW});assert.equal(first.send,true);assert.equal(first.risks.length,0);
  assert.match(usageSummary(first),/失敗（用量未知）/);
  const repeated=prepareUsage(sent(first),undefined,{now:NOW});assert.equal(repeated.send,false);
  const recovered=prepareUsage(repeated.state,snapshot(),{now:NOW});assert.equal(recovered.send,true);assert.match(recovered.state.pending.content,/查詢已恢復/);
  assert.equal(prepareUsage(sent(recovered),snapshot(),{now:NOW}).send,false);
  assert.equal(prepareUsage(sent(recovered),undefined,{now:NOW}).send,true);
});

test('interrupted POST intents are quarantined without suppressing later quota escalation',()=>{
  const first=prepareUsage(undefined,snapshot({writes:80000}),{now:NOW});
  let next=prepareUsage(first.state,snapshot({writes:81000}),{now:NOW});
  assert.equal(next.send,false);assert.equal(next.state.pending.status,'uncertain');
  next=prepareUsage(next.state,snapshot({writes:90000}),{now:NOW});assert.equal(next.send,true);
});

test('429 retries only when due, refreshes counts and cancels stale predictions or yesterday alerts',()=>{
  const first=prepareUsage(undefined,snapshot({writes:10000,hourWrites:10000}),{now:NOW});
  const retry={...first.state,pending:{...first.state.pending,status:'retry',nextAttempt:NOW+HOUR}};
  assert.equal(prepareUsage(retry,snapshot({writes:20000,hourWrites:10000}),{now:NOW}).send,false);
  let next=prepareUsage(retry,snapshot({writes:30000,hourWrites:10000},NOW+HOUR),{now:NOW+HOUR});
  assert.equal(next.send,true);assert.match(next.state.pending.content,/30,000/);
  next=prepareUsage(retry,snapshot(),{now:NOW});assert.equal(next.send,false);assert.equal(next.state.pending,null);
  const tomorrow=NOW+24*HOUR;
  next=prepareUsage(retry,snapshot({},tomorrow),{now:tomorrow});assert.equal(next.send,false);
});

test('corrupt or future notification state fails closed',()=>{
  const state=prepareUsage(undefined,snapshot(),{now:NOW}).state;
  for(const change of [{schema:2},{at:NOW+120000},{notified:['private unknown value']},{notified:Array(65).fill('api:failure')},{pending:{status:'sending',keys:[],content:'x'.repeat(1901)}}])assert.throws(()=>readUsageState({...state,...change},NOW),/state is invalid/);
});

test('webhook validation and delivery classification preserve safe retry behavior',async()=>{
  for(const value of ['http://discord.com/api/webhooks/100000000000000005/x',WEBHOOK+'?wait=true',WEBHOOK.replace('discord.com','evil.invalid'),WEBHOOK+'#secret'])assert.throws(()=>operationsWebhook(value));
  const url=operationsWebhook(WEBHOOK);assert.equal(url.search,'?wait=true');
  for(const [response,status] of [[()=>Response.json({id:'100000000000000007'}),'sent'],[()=>Response.json({retry_after:1800},{status:429}),'retry'],[()=>new Response(null,{status:403}),'blocked'],[()=>new Response(null,{status:500}),'uncertain'],[()=>new Response(null,{status:302}),'uncertain'],[()=>Response.json({}),'uncertain'],[()=>{throw new Error('private upstream token');},'uncertain']]){
    const result=await postNotification(url,{content:'safe',allowed_mentions:{parse:[]}},{now:NOW,fetchImpl:async(_url,options)=>{assert.equal(options.redirect,'manual');return response();}});
    assert.equal(result.status,status);if(status==='retry')assert.equal(result.nextAttempt,NOW+1800000);
    assert.ok(!JSON.stringify(result).includes('private'));
  }
});

const context={GITHUB_REPOSITORY:'owner/repo',GITHUB_DEFAULT_BRANCH:'main',GITHUB_REF:'refs/heads/main',GITHUB_TOKEN:'fixture-github-token',GITHUB_RUN_ID:'300',GITHUB_RUN_ATTEMPT:'2'};
const run=(id,extra={})=>({id,head_branch:'main',head_repository:{full_name:'owner/repo'},path:'.github/workflows/cloudflare-usage.yml',event:'schedule',status:'completed',conclusion:'success',...extra});
const artifact=(runId,attempt,kind='state',extra={})=>({id:runId*10+attempt,name:`cf-usage-${kind}-${runId}-${attempt}`,expired:false,size_in_bytes:1000,...extra});
function history(runs,artifacts){
  return async(url,options)=>{
    assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer fixture-github-token');
    const match=/actions\/runs\/(\d+)\/artifacts/.exec(url);
    return Response.json(match?{artifacts:artifacts[match[1]]||[],total_count:(artifacts[match[1]]||[]).length}:{workflow_runs:runs});
  };
}
test('artifact restore ignores fork, PR and non-default-branch runs and prefers final state from latest attempt',async()=>{
  const fetchImpl=history([run(400,{event:'pull_request'}),run(399,{head_repository:{full_name:'fork/repo'}}),run(398,{head_branch:'other'}),run(300),run(299)],{300:[artifact(300,1,'intent'),artifact(300,1),artifact(300,2)],299:[artifact(299,1)]});
  assert.deepEqual(await previousUsageArtifact(context,{fetchImpl}),{id:3001,runId:300,attempt:1,final:true});
  await assert.rejects(previousUsageArtifact({...context,GITHUB_REF:'refs/heads/other'},{fetchImpl}),/default-branch/);
  await assert.rejects(previousUsageArtifact({...context,GITHUB_RUN_ID:'299'},{fetchImpl:history([run(300),run(299)],{})}),/new workflow run/);
});

test('failed notification runs restore persisted intent; lost state and unavailable history never bootstrap as healthy',async()=>{
  assert.deepEqual(await previousUsageArtifact(context,{fetchImpl:history([run(299,{conclusion:'failure'})],{299:[artifact(299,1,'intent')]})}),{id:2991,runId:299,attempt:1,final:false});
  assert.equal(await previousUsageArtifact(context,{fetchImpl:history([],{} )}),null);
  for(const fetchImpl of [history([run(299)],{}),history([run(299)],{299:[artifact(299,1,'state',{expired:true})]}),async()=>new Response(null,{status:403})])await assert.rejects(previousUsageArtifact(context,{fetchImpl}),/state|history/);
});

test('CLI requires a persisted intent before POST and safely retries an upload that failed before POST',async()=>{
  const cwd=process.cwd(),directory=mkdtempSync(join(tmpdir(),'circus-usage-')),oldFetch=globalThis.fetch;
  const prefix=join(tmpdir(),'circus-usage-');
  assert.ok(resolve(directory).startsWith(resolve(prefix))&&!directory.slice(prefix.length).includes(sep));
  let posts=0;
  try{
    process.chdir(directory);mkdirSync('test-results/cloudflare-usage',{recursive:true});
    const result=prepareUsage(undefined,snapshot({writes:80000},Date.now()),{now:Date.now()});
    writeFileSync('test-results/cloudflare-usage/state.json',JSON.stringify(result.state));
    globalThis.fetch=async(_url,options)=>{posts++;const payload=JSON.parse(options.body);assert.deepEqual(payload.allowed_mentions,{parse:[]});return Response.json({id:'100000000000000007'});};
    await assert.rejects(runUsageCommand('send',{CF_USAGE_DISCORD_WEBHOOK:WEBHOOK}),/artifact is required/);assert.equal(posts,0);
    await runUsageCommand('unsent',{});
    const unsent=JSON.parse(readFileSync('test-results/cloudflare-usage/state.json','utf8'));
    assert.equal(unsent.pending.status,'retry');assert.equal(prepareUsage(unsent,snapshot({writes:80000},Date.now())).send,true);
    writeFileSync('test-results/cloudflare-usage/state.json',JSON.stringify(result.state));
    await runUsageCommand('send',{CF_USAGE_DISCORD_WEBHOOK:WEBHOOK,CF_INTENT_ARTIFACT_ID:'123'});assert.equal(posts,1);
    assert.equal(JSON.parse(readFileSync('test-results/cloudflare-usage/state.json','utf8')).pending.status,'sent');
  }finally{globalThis.fetch=oldFetch;process.chdir(cwd);rmSync(directory,{recursive:true,force:true});}
});

test('CLI dry-run requires a plan and only reads analytics without persisting or posting notifications',async()=>{
  const cwd=process.cwd(),directory=mkdtempSync(join(tmpdir(),'circus-usage-')),oldFetch=globalThis.fetch,oldLog=console.log;
  const prefix=join(tmpdir(),'circus-usage-');
  assert.ok(resolve(directory).startsWith(resolve(prefix))&&!directory.slice(prefix.length).includes(sep));
  const requests=[],lines=[];
  try{
    process.chdir(directory);console.log=line=>lines.push(line);
    globalThis.fetch=async(url,options)=>{requests.push({url,method:options.method});return Response.json(body({writes:200000}));};
    await assert.rejects(runUsageCommand('dry-run',{}),/CLOUD_PLAN/);
    assert.equal(requests.length,0);
    await runUsageCommand('dry-run',{CLOUD_PLAN:'paid',CF_ACCOUNT_ID:ACCOUNT,CF_ANALYTICS_TOKEN:'isolated-read-only-token'});
    assert.deepEqual(requests,[{url:'https://api.cloudflare.com/client/v4/graphql',method:'POST'}]);
    assert.match(lines.join('\n'),/Paid 每日觀測/);
    assert.equal(existsSync('test-results/cloudflare-usage/state.json'),false);
  }finally{globalThis.fetch=oldFetch;console.log=oldLog;process.chdir(cwd);rmSync(directory,{recursive:true,force:true});}
});

test('workflow keeps monitoring outside Cloudflare, restricts credentials and persists intent before POST',()=>{
  const workflow=readFileSync('.github/workflows/cloudflare-usage.yml','utf8');
  assert.match(workflow,/cron: '7,22,37,52 \* \* \* \*'/);
  assert.doesNotMatch(workflow,/pull_request|wrangler|npm ci|write:/);
  assert.match(workflow,/cancel-in-progress: false/);assert.match(workflow,/persist-credentials: false/);
  assert.match(workflow,/digest-mismatch: error/);assert.match(workflow,/vars.CF_ACCOUNT_ID/);
  assert.match(workflow,/secrets.CF_ANALYTICS_TOKEN/);assert.match(workflow,/steps.intent.outputs.artifact-id/);
  assert.match(workflow,/CLOUD_PLAN: paid/);
  assert.ok(workflow.indexOf('Persist intent before Discord POST')<workflow.indexOf('Notify maintenance channel'));
  assert.ok([...workflow.matchAll(/uses: ([^\s]+)/g)].every(match=>/@[a-f0-9]{40}$/.test(match[1])));
});
