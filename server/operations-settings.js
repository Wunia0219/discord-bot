import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {databaseSettings} from './database-maintenance.js';

function integer(env,name,fallback,min,max){
  const value=env[name]===undefined?fallback:Number(env[name]);
  if(!Number.isSafeInteger(value)||value<min||value>max)throw new Error(`Invalid ${name}`);
  return value;
}

export function operationsSettings(env=process.env){
  if(env.WALLET_ENABLED!=='true')return null;
  if(env.WALLET_BACKEND==='firestore')return null;
  if(env.OPERATIONS_ENABLED!==undefined&&!['true','false'].includes(env.OPERATIONS_ENABLED))throw new Error('Invalid OPERATIONS_ENABLED');
  if(env.OPERATIONS_ENABLED==='false')return null;
  const database=databaseSettings(env);
  const sourceId=createHash('sha256').update(database.environment+'\0'+database.filename).digest('hex').slice(0,24);
  const directory=join(database.backupDirectory,'automatic',sourceId);
  const keepMin=integer(env,'BACKUP_KEEP_MIN',3,1,1000);
  const maxCount=integer(env,'BACKUP_MAX_COUNT',28,keepMin,10000);
  return {...database,sourceId,directory,statusFile:join(directory,'operations','status.json'),
    logFile:join(directory,'operations','events.jsonl'),
    backupIntervalMs:integer(env,'BACKUP_INTERVAL_MINUTES',360,1,10080)*60000,
    retentionMs:integer(env,'BACKUP_RETENTION_DAYS',7,1,3650)*86400000,keepMin,maxCount,
    backupMaxBytes:integer(env,'BACKUP_MAX_TOTAL_MB',256,1,1048576)*1024*1024,
    monitorIntervalMs:integer(env,'MONITOR_INTERVAL_SECONDS',300,1,86400)*1000,
    minFreeBytes:integer(env,'DISK_MIN_FREE_MB',256,1,1048576)*1024*1024};
}
