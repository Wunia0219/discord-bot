import {createHash} from 'node:crypto';
import {closeSync,openSync,readSync,existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,statfsSync,statSync,unlinkSync,writeFileSync} from 'node:fs';
import {basename,dirname,join,resolve} from 'node:path';
import {backupWalletDatabase} from './database-maintenance.js';
import {inspectWalletDatabase} from './database.js';

export const checksum=file=>{
  const fd=openSync(file,'r'),hash=createHash('sha256'),buffer=Buffer.alloc(65536);
  try{let length;while((length=readSync(fd,buffer,0,buffer.length,null)))hash.update(buffer.subarray(0,length));return hash.digest('hex');}
  finally{closeSync(fd);}
};
export function diskSpace(path){
  let parent=resolve(path);
  while(!existsSync(parent)&&dirname(parent)!==parent)parent=dirname(parent);
  const disk=statfsSync(parent,{bigint:true});
  return Number(disk.bavail*disk.bsize);
}
const bytes=file=>{try{return statSync(file).size;}catch{return 0;}};
function snapshotBytes(settings){
  if(!existsSync(settings.directory))return 0;
  return readdirSync(settings.directory).reduce((total,name)=>{
    const file=join(settings.directory,name),info=lstatSync(file);
    return total+(info.isFile()&&!info.isSymbolicLink()&&name.endsWith('.sqlite')?info.size:0);
  },0);
}

// Only manifests in this database's dedicated automatic directory own snapshots.
// Hand-made backups, other sources, links and unrecognized files are never pruned.
export function automaticSnapshots(settings){
  if(!existsSync(settings.directory))return [];
  const records=[];
  for(const name of readdirSync(settings.directory)){
    if(!name.endsWith('.sqlite.meta.json'))continue;
    const metadata=join(settings.directory,name);
    try{
      if(!lstatSync(metadata).isFile()||lstatSync(metadata).isSymbolicLink())continue;
      const row=JSON.parse(readFileSync(metadata,'utf8'));
      if(row.sourceId!==settings.sourceId||row.environment!==settings.environment
        ||typeof row.file!=='string'||basename(row.file)!==row.file||name!==row.file+'.meta.json'
        ||!new RegExp(`^${settings.environment}-\\d{4}-\\d{2}-\\d{2}T[\\dTZ-]+-[a-f\\d]{8}\\.sqlite$`).test(row.file)
        ||!Number.isSafeInteger(row.createdAt)||!/^[a-f\d]{64}$/.test(row.sha256||''))continue;
      const file=join(settings.directory,row.file),info=lstatSync(file);
      if(info.isSymbolicLink()||!info.isFile())continue;
      records.push({...row,path:file,metadata});
    }catch{/* Unrecognized or interrupted files are preserved for inspection. */}
  }
  return records.sort((a,b)=>b.createdAt-a.createdAt||b.file.localeCompare(a.file));
}

export function pruneAutomaticSnapshots(settings,verified,now=Date.now()){
  const records=automaticSnapshots(settings);
  // No deletion unless this run has just created and verified a new snapshot.
  if(!verified||!records.some(row=>row.path===verified.database&&row.sha256===verified.sha256))return 0;
  let removed=0;
  for(let i=0;i<records.length;i++){
    const row=records[i];
    if(row.path===verified.database||i<settings.keepMin)continue;
    if(i<settings.maxCount&&now-row.createdAt<=settings.retentionMs)continue;
    if(resolve(row.path)!==join(resolve(settings.directory),row.file))throw new Error('Unsafe automatic backup target');
    // Unlink this regular file only; never recurse or follow a directory/link.
    const info=lstatSync(row.path);
    if(info.isSymbolicLink()||!info.isFile())continue;
    unlinkSync(row.path);unlinkSync(row.metadata);removed++;
  }
  return removed;
}

export function performMaintenance(settings,{now=Date.now(),freeBytes=diskSpace,backupImpl=backupWalletDatabase}={}){
  const result={checkedAt:new Date(now).toISOString(),audit:null,disks:[],backup:null,alerts:[]};
  for(const [name,path] of [['database',settings.filename],['backup',settings.directory]]){
    try{
      const available=freeBytes(path);
      result.disks.push({name,freeBytes:available,ok:available>=settings.minFreeBytes});
      if(available<settings.minFreeBytes)result.alerts.push('DISK_SPACE_LOW');
    }catch{result.alerts.push('DISK_CHECK_FAILED');}
  }
  try{
    result.audit=inspectWalletDatabase(settings.filename,settings.environment);
    if(!result.audit.ok)result.alerts.push('DATABASE_AUDIT_FAILED');
  }catch{result.alerts.push('DATABASE_UNAVAILABLE');}
  result.databaseBytes=bytes(settings.filename);result.walBytes=bytes(settings.filename+'-wal');
  let last=null;
  try{
    for(const candidate of automaticSnapshots(settings)){
      if(candidate.createdAt>now)continue;
      try{if(checksum(candidate.path)===candidate.sha256){last=candidate;break;}}catch{}
      result.alerts.push('BACKUP_CHECKSUM_FAILED');
    }
    const due=!last||now-last.createdAt>=settings.backupIntervalMs;
    const usedBytes=snapshotBytes(settings);
    result.backupStorage={usedBytes,limitBytes:settings.backupMaxBytes};
    const estimatedBytes=result.databaseBytes+result.walBytes;
    const withinBudget=usedBytes+estimatedBytes<=settings.backupMaxBytes;
    if(due&&!withinBudget)result.alerts.push('BACKUP_BUDGET_EXCEEDED');
    if(due&&withinBudget&&result.audit?.ok&&!result.alerts.some(code=>code.startsWith('DISK_'))){
      let backup;
      try{
        mkdirSync(settings.directory,{recursive:true});
        backup=backupImpl({...settings,backupDirectory:settings.directory});
        if(usedBytes+bytes(backup.database)>settings.backupMaxBytes){
          unlinkSync(backup.database);backup=null;
          result.alerts.push('BACKUP_BUDGET_EXCEEDED');
          throw new Error('Snapshot exceeds its local storage budget');
        }
        const sha256=checksum(backup.database);
        const record={sourceId:settings.sourceId,environment:settings.environment,file:basename(backup.database),createdAt:now,sha256};
        writeFileSync(backup.database+'.meta.json',JSON.stringify(record)+'\n',{flag:'wx',mode:0o600});
        last={...record,path:backup.database};
        result.backup={created:true,verified:true,lastSuccessAt:new Date(now).toISOString(),ageMs:0,file:record.file};
        try{result.backup.pruned=pruneAutomaticSnapshots(settings,{...backup,sha256},now);}
        catch{result.alerts.push('BACKUP_RETENTION_FAILED');}
      }catch{result.alerts.push('BACKUP_FAILED');}
    }
    if(last&&!result.backup)result.backup={created:false,verified:true,lastSuccessAt:new Date(last.createdAt).toISOString(),ageMs:now-last.createdAt,file:last.file};
    if(!last)result.alerts.push('BACKUP_MISSING');
    else if(now-last.createdAt>settings.backupIntervalMs*2)result.alerts.push('BACKUP_STALE');
    result.snapshotCount=automaticSnapshots(settings).length;
    result.backupStorage.usedBytes=snapshotBytes(settings);
  }catch{result.alerts.push('BACKUP_SCAN_FAILED');}
  result.alerts=[...new Set(result.alerts)].sort();
  return result;
}
