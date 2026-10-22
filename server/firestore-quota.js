import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {problem} from './wallet.js';

const windowMs=86400000,slotMs=60000;
const unavailable=()=>problem(503,'服務今天的使用量較高，請稍後再試。','FIRESTORE_BUDGET');

// This is a durable, conservative application allowance, not Google's billing meter.
// Reserve before network calls; failed/uncertain requests never refund their allowance.
export class FirestoreQuota {
  constructor({filename,projectId,reads=40000,writes=15000,egressBytes=128*1024**2,storageBytes=128*1024**2,clock=Date.now}){
    for(const value of [reads,writes,egressBytes,storageBytes])if(!Number.isSafeInteger(value)||value<=0)throw new Error('Invalid Firestore quota');
    Object.assign(this,{clock,limits:{reads,writes,egressBytes,storageBytes}});
    mkdirSync(dirname(filename),{recursive:true});this.db=new DatabaseSync(filename);
    try{
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS usage(slot INTEGER PRIMARY KEY,reads INTEGER NOT NULL,writes INTEGER NOT NULL,egressBytes INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS growth(id INTEGER PRIMARY KEY CHECK(id=1),bytes INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS documents(key TEXT PRIMARY KEY,bytes INTEGER NOT NULL);`);
    this.db.prepare('INSERT OR IGNORE INTO settings VALUES(?,?)').run('project',projectId);
    if(this.db.prepare("SELECT value FROM settings WHERE key='project'").get().value!==projectId){this.db.close();throw new Error('Firestore quota project mismatch');}
    this.db.exec('INSERT OR IGNORE INTO growth VALUES(1,0)');
    }catch(error){if(this.db.isOpen)this.db.close();throw error;}
  }
  totals(){
    const since=this.clock()-windowMs-slotMs;
    const usage=this.db.prepare('SELECT COALESCE(SUM(reads),0) reads,COALESCE(SUM(writes),0) writes,COALESCE(SUM(egressBytes),0) egressBytes FROM usage WHERE slot>?').get(since);
    return {...usage,storageBytes:this.db.prepare('SELECT bytes FROM growth WHERE id=1').get().bytes};
  }
  reserve(cost={},document=null){
    const values=Object.fromEntries(Object.keys(this.limits).map(key=>[key,cost[key]||0]));
    if(Object.values(values).some(value=>!Number.isSafeInteger(value)||value<0))throw new Error('Invalid Firestore reservation');
    if(document&&(typeof document.key!=='string'||!Number.isSafeInteger(document.bytes)||document.bytes<0))throw new Error('Invalid document reservation');
    try{
      this.db.exec('BEGIN IMMEDIATE');const current=this.totals();
      if(document){const previous=this.db.prepare('SELECT bytes FROM documents WHERE key=?').get(document.key)?.bytes||0;values.storageBytes+=Math.max(0,document.bytes-previous);}
      if(Object.keys(this.limits).some(key=>current[key]+values[key]>this.limits[key]))throw unavailable();
      const slot=Math.floor(this.clock()/slotMs)*slotMs;
      this.db.prepare(`INSERT INTO usage VALUES(?,?,?,?) ON CONFLICT(slot) DO UPDATE SET
        reads=reads+excluded.reads,writes=writes+excluded.writes,egressBytes=egressBytes+excluded.egressBytes`)
        .run(slot,values.reads,values.writes,values.egressBytes);
      this.db.prepare('UPDATE growth SET bytes=bytes+? WHERE id=1').run(values.storageBytes);
      if(document)this.db.prepare('INSERT INTO documents VALUES(?,?) ON CONFLICT(key) DO UPDATE SET bytes=MAX(bytes,excluded.bytes)').run(document.key,document.bytes);
      this.db.prepare('DELETE FROM usage WHERE slot<?').run(this.clock()-windowMs-2*slotMs);
      this.db.exec('COMMIT');
    }catch(error){try{this.db.exec('ROLLBACK');}catch{}throw error.code==='FIRESTORE_BUDGET'?error:unavailable();}
  }
  // Account response bytes without changing a settled financial result on overflow.
  observe(bytes){
    this.reserve({});
    this.db.prepare('INSERT INTO usage VALUES(?,0,0,?) ON CONFLICT(slot) DO UPDATE SET egressBytes=egressBytes+excluded.egressBytes')
      .run(Math.floor(this.clock()/slotMs)*slotMs,bytes);
  }
  status(){const used=this.totals();return {used,limits:this.limits,blocked:Object.keys(this.limits).some(key=>used[key]>=this.limits[key]),windowHours:24,estimated:true};}
  estimateGrowth(documents){
    const query=this.db.prepare('SELECT bytes FROM documents WHERE key=?');
    return documents.reduce((total,document)=>total+Math.max(0,document.bytes-(query.get(document.key)?.bytes||0)),0);
  }
  close(){if(this.db.isOpen)this.db.close();}
}
