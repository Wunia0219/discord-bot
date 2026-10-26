import { DatabaseSync } from 'node:sqlite';
import { inspectSettlements } from './database-audit.js';

const migrations = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS wallets(guild TEXT NOT NULL,user TEXT NOT NULL,balance INTEGER NOT NULL CHECK(balance>=0 AND balance<=1000000000000),milestone INTEGER NOT NULL DEFAULT 0,last_spin INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(guild,user));
      CREATE TABLE IF NOT EXISTS ledger(id INTEGER PRIMARY KEY AUTOINCREMENT,guild TEXT NOT NULL,user TEXT NOT NULL,kind TEXT NOT NULL,delta INTEGER NOT NULL,before INTEGER NOT NULL,after INTEGER NOT NULL,actor TEXT,reason TEXT NOT NULL,time TEXT NOT NULL,day TEXT NOT NULL,reference TEXT,FOREIGN KEY(guild,user) REFERENCES wallets(guild,user));
      CREATE INDEX IF NOT EXISTS ledger_user ON ledger(guild,user,id DESC);
      CREATE INDEX IF NOT EXISTS ledger_admin_day ON ledger(guild,actor,day,kind);
      CREATE UNIQUE INDEX IF NOT EXISTS reversal_once ON ledger(guild,reference) WHERE kind='reversal';
      CREATE TABLE IF NOT EXISTS operations(guild TEXT NOT NULL,key TEXT NOT NULL,fingerprint TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(guild,key));
      CREATE TABLE IF NOT EXISTS rounds(guild TEXT NOT NULL,user TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(guild,user,id));
      CREATE INDEX IF NOT EXISTS rounds_user ON rounds(guild,user,created DESC);
      CREATE TRIGGER IF NOT EXISTS ledger_no_update BEFORE UPDATE ON ledger BEGIN SELECT RAISE(ABORT,'ledger is append only'); END;
      CREATE TRIGGER IF NOT EXISTS ledger_no_delete BEFORE DELETE ON ledger BEGIN SELECT RAISE(ABORT,'ledger is append only'); END;`,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS highlight_events(
        guild TEXT NOT NULL, round_id TEXT NOT NULL, name TEXT NOT NULL,
        tier TEXT NOT NULL, multiplier REAL NOT NULL, occurred INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', PRIMARY KEY(guild,round_id));
      CREATE INDEX IF NOT EXISTS highlight_pending ON highlight_events(guild,status,occurred);
      CREATE TABLE IF NOT EXISTS highlight_boards(
        guild TEXT PRIMARY KEY, message_id TEXT, started INTEGER NOT NULL,
        total INTEGER NOT NULL, entries TEXT NOT NULL, next_attempt INTEGER NOT NULL);`,
  },
  {version:3,sql:"CREATE INDEX IF NOT EXISTS ledger_wallet_reset ON ledger(guild,user,id DESC) WHERE kind='reset';"},
];

export const DATABASE_VERSION = migrations.at(-1).version;
export const WALLET_TABLES = ['settings', 'wallets', 'ledger', 'operations', 'rounds', 'highlight_events', 'highlight_boards'];
const environments = new Set(['test', 'production']);
const requiredColumns = {
  settings: ['key', 'value'],
  wallets: ['guild', 'user', 'balance', 'milestone', 'last_spin'],
  ledger: ['id', 'guild', 'user', 'kind', 'delta', 'before', 'after', 'actor', 'reason', 'time', 'day', 'reference'],
  operations: ['guild', 'key', 'fingerprint', 'result'],
  rounds: ['guild', 'user', 'id', 'data', 'created'],
  highlight_events: ['guild', 'round_id', 'name', 'tier', 'multiplier', 'occurred', 'status'],
  highlight_boards: ['guild', 'message_id', 'started', 'total', 'entries', 'next_attempt'],
};

export function assertDatabaseEnvironment(environment) {
  if (!environments.has(environment)) throw new Error('Invalid wallet environment');
}

function identity(db, environment, { allowEmpty = false } = {}) {
  assertDatabaseEnvironment(environment);
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > DATABASE_VERSION) throw new Error('Database schema is newer than this server');
  const tables = new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row => row.name));
  if (allowEmpty && !tables.size && version === 0) return { version, empty: true, tables };
  if (!tables.has('settings')) throw new Error('Not a recognized wallet database');
  const actual = db.prepare("SELECT value FROM settings WHERE key='environment'").get()?.value;
  if (actual !== environment) throw new Error('Refusing to mix test and production databases');
  return { version, empty: false, tables };
}

// Check ownership/environment before changing journal mode or applying any DDL.
export function openWalletDatabase(filename, environment) {
  assertDatabaseEnvironment(environment);
  const db = new DatabaseSync(filename);
  try {
    // Connection-local: wait for another opener before the first schema read.
    db.exec('PRAGMA busy_timeout=5000');
    identity(db, environment, { allowEmpty: true });
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
    db.exec('BEGIN IMMEDIATE');
    try {
      const current = identity(db, environment, { allowEmpty: true });
      for (const migration of migrations) {
        if (migration.version <= current.version) continue;
        db.exec(migration.sql);
        if (current.empty && migration.version === 1) {
          db.prepare("INSERT INTO settings(key,value) VALUES('environment',?)").run(environment);
        }
        db.exec(`PRAGMA user_version=${migration.version}`);
      }
      for (const [table, columns] of Object.entries(requiredColumns)) {
        const actual = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
        if (columns.some(column => !actual.has(column))) throw new Error(`Incomplete wallet schema: ${table}`);
      }
      const guards = db.prepare("SELECT COUNT(*) count FROM sqlite_schema WHERE type='trigger' AND name IN ('ledger_no_update','ledger_no_delete')").get().count;
      if (guards !== 2) throw new Error('Missing ledger protection');
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

// A read transaction keeps every audit query on the same committed snapshot.
// This function never creates, upgrades, repairs or seeds a database.
export function inspectWalletDatabase(filename, environment) {
  assertDatabaseEnvironment(environment);
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout=5000; BEGIN');
    const current = identity(db, environment);
    const issues = [];
    const counts = {};
    for (const table of WALLET_TABLES) {
      if (current.tables.has(table)) counts[table] = db.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count;
      else if ((table !== 'highlight_events' && table !== 'highlight_boards') || current.version >= 2) issues.push(`Missing table: ${table}`);
    }
    const checks = db.prepare('PRAGMA quick_check').all();
    if (checks.some(row => Object.values(row)[0] !== 'ok')) issues.push('SQLite integrity check failed');
    if (db.prepare('PRAGMA foreign_key_check').all().length) issues.push('Foreign key check failed');
    const triggers = new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type='trigger'").all().map(row => row.name));
    for (const name of ['ledger_no_update', 'ledger_no_delete']) {
      if (!triggers.has(name)) issues.push(`Missing ledger protection: ${name}`);
    }
    if (current.tables.has('wallets') && current.tables.has('ledger')) {
      if (db.prepare("SELECT COUNT(*) count FROM wallets WHERE typeof(balance)!='integer' OR balance<0 OR balance>1000000000000").get().count) issues.push('Invalid wallet balances');
      const brokenChain = db.prepare(`SELECT COUNT(*) count FROM (
        SELECT before,after,delta,LAG(after,1,0) OVER(PARTITION BY guild,user ORDER BY id) previous FROM ledger
      ) WHERE before!=previous OR after!=before+delta`).get().count;
      if (brokenChain) issues.push(`Ledger continuity errors: ${brokenChain}`);
      const mismatch = db.prepare(`SELECT COUNT(*) count FROM wallets w WHERE balance != COALESCE(
        (SELECT l.after FROM ledger l WHERE l.guild=w.guild AND l.user=w.user ORDER BY l.id DESC LIMIT 1),0)`).get().count;
      if (mismatch) issues.push(`Wallet/ledger balance mismatches: ${mismatch}`);
    }
    if (current.tables.has('rounds')) {
      if (db.prepare('SELECT COUNT(*) count FROM rounds WHERE NOT json_valid(data)').get().count) issues.push('Invalid round JSON');
      if (current.tables.has('wallets') && db.prepare(`SELECT COUNT(*) count FROM rounds r LEFT JOIN wallets w
        ON w.guild=r.guild AND w.user=r.user WHERE w.user IS NULL`).get().count) issues.push('Rounds without a wallet');
    }
    if (current.tables.has('operations') && db.prepare('SELECT COUNT(*) count FROM operations WHERE NOT json_valid(result)').get().count) issues.push('Invalid operation JSON');
    if (['rounds', 'ledger', 'operations'].every(table => current.tables.has(table))) {
      issues.push(...inspectSettlements(db));
    }
    db.exec('ROLLBACK');
    return { ok: issues.length === 0, environment, schemaVersion: current.version, latestSchemaVersion: DATABASE_VERSION, needsMigration: current.version < DATABASE_VERSION, counts, issues };
  } finally {
    db.close();
  }
}
