import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {auditSnapshot} from './snapshot.js';
import {taipeiDay} from '../server/wallet-common.js';
const requireMatch=(a,b)=>{if(!isDeepStrictEqual(a,b))throw new Error('Cloud acceptance mismatch');};
// Private, paused acceptance only. Never permit a verification to settle a new
// operation, even if an original retry record is unexpectedly missing.
export async function verifyCloudSnapshot(snapshot,store){
  if(store.db.readOnly!==true)throw new Error('Read-only verification transport required');
  store.write=()=>{throw new Error('Verification cannot write');};
  const audit=auditSnapshot(snapshot,store.environment),before=store.quota.status().used.writes;
  const meta=await store.read(store.meta);store.checkMeta(meta);requireMatch(meta.nextId,snapshot.revision);
  let retries=0,originalResults=0;
  for(const w of snapshot.tables.wallets){
    const rows=snapshot.tables.ledger.filter(e=>e.guild===w.guild&&e.user===w.user),rounds=snapshot.tables.rounds.filter(r=>r.guild===w.guild&&r.user===w.user).map(r=>JSON.parse(r.data));
    const state=await store.state(w.guild,w.user);requireMatch(state.balance,w.balance);
    requireMatch(state.claimed,snapshot.tables.operations.some(o=>o.guild===w.guild&&o.key===`daily:${w.user}:${taipeiDay(Date.now())}`));
    const summary={checkin:{days:0,total:0},game:{rounds:rounds.length,bet:0,payout:0,net:0}};
    for(const e of rows)if(e.kind==='checkin'){summary.checkin.days++;summary.checkin.total+=e.delta;}
    for(const r of rounds)for(const k of ['bet','payout','net'])summary.game[k]+=r[k];
    requireMatch(await store.auditSummary(w.guild,w.user),summary);
    requireMatch(await store.history(w.guild,w.user),rows.toSorted((a,b)=>b.id-a.id).slice(0,50));
    const page=await store.rounds(w.guild,w.user,{limit:5});
    for(const row of page.rows)requireMatch(row.round,rounds.find(r=>r.id===row.round.id));
    for(const op of snapshot.tables.operations.filter(o=>o.guild===w.guild&&o.key.startsWith(`daily:${w.user}:`))){
      const expected=JSON.parse(op.result),entry=rows.find(e=>e.id===expected.entry.id);
      store.clock=()=>Date.parse(entry.time);const result=await store.checkin(w.guild,w.user,{compact:true});requireMatch(result.duplicate,true);requireMatch(result.entry,expected.entry);retries++;
    }
    store.clock=Date.now;
    const op=snapshot.tables.operations.findLast(o=>o.guild===w.guild&&o.key.startsWith(`spin:${w.user}:`));
    if(op){const r=await store.spin(w.guild,w.user,Number(op.fingerprint),op.key.slice(`spin:${w.user}:`.length),{compact:true});requireMatch(r.duplicate,true);requireMatch(r.round,JSON.parse(op.result).round);retries++;}
  }
  for(const o of snapshot.tables.operations.filter(o=>!o.key.startsWith('spin:'))){
    const id=createHash('sha256').update(o.guild+'\0'+o.key).digest('hex'),actual=await store.read(store.root.collection('operations').doc(id));
    requireMatch(actual,{fingerprint:o.fingerprint,result:JSON.parse(o.result)});originalResults++;
  }
  requireMatch((await store.read(store.meta)).nextId,snapshot.revision);
  requireMatch(store.quota.status().used.writes,before);
  return {verified:true,readOnly:true,fullSnapshot:audit,remoteWallets:snapshot.tables.wallets.length,originalNonSpinResults:originalResults,replayedRequests:retries,remoteHistory:'latest 50 ledger and 5 rounds per wallet; full archived tables audited'};
}
