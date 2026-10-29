import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { databaseSettings } from '../../server/sqlite/database-maintenance.js';
import { inspectWalletDatabase, openWalletDatabase } from '../../server/sqlite/database.js';

const settings = databaseSettings();
mkdirSync(dirname(settings.filename), { recursive: true });
const db = openWalletDatabase(settings.filename, settings.environment);
db.close();
const result = inspectWalletDatabase(settings.filename, settings.environment);
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
