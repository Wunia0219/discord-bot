import {isDeepStrictEqual} from 'node:util';
import {BETS,MODEL_VERSION,LEGACY_MODELS,gridFromStops,evaluateGrid} from '../src/game/index.js';
import {previousDay,validCheckinTransition} from './weekly-checkin.js';
import {validResetOperation} from './wallet-admin.js';
import {validWelcomeEntry} from './wallet-opening.js';

const MAX_BALANCE=1_000_000_000_000;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const balance=value=>Number.isSafeInteger(value)&&value>=0&&value<=MAX_BALANCE;
const parse=text=>{try{return JSON.parse(text);}catch{return null;}};
const currentMath={gridFromStops,evaluateGrid};
const operationKinds=new Set(['spin','checkin','grant','reversal','test_fixture','reset']);
// Older writes sampled the clock separately for ledger, JSON and sort time.
// Keep a bounded 1-second compatibility allowance without rewriting old rows.
const sameSettlementTime=(left,right)=>Number.isFinite(left)&&Number.isFinite(right)&&Math.abs(left-right)<=1000;

// Stream the audit, retaining unsafe SQLite integers as BigInt so they are
// rejected instead of rounding them or aborting the entire diagnostic report.
function reader(db,sql){
  const query=db.prepare(sql);query.setReadBigInts(true);
  const normalize=row=>row&&Object.fromEntries(Object.entries(row).map(([key,value])=>[
    key,typeof value==='bigint'&&Number.isSafeInteger(Number(value))?Number(value):value,
  ]));
  return {get:(...args)=>normalize(query.get(...args)),
    *iterate(){for(const row of query.iterate())yield normalize(row);}};
}

export function validRound(row,round){
  if(!object(round)||round.id!==row.id||!BETS.includes(round.bet)
    ||!balance(round.before)||round.before<round.bet||!balance(round.after)
    ||!Number.isSafeInteger(round.payout)||round.payout<0
    ||round.net!==round.payout-round.bet||round.after!==round.before+round.net
    ||typeof round.time!=='string'||!Number.isFinite(Date.parse(round.time))||typeof round.rules!=='string'
    ||!Number.isSafeInteger(row.created)||row.created<0
    ||!sameSettlementTime(Date.parse(round.time),row.created))return false;
  const math=round.rules===MODEL_VERSION?currentMath:LEGACY_MODELS[round.rules];
  if(!math)return false;
  try{
    const grid=math.gridFromStops(round.stops),expected=math.evaluateGrid(grid,round.bet);
    return isDeepStrictEqual(round.grid,grid)&&isDeepStrictEqual(round.symbols,grid.map(col=>col[1]))
      &&['payout','wins','lineBet','unitBet'].every(key=>isDeepStrictEqual(round[key],expected[key]));
  }catch{return false;}
}

function sameEntry(entry,cached){
  return object(cached)&&entry&&['id','before','after','delta'].every(key=>
    Number.isSafeInteger(cached[key])&&entry[key]===cached[key]);
}

// Used only by maintenance audits, inside the caller's consistent read snapshot.
// Historical rules are replayed for comparison; no settlement is ever rewritten.
export function inspectSettlements(db){
  const errors=new Map(),add=name=>errors.set(name,(errors.get(name)??0)+1);
  const roundById=reader(db,'SELECT * FROM rounds WHERE guild=? AND user=? AND id=?');
  const operationByKey=reader(db,'SELECT * FROM operations WHERE guild=? AND key=?');
  const entryById=reader(db,'SELECT * FROM ledger WHERE id=?');
  let rounds=0,spinOperations=0,entryOperations=0,spinEntries=0,otherEntries=0;

  for(const row of reader(db,'SELECT * FROM rounds').iterate()){
    rounds++;
    if(!validRound(row,parse(row.data)))add('Round settlement errors');
  }

  for(const row of reader(db,'SELECT * FROM operations').iterate()){
    const result=parse(row.result);
    if(!object(result)){add('Operation result errors');continue;}
    if(row.key.startsWith('reset:')){
      if(!validResetOperation(row,result,id=>entryById.get(id)))add('Reset operation errors');
      entryOperations+=Array.isArray(result.entries)?result.entries.length:0;continue;
    }
    const spin=/^spin:(\d{17,20}):([-a-zA-Z0-9]{16,80})$/.exec(row.key);
    if(spin){
      spinOperations++;
      const round=result.round;
      const canonical=object(round)&&typeof round.id==='string'?roundById.get(row.guild,spin[1],round.id):null;
      if(!canonical||row.fingerprint!==String(round.bet)||!isDeepStrictEqual(round,parse(canonical.data)))add('Operation result errors');
      continue;
    }
    entryOperations++;
    const cached=result.entry,entry=object(cached)&&Number.isSafeInteger(cached.id)?entryById.get(cached.id):null;
    if(!sameEntry(entry,cached)||entry.guild!==row.guild){add('Operation result errors');continue;}
    const daily=/^daily:(\d{17,20}):(\d{4}-\d{2}-\d{2})$/.exec(row.key);
    const admin=/^admin:([-a-zA-Z0-9]{16,80})$/.test(row.key);
    const local=/^local-fixture:[a-z0-9-]+$/.test(row.key);
    let valid=false;
    if(daily){
      const day=previousDay(entry.day),prior=parse(operationByKey.get(row.guild,`daily:${entry.user}:${day}`)?.result);
      valid=entry.kind==='checkin'&&entry.user===daily[1]&&entry.day===daily[2]
        &&entry.actor===entry.user&&entry.delta>0&&row.fingerprint==='daily'
        &&validCheckinTransition(result,prior?{...prior,day}:null,entry.day);
    }
    else if(admin){
      const fingerprint=parse(row.fingerprint);
      if(Array.isArray(fingerprint)){
        if(entry.kind==='grant')valid=isDeepStrictEqual(fingerprint,[entry.actor,entry.user,entry.delta,entry.reason])&&entry.delta>0;
        else if(entry.kind==='reversal')valid=isDeepStrictEqual(fingerprint,[entry.actor,Number(entry.reference),entry.reason])&&entry.delta<0;
      }
    }else if(local)valid=entry.kind==='test_fixture'&&/^(0|[1-9]\d*)$/.test(row.fingerprint)
      &&balance(Number(row.fingerprint))&&entry.after===Number(row.fingerprint);
    if(!valid)add('Operation result errors');
  }

  const seenOwners=new Set();
  for(const entry of reader(db,'SELECT * FROM ledger ORDER BY id').iterate()){
    const owner=entry.guild+'_'+entry.user;
    if(entry.kind==='welcome'&&(!validWelcomeEntry(entry)||seenOwners.has(owner)))add('Invalid welcome credit');
    seenOwners.add(owner);
    if(!balance(entry.before)||!balance(entry.after)||!Number.isSafeInteger(entry.delta)
      ||entry.after!==entry.before+entry.delta)add('Invalid ledger amounts');
    const time=typeof entry.time==='string'?Date.parse(entry.time):NaN,day=new Date(time+8*3600000);
    if(!Number.isFinite(day.getTime())||entry.day!==day.toISOString().slice(0,10))add('Ledger date errors');
    if(entry.kind==='spin'){
      spinEntries++;
      const op=operationByKey.get(entry.guild,`spin:${entry.user}:${entry.reference}`),round=parse(op?.result)?.round;
      if(!object(round)||entry.actor!==entry.user||round.before!==entry.before||round.after!==entry.after||round.net!==entry.delta)add('Spin ledger errors');
      else {
        const canonical=roundById.get(entry.guild,entry.user,round.id);
        if(!sameSettlementTime(time,Date.parse(round.time))||!sameSettlementTime(time,canonical?.created))add('Spin ledger time errors');
      }
    }else if(operationKinds.has(entry.kind)){
      otherEntries++;
      if(entry.kind==='checkin'){
        const op=operationByKey.get(entry.guild,`daily:${entry.user}:${entry.day}`);
        if(parse(op?.result)?.entry?.id!==entry.id)add('Ledger operation errors');
      }
      if(entry.kind==='reset'){
        const result=parse(operationByKey.get(entry.guild,'reset:'+entry.reference)?.result);
        if(!Array.isArray(result?.entries)||!result.entries.some(e=>e?.id===entry.id&&e.user===entry.user))add('Reset ledger operation errors');
      }
      if(entry.kind==='reversal'){
        const original=/^[1-9]\d*$/.test(entry.reference??'')?entryById.get(entry.reference):null;
        if(!original||original.guild!==entry.guild||original.user!==entry.user||original.kind!=='grant'||entry.delta!==-original.delta)add('Ledger reversal errors');
      }
    }else if(entry.kind!=='test_seed'&&entry.kind!=='welcome')add('Unsupported ledger kinds');
  }

  // Unique links plus matching totals ensure no round or recorded action is
  // left without its retry record, including zero-net (break-even) spins.
  if(rounds!==spinOperations)add('Spin operation coverage errors');
  if(spinEntries!==spinOperations)add('Spin ledger coverage errors');
  if(otherEntries!==entryOperations)add('Ledger operation coverage errors');
  const duplicateSpinEntries=db.prepare(`SELECT COUNT(*) count FROM (
    SELECT guild,user,reference FROM ledger WHERE kind='spin'
    GROUP BY guild,user,reference HAVING COUNT(*)>1
  )`).get().count;
  if(duplicateSpinEntries)errors.set('Spin ledger duplicate links',duplicateSpinEntries);
  const safe="CASE WHEN json_valid(result) THEN result ELSE '{}' END";
  const duplicateSpins=db.prepare(`SELECT COUNT(*) count FROM (
    SELECT guild,substr(key,6,instr(substr(key,6),':')-1),json_extract(${safe},'$.round.id')
    FROM operations WHERE key LIKE 'spin:%' AND json_type(${safe},'$.round.id')='text'
    GROUP BY guild,substr(key,6,instr(substr(key,6),':')-1),json_extract(${safe},'$.round.id') HAVING COUNT(*)>1
  )`).get().count;
  if(duplicateSpins)errors.set('Spin operation duplicate links',duplicateSpins);
  const duplicateEntries=db.prepare(`SELECT COUNT(*) count FROM (
    SELECT guild,json_extract(${safe},'$.entry.id') FROM operations
    WHERE json_type(${safe},'$.entry.id')='integer'
    GROUP BY guild,json_extract(${safe},'$.entry.id') HAVING COUNT(*)>1
  )`).get().count;
  if(duplicateEntries)errors.set('Ledger operation duplicate links',duplicateEntries);
  return [...errors].map(([name,count])=>`${name}: ${count}`);
}
