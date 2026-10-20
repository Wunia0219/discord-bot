import { DatabaseSync } from 'node:sqlite';
import { closeSync, mkdirSync, openSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertDatabaseEnvironment, inspectWalletDatabase } from './database.js';

export function databaseSettings(env = process.env) {
  const environment = env.APP_ENV;
  assertDatabaseEnvironment(environment);
  if (env.DATABASE_PATH === ':memory:') throw new Error('Maintenance requires a database file');
  return {
    environment,
    filename: resolve(env.DATABASE_PATH || `data/${environment}.sqlite`),
    backupDirectory: resolve(env.BACKUP_DIRECTORY || 'backups'),
  };
}

// VACUUM INTO takes a consistent snapshot including committed WAL contents.
// Reserve a brand-new destination so restore can never overwrite a live file.
export function copyWalletDatabase({ source, target, environment }) {
  if (!source || !target) throw new Error('Source and destination paths are required');
  source = resolve(source);
  target = resolve(target);
  if (source === target) throw new Error('Source and destination must be different');
  const original = inspectWalletDatabase(source, environment);
  if (!original.ok) throw new Error('Source database failed verification; no copy created');
  let created = false;
  try {
    mkdirSync(dirname(target), { recursive: true });
    closeSync(openSync(target, 'wx', 0o600));
    created = true;
    const db = new DatabaseSync(source, { readOnly: true });
    try {
      db.exec('PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL');
      db.prepare('VACUUM INTO ?').run(target);
    } finally {
      db.close();
    }
    const check = inspectWalletDatabase(target, environment);
    if (!check.ok) throw new Error('Copied database failed verification');
    return { ...check, database: target };
  } catch (error) {
    // Only remove the destination this call exclusively created.
    if (created) {
      try { unlinkSync(target); } catch { /* Keep the original failure. */ }
    }
    throw error;
  }
}

export function backupWalletDatabase({ filename, backupDirectory, environment }) {
  assertDatabaseEnvironment(environment);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return copyWalletDatabase({
    source: filename,
    target: resolve(backupDirectory, `${environment}-${stamp}-${randomUUID().slice(0, 8)}.sqlite`),
    environment,
  });
}
