import { backupWalletDatabase, databaseSettings } from '../../server/database-maintenance.js';

const result = backupWalletDatabase(databaseSettings());
console.log(JSON.stringify(result, null, 2));
