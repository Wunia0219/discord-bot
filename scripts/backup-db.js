import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const environment=process.env.APP_ENV || 'test';
if(!['test','production'].includes(environment))throw new Error('Invalid APP_ENV');
const source=resolve(process.env.DATABASE_PATH || `data/${environment}.sqlite`);
if(!existsSync(source))throw new Error('Database does not exist');
const directory=resolve(process.env.BACKUP_DIRECTORY || 'backups');mkdirSync(directory,{recursive:true});
const target=resolve(directory,`${environment}-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`);
const db=new DatabaseSync(source);
try{
  if(db.prepare('SELECT value FROM settings WHERE key=?').get('environment')?.value!==environment)throw new Error('Environment mismatch');
  // SQLite creates a consistent snapshot including committed WAL contents; never copy a live .sqlite alone.
  db.prepare('VACUUM INTO ?').run(target);
  console.log(`Backup created: ${target}`);
}finally{db.close();}
