import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {encodeHistory,decodeHistory,ledgerIndex,ledgerRange,sequenceKey} from '../server/firestore-schema.js';

test('recent cache compression preserves exact JSON data including legacy fields and non-ASCII text',()=>{
  const rows=Array.from({length:105},(_,i)=>({sequence:200-i,round:{id:String(i),rules:'legacy-v1',
    custom:{label:'未改寫的歷史 🎪',unknown:[null,false,123]},wins:[{payout:123,rows:[0,1,2]}]}}));
  const encoded=encodeHistory(rows);assert.deepEqual(decodeHistory(encoded),rows.slice(0,100));
  assert.ok(Buffer.byteLength(encoded)<Buffer.byteLength(JSON.stringify(rows.slice(0,100)))*.3);
  assert.equal(encoded,encodeHistory(rows));assert.deepEqual(decodeHistory(encodeHistory([])),[]);
});

test('invalid compressed caches fail closed with a bounded decompressed size',()=>{
  for(const value of [null,'garbage','deflate-v1:broken',encodeHistory([{sequence:1,round:{id:'a'}},{sequence:2,round:{id:'b'}}])])
    assert.throws(()=>decodeHistory(value));
  const bomb='deflate-v1:'+deflateRawSync(' '.repeat(2*1024*1024+1)).toString('base64');
  assert.throws(()=>decodeHistory(bomb));
});

test('single-field range keys preserve numeric order and isolate owner, category and day',()=>{
  const entry={guild:'100000000000000001',user:'100000000000000002',kind:'grant',day:'2026-10-23',id:9};
  for(const filter of [{},{category:'rewards'},{day:entry.day},{day:entry.day,category:'rewards'}]){
    const {field,prefix}=ledgerRange(entry.guild,entry.user,filter),keys=ledgerIndex(entry);
    assert.equal(keys[field],prefix+sequenceKey(9));assert.ok(keys[field]<ledgerIndex({...entry,id:10})[field]);
    assert.ok(keys[field]>=prefix+sequenceKey(0)&&keys[field]<prefix+sequenceKey(10));
    assert.notEqual(keys[field],ledgerIndex({...entry,user:'100000000000000003'})[field]);
  }
});
