import {deflateRawSync,inflateRawSync} from 'node:zlib';

export const entryCategory=kind=>({grant:'rewards',reversal:'rewards',reset:'rewards',checkin:'checkin',spin:'game'}[kind]||'other');
export const sequenceKey=id=>String(id).padStart(16,'0');
const maxHistoryBytes=2*1024*1024;
export function encodeHistory(records){
  const json=JSON.stringify(records.slice(0,100));
  if(Buffer.byteLength(json)>maxHistoryBytes)throw new Error('History cache exceeds decoded size limit');
  return 'deflate-v1:'+deflateRawSync(json).toString('base64');
}
export function decodeHistory(value){
  if(typeof value!=='string'||!value.startsWith('deflate-v1:'))throw new Error('Invalid history cache codec');
  const rows=JSON.parse(inflateRawSync(Buffer.from(value.slice(11),'base64'),{maxOutputLength:maxHistoryBytes}).toString('utf8'));
  if(!Array.isArray(rows)||rows.length>100||rows.some((r,i)=>!Number.isSafeInteger(r.sequence)||r.sequence<1||!r.round?.id||(i&&rows[i-1].sequence<=r.sequence)))
    throw new Error('Invalid history cache');
  return rows;
}

// Four scalar indexes on ONE authoritative document. Each query has only one
// range/order field, uses the default single-field index, and isolates the owner.
export function ledgerIndex(entry){
  const owner=`${entry.guild}_${entry.user}:`,cat=entryCategory(entry.kind),id=sequenceKey(entry.id);
  return {ownerKey:owner+id,categoryKey:owner+cat+':'+id,
    dayKey:owner+entry.day+':'+id,categoryDayKey:owner+cat+':'+entry.day+':'+id};
}
export function ledgerRange(guild,user,{category='all',day}={}){
  const owner=`${guild}_${user}:`;
  return day?category==='all'?{field:'dayKey',prefix:owner+day+':'}:
    {field:'categoryDayKey',prefix:owner+category+':'+day+':'}:
    category==='all'?{field:'ownerKey',prefix:owner}:{field:'categoryKey',prefix:owner+category+':'};
}
