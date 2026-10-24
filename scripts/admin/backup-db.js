import { backupWalletDatabase, databaseSettings } from '../../server/database-maintenance.js';

if(process.env.WALLET_BACKEND==='firestore')await import('./backup-firestore.js');
else console.log(JSON.stringify(backupWalletDatabase(databaseSettings()), null, 2));
