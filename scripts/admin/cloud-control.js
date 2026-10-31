// Explicit operator actions only; no automatic deployment or credential output.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {operationsHealth} from '../../cloud/operations-health.js';
import {APP_VERSION} from '../../src/version.js';
const [command,...args]=process.argv.slice(2),flags=new Map();
for(let i=0;i<args.length;i+=2){if(!['--env','--from','--to','--writers-stopped','--free-plan-verified','--reads','--writes','--allow-paid-usage'].includes(args[i])||!args[i+1]||flags.has(args[i]))throw new Error('Invalid operator arguments');flags.set(args[i],args[i+1]);}
const need=key=>{const value=flags.get('--'+key);if(!value)throw new Error('Missing --'+key);return value;};
if(!['status','health','seed','verify','activate','pause','backup','archive','export','quota-limits','quota-notify-only'].includes(command))throw new Error('Expected status, health, seed, verify, activate, pause, backup, archive, export, quota-limits or quota-notify-only');
const env=parseEnv(readFileSync(need('env'),'utf8')),origin=new URL(env.CLOUD_ORIGIN);
if(origin.protocol!=='https:'||!/^[-a-z0-9]+\.[-a-z0-9]+\.workers\.dev$/.test(origin.hostname)||origin.port||origin.pathname!=='/'||origin.search||origin.hash||origin.username||origin.password)throw new Error('Expected the reviewed workers.dev origin');
const readOnly=['status','health'].includes(command),token=readOnly?(env.CLOUD_MONITOR_TOKEN||env.CLOUD_ADMIN_TOKEN):env.CLOUD_ADMIN_TOKEN;
if(!/^[a-f0-9]{64}$/i.test(token||''))throw new Error(readOnly?'Private read-only or admin token required':'Private admin token required');
let input=command==='export'?{paged:true}:{};
if(command==='quota-notify-only'){
  if(need('allow-paid-usage')!=='true')throw new Error('Explicit paid usage approval required');
  input={mode:'notify-only',allowPaidUsage:true};
}
if(command==='quota-limits'){
  input={reads:Number(need('reads')),writes:Number(need('writes'))};
  if(Object.values(input).some(value=>!Number.isSafeInteger(value)||value<1)||input.reads>50000||input.writes>20000)throw new Error('Document limits must stay within the free allowance');
}
if(command==='seed')input=JSON.parse(readFileSync(need('from'),'utf8'));
if(command==='activate'){
  if(need('writers-stopped')!=='true'||need('free-plan-verified')!=='true')throw new Error('Verify stopped writers and the actual Free subscription first');
  input={writersStopped:true,freePlanVerified:true};
}
// Check the requested destination before releasing ownership. A lost response can
// be exported again with the same receipt; the cloud writer stays released.
if(['archive','export'].includes(command)&&existsSync(need('to')))throw new Error('Export destination already exists');
let response=await fetch(new URL('/__ops/'+(command==='health'?'status':command==='archive'?'archive-manifest':command==='quota-notify-only'?'quota-policy':command),origin),{
  method:readOnly?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(command==='verify'?180000:30000),
  headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
  ...(readOnly?{}:{body:JSON.stringify(input)}),
});
if(response.status===404&&command==='archive')response=await fetch(new URL('/__ops/archive',origin),{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{}'});
if(!response.ok)throw new Error('Cloud operation refused (HTTP '+response.status+'); inspect status, retain original request and data');
const result=await response.json();
if(['archive','export'].includes(command)&&result.archive&&!result.archive.chunks){
  const m=result.archive.manifest,chunks=[];
  if(!Number.isSafeInteger(m.parts)||m.parts<1||m.parts>8192)throw new Error('Invalid archive part count');
  while(chunks.length<m.parts){
    const page=await fetch(new URL('/__ops/archive-page',origin),{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({generation:m.generation,start:chunks.length,limit:16})});
    if(!page.ok)throw new Error('Archive download interrupted; original backup retained');
    const data=await page.json();if(data.generation!==m.generation||data.sha256!==m.sha256||data.start!==chunks.length||!Array.isArray(data.chunks)||data.chunks.length!==Math.min(16,m.parts-chunks.length))throw new Error('Archive page changed');
    chunks.push(...data.chunks);
  }
  result.archive.chunks=chunks;
}
if(command==='health'){
  const health=operationsHealth(result),versionMatches=result.version===APP_VERSION;
  console.log(JSON.stringify({version:result.version??null,expectedVersion:APP_VERSION,versionMatches,...health,ok:health.ok&&versionMatches}));
  if(!health.ok||!versionMatches)process.exitCode=1;
}else if(['archive','export'].includes(command)){
  if(command==='export'&&(result.released!==true||!result.exportId||!result.archive||!result.quota))throw new Error('Incomplete release export');
  writeFileSync(need('to'),JSON.stringify(result),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({released:result.released,saved:true,revision:result.archive.manifest.revision}));
}else console.log(JSON.stringify(result));
