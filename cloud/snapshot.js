import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {validRound} from '../server/database-audit.js';
import {assertHighlightEvent,assertHighlightBoard} from '../server/firestore-highlight-data.js';
import {highlightEvent} from '../server/firestore-highlight-data.js';

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
      if(o.key.startsWith('daily:'))requireValue(o.key===`daily:${e.user}:${e.day}`&&e.kind==='checkin'&&e.actor===e.user&&e.delta>0&&o.fingerprint==='daily','Checkin mismatch');
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

// Independently decryptable chunks; no key is included in the downloadable archive.
export class SnapshotVault {
  constructor(storage,state,sealer){Object.assign(this,{storage,state,sealer});this.sql=storage.sql;this.sql.exec('CREATE TABLE IF NOT EXISTS backup_chunks(generation TEXT,part INTEGER,payload TEXT,PRIMARY KEY(generation,part))');}
  save(generation,snapshot){
    const text=JSON.stringify(snapshot);if(Buffer.byteLength(text)>8*1024**2)throw new Error('Cloud backup size limit; retain old snapshots');
    const parts=[];for(let i=0;i<text.length;i+=100000)parts.push(this.sealer.seal(text.slice(i,i+100000),`backup:${generation}:${parts.length}`));
    const manifest={format:1,generation,parts:parts.length,sha256:digest(text),environment:snapshot.environment,revision:snapshot.revision,createdAt:Date.now()};
    this.storage.transactionSync(()=>{this.sql.exec('DELETE FROM backup_chunks WHERE generation=?',generation);for(let i=0;i<parts.length;i++)this.sql.exec('INSERT INTO backup_chunks VALUES(?,?,?)',generation,i,parts[i]);this.state.set('backup:'+generation,manifest);});return manifest;
  }
  load(generation){const a=this.archive(generation),text=a.chunks.map((v,i)=>this.sealer.open(v,`backup:${generation}:${i}`)).join('');if(digest(text)!==a.manifest.sha256)throw new Error('Backup checksum');return JSON.parse(text);}
  archive(generation){const manifest=this.state.get('backup:'+generation);if(!manifest)throw new Error('Backup unavailable');const rows=[...this.sql.exec('SELECT part,payload FROM backup_chunks WHERE generation=? ORDER BY part',generation)];if(rows.length!==manifest.parts||rows.some((r,i)=>r.part!==i))throw new Error('Backup incomplete');return {manifest,chunks:rows.map(r=>r.payload)};}
  discard(generation){if((this.state.get('backup-retained')||[]).includes(generation))throw new Error('Cannot discard verified backup');this.storage.transactionSync(()=>{this.sql.exec('DELETE FROM backup_chunks WHERE generation=?',generation);this.sql.exec('DELETE FROM cloud_state WHERE key=?','backup:'+generation);});}
  publish(generation){this.state.set('backup-latest',generation);const old=this.state.get('backup-retained')||[];const retained=[generation,...old.filter(g=>g!==generation)];this.state.set('backup-retained',retained.slice(0,3));for(const g of retained.slice(3)){this.sql.exec('DELETE FROM backup_chunks WHERE generation=?',g);this.sql.exec('DELETE FROM cloud_state WHERE key=?','backup:'+g);}}
}
