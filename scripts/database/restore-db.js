import { parseArgs } from 'node:util';
import { copyWalletDatabase, databaseSettings } from '../../server/sqlite/database-maintenance.js';

const { values } = parseArgs({ options: { from: { type: 'string' }, to: { type: 'string' } }, allowPositionals: false });
if (!values.from || !values.to) throw new Error('Usage: restore-db.js --from <backup.sqlite> --to <new-database.sqlite>');
const { environment } = databaseSettings();
const result = copyWalletDatabase({ source: values.from, target: values.to, environment });
console.log(JSON.stringify(result, null, 2));
