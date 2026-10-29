// Local-only handoff/recovery helpers. Never open the live database writable.
import {DatabaseSync} from 'node:sqlite';
import {openSync,closeSync,existsSync,linkSync,unlinkSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {inspectWalletDatabase,openWalletDatabase,WALLET_TABLES} from '../sqlite/database.js';
import {auditSnapshot,digest,TABLES,checkManifest,openSegment} from '../../cloud/snapshot.js';
import {Sealer} from '../../cloud/storage.js';
import {QUOTA_LIMITS} from '../../cloud/quota.js';

export function snapshotForCloud(filename,environment,{upstreamImportFingerprint=null}={}){
  const audit=inspectWalletDatabase(filename,environment);if(!audit.ok)throw new Error('Snapshot audit failed');
  const db=new DatabaseSync(filename,{readOnly:true});let tables;
  try{db.exec('BEGIN');tables=Object.fromEntries(WALLET_TABLES.map(t=>[t,db.prepare('SELECT * FROM '+t).all().map(row=>({...row}))]));}finally{db.close();}
  const snapshot={format:1,environment,createdAt:Date.now(),upstreamImportFingerprint,revision:tables.ledger.reduce((max,e)=>Math.max(max,e.id),0),tables};auditSnapshot(snapshot,environment);return snapshot;
}
export function quotaForCloud(settings){
  const scopes={};for(const [scope,suffix] of [['global',''],['maintenance','.maintenance.sqlite'],['highlights','.highlights.sqlite']]){
    const filename=settings.quota.filename+suffix,db=new DatabaseSync(filename,{readOnly:true});
    try{db.exec('BEGIN');if(db.prepare("SELECT value FROM settings WHERE key='project'").get()?.value!==settings.projectId)throw new Error('Quota project mismatch');
      scopes[scope]={limits:{...QUOTA_LIMITS[scope],...(settings.scopeLimits?.[scope]||{})},growth:db.prepare('SELECT bytes FROM growth WHERE id=1').get().bytes,usage:db.prepare('SELECT * FROM usage WHERE slot>? ORDER BY slot').all(Date.now()-86460000),documents:db.prepare('SELECT * FROM documents ORDER BY key').all()};
    }finally{db.close();}
  }
  return {projectId:settings.projectId,exportedAt:Date.now(),scopes};
}
export function decodeCloudArchive(archive,key,environment){
  const {manifest,chunks}=archive||{},sealer=new Sealer(key);
  if(manifest?.format===2){
    checkManifest(manifest,sealer);if(manifest.environment!==environment||!Array.isArray(chunks)||chunks.length!==manifest.parts)throw new Error('Invalid cloud archive');
    const tables=Object.fromEntries(TABLES.map(t=>[t,[]]));for(let i=0;i<chunks.length;i++)for(const row of openSegment(manifest,i,chunks[i],sealer))tables[manifest.segments[i].table].push(row);
    const snapshot={...manifest.header,tables};auditSnapshot(snapshot,environment);return snapshot;
  }
  if(manifest?.format!==1||manifest.environment!==environment||!Array.isArray(chunks)||chunks.length!==manifest.parts||chunks.length>200)throw new Error('Invalid cloud archive');
  const text=chunks.map((c,i)=>sealer.open(c,`backup:${manifest.generation}:${i}`)).join('');if(Buffer.byteLength(text)>8*1024**2||digest(text)!==manifest.sha256)throw new Error('Cloud archive checksum');
  const snapshot=JSON.parse(text);auditSnapshot(snapshot,environment);if(snapshot.revision!==manifest.revision)throw new Error('Archive revision');return snapshot;
}
export function restoreCloudSnapshot(snapshot,target,environment){
  auditSnapshot(snapshot,environment);if(existsSync(target))throw new Error('Restore target exists');const temporary=target+'.partial-'+randomUUID();closeSync(openSync(temporary,'wx',0o600));
  const db=openWalletDatabase(temporary,environment);
  try{db.exec('BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON');for(const table of WALLET_TABLES){if(table==='settings')continue;for(const row of snapshot.tables[table]){const columns=Object.keys(row);const schema=new Set(db.prepare('PRAGMA table_info('+table+')').all().map(c=>c.name));if(columns.some(c=>!schema.has(c)))throw new Error('Unsupported snapshot column');db.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...columns.map(c=>row[c]));}}db.exec('COMMIT');}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}finally{db.close();}
  try{const result=inspectWalletDatabase(temporary,environment);if(!result.ok)throw new Error('Restored snapshot audit failed');linkSync(temporary,target);return result;}
  finally{for(const file of [temporary,temporary+'-wal',temporary+'-shm'])if(existsSync(file))unlinkSync(file);}
}

// Add only the usage accumulated in cloud AFTER its original import. If local
// maintenance unexpectedly consumed allowance, keep that usage as well. Receipt
// IDs make crash/retry safe for each original quota file; files are never replaced.
export function mergeReturnedQuota(filename,scope,{base,returned,receiptId,projectId}){
  if(!/^[a-f0-9]{64}$/.test(receiptId)||base.projectId!==projectId||returned.projectId!==projectId)throw new Error('Quota receipt identity');
  const b=base.scopes[scope],r=returned.scopes[scope];if(!b||!r||Object.keys(QUOTA_LIMITS[scope]).some(k=>b.limits?.[k]!==r.limits?.[k]))throw new Error('Quota limits changed');
  const previous=new Map(b.usage.map(x=>[x.slot,x]));
  if(!Number.isSafeInteger(r.growth)||r.growth<b.growth)throw new Error('Storage growth must not decrease');
  for(const row of r.usage)for(const k of ['slot','reads','writes','egressBytes'])if(!Number.isSafeInteger(row[k])||row[k]<0)throw new Error('Invalid returned quota');
  if(!existsSync(filename))throw new Error('Original quota file is missing; never recreate it');
  const db=new DatabaseSync(filename);
  try{db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');if(db.prepare("SELECT value FROM settings WHERE key='project'").get()?.value!==projectId)throw new Error('Quota project mismatch');
    db.exec('CREATE TABLE IF NOT EXISTS cloud_receipts(id TEXT PRIMARY KEY)');if(db.prepare('SELECT id FROM cloud_receipts WHERE id=?').get(receiptId)){db.exec('ROLLBACK');return {alreadyApplied:true};}
    for(const row of r.usage){const old=previous.get(row.slot),values=['reads','writes','egressBytes'].map(k=>{const delta=row[k]-(old?.[k]||0);if(delta<0)throw new Error('Returned quota decreased');return delta;});db.prepare('INSERT INTO usage VALUES(?,?,?,?) ON CONFLICT(slot) DO UPDATE SET reads=reads+excluded.reads,writes=writes+excluded.writes,egressBytes=egressBytes+excluded.egressBytes').run(row.slot,...values);}
    db.prepare('UPDATE growth SET bytes=bytes+? WHERE id=1').run(r.growth-b.growth);
    for(const d of r.documents){if(!/^[a-f0-9]{64}$/.test(d.key)||!Number.isSafeInteger(d.bytes)||d.bytes<0)throw new Error('Invalid document growth');db.prepare('INSERT INTO documents VALUES(?,?) ON CONFLICT(key) DO UPDATE SET bytes=MAX(bytes,excluded.bytes)').run(d.key,d.bytes);}
    db.prepare('INSERT INTO cloud_receipts VALUES(?)').run(receiptId);db.exec('COMMIT');return {applied:true};
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}finally{db.close();}
}
