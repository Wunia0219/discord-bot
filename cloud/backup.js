import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {auditSnapshot,digest} from './snapshot.js';
import {highlightBoardRecord} from '../server/firestore-highlight-data.js';
import {FirestoreRest} from './firestore-rest.js';
const unpack=d=>{if(!d.exists)throw new Error('Backup document missing');return JSON.parse(d.get('json'));};
// Each step uses at most 20 new ledger entries and the SAME Firestore readTime.
// In-progress generations are never advertised as recoverable snapshots.
export class CloudBackup {
  constructor(store,state,vault){Object.assign(this,{store,state,vault});}
  // REST batchGet/query send exactly one request, without SDK/transaction retries.
  // Reserve BEFORE each attempt; a failed/uncertain attempt is never refunded.
  // A subsequent alarm reserves again. Unknown adapters retain the old margin.
  get readAttempts(){return this.store.db instanceof FirestoreRest?1:6;}
  async read(refs,readTime){this.store.quota.reserve({reads:this.readAttempts*refs.length});const docs=await this.store.db.batchGet(refs,readTime?{readTime}:{});this.store.quota.observe(Buffer.byteLength(JSON.stringify(docs.map(d=>d.data()))));return docs;}
  async start(){
    const latest=this.state.get('backup-latest');if(!latest)throw new Error('Verified backup baseline required');
    const doc=(await this.read([this.store.meta]))[0],meta=unpack(doc);this.store.checkMeta(meta);const snapshot=this.vault.load(latest);
    if(meta.nextId<snapshot.revision||snapshot.upstreamImportFingerprint!==(meta.importFingerprint??null))throw new Error('Backup source changed');
    const generation=randomUUID(),job={generation,readTime:doc.readTime,target:meta.nextId,cursor:snapshot.revision,phase:'ledger',startedAt:Date.now(),collection:0,cursorId:null,highlights:meta.highlights===1};
    if(!job.readTime)throw new Error('Missing consistent read time');
    snapshot.tables.wallets=[];snapshot.tables.highlight_events=[];snapshot.tables.highlight_boards=[];
    this.vault.storage.transactionSync(()=>{this.vault.save(generation,snapshot);this.state.set('backup-job',job);});return job;
  }
  async step(){
    const job=this.state.get('backup-job')||await this.start();if(Date.now()-job.startedAt>50*60000){this.vault.storage.transactionSync(()=>{this.vault.discard(job.generation);this.state.set('backup-job',null);});throw new Error('Backup snapshot expired; retry from last verified generation');}
    const snapshot=this.vault.load(job.generation),s=this.store,t=snapshot.tables;
    if(job.phase==='ledger'&&job.cursor<job.target){
      const ids=Array.from({length:Math.min(20,job.target-job.cursor)},(_,i)=>job.cursor+i+1),docs=await this.read(ids.map(id=>s.root.collection('ledger').doc(String(id))),job.readTime),links=[];
      docs.forEach((doc,i)=>{const e=unpack(doc);if(e.id!==ids[i])throw new Error('Ledger gap');t.ledger.push(e);if(e.kind==='test_seed')return;const key=doc.get('operationKey');if(typeof key!=='string')throw new Error('Missing original retry key');links.push({guild:e.guild,user:e.user,key});});
      const ops=await this.read(links.map(o=>s.root.collection('operations').doc(digest(o.guild+'\0'+o.key))),job.readTime),rounds=[];
      ops.forEach((doc,i)=>{const o=unpack(doc),link=links[i];t.operations.push({guild:link.guild,key:link.key,fingerprint:o.fingerprint,result:JSON.stringify(o.result)});if(link.key.startsWith('spin:'))rounds.push({...link,round:o.result.round});});
      const original=await this.read(rounds.map(r=>s.walletRef(r.guild,r.user).collection('rounds').doc(r.round.id)),job.readTime);
      original.forEach((doc,i)=>{const r=rounds[i];if(!isDeepStrictEqual(unpack(doc),r.round))throw new Error('Original round mismatch');t.rounds.push({guild:r.guild,user:r.user,id:r.round.id,data:JSON.stringify(r.round),created:Date.parse(r.round.time)});});job.cursor=ids.at(-1);
    }else{
      job.phase='collections';const collections=job.highlights?['wallets','highlightEvents','highlightBoards']:['wallets'];
      const name=collections[job.collection];let query=s.root.collection(name).orderBy('__name__').limit(20);if(job.cursorId)query=query.startAfter(job.cursorId);
      // __name__ ordering only: reserve the full 20-document page, even if empty.
      s.quota.reserve({reads:this.readAttempts*20});const page=await s.db.query(query,{readTime:job.readTime});s.quota.observe(Buffer.byteLength(JSON.stringify(page.docs.map(d=>d.data()))));
      for(const doc of page.docs){const row=unpack(doc);if(name==='wallets')t.wallets.push({guild:row.guild,user:row.user,balance:row.balance,milestone:Number(row.milestone),last_spin:row.last_spin});else if(name==='highlightEvents')t.highlight_events.push(row);else t.highlight_boards.push(highlightBoardRecord(row));}
      if(page.size===20)job.cursorId=page.docs.at(-1).id;else{job.collection++;job.cursorId=null;}
      if(job.collection===collections.length){snapshot.revision=job.target;snapshot.createdAt=Date.now();auditSnapshot(snapshot,s.environment);this.vault.save(job.generation,snapshot);this.vault.publish(job.generation);this.state.set('backup-job',null);this.state.set('backup-status',{ok:true,at:Date.now(),revision:snapshot.revision});return {complete:true};}
    }
    // Atomic checkpoint prevents a repeated alarm from duplicating immutable rows.
    this.vault.storage.transactionSync(()=>{this.vault.save(job.generation,snapshot);this.state.set('backup-job',job);});return {complete:false};
  }
}
