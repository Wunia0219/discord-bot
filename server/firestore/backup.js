import {DatabaseSync} from 'node:sqlite';
import {isOpeningKind} from '../wallet/wallet-opening.js';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {existsSync,mkdirSync,readFileSync,writeFileSync,readdirSync,lstatSync,renameSync,unlinkSync,statSync,openSync,closeSync} from 'node:fs';
import {join,basename,resolve} from 'node:path';
import {FieldPath} from '@google-cloud/firestore';
import {FirestoreWalletStore} from './wallet.js';
import {FirestoreQuota} from './quota.js';
import {openWalletDatabase,inspectWalletDatabase} from '../sqlite/database.js';
import {copyWalletDatabase} from '../sqlite/database-maintenance.js';
import {firestoreImportPlan} from './import.js';
import {automaticSnapshots,checksum,diskSpace} from '../recovery/automatic-backup.js';
import {assertHighlightEvent,assertHighlightBoard,highlightBoardRecord} from './highlight-data.js';

const digest=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>Object.assign(new Error(code),{code});
const unpack=snapshot=>snapshot.exists?JSON.parse(snapshot.get('json')):null;
const pageSize=20;

// Both ledgers are persistent and shared by all local workers using this project.
// Maintenance never writes Firestore; an exhausted maintenance allowance leaves game capacity available.
export class MaintenanceQuota {
  constructor(settings){
    this.global=new FirestoreQuota(settings.firestore.quota);
    try{this.maintenance=new FirestoreQuota(settings.maintenanceQuota);}catch(error){this.global.close();throw error;}
  }
  reserve(cost={}){
    if(cost.writes||cost.storageBytes)throw fail('BACKUP_REMOTE_WRITE_REFUSED');
    try{this.maintenance.reserve(cost);}catch{throw fail('FIRESTORE_MAINTENANCE_BUDGET');}
    this.global.reserve(cost);
  }
  observe(bytes){
    this.global.observe(bytes);
    try{this.maintenance.observe(bytes);}catch{throw fail('FIRESTORE_MAINTENANCE_BUDGET');}
  }
  status(){return {...this.global.status(),maintenance:this.maintenance.status()};}
  close(){this.global.close();this.maintenance.close();}
}

function owned(settings,row){
  return row.backend==='firestore'&&row.projectId===settings.firestore.projectId&&row.namespace===settings.firestore.namespace
    &&row.format===1&&Number.isSafeInteger(row.revision)&&row.revision>=0;
}
function usedBytes(settings){
  if(!existsSync(settings.directory))return 0;
  return readdirSync(settings.directory).reduce((sum,name)=>{
    const info=lstatSync(join(settings.directory,name));
    return sum+(info.isFile()&&!info.isSymbolicLink()&&/\.sqlite(?:\.partial(?:-journal|-wal|-shm)?)?$/.test(name)?info.size:0);
  },0);
}
function pruneSnapshots(settings,verified,now){
  const records=automaticSnapshots(settings).filter(row=>owned(settings,row));
  const valid=records.filter(row=>checksum(row.path)===row.sha256);
  if(!valid.some(row=>row.path===verified.path&&row.sha256===verified.sha256))throw fail('BACKUP_CHECKSUM_FAILED');
  // A damaged newer file must never displace an older good copy from the minimum.
  const keep=new Set(valid.slice(0,settings.keepMin).map(row=>row.path));
  for(const row of records)if(!keep.has(row.path)&&keep.size<settings.maxCount&&now-row.createdAt<=settings.retentionMs)keep.add(row.path);
  let removed=0;
  for(const row of records){
    if(keep.has(row.path))continue;
    if(resolve(row.path)!==join(resolve(settings.directory),row.file))throw fail('BACKUP_TARGET_INVALID');
    for(const path of [row.path,row.metadata]){
      const info=lstatSync(path);if(!info.isFile()||info.isSymbolicLink())throw fail('BACKUP_TARGET_INVALID');
    }
    unlinkSync(row.path);unlinkSync(row.metadata);removed++;
  }
  return removed;
}
function removeOwnPartial(settings){
  for(const name of readdirSync(settings.directory)){
    if(!name.endsWith('.sqlite.partial.meta.json'))continue;
    const marker=join(settings.directory,name);
    try{
      if(!lstatSync(marker).isFile()||lstatSync(marker).isSymbolicLink())continue;
      const row=JSON.parse(readFileSync(marker,'utf8'));
      if(row.sourceId!==settings.sourceId||row.environment!==settings.environment||basename(row.file)!==row.file
        ||name!==row.file+'.meta.json'||!new RegExp(`^${settings.environment}-\\d{4}-\\d{2}-\\d{2}T[\\dTZ-]+-[a-f\\d]{8}\\.sqlite\\.partial$`).test(row.file))continue;
      const file=join(settings.directory,row.file);
      if(resolve(file)!==join(resolve(settings.directory),row.file))continue;
      if(existsSync(file)&&(!lstatSync(file).isFile()||lstatSync(file).isSymbolicLink()))continue;
      // A killed SQLite writer can leave journals beside its owned candidate.
      for(const candidate of [file,file+'-journal',file+'-wal',file+'-shm']){
        if(!existsSync(candidate))continue;
        const info=lstatSync(candidate);if(info.isFile()&&!info.isSymbolicLink())unlinkSync(candidate);
      }
      unlinkSync(marker);
    }catch{/* Preserve foreign or malformed files. */}
  }
}

async function readDocuments(store,tx,refs){
  const result=[];
  for(let start=0;start<refs.length;start+=pageSize){
    const chunk=refs.slice(start,start+pageSize);store.quota.reserve({reads:6*chunk.length});
    const documents=await tx.getAll(...chunk);
    for(const doc of documents)store.quota.observe(Buffer.byteLength(JSON.stringify(doc.data()||null)));
    result.push(...documents);
  }
  return result;
}
async function readWallets(store,tx){
  const wallets=[];let cursor;
  for(;;){
    let query=store.root.collection('wallets').orderBy(FieldPath.documentId()).limit(pageSize);
    if(cursor)query=query.startAfter(cursor);
    store.quota.reserve({reads:6*pageSize});const page=await tx.get(query);
    for(const doc of page.docs){
      store.quota.observe(Buffer.byteLength(JSON.stringify(doc.data())));
      const wallet=unpack(doc);
      if(!/^\d{17,20}$/.test(wallet.guild)||!/^\d{17,20}$/.test(wallet.user)||doc.id!==wallet.guild+'_'+wallet.user)throw fail('BACKUP_WALLET_INVALID');
      wallets.push(wallet);
    }
    if(page.size<pageSize)break;cursor=page.docs.at(-1).id;
  }
  return wallets;
}
function operationKey(entry,document){
  if(isOpeningKind(entry.kind))return null;
  const linked=document.get('operationKey');
  if(entry.kind==='reset'){
    if(linked===null)return null;
    if(linked!==`reset:${entry.reference}`)throw fail('BACKUP_OPERATION_LINK_MISMATCH');
    return linked;
  }
  // Pre-upgrade spins and claims have recoverable keys. Administrative IDs require
  // a verified migration baseline or the new ledger link; never drop deduplication.
  if(entry.kind==='spin'||entry.kind==='checkin'){
    const expected=entry.kind==='spin'?`spin:${entry.user}:${entry.reference}`:`daily:${entry.user}:${entry.day}`;
    if(linked&&linked!==expected)throw fail('BACKUP_OPERATION_LINK_MISMATCH');
    return expected;
  }
  if(typeof linked==='string'&&/^admin:[a-zA-Z0-9:_-]{1,128}$/.test(linked))return linked;
  throw fail('BACKUP_OPERATION_LINK_MISSING');
}

async function readHighlights(store,tx,db){
  // Delivery state changes without a ledger revision. Read both collections in
  // the SAME snapshot as wallets, including statuses and the known message ID.
  db.exec('DELETE FROM highlight_events; DELETE FROM highlight_boards;');
  for(const collection of ['highlightEvents','highlightBoards']){
    let cursor;
    for(;;){
      let query=store.root.collection(collection).orderBy(FieldPath.documentId()).limit(pageSize);
      if(cursor)query=query.startAfter(cursor);
      store.quota.reserve({reads:6*pageSize});const page=await tx.get(query);
      for(const doc of page.docs){
        const data=unpack(doc);store.quota.observe(Buffer.byteLength(JSON.stringify(data)));
        if(collection==='highlightEvents'){
          assertHighlightEvent(data);if(doc.id!==data.guild+'_'+data.round_id)throw fail('BACKUP_HIGHLIGHT_INVALID');
          db.prepare('INSERT INTO highlight_events VALUES(?,?,?,?,?,?,?)').run(...['guild','round_id','name','tier','multiplier','occurred','status'].map(key=>data[key]));
        }else{
          const row=highlightBoardRecord(data);assertHighlightBoard(row);if(doc.id!==row.guild)throw fail('BACKUP_HIGHLIGHT_INVALID');
          db.prepare('INSERT INTO highlight_boards VALUES(?,?,?,?,?,?)').run(...['guild','message_id','started','total','entries','next_attempt'].map(key=>row[key]));
        }
      }
      if(page.size<pageSize)break;cursor=page.docs.at(-1).id;
    }
  }
}

export async function createFirestoreSnapshot(store,settings,{now=Date.now(),previous=null,freeBytes=diskSpace,beforePublish=()=>{}}={}){
  const file=`${settings.environment}-${new Date(now).toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}.sqlite`;
  const target=join(settings.directory,file),partial=target+'.partial',marker=partial+'.meta.json';
  let db,created=false,published=false,markerCreated=false;
  try{
    if(freeBytes(settings.directory)<settings.minFreeBytes)throw fail('DISK_SPACE_LOW');
    writeFileSync(marker,JSON.stringify({sourceId:settings.sourceId,environment:settings.environment,file:basename(partial)})+'\n',{flag:'wx',mode:0o600});
    markerCreated=true;
    const source=previous?.path||settings.baseline;
    if(source){
      if(previous&&(!owned(settings,previous)||checksum(source)!==previous.sha256))throw fail('BACKUP_CHECKSUM_FAILED');
      if(!inspectWalletDatabase(source,settings.environment).ok)throw fail('BACKUP_BASELINE_INVALID');
      if(usedBytes(settings)+statSync(source).size>settings.backupMaxBytes)throw fail('BACKUP_BUDGET_EXCEEDED');
      copyWalletDatabase({source,target:partial,environment:settings.environment});created=true;
      db=new DatabaseSync(partial);
    }else{closeSync(openSync(partial,'wx',0o600));created=true;db=openWalletDatabase(partial,settings.environment);}
    db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON');
    const cursor=db.prepare('SELECT COALESCE(MAX(id),0) revision FROM ledger').get().revision;
    const baselinePlan=source&&!previous?firestoreImportPlan(source,settings.environment,{version:store.schemaVersion}):null;
    let remoteWallets,meta;
    // A read-only Firestore transaction provides a coherent snapshot without locking
    // gameplay or performing remote writes. The SDK does not retry read-only callbacks.
    await store.db.runTransaction(async tx=>{
      meta=await store.read(store.meta,tx);store.checkMeta(meta);
      if(meta.nextId<cursor)throw fail('BACKUP_SOURCE_CHANGED');
      if(previous&&(meta.importFingerprint??null)!==previous.upstreamImportFingerprint)throw fail('BACKUP_SOURCE_CHANGED');
      if(baselinePlan&&meta.importFingerprint!==baselinePlan.fingerprint)throw fail('BACKUP_BASELINE_MISMATCH');
      const delta=meta.nextId-cursor,quota=store.quota.status();
      const estimate=6*(3*delta+pageSize);
      if(quota.used.reads+estimate>quota.limits.reads||quota.maintenance.used.reads+estimate>quota.maintenance.limits.reads)throw fail('FIRESTORE_MAINTENANCE_BUDGET');
      const insertEntry=db.prepare('INSERT INTO ledger(id,guild,user,kind,delta,before,after,actor,reason,time,day,reference) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
      const operationKeys=new Map();
      for(let start=cursor+1;start<=meta.nextId;start+=pageSize){
        const ids=Array.from({length:Math.min(pageSize,meta.nextId-start+1)},(_,i)=>start+i);
        const docs=await readDocuments(store,tx,ids.map(id=>store.root.collection('ledger').doc(String(id))));
        docs.forEach((doc,i)=>{
          const entry=unpack(doc);if(!entry||entry.id!==ids[i])throw fail('BACKUP_LEDGER_GAP');
          insertEntry.run(...['id','guild','user','kind','delta','before','after','actor','reason','time','day','reference'].map(key=>entry[key]));
          const key=operationKey(entry,doc);if(key)operationKeys.set(digest(entry.guild+'\0'+key),{guild:entry.guild,key});
        });
      }
      const operations=[...operationKeys],opDocs=await readDocuments(store,tx,operations.map(([id])=>store.root.collection('operations').doc(id)));
      const rounds=[];
      opDocs.forEach((doc,i)=>{
        const data=unpack(doc),{guild,key}=operations[i][1];
        if(!data||typeof data.fingerprint!=='string'||!data.result)throw fail('BACKUP_OPERATION_MISSING');
        db.prepare('INSERT INTO operations(guild,key,fingerprint,result) VALUES(?,?,?,?)').run(guild,key,data.fingerprint,JSON.stringify(data.result));
        if(key.startsWith('spin:')){
          const round=data.result.round,user=key.split(':')[1];if(!round?.id)throw fail('BACKUP_ROUND_MISSING');
          rounds.push({guild,user,round});
        }
      });
      const roundDocs=await readDocuments(store,tx,rounds.map(({guild,user,round})=>store.walletRef(guild,user).collection('rounds').doc(round.id)));
      rounds.forEach(({guild,user,round},i)=>{
        if(!isDeepStrictEqual(unpack(roundDocs[i]),round))throw fail('BACKUP_ROUND_MISMATCH');
        db.prepare('INSERT INTO rounds(guild,user,id,data,created) VALUES(?,?,?,?,?)').run(guild,user,round.id,JSON.stringify(round),Date.parse(round.time));
      });
      remoteWallets=await readWallets(store,tx);
      const seen=new Set(remoteWallets.map(wallet=>wallet.guild+'_'+wallet.user));
      for(const row of db.prepare('SELECT guild,user FROM wallets').all())if(!seen.has(row.guild+'_'+row.user))throw fail('BACKUP_WALLET_MISSING');
      const update=db.prepare('INSERT INTO wallets(guild,user,balance,milestone,last_spin) VALUES(?,?,?,?,?) ON CONFLICT(guild,user) DO UPDATE SET balance=excluded.balance,milestone=excluded.milestone,last_spin=excluded.last_spin');
      for(const wallet of remoteWallets)update.run(wallet.guild,wallet.user,wallet.balance,Number(wallet.milestone),wallet.last_spin);
      if(meta.highlights===1)await readHighlights(store,tx,db);
      else if(db.prepare('SELECT count(*) count FROM highlight_events').get().count||db.prepare('SELECT count(*) count FROM highlight_boards').get().count)
        throw fail('BACKUP_SOURCE_CHANGED');
    },{readOnly:true});
    db.exec('COMMIT');db.close();db=null;
    const audit=inspectWalletDatabase(partial,settings.environment);if(!audit.ok)throw fail('BACKUP_AUDIT_FAILED');
    const plan=firestoreImportPlan(partial,settings.environment,{version:store.schemaVersion});
    for(const wallet of remoteWallets){
      const expected=plan.resources.find(row=>row.path===`wallets/${wallet.guild}_${wallet.user}`)?.data;
      if(!isDeepStrictEqual(expected,wallet))throw fail('BACKUP_WALLET_MISMATCH');
    }
    if(usedBytes(settings)>settings.backupMaxBytes||freeBytes(settings.directory)<settings.minFreeBytes)throw fail('BACKUP_BUDGET_EXCEEDED');
    const record={format:1,backend:'firestore',sourceId:settings.sourceId,environment:settings.environment,
      projectId:settings.firestore.projectId,namespace:settings.firestore.namespace,file,createdAt:now,
      revision:meta.nextId,upstreamImportFingerprint:meta.importFingerprint??null,sha256:checksum(partial),
      fingerprint:plan.fingerprint,counts:audit.counts};
    beforePublish(record);
    renameSync(partial,target);published=true;
    writeFileSync(target+'.meta.json',JSON.stringify(record)+'\n',{flag:'wx',mode:0o600});unlinkSync(marker);
    return {...record,path:target,metadata:target+'.meta.json'};
  }catch(error){
    if(db){try{db.exec('ROLLBACK');}catch{}db.close();}
    for(const path of [created?(published?target:partial):null,...(created?[partial+'-journal',partial+'-wal',partial+'-shm']:[]),published?target+'.meta.json':null,markerCreated?marker:null]){
      if(path)try{if(lstatSync(path).isFile()&&!lstatSync(path).isSymbolicLink())unlinkSync(path);}catch{}
    }
    throw error;
  }
}

export async function performFirestoreMaintenance(settings,{now=Date.now(),freeBytes=diskSpace,forceBackup=false,createSnapshot=createFirestoreSnapshot,store:providedStore}={}){
  const result={checkedAt:new Date(now).toISOString(),backend:'firestore',audit:null,backup:null,alerts:[],disks:[]};
  mkdirSync(join(settings.directory,'operations'),{recursive:true,mode:0o700});
  let lock,store=providedStore;
  try{
    lock=new DatabaseSync(settings.lockFile);lock.exec('PRAGMA busy_timeout=0; CREATE TABLE IF NOT EXISTS mutex(id INTEGER PRIMARY KEY); BEGIN IMMEDIATE');
    removeOwnPartial(settings);
    for(const [name,path] of [['quota',settings.firestore.quota.filename],['backup',settings.directory]]){
      try{const available=freeBytes(path);result.disks.push({name,freeBytes:available,ok:available>=settings.minFreeBytes});if(available<settings.minFreeBytes)result.alerts.push('DISK_SPACE_LOW');}
      catch{result.alerts.push('DISK_CHECK_FAILED');}
    }
    let last=null;
    for(const row of automaticSnapshots(settings)){
      if(!owned(settings,row)||row.createdAt>now)continue;
      if(checksum(row.path)===row.sha256){last=row;break;}result.alerts.push('BACKUP_CHECKSUM_FAILED');
    }
    if(!store)store=new FirestoreWalletStore(settings.firestore,{guildIds:['100000000000000001'],quota:new MaintenanceQuota(settings)});
    const usage=store.quota.status();
    result.quota=usage;
    if(Object.keys(usage.limits).some(key=>usage.used[key]>=usage.limits[key]*.8))result.alerts.push('FIRESTORE_QUOTA_HIGH');
    try{
      store.checkMeta(await store.read(store.meta));result.audit={ok:true,scope:'remote-metadata'};
    }catch(error){
      if(error.code==='FIRESTORE_MAINTENANCE_BUDGET')result.audit={ok:true,scope:'local-only',remoteVerified:false};
      else result.audit={ok:false,scope:'remote-metadata'};
      result.alerts.push(error.code==='FIRESTORE_MAINTENANCE_BUDGET'?error.code:error.code==='FIRESTORE_BUDGET'?'FIRESTORE_QUOTA_EXHAUSTED':'DATABASE_UNAVAILABLE');
    }
    const due=forceBackup||!last||now-last.createdAt>=settings.backupIntervalMs;
    if(due&&result.audit?.scope==='remote-metadata'&&result.audit.ok&&!result.alerts.some(code=>code.startsWith('DISK_'))){
      try{
        last=await createSnapshot(store,settings,{now,previous:last,freeBytes});
        result.backup={created:true,verified:true,file:last.file,lastSuccessAt:new Date(last.createdAt).toISOString(),ageMs:0};
        try{result.backup.pruned=pruneSnapshots(settings,last,now);}catch{result.alerts.push('BACKUP_RETENTION_FAILED');}
      }catch(error){
        const known=['FIRESTORE_BUDGET','FIRESTORE_MAINTENANCE_BUDGET','BACKUP_BUDGET_EXCEEDED','DISK_SPACE_LOW','BACKUP_BASELINE_MISMATCH','BACKUP_SOURCE_CHANGED','BACKUP_OPERATION_LINK_MISSING'];
        result.alerts.push(known.includes(error.code)?error.code:'BACKUP_FAILED');
      }
    }
    if(last&&!result.backup)result.backup={created:false,verified:true,file:last.file,lastSuccessAt:new Date(last.createdAt).toISOString(),ageMs:now-last.createdAt};
    if(!last)result.alerts.push('BACKUP_MISSING');else if(now-last.createdAt>settings.backupIntervalMs*2)result.alerts.push('BACKUP_STALE');
    result.backupStorage={usedBytes:usedBytes(settings),limitBytes:settings.backupMaxBytes};
    result.snapshotCount=automaticSnapshots(settings).filter(row=>owned(settings,row)).length;
    result.quota=store.quota.status();
    if(result.quota.blocked)result.alerts.push('FIRESTORE_QUOTA_EXHAUSTED');
    else if(Object.keys(result.quota.limits).some(key=>result.quota.used[key]>=result.quota.limits[key]*.8))result.alerts.push('FIRESTORE_QUOTA_HIGH');
  }catch(error){result.audit={ok:false};result.alerts.push(error.code?.includes('BUSY')||/database is locked/i.test(error.message)?'MAINTENANCE_BUSY':'MAINTENANCE_FAILED');}
  finally{
    if(!providedStore)await store?.close();
    if(lock){try{lock.exec('ROLLBACK');}catch{}lock.close();}
  }
  result.alerts=[...new Set(result.alerts)].sort();return result;
}
