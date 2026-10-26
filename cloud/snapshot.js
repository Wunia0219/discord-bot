import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {validRound} from '../server/database-audit.js';
import {assertHighlightEvent,assertHighlightBoard} from '../server/firestore-highlight-data.js';
import {highlightEvent} from '../server/firestore-highlight-data.js';
import {auditRows} from './snapshot-audit.js';
import {previousDay,validCheckinTransition} from '../server/weekly-checkin.js';

export const TABLES=['settings','wallets','ledger','operations','rounds','highlight_events','highlight_boards'];
export const digest=value=>createHash('sha256').update(value).digest('hex');
const requireValue=(condition,message)=>{if(!condition)throw new Error(message);};
const snowflake=s=>typeof s==='string'&&/^\d{17,20}$/.test(s);
const amount=n=>Number.isSafeInteger(n)&&n>=0&&n<=1e12;
const unique=(rows,key)=>{const m=new Map();for(const row of rows){const k=key(row);requireValue(!m.has(k),'Duplicate snapshot row');m.set(k,row);}return m;};
export function auditSnapshot(snapshot,environment){
  requireValue(snapshot?.format===1&&snapshot.environment===environment,'Snapshot environment');
  for(const t of TABLES)requireValue(Array.isArray(snapshot.tables?.[t]),'Incomplete snapshot');
  const t=snapshot.tables;requireValue(t.settings.length===1&&t.settings[0].key==='environment'&&t.settings[0].value===environment,'Snapshot settings');
  const spinLinks=new Set(),reversals=new Set();
  const wallets=unique(t.wallets,w=>w.guild+'_'+w.user),entries=unique(t.ledger,e=>e.id),ops=unique(t.operations,o=>o.guild+'\0'+o.key),rounds=unique(t.rounds,r=>r.guild+'_'+r.user+'_'+r.id),balances=new Map(),usedOps=new Set(),usedRounds=new Set();
  let revision=0;
  for(const e of [...t.ledger].sort((a,b)=>a.id-b.id)){
    const owner=e.guild+'_'+e.user;requireValue(e.id===++revision&&wallets.has(owner)&&amount(e.before)&&amount(e.after)&&Number.isSafeInteger(e.delta)&&e.after===e.before+e.delta&&e.before===(balances.get(owner)||0),'Ledger continuity');
    const time=Date.parse(e.time);requireValue(Number.isFinite(time)&&e.day===new Date(time+28800000).toISOString().slice(0,10),'Ledger date');balances.set(owner,e.after);
  }
  for(const [owner,w] of wallets){requireValue(snowflake(w.guild)&&snowflake(w.user)&&amount(w.balance)&&w.balance===(balances.get(owner)||0)&&[0,1].includes(w.milestone)&&Number.isSafeInteger(w.last_spin),'Wallet balance');}
  for(const o of t.operations){
    requireValue(typeof o.fingerprint==='string'&&typeof o.result==='string','Operation format');const r=JSON.parse(o.result),spin=/^spin:(\d{17,20}):([-a-zA-Z0-9]{16,80})$/.exec(o.key),key=o.guild+'\0'+o.key;
    if(spin){const row=rounds.get(o.guild+'_'+spin[1]+'_'+r.round?.id);requireValue(row&&validRound(row,r.round)&&isDeepStrictEqual(JSON.parse(row.data),r.round)&&o.fingerprint===String(r.round.bet),'Original round mismatch');requireValue(!usedRounds.has(row),'Duplicate round result');usedRounds.add(row);}
    else{const e=entries.get(r.entry?.id);requireValue(e&&e.guild===o.guild&&['id','before','after','delta'].every(k=>r.entry[k]===e[k]),'Original entry mismatch');
      if(o.key.startsWith('daily:')){
        const day=previousDay(e.day),prior=ops.get(o.guild+'\0'+`daily:${e.user}:${day}`);
        requireValue(o.key===`daily:${e.user}:${e.day}`&&e.kind==='checkin'&&e.actor===e.user&&e.delta>0&&o.fingerprint==='daily'
          &&validCheckinTransition(r,prior?{...JSON.parse(prior.result),day}:null,e.day),'Checkin mismatch');
      }
      else if(e.kind==='grant')requireValue(o.key.startsWith('admin:')&&e.delta>0&&isDeepStrictEqual(JSON.parse(o.fingerprint),[e.actor,e.user,e.delta,e.reason]),'Grant mismatch');
      else if(e.kind==='reversal'){const original=entries.get(Number(e.reference));requireValue(o.key.startsWith('admin:')&&original?.kind==='grant'&&original.guild===e.guild&&original.user===e.user&&e.delta===-original.delta&&isDeepStrictEqual(JSON.parse(o.fingerprint),[e.actor,Number(e.reference),e.reason]),'Reversal mismatch');}
      else requireValue(e.kind==='test_fixture'&&Number(o.fingerprint)===e.after,'Fixture mismatch');
      requireValue(!usedOps.has(e.id),'Duplicate entry result');usedOps.add(e.id);
    }
    requireValue(ops.has(key),'Operation missing');
  }
  for(const e of t.ledger){
    if(e.kind==='spin'){const link=e.guild+'_'+e.user+'_'+e.reference;requireValue(!spinLinks.has(link),'Duplicate spin ledger');spinLinks.add(link);const r=JSON.parse(ops.get(e.guild+'\0'+`spin:${e.user}:${e.reference}`)?.result||'null')?.round;requireValue(r&&e.actor===e.user&&r.before===e.before&&r.after===e.after&&r.net===e.delta&&Math.abs(Date.parse(r.time)-Date.parse(e.time))<=1000,'Spin link mismatch');}
    else if(e.kind!=='test_seed')requireValue(usedOps.has(e.id),'Missing retry result');
    if(e.kind==='reversal'){const link=e.guild+'_'+e.reference;requireValue(!reversals.has(link),'Duplicate reversal');reversals.add(link);}
  }
  requireValue(usedRounds.size===rounds.size&&t.ledger.filter(e=>e.kind==='spin').length===rounds.size,'Round coverage');
  unique(t.highlight_events,e=>e.guild+'_'+e.round_id);unique(t.highlight_boards,b=>b.guild);
  for(const e of t.highlight_events){assertHighlightEvent(e);const rows=t.rounds.filter(r=>r.guild===e.guild&&r.id===e.round_id);const expected=rows.length===1?highlightEvent(e.guild,e.name,JSON.parse(rows[0].data),e.occurred):null;requireValue(expected&&expected.tier===e.tier&&expected.multiplier===e.multiplier&&expected.occurred===e.occurred,'Highlight round mismatch');}
  for(const b of t.highlight_boards)assertHighlightBoard(b);
  requireValue(snapshot.revision===revision,'Snapshot revision');return {revision,counts:Object.fromEntries(TABLES.map(t=>[t,snapshot.tables[t].length]))};
}

export const BACKUP_LIMIT_BYTES=128*1024**2;
export const BACKUP_MAX_PARTS=8192;
export const manifestDigest=m=>digest(JSON.stringify({header:m.header,segments:m.segments}));
export function openSegment(manifest,index,payload,sealer){
  const p=manifest.segments[index];
  if(!p||!TABLES.includes(p.table)||!/^[a-f0-9]{64}$/.test(p.id))throw new Error('Invalid backup segment');
  const text=sealer.open(payload,'backup-segment:'+p.id);
  if(typeof text!=='string'||Buffer.byteLength(text)!==p.bytes||digest(text)!==p.id)throw new Error('Backup segment checksum');
  const rows=JSON.parse(text);if(!Array.isArray(rows)||rows.length!==p.rows)throw new Error('Backup segment rows');return rows;
}
export function checkManifest(m,sealer){
  if(m?.format!==2||!Array.isArray(m.segments)||m.segments.length>BACKUP_MAX_PARTS||m.parts!==m.segments.length||m.sha256!==manifestDigest(m)||m.bytes!==m.segments.reduce((n,p)=>n+p.bytes,0)||m.bytes>BACKUP_LIMIT_BYTES||m.environment!==m.header?.environment||m.revision!==m.header?.revision||m.authentication!==sealer.authenticate({header:m.header,segments:m.segments},'backup-manifest:'+m.generation))throw new Error('Invalid segmented backup manifest');
}

export class SnapshotVault {
  constructor(storage,state,sealer){
    Object.assign(this,{storage,state,sealer});this.sql=storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS backup_chunks(generation TEXT,part INTEGER,payload TEXT,PRIMARY KEY(generation,part))');
    this.sql.exec('CREATE TABLE IF NOT EXISTS backup_segments(id TEXT PRIMARY KEY,payload TEXT NOT NULL)');
  }
  manifest(generation){const m=this.state.get('backup:'+generation);if(!m)throw new Error('Backup unavailable');if(m.format===2)checkManifest(m,this.sealer);return m;}
  commit(generation,header,segments){
    const bytes=segments.reduce((n,p)=>n+p.bytes,0);
    if(bytes>BACKUP_LIMIT_BYTES||segments.length>BACKUP_MAX_PARTS)throw new Error('Backup capacity limit; retain verified generations');
    const m={format:2,generation,header,segments,parts:segments.length,bytes,limitBytes:BACKUP_LIMIT_BYTES,environment:header.environment,revision:header.revision,createdAt:Date.now()};m.sha256=manifestDigest(m);m.authentication=this.sealer.authenticate({header,segments},'backup-manifest:'+generation);this.state.set('backup:'+generation,m);return m;
  }
  segments(tables){
    const parts=[];
    for(const table of TABLES){
      let batch=[],bytes=2;
      const flush=()=>{if(!batch.length)return;const text=JSON.stringify(batch),id=digest(text);if(![...this.sql.exec('SELECT id FROM backup_segments WHERE id=?',id)].length)this.sql.exec('INSERT INTO backup_segments VALUES(?,?)',id,this.sealer.seal(text,'backup-segment:'+id));parts.push({table,id,bytes:Buffer.byteLength(text),rows:batch.length});batch=[];bytes=2;};
      for(const row of tables[table]||[]){const n=Buffer.byteLength(JSON.stringify(row))+1;if(n>512*1024)throw new Error('Backup row size limit');if(bytes+n>64000)flush();batch.push(row);bytes+=n;}flush();
    }
    return parts;
  }
  save(generation,snapshot){
    const {tables,...header}=snapshot;
    return this.storage.transactionSync(()=>this.commit(generation,header,this.segments({...tables,ledger:[...tables.ledger].sort((a,b)=>a.id-b.id)})));
  }
  fork(generation,source){
    let m=this.manifest(source);
    if(m.format===1){const s=this.load(source);s.tables.wallets=[];s.tables.highlight_events=[];s.tables.highlight_boards=[];return this.save(generation,s);}
    return this.commit(generation,m.header,m.segments.filter(p=>!['wallets','highlight_events','highlight_boards'].includes(p.table)));
  }
  append(generation,tables,header={}){const m=this.manifest(generation);if(m.format!==2)throw new Error('Segmented checkpoint required');return this.storage.transactionSync(()=>this.commit(generation,{...m.header,...header},[...m.segments,...this.segments(tables)]));}
  part(generation,index,m=this.manifest(generation)){
    if(!Number.isSafeInteger(index)||index<0||index>=m.parts)throw new Error('Invalid backup part');
    const row=m.format===1?[...this.sql.exec('SELECT payload FROM backup_chunks WHERE generation=? AND part=?',generation,index)][0]:[...this.sql.exec('SELECT payload FROM backup_segments WHERE id=?',m.segments[index].id)][0];
    if(!row)throw new Error('Backup incomplete');return row.payload;
  }
  *rows(generation,table){const m=this.manifest(generation);if(m.format!==2)throw new Error('Legacy backup requires conversion');for(let i=0;i<m.parts;i++)if(m.segments[i].table===table)yield*openSegment(m,i,this.part(generation,i,m),this.sealer);}
  load(generation){
    const m=this.manifest(generation);
    if(m.format===2)return {...m.header,tables:Object.fromEntries(TABLES.map(t=>[t,[...this.rows(generation,t)]]))};
    const text=Array.from({length:m.parts},(_,i)=>this.sealer.open(this.part(generation,i,m),`backup:${generation}:${i}`)).join('');if(digest(text)!==m.sha256)throw new Error('Backup checksum');return JSON.parse(text);
  }
  audit(generation){
    const m=this.manifest(generation);if(m.format===1)return auditSnapshot(this.load(generation),m.environment);
    // Transient indexes hold segment locations, not full historical rows. Auditing
    // must not rewrite the whole history into paid/metered Durable Object SQL.
    const locations=new WeakMap(),cache=new Map();
    const segment=index=>{
      if(!cache.has(index)){if(cache.size>=8)cache.delete(cache.keys().next().value);cache.set(index,openSegment(m,index,this.part(generation,index,m),this.sealer));}
      return cache.get(index);
    };
    const rows=function*(table){for(let i=0;i<m.parts;i++)if(m.segments[i].table===table){const batch=segment(i);for(let j=0;j<batch.length;j++){locations.set(batch[j],[i,j]);yield batch[j];}}};
    const factory=()=>{const values=new Map();return {
      get(key){const item=values.get(key);return item?.pointer?segment(item.pointer[0])[item.pointer[1]]:item?.value;},
      has:key=>values.has(key),set(key,value){const pointer=typeof value==='object'&&value?locations.get(value):null;values.set(key,pointer?{pointer}:{value});},get size(){return values.size;}
    };};
    return auditRows(m.header,rows,m.environment,factory);
  }
  archive(generation){const manifest=this.manifest(generation);return {manifest,chunks:Array.from({length:manifest.parts},(_,i)=>this.part(generation,i,manifest))};}
  discard(generation){if((this.state.get('backup-retained')||[]).includes(generation))throw new Error('Cannot discard verified backup');this.storage.transactionSync(()=>{this.sql.exec('DELETE FROM backup_chunks WHERE generation=?',generation);this.sql.exec('DELETE FROM cloud_state WHERE key=?','backup:'+generation);this.collect();});}
  collect(){
    const keep=new Set();for(const r of this.sql.exec("SELECT value FROM cloud_state WHERE key LIKE 'backup:%'")){const m=JSON.parse(r.value);for(const p of m.segments||[])keep.add(p.id);}
    for(const r of this.sql.exec('SELECT id FROM backup_segments'))if(!keep.has(r.id))this.sql.exec('DELETE FROM backup_segments WHERE id=?',r.id);
  }
  publish(generation){
    this.manifest(generation);
    this.storage.transactionSync(()=>{const old=this.state.get('backup-retained')||[],retained=[generation,...old.filter(g=>g!==generation)];this.state.set('backup-latest',generation);this.state.set('backup-retained',retained.slice(0,3));for(const g of retained.slice(3)){this.sql.exec('DELETE FROM backup_chunks WHERE generation=?',g);this.sql.exec('DELETE FROM cloud_state WHERE key=?','backup:'+g);}this.collect();});
  }
}
