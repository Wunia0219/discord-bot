// Human-facing series are independent of the immutable ledger cursor. They live
// in existing receipts and indexes, so assigning a code adds no document write.
export function nextRecordCode(meta,kind){
  const series=kind==='spin'?'P':['grant','reversal'].includes(kind)?'R':null;
  if(!series)return undefined;
  const counters=meta.recordCounters ||= {},value=(counters[series]??0)+1;
  if(!Number.isSafeInteger(value)||value<1)throw new Error('Record counter exhausted');
  counters[series]=value;return series+String(value).padStart(6,'0');
}
export function validRecordCode(code,series){
  if(typeof code!=='string'||!new RegExp('^'+(series||'[PR]')+'[0-9]{6,16}$').test(code))return false;
  const value=Number(code.slice(1));return Number.isSafeInteger(value)&&value>0&&code===code[0]+String(value).padStart(6,'0');
}
export function receiptCode(result){return result?.recordCode??result?.round?.recordCode;}
export const recordLabel=record=>record.recordCode||'#'+record.id;
