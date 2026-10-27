// Safe operator workflow: download an existing encrypted backup, or rehearse it
// locally. Never calls pause, backup, export, activate, or live database writes.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {downloadRecoveryArchive,recoverySummary,sendRecoveryNotification} from '../../server/wallet-recovery.js';

const [operation,...args]=process.argv.slice(2),flags=new Map();
const allowed=['--env','--archive','--key-file','--out','--environment','--project','--namespace','--guild','--notify-webhook-file','--notify-guild','--notify-channel'];
for(let i=0;i<args.length;i+=2){if(!allowed.includes(args[i])||!args[i+1]||flags.has(args[i]))throw new Error('Expected unique recovery --key value arguments');flags.set(args[i],args[i+1]);}
const need=name=>{const value=flags.get('--'+name);if(!value)throw new Error('Missing --'+name);return value;};
if(!['backup','drill'].includes(operation))throw new Error('Expected backup or drill');
const environment=need('environment');if(!['test','production'].includes(environment))throw new Error('Explicit test or production environment required');
const keyFile=resolve(need('key-file')),key=readFileSync(keyFile,'utf8').trim();
if(!/^[a-f0-9]{64}$/i.test(key))throw new Error('Invalid recovery key');
let source,env,archivePath;
if(operation==='backup'){
  env=parseEnv(readFileSync(need('env'),'utf8'));
  source={projectId:need('project'),namespace:need('namespace'),environment};
}else archivePath=resolve(need('archive'));
const notify=flags.has('--notify-webhook-file');
if(notify){need('notify-guild');need('notify-channel');}
else if(flags.has('--notify-guild')||flags.has('--notify-channel'))throw new Error('Notification webhook file required');
const out=resolve(need('out'));if(existsSync(out))throw new Error('Use a new output directory; previous recovery evidence is never overwritten');mkdirSync(out,{recursive:true});
const reportPath=join(out,'report.json'),report={operation,status:'started',startedAt:new Date().toISOString(),environment,serviceChanged:false};
const save=()=>writeFileSync(reportPath,JSON.stringify(report,null,2),{mode:0o600});save();
let stage=operation==='backup'?'download':'read-archive';
try{
  const envelope=operation==='backup'?await downloadRecoveryArchive({origin:env.CLOUD_ORIGIN,token:env.CLOUD_ADMIN_TOKEN,source}):JSON.parse(readFileSync(archivePath,'utf8'));
  stage='verify';
  const {summary}=recoverySummary(envelope,key,environment,{guildId:flags.get('--guild')});
  if(operation==='backup'){stage='save-archive';archivePath=join(out,'archive.json');writeFileSync(archivePath,JSON.stringify(envelope),{flag:'wx',mode:0o600});}
  Object.assign(report,summary);
  if(operation==='drill'){
    stage='drill';
    const child=spawnSync(process.execPath,[fileURLToPath(new URL('./rehearse-cloud-recovery.js',import.meta.url)),'--archive',archivePath,'--key-file',keyFile,'--environment',environment,'--out',join(out,'local-drill')],{encoding:'utf8',windowsHide:true,maxBuffer:1024*1024,timeout:180000});
    if(child.status!==0)throw new Error('Isolated recovery verification failed');
    const drill=JSON.parse(readFileSync(join(out,'local-drill','report.json'),'utf8'));
    if(drill.ok!==true||drill.allSevenTablesUnchanged!==true||drill.sourceUnchanged!==true||drill.externalServicesAccessed!==false)throw new Error('Recovery drill incomplete');
    report.drill=drill;
  }
  report.status='complete';
}catch{
  report.status='failed';report.ok=false;report.failure='RECOVERY_VERIFICATION_FAILED';report.failedStage=stage;process.exitCode=1;
}finally{
  report.finishedAt=new Date().toISOString();save();
}
if(notify){
  try{await sendRecoveryNotification({webhook:readFileSync(need('notify-webhook-file'),'utf8').trim(),guildId:need('notify-guild'),channelId:need('notify-channel'),report,save});}
  catch{report.notification ||= {status:'not-sent'};if(report.notification.status==='sending')report.notification={status:'uncertain'};save();}
  if(report.notification.status!=='sent')process.exitCode=1;
}
console.log(JSON.stringify({operation,status:report.status,environment,walletCount:report.walletCount,revision:report.revision,notification:report.notification?.status||'disabled',serviceChanged:false}));
