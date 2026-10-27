import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {parseArgs,parseEnv} from 'node:util';
import {randomBytes} from 'node:crypto';
import {decodeCloudArchive,restoreCloudSnapshot} from '../../server/recovery/cloud-handoff.js';
import {firestoreImportPlan} from '../../server/firestore/import.js';

const {values,positionals}=parseArgs({allowPositionals:true,options:Object.fromEntries(['archive','key-file','out','env','plan','confirm'].map(key=>[key,{type:'string'}]))});
const need=key=>{if(!values[key])throw new Error('Missing --'+key);return values[key];};
const command=positionals[0];
if(command==='plan'){
 const envelope=JSON.parse(readFileSync(need('archive'),'utf8')),source=envelope.source;
 if(source?.environment!=='test'||source.schemaVersion!==2||!source.namespace.endsWith('-test'))throw new Error('Only a test v2 archive is accepted');
 const snapshot=decodeCloudArchive(envelope.archive,readFileSync(need('key-file'),'utf8').trim(),'test');
 const out=resolve(need('out'));if(existsSync(out))throw new Error('Use a new private output directory');mkdirSync(out,{recursive:true});
 const file=join(out,'source.sqlite');restoreCloudSnapshot(snapshot,file,'test');
 const plan=firestoreImportPlan(file,'test',{version:2}),manifest=envelope.archive.manifest;
 const input={action:'prepare',id:randomBytes(16).toString('hex'),confirm:'DELETE ALL TEST PLAYERS',projectId:source.projectId,namespace:source.namespace,generation:manifest.generation,sha256:manifest.sha256,revision:snapshot.revision,paths:plan.resources.map(r=>r.path)};
 writeFileSync(join(out,'plan.json'),JSON.stringify(input),{flag:'wx',mode:0o600});
 console.log(JSON.stringify({planned:true,source,revision:snapshot.revision,wallets:snapshot.tables.wallets.length,documents:input.paths.length,operationId:input.id,output:out}));
}else if(['prepare','step'].includes(command)){
 if(need('confirm')!=='DELETE ALL TEST PLAYERS')throw new Error('Explicit deletion confirmation required');
 const plan=JSON.parse(readFileSync(need('plan'),'utf8')),env=parseEnv(readFileSync(need('env'),'utf8')),origin=new URL(env.CLOUD_ORIGIN);
 if(origin.protocol!=='https:'||!/^[-a-z0-9]+\.[-a-z0-9]+\.workers\.dev$/.test(origin.hostname)||origin.port||origin.pathname!=='/'||origin.search||origin.hash||origin.username||origin.password||!/^[a-f0-9]{64}$/.test(env.CLOUD_ADMIN_TOKEN||''))throw new Error('Reviewed origin and private admin token required');
 const input=command==='prepare'?plan:{action:'step',id:plan.id};
 const response=await fetch(new URL('/__ops/test-reset',origin),{method:'POST',headers:{Authorization:'Bearer '+env.CLOUD_ADMIN_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(input),redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw new Error('Reset refused; retain backup and inspect paused service (HTTP '+response.status+')');
 console.log(JSON.stringify(await response.json()));
}else throw new Error('Expected plan, prepare or step; this tool never deploys or activates a service');
