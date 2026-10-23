import {operationsSettings} from '../../server/operations-settings.js';
import {maintenanceJob} from '../../server/operations.js';

const settings=operationsSettings();
if(settings?.backend!=='firestore')throw new Error('Firestore operations must be enabled');
const result=await maintenanceJob({...settings,forceBackup:true});
console.log(JSON.stringify(result,null,2));
if(!result.backup?.created||!result.backup?.verified)process.exitCode=1;
