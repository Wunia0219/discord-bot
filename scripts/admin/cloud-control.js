// Explicit operator actions only; no automatic deployment or credential output.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {parseEnv} from 'node:util';
const [command,...args]=process.argv.slice(2),flags=new Map();
for(let i=0;i<args.length;i+=2){if(!['--env','--from','--to','--writers-stopped','--free-plan-verified'].includes(args[i])||!args[i+1]||flags.has(args[i]))throw new Error('Invalid operator arguments');flags.set(args[i],args[i+1]);}
const need=key=>{const value=flags.get('--'+key);if(!value)throw new Error('Missing --'+key);return value;};
if(!['status','seed','verify','activate','pause','backup','archive','export'].includes(command))throw new Error('Expected status, seed, verify, activate, pause, backup, archive or export');
const env=parseEnv(readFileSync(need('env'),'utf8')),origin=new URL(env.CLOUD_ORIGIN);
if(origin.protocol!=='https:'||!/^[-a-z0-9]+\.[-a-z0-9]+\.workers\.dev$/.test(origin.hostname)||origin.port||origin.pathname!=='/'||origin.search||origin.hash||origin.username||origin.password)throw new Error('Expected the reviewed workers.dev origin');
if(!/^[a-f0-9]{64}$/i.test(env.CLOUD_ADMIN_TOKEN||''))throw new Error('Private admin token required');
let input={};
if(command==='seed')input=JSON.parse(readFileSync(need('from'),'utf8'));
if(command==='activate'){
  if(need('writers-stopped')!=='true'||need('free-plan-verified')!=='true')throw new Error('Verify stopped writers and the actual Free subscription first');
  input={writersStopped:true,freePlanVerified:true};
}
// Check the requested destination before releasing ownership. A lost response can
// be exported again with the same receipt; the cloud writer stays released.
if(['archive','export'].includes(command)&&existsSync(need('to')))throw new Error('Export destination already exists');
const response=await fetch(new URL('/__ops/'+command,origin),{
  method:command==='status'?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(command==='verify'?180000:30000),
  headers:{Authorization:'Bearer '+env.CLOUD_ADMIN_TOKEN,'Content-Type':'application/json'},
  ...(command==='status'?{}:{body:JSON.stringify(input)}),
});
if(!response.ok)throw new Error('Cloud operation refused (HTTP '+response.status+'); inspect status, retain original request and data');
const result=await response.json();
if(['archive','export'].includes(command)){
  if(command==='export'&&(result.released!==true||!result.exportId||!result.archive||!result.quota))throw new Error('Incomplete release export');
  writeFileSync(need('to'),JSON.stringify(result),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({released:result.released,saved:true,revision:result.archive.manifest.revision}));
}else console.log(JSON.stringify(result));
