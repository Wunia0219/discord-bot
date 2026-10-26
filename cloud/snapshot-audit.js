import {isDeepStrictEqual} from 'node:util';
import {validRound} from '../server/database-audit.js';
import {assertHighlightEvent,assertHighlightBoard,highlightEvent} from '../server/firestore-highlight-data.js';
import {previousDay,validCheckinTransition} from '../server/weekly-checkin.js';

// Same relationships as auditSnapshot, with bounded row iteration and segment-location
// indexes. No array containing the complete history is constructed in the Worker.
export function auditRows(header,rows,environment,map){
  const check=(value,message)=>{if(!value)throw new Error(message);};
  const amount=n=>Number.isSafeInteger(n)&&n>=0&&n<=1e12;
  const unique=(index,key,row)=>{check(!index.has(key),'Duplicate snapshot row');index.set(key,row);};
  check(header.format===1&&header.environment===environment,'Snapshot environment');
  const settings=[...rows('settings')];check(settings.length===1&&settings[0].key==='environment'&&settings[0].value===environment,'Snapshot settings');
  const wallets=map('wallets'),entries=map('entries'),ops=map('ops'),rounds=map('rounds'),balances=map('balances'),usedOps=map('usedOps'),usedRounds=map('usedRounds'),spinLinks=map('spinLinks'),reversals=map('reversals'),highlightRounds=map('highlightRounds');
  const counts={settings:1,wallets:0,ledger:0,operations:0,rounds:0,highlight_events:0,highlight_boards:0};
  for(const w of rows('wallets')){unique(wallets,w.guild+'_'+w.user,w);counts.wallets++;}
  let revision=0,spinCount=0;
  for(const e of rows('ledger')){
    const owner=e.guild+'_'+e.user;check(e.id===++revision&&wallets.has(owner)&&amount(e.before)&&amount(e.after)&&Number.isSafeInteger(e.delta)&&e.after===e.before+e.delta&&e.before===(balances.get(owner)||0),'Ledger continuity');
    const time=Date.parse(e.time);check(Number.isFinite(time)&&e.day===new Date(time+28800000).toISOString().slice(0,10),'Ledger date');balances.set(owner,e.after);unique(entries,e.id,e);counts.ledger++;
  }
  for(const w of rows('wallets'))check(/^\d{17,20}$/.test(w.guild)&&/^\d{17,20}$/.test(w.user)&&amount(w.balance)&&w.balance===(balances.get(w.guild+'_'+w.user)||0)&&[0,1].includes(w.milestone)&&Number.isSafeInteger(w.last_spin),'Wallet balance');
  for(const r of rows('rounds')){unique(rounds,r.guild+'_'+r.user+'_'+r.id,r);const key=r.guild+'_'+r.id;highlightRounds.set(key,highlightRounds.has(key)?null:r);counts.rounds++;}
  for(const o of rows('operations')){
    check(typeof o.fingerprint==='string'&&typeof o.result==='string','Operation format');unique(ops,o.guild+'\0'+o.key,o);counts.operations++;
    const r=JSON.parse(o.result),spin=/^spin:(\d{17,20}):([-a-zA-Z0-9]{16,80})$/.exec(o.key);
    if(spin){const key=o.guild+'_'+spin[1]+'_'+r.round?.id,row=rounds.get(key);check(row&&validRound(row,r.round)&&isDeepStrictEqual(JSON.parse(row.data),r.round)&&o.fingerprint===String(r.round.bet),'Original round mismatch');unique(usedRounds,key,true);}
    else{
      const e=entries.get(r.entry?.id);check(e&&e.guild===o.guild&&['id','before','after','delta'].every(k=>r.entry[k]===e[k]),'Original entry mismatch');
      if(o.key.startsWith('daily:'))check(o.key===`daily:${e.user}:${e.day}`&&e.kind==='checkin'&&e.actor===e.user&&e.delta>0&&o.fingerprint==='daily','Checkin mismatch');
      else if(e.kind==='grant')check(o.key.startsWith('admin:')&&e.delta>0&&isDeepStrictEqual(JSON.parse(o.fingerprint),[e.actor,e.user,e.delta,e.reason]),'Grant mismatch');
      else if(e.kind==='reversal'){const original=entries.get(Number(e.reference));check(o.key.startsWith('admin:')&&original?.kind==='grant'&&original.guild===e.guild&&original.user===e.user&&e.delta===-original.delta&&isDeepStrictEqual(JSON.parse(o.fingerprint),[e.actor,Number(e.reference),e.reason]),'Reversal mismatch');}
      else check(e.kind==='test_fixture'&&Number(o.fingerprint)===e.after,'Fixture mismatch');
      unique(usedOps,e.id,true);
    }
  }
  for(const e of rows('ledger')){
    if(e.kind==='checkin'){
      const day=previousDay(e.day),op=ops.get(e.guild+'\0'+`daily:${e.user}:${e.day}`),prior=ops.get(e.guild+'\0'+`daily:${e.user}:${day}`);
      check(op&&validCheckinTransition(JSON.parse(op.result),prior?{...JSON.parse(prior.result),day}:null,e.day),'Checkin mismatch');
    }
    if(e.kind==='spin'){unique(spinLinks,e.guild+'_'+e.user+'_'+e.reference,true);const r=JSON.parse(ops.get(e.guild+'\0'+`spin:${e.user}:${e.reference}`)?.result||'null')?.round;check(r&&e.actor===e.user&&r.before===e.before&&r.after===e.after&&r.net===e.delta&&Math.abs(Date.parse(r.time)-Date.parse(e.time))<=1000,'Spin link mismatch');spinCount++;}
    else if(e.kind!=='test_seed')check(usedOps.has(e.id),'Missing retry result');
    if(e.kind==='reversal')unique(reversals,e.guild+'_'+e.reference,true);
  }
  check(usedRounds.size===rounds.size&&spinCount===rounds.size,'Round coverage');
  const events=map('events'),boards=map('boards');
  for(const e of rows('highlight_events')){unique(events,e.guild+'_'+e.round_id,true);assertHighlightEvent(e);const row=highlightRounds.get(e.guild+'_'+e.round_id),expected=row?highlightEvent(e.guild,e.name,JSON.parse(row.data),e.occurred):null;check(expected&&expected.tier===e.tier&&expected.multiplier===e.multiplier&&expected.occurred===e.occurred,'Highlight round mismatch');counts.highlight_events++;}
  for(const b of rows('highlight_boards')){unique(boards,b.guild,true);assertHighlightBoard(b);counts.highlight_boards++;}
  check(header.revision===revision,'Snapshot revision');return {revision,counts};
}
