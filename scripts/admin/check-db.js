import { databaseSettings } from '../../server/database-maintenance.js';
import { inspectWalletDatabase } from '../../server/database.js';

const settings = databaseSettings();
const result = inspectWalletDatabase(settings.filename, settings.environment);
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
