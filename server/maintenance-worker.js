import {parentPort,workerData} from 'node:worker_threads';
import {performMaintenance} from './automatic-backup.js';

try{parentPort.postMessage({ok:true,result:performMaintenance(workerData.settings)});}
catch{parentPort.postMessage({ok:false,code:'MAINTENANCE_FAILED'});}
