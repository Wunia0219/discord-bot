import {operationsSettings} from '../../server/operations/operations-settings.js';
import {checkOperationsStatus} from '../../server/operations/operations-status.js';

const port=Number(process.env.PORT||4188);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid PORT');
const result=await checkOperationsStatus(operationsSettings(),{port});
console.log(JSON.stringify(result,null,2));
if(!result.ok)process.exitCode=1;
