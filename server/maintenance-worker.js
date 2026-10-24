import {parentPort,workerData} from 'node:worker_threads';
import {performMaintenance} from './automatic-backup.js';

try{
  const result=workerData.settings.backend==='firestore'
    ?await (await import('./firestore-backup.js')).performFirestoreMaintenance(workerData.settings,{forceBackup:workerData.settings.forceBackup===true})
    :performMaintenance(workerData.settings);
  parentPort.postMessage({ok:true,result});
}
catch{parentPort.postMessage({ok:false,code:'MAINTENANCE_FAILED'});}
