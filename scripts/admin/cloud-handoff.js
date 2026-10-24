import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {parseEnv} from 'node:util';
import {resolve} from 'node:path';
import {operationsSettings} from '../../server/operations-settings.js';
import {snapshotForCloud,quotaForCloud,decodeCloudArchive,restoreCloudSnapshot,mergeReturnedQuota} from '../../server/cloud-handoff.js';
import {checksum} from '../../server/automatic-backup.js';
import {digest} from '../../cloud/snapshot.js';
const [command,...args]=process.argv.slice(2),flags=new Map();for(let i=0;i<args.length;i+=2){if(!args[i].startsWith('--')||!args[i+1]||flags.has(args[i]))throw new Error('Expected unique --key value arguments');flags.set(args[i],args[i+1]);}
const need=k=>{const v=flags.get('--'+k);if(!v)throw new Error('Missing --'+k);return v;};
const read=f=>JSON.parse(readFileSync(f,'utf8').replace(/^\uFEFF/,''));
if(command==='prepare'){
  if(need('writers-stopped')!=='true')throw new Error('Stop all writers first');
  const env=parseEnv(readFileSync(need('env'),'utf8')),s=operationsSettings(env);if(s?.backend!=='firestore'||s.firestore.schemaVersion!==2)throw new Error('Active v2 required');
  if(process.platform==='win32'){
    const inventory=String.raw`$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -match 'server[\\/]index\.js|scripts[\\/]admin[\\/](import-firestore|backup-firestore|operations-status|firestore-status)\.js' }).Count`;
    const found=execFileSync('powershell.exe',['-NoProfile','-Command',inventory],{encoding:'utf8',windowsHide:true}).trim();if(found!=='0')throw new Error('A writer or maintenance process is still running');
  }else throw new Error('Writer inventory for this host requires a reviewed handoff; no implicit override');
  const source=resolve(need('from')),meta=read(source+'.meta.json');if(checksum(source)!==meta.sha256||meta.namespace!==s.firestore.namespace||meta.projectId!==s.firestore.projectId||!Number.isSafeInteger(meta.createdAt)||meta.createdAt>Date.now()+60000||Date.now()-meta.createdAt>300000)throw new Error('Fresh post-stop backup required');
  const raw=env,global=s.firestore.quota;
  const scopeLimits={global:{reads:global.reads,writes:global.writes,egressBytes:global.egressBytes,storageBytes:global.storageBytes},maintenance:{reads:s.maintenanceQuota.reads,writes:1,egressBytes:s.maintenanceQuota.egressBytes,storageBytes:s.maintenanceQuota.storageBytes},highlights:{reads:Number(raw.FIRESTORE_HIGHLIGHTS_READ_BUDGET||Math.min(3000,global.reads)),writes:Number(raw.FIRESTORE_HIGHLIGHTS_WRITE_BUDGET||Math.min(1000,global.writes)),egressBytes:Number(raw.FIRESTORE_HIGHLIGHTS_EGRESS_MB||Math.min(8,global.egressBytes/1024**2))*1024**2,storageBytes:global.storageBytes}};
  const snapshot=snapshotForCloud(source,s.environment,{upstreamImportFingerprint:meta.upstreamImportFingerprint}),quota=quotaForCloud({...s.firestore,scopeLimits});
  const output={format:1,projectId:s.firestore.projectId,namespace:s.firestore.namespace,writersStopped:true,sourceSha256:meta.sha256,snapshot,quota};writeFileSync(need('to'),JSON.stringify(output),{flag:'wx',mode:0o600});console.log(JSON.stringify({prepared:true,revision:snapshot.revision,quotaFile:global.filename,active:false}));
}else if(command==='restore'){
  const envelope=read(need('from')),key=readFileSync(need('key-file'),'utf8').trim(),environment=need('environment'),snapshot=decodeCloudArchive(envelope.archive||envelope,key,environment);console.log(JSON.stringify(restoreCloudSnapshot(snapshot,need('to'),environment)));
}else if(command==='return-quota'){
  const handoff=read(need('handoff')),returned=read(need('from')),env=parseEnv(readFileSync(need('env'),'utf8')),s=operationsSettings(env);if(returned.released!==true||returned.source?.namespace!==s.firestore.namespace||handoff.namespace!==s.firestore.namespace||!returned.exportId)throw new Error('Paused and released matching cloud export required');
  const receiptId=digest(returned.exportId);for(const [scope,suffix] of [['global',''],['maintenance','.maintenance.sqlite'],['highlights','.highlights.sqlite']])mergeReturnedQuota(s.firestore.quota.filename+suffix,scope,{base:handoff.quota,returned:returned.quota,receiptId,projectId:s.firestore.projectId});console.log(JSON.stringify({merged:true,originalQuotaFilesPreserved:true}));
}else throw new Error('Expected prepare, restore or return-quota');
