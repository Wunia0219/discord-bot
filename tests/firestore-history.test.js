import test from 'node:test';
import assert from 'node:assert/strict';
import {readAuditPage} from '../server/firestore-history.js';

const days=Array.from({length:30},(_,i)=>`2026-09-${String(30-i).padStart(2,'0')}`);
function fixture(entries,category='game'){
  const calls=[];
  const query=async(name,before,limit)=>{
    const selected=entries.filter(row=>row.id<before&&(name==='ledger'||name===`entries-${category}`||name===`entries-${category}-${row.day}`))
      .sort((a,b)=>b.id-a.id).slice(0,limit);
    calls.push({name,before,limit,charged:Math.max(1,selected.length)});return selected;
  };
  return {calls,query,category};
}

test('active 30-day audit reads one 11-row page instead of 30 pages',async()=>{
  const entries=days.flatMap((day,index)=>Array.from({length:20},(_,i)=>({day,id:(30-index)*20+i+1})));
  const h=fixture(entries),rows=await readAuditPage({...h,days,before:Number.MAX_SAFE_INTEGER});
  assert.deepEqual(rows,entries.toSorted((a,b)=>b.id-a.id).slice(0,11));
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].charged,11);
  assert.equal(h.calls.reduce((sum,row)=>sum+row.limit*6,0),66); // Previously 1,980 reserved / 330 documents.
});

test('sparse and empty accounts finish in one query without missing-day reads',async()=>{
  for(const entries of [[],[{id:2,day:days[3]},{id:1,day:'2025-01-01'}]]){
    const h=fixture(entries),rows=await readAuditPage({...h,days,before:Number.MAX_SAFE_INTEGER});
    assert.deepEqual(rows,entries.filter(row=>days.includes(row.day)));assert.equal(h.calls.length,1);
  }
});

test('fallback preserves all pages with interleaved dates, clock rollback and out-of-range rows',async()=>{
  // New IDs deliberately include old and future dates, so stopping at the
  // first old date (or concatenating daily pages) would silently lose records.
  const entries=Array.from({length:210},(_,i)=>({id:i+1,day:i%4===0?'2025-01-01':i%5===0?'2027-01-01':days[(i*17)%30]}));
  for(const category of ['game','all','rewards','checkin']){
    const h=fixture(entries,category),actual=[];let before=Number.MAX_SAFE_INTEGER;
    for(;;){
      const start=h.calls.length,rows=await readAuditPage({...h,days,before});
      assert.ok(h.calls.slice(start).reduce((sum,row)=>sum+row.limit,0)<=51);
      actual.push(...rows.slice(0,10));if(rows.length<11)break;before=rows[9].id;
    }
    assert.deepEqual(actual,entries.filter(row=>days.includes(row.day)).toSorted((a,b)=>b.id-a.id));
    assert.equal(new Set(actual.map(row=>row.id)).size,actual.length);
  }
});

test('unrestricted and one-day pages retain one bounded query and exclusive cursors',async()=>{
  const entries=Array.from({length:40},(_,i)=>({id:i+1,day:days[i%2]}));
  for(const selected of [[],[days[0]]]){
    const h=fixture(entries),rows=await readAuditPage({...h,days:selected,before:30});
    assert.deepEqual(rows,entries.filter(row=>row.id<30&&(!selected.length||selected.includes(row.day))).toSorted((a,b)=>b.id-a.id).slice(0,11));
    assert.equal(h.calls.length,1);
  }
});

test('fallback fails as a whole if one daily index cannot be read',async()=>{
  const h=fixture(Array.from({length:20},(_,i)=>({id:i+1,day:'2025-01-01'})));
  await assert.rejects(readAuditPage({...h,days,before:100,query:(...args)=>{
    if(args[0].endsWith(days[2]))throw new Error('budget exhausted');return h.query(...args);
  }}),/budget exhausted/);
  assert.ok(h.calls.length<=6);
});
