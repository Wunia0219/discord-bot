import {highlightTier,HIGHLIGHT_MAX_AGE_MS} from './highlight-card.js';

export const highlightEventPath=event=>`highlightEvents/${event.guild}_${event.round_id}`;
export const highlightEventIndex=event=>({queueKey:`${event.guild}:${event.status}:${String(event.occurred).padStart(16,'0')}:${event.round_id}`});
export function highlightEvent(guild,name,round,now){
  const tier=highlightTier(round.payout,round.bet),occurred=Date.parse(round.time);
  if(!tier||!Number.isSafeInteger(round.payout)||!Number.isSafeInteger(round.bet)||!Number.isFinite(occurred)
    ||occurred>now||now-occurred>HIGHLIGHT_MAX_AGE_MS)return null;
  return {guild,round_id:round.id,name:String(name||'玩家').slice(0,160),tier,multiplier:round.payout/round.bet,occurred,status:'pending'};
}
// Delivery leases are transient. The durable sending status and board ID are
// enough to recover PATCH safely and quarantine an uncertain POST after restore.
export function highlightBoardRecord(board){
  return Object.fromEntries(['guild','message_id','started','total','entries','next_attempt'].map(key=>[key,board[key]]));
}
const snowflake=value=>/^\d{17,20}$/.test(value||'');
const item=row=>!!row&&typeof row.name==='string'&&row.name.length<=160&&['super','mega'].includes(row.tier)
  &&Number.isFinite(row.multiplier)&&row.multiplier>=30&&(row.tier==='mega')===(row.multiplier>=100);
export function assertHighlightEvent(row){
  if(!row||!snowflake(row.guild)||typeof row.round_id!=='string'||!/^[-\w:]{1,128}$/.test(row.round_id)||!item(row)
    ||!Number.isSafeInteger(row.occurred)||row.occurred<0||!['pending','sending','sent','uncertain','expired'].includes(row.status))
    throw new Error('Invalid highlight event');
}
export function assertHighlightBoard(row){
  if(!row)throw new Error('Invalid highlight board');
  let entries;try{entries=JSON.parse(row.entries);}catch{}
  if(!snowflake(row.guild)||(row.message_id!==null&&!snowflake(row.message_id))
    ||!Number.isSafeInteger(row.total)||row.total<0
    // Legacy SQLite Retry-After values may contain fractional milliseconds.
    ||![row.started,row.next_attempt].every(value=>Number.isFinite(value)&&value>=0&&value<=Number.MAX_SAFE_INTEGER)
    ||!Array.isArray(entries)||entries.length>5||!entries.every(item))throw new Error('Invalid highlight board');
}
