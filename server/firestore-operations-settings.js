import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {firestoreSettings} from './firestore-settings.js';

function integer(env,key,fallback,min,max){
  const value=env[key]===undefined?fallback:Number(env[key]);
  if(!Number.isSafeInteger(value)||value<min||value>max)throw new Error(`Invalid ${key}`);
  return value;
}
export function firestoreOperationsSettings(env){
  const firestore=firestoreSettings(env);
  const sourceId=createHash('sha256').update(['firestore',firestore.projectId,firestore.namespace,firestore.environment].join('\0')).digest('hex').slice(0,24);
  const directory=join(resolve(env.BACKUP_DIRECTORY||'backups'),'firestore',sourceId);
  const keepMin=integer(env,'BACKUP_KEEP_MIN',3,1,1000);
  return {backend:'firestore',firestore,environment:firestore.environment,sourceId,directory,
    statusFile:join(directory,'operations','status.json'),logFile:join(directory,'operations','events.jsonl'),
    lockFile:join(directory,'operations','maintenance.sqlite'),
    baseline:env.FIRESTORE_BACKUP_BASELINE?resolve(env.FIRESTORE_BACKUP_BASELINE):null,
    maintenanceQuota:{...firestore.quota,filename:firestore.quota.filename+'.maintenance.sqlite',
      reads:integer(env,'FIRESTORE_MAINTENANCE_READ_BUDGET',Math.min(6000,firestore.quota.reads),1,firestore.quota.reads),writes:1,
      egressBytes:integer(env,'FIRESTORE_MAINTENANCE_EGRESS_MB',32,1,128)*1024**2},
    backupIntervalMs:integer(env,'FIRESTORE_BACKUP_INTERVAL_MINUTES',1440,60,10080)*60000,
    monitorIntervalMs:integer(env,'FIRESTORE_MONITOR_INTERVAL_SECONDS',600,60,86400)*1000,
    retentionMs:integer(env,'BACKUP_RETENTION_DAYS',7,1,3650)*86400000,keepMin,
    maxCount:integer(env,'BACKUP_MAX_COUNT',7,keepMin,10000),
    backupMaxBytes:integer(env,'BACKUP_MAX_TOTAL_MB',256,1,1048576)*1024**2,
    minFreeBytes:integer(env,'DISK_MIN_FREE_MB',256,1,1048576)*1024**2};
}
