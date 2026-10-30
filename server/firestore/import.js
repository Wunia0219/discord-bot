import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {inspectWalletDatabase} from '../sqlite/database.js';
import {taipeiDay} from '../wallet/wallet.js';
import {ledgerIndex,encodeHistory} from './schema.js';
import {resetMarker,resetEntryIds,resetIndex} from '../wallet/wallet-admin.js';
import {highlightEventPath,highlightEventIndex,assertHighlightEvent,assertHighlightBoard,highlightEvent} from './highlight-data.js';

const digest=value=>createHash('sha256').update(value).digest('hex');
const blank=()=>({checkin:{days:0,total:0},game:{rounds:0,bet:0,payout:0,net:0}});
const category=kind=>({grant:'rewards',reversal:'rewards',reset:'rewards',checkin:'checkin',spin:'game'}[kind]||'other');

// Read an audited SQLite snapshot; the source is never modified or reopened writable.
export function firestoreImportPlan(filename,environment,{version=1}={}){
  if(![1,2].includes(version))throw new Error('Invalid import schema version');
  const audit=inspectWalletDatabase(filename,environment);
  if(!audit.ok)throw new Error('Source database failed verification');
  const db=new DatabaseSync(filename,{readOnly:true}),documents=new Map(),wallets=new Map(),days=new Map(),adminDays=new Map();let nextId=0;
  const put=(path,data,index={})=>{if(documents.has(path))throw new Error('Duplicate import target');documents.set(path,{path,data,index});};
  try{
    db.exec('BEGIN');
    const operationLinks=new Map(),spinRequests=new Map(),roundSequences=new Map(),resetLinks=new Map(),lastRounds=new Map();
    for(const row of db.prepare('SELECT * FROM operations').iterate()){
      const result=JSON.parse(row.result);
      if(row.key.startsWith('reset:'))resetLinks.set(resetEntryIds(result)[0],row.key);
      if(result.entry)operationLinks.set(result.entry.id,row.key);
      if(result.round)spinRequests.set(row.guild+'\0'+row.key,result.round.id);
    }
    for(const row of db.prepare('SELECT * FROM wallets ORDER BY guild,user').iterate()){
      const base=`wallets/${row.guild}_${row.user}`;
      wallets.set(base,{...row,claimedDay:null,revision:0,history:[],summary:blank(),milestone:!!row.milestone});
    }
    for(const entry of db.prepare('SELECT * FROM ledger ORDER BY id').iterate()){
      nextId=Math.max(nextId,entry.id);const base=`wallets/${entry.guild}_${entry.user}`,wallet=wallets.get(base),id=String(entry.id).padStart(16,'0'),cat=category(entry.kind);
      wallet.revision=entry.id;
      if(version===1){
        for(const name of ['ledger',`entries-${cat}`,`entries-${cat}-${entry.day}`,`entries-all-${entry.day}`])put(`${base}/${name}/${id}`,entry,{id:entry.id});
        put(`ledger/${entry.id}`,entry,entry.kind==='reset'?{operationKey:resetLinks.get(entry.id)||null}:{});
      }else{
        const key=entry.kind==='spin'?`spin:${entry.user}:${entry.reference}`:
          entry.kind==='checkin'?`daily:${entry.user}:${entry.day}`:entry.kind==='reset'?resetLinks.get(entry.id)||null:operationLinks.get(entry.id)||null;
        put(`ledger/${entry.id}`,entry,{...ledgerIndex(entry),operationKey:key});
        if(entry.kind==='spin'){
          const roundId=spinRequests.get(entry.guild+'\0'+key);
          if(!roundId)throw new Error('Source spin operation is missing');
          roundSequences.set(base+'/'+roundId,entry.id);wallet.historyRevision=entry.id;
        }
      }
      if(entry.kind==='checkin'){
        wallet.claimedDay=entry.day;wallet.summary.checkin.days++;wallet.summary.checkin.total+=entry.delta;
        const key=base+'/days/'+entry.day,summary=days.get(key)||blank();summary.checkin.days++;summary.checkin.total+=entry.delta;days.set(key,summary);
      }
      if(entry.kind==='spin')lastRounds.set(base,spinRequests.get(entry.guild+'\0'+`spin:${entry.user}:${entry.reference}`));
      if(entry.kind==='reset')wallet.balanceReset=resetMarker(entry,lastRounds.get(base)||null);
      if(entry.kind==='reversal')put(`reversals/${entry.reference}`,{entryId:entry.id});
      if(entry.kind==='grant'){
        const key=`adminDays/${entry.guild}_${entry.actor}_${entry.day}`;adminDays.set(key,{used:(adminDays.get(key)?.used||0)+entry.delta});
      }
    }
    for(const row of db.prepare('SELECT * FROM rounds ORDER BY created DESC,rowid DESC').iterate()){
      const round=JSON.parse(row.data),base=`wallets/${row.guild}_${row.user}`,wallet=wallets.get(base);
      if(version===1){if(wallet.history.length<100)wallet.history.push(round);}
      else{
        wallet.history.push({sequence:roundSequences.get(base+'/'+round.id),round});
        wallet.history.sort((a,b)=>b.sequence-a.sequence);wallet.history.length=Math.min(wallet.history.length,100);
      }
      put(`${base}/rounds/${round.id}`,round,version===2?{sequence:roundSequences.get(base+'/'+round.id)}:{});
      const day=taipeiDay(row.created),key=base+'/days/'+day,summary=days.get(key)||blank();
      for(const target of [summary,wallet.summary]){target.game.rounds++;target.game.bet+=round.bet;target.game.payout+=round.payout;target.game.net=target.game.payout-target.game.bet;}
      days.set(key,summary);
    }
    for(const row of db.prepare('SELECT * FROM operations ORDER BY guild,key').iterate()){
      const result=JSON.parse(row.result),claim=/^daily:(\d{17,20}):(\d{4}-\d{2}-\d{2})$/.exec(row.key);
      if(claim){const wallet=wallets.get(`wallets/${row.guild}_${claim[1]}`);if(wallet.claimedDay===claim[2]&&result.checkin)wallet.checkin=result.checkin;}
      put(`operations/${digest(row.guild+'\0'+row.key)}`,{fingerprint:row.fingerprint,result},row.key.startsWith('reset:')?resetIndex(row.guild,result):{});
    }
    if(audit.counts.highlight_events)for(const row of db.prepare('SELECT * FROM highlight_events ORDER BY guild,round_id').iterate()){
      assertHighlightEvent(row);
      const rounds=db.prepare('SELECT data,user FROM rounds WHERE guild=? AND id=?').all(row.guild,row.round_id);
      const expected=rounds.length===1?highlightEvent(row.guild,row.name,JSON.parse(rounds[0].data),row.occurred):null;
      if(!expected||expected.tier!==row.tier||expected.multiplier!==row.multiplier||expected.occurred!==row.occurred)throw new Error('Highlight does not match original round');
      put(highlightEventPath(row),{...row},highlightEventIndex(row,rounds[0].user));
    }
    if(audit.counts.highlight_boards)for(const row of db.prepare('SELECT * FROM highlight_boards ORDER BY guild').iterate()){
      assertHighlightBoard(row);put(`highlightBoards/${row.guild}`,{...row});
    }
    if(version===2)for(const wallet of wallets.values()){
      wallet.historyCache=encodeHistory(wallet.history);delete wallet.history;wallet.historyRevision ||= 0;
    }
    for(const [path,data] of [...wallets,...days,...adminDays])put(path,data);
  }finally{db.exec('ROLLBACK');db.close();}
  const resources=[...documents.values()].sort((a,b)=>a.path.localeCompare(b.path));
  const fingerprint=digest(JSON.stringify(resources));
  return {version,environment,audit,resources,fingerprint,nextId};
}

// Imports into an empty namespace only. Each chunk and its progress commit atomically.
// A partial import remains unavailable to players and resumes from that exact chunk.
export async function importFirestore(store,plan,{batchSize=50}={}){
  if(store.environment!==plan.environment)throw new Error('Import environment mismatch');
  if(store.schemaVersion!==(plan.version??1))throw new Error('Import schema version mismatch');
  if(!Number.isInteger(batchSize)||batchSize<1||batchSize>100)throw new Error('Invalid import batch size');
  let meta=await store.read(store.meta);
  const checkTarget=current=>{
    if(current&&(current.version!==store.schemaVersion||current.environment!==store.environment))
      throw new Error('Import target schema version or environment mismatch; use a new empty namespace');
  };
  checkTarget(meta);
  if(meta?.importFingerprint===plan.fingerprint&&meta.status==='ready')return {alreadyImported:true,documents:plan.resources.length,fingerprint:plan.fingerprint};
  if(meta&&!(meta.status==='importing'&&meta.importFingerprint===plan.fingerprint)&&!(meta.status==='ready'&&meta.nextId===0))throw new Error('Firestore namespace is not empty; no existing wallets overwritten');
  const used=store.quota.status(),remaining=plan.resources.length-(meta?.importDone||0);
  const storage=plan.resources.map(record=>{
    const bytes=Buffer.byteLength(JSON.stringify({json:JSON.stringify(record.data),...record.index}));
    if(bytes>512*1024)throw new Error('Source contains an oversized Firestore document');
    return {key:digest(store.settings.projectId+':'+store.root.path+'/'+record.path),bytes:bytes*4+512};
  });
  // Refuse before starting if this complete import plus its full verification cannot fit.
  if(used.used.writes+2*(remaining+Math.ceil(remaining/batchSize)+2)>used.limits.writes
    ||used.used.reads+6*(plan.resources.length+Math.ceil(remaining/batchSize)+10)>used.limits.reads
    ||used.used.storageBytes+store.quota.estimateGrowth(storage)+65536>used.limits.storageBytes)throw new Error('Insufficient application allowance for complete import and verification');
  await store.db.runTransaction(async tx=>{
    const current=await store.read(store.meta,tx);
    checkTarget(current);
    if(current&&!(current.status==='importing'&&current.importFingerprint===plan.fingerprint)&&!(current.status==='ready'&&current.nextId===0))throw new Error('Import target changed');
    if(!current||current.status==='ready'){
      store.quota.reserve({reads:6});
      if(!(await tx.get(store.root.collection('wallets').limit(1))).empty)throw new Error('Firestore namespace is not empty; no existing wallets overwritten');
    }
    store.write(tx,store.meta,{version:store.schemaVersion,environment:plan.environment,status:'importing',nextId:plan.nextId,
      ...(plan.audit.counts.highlight_events||plan.audit.counts.highlight_boards?{highlights:1}:{}),
      importFingerprint:plan.fingerprint,importDone:current?.importDone||0,importTotal:plan.resources.length});
  },{maxAttempts:3});
  store.ready=false;
  for(;;){
    const complete=await store.db.runTransaction(async tx=>{
      const current=await store.read(store.meta,tx);
      checkTarget(current);
      if(current.status!=='importing'||current.importFingerprint!==plan.fingerprint)throw new Error('Import state changed');
      const start=current.importDone,chunk=plan.resources.slice(start,start+batchSize);
      if(!chunk.length)return true;
      for(const record of chunk)store.write(tx,store.db.doc(store.root.path+'/'+record.path),record.data,{create:true,index:record.index});
      store.write(tx,store.meta,{...current,importDone:start+chunk.length});return false;
    },{maxAttempts:3});
    if(complete)break;
  }
  for(let start=0;start<plan.resources.length;start+=batchSize){
    const chunk=plan.resources.slice(start,start+batchSize);store.quota.reserve({reads:6*chunk.length});
    const snapshots=await store.db.getAll(...chunk.map(record=>store.db.doc(store.root.path+'/'+record.path)));
    for(let i=0;i<chunk.length;i++){
      if(!snapshots[i].exists||snapshots[i].get('json')!==JSON.stringify(chunk[i].data)
        ||Object.entries(chunk[i].index).some(([key,value])=>snapshots[i].get(key)!==value))throw new Error('Imported Firestore document failed content verification');
      store.quota.observe(Buffer.byteLength(snapshots[i].get('json')));
    }
  }
  await store.db.runTransaction(async tx=>{
    const current=await store.read(store.meta,tx);
    checkTarget(current);
    if(current.status!=='importing'||current.importFingerprint!==plan.fingerprint||current.importDone!==plan.resources.length)throw new Error('Import verification state changed');
    store.write(tx,store.meta,{...current,status:'ready'});
  },{maxAttempts:3});
  store.cache.clear();store.ready=true;store.readyAt=store.clock();
  return {documents:plan.resources.length,fingerprint:plan.fingerprint,verified:true};
}
