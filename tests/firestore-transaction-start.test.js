import test from 'node:test';
import assert from 'node:assert/strict';
import {FirestoreRest} from '../cloud/firestore-rest.js';

function transport(fetchImpl){return new FirestoreRest({projectId:'demo-jokers-circus',namespace:'transaction-test',emulator:'127.0.0.1:8787',fetchImpl});}
const path='circus_wallet_v1/transaction-test/meta/state';
const found=name=>({found:{name,fields:{json:{stringValue:'{}'}}}});

test('parallel document reads share the transaction opened by the first read',async()=>{
 const requests=[];const db=transport(async(url,options)=>{
  const body=JSON.parse(options.body);requests.push({url,body});
  if(url.endsWith(':batchGet'))return Response.json([...(body.newTransaction?[{transaction:'one-transaction'}]:[]),...body.documents.map(found)]);
  assert.ok(url.endsWith(':commit'));assert.equal(body.transaction,'one-transaction');return Response.json({});
 });
 await db.runTransaction(async tx=>{await Promise.all([tx.get(db.doc(path)),tx.get(db.doc(path))]);tx.set(db.doc(path),{json:'{}'});});
 assert.equal(requests.length,3);assert.deepEqual(requests[0].body.newTransaction,{readWrite:{}});assert.equal(requests[1].body.transaction,'one-transaction');
});

test('an explicit abort during the fused read retries, while an ambiguous commit never does',async()=>{
 for(const ambiguous of [false,true]){
  let reads=0,commits=0,callbacks=0;const db=transport(async(url,options)=>{
   const body=JSON.parse(options.body);
   if(url.endsWith(':batchGet')){reads++;if(!ambiguous&&reads===1)return Response.json({error:{status:'ABORTED'}},{status:409});return Response.json([{transaction:'fixture'},...body.documents.map(found)]);}
   if(url.endsWith(':commit')){commits++;if(ambiguous)throw new Error('lost committed response');}
   return Response.json({});
  });
  const operation=db.runTransaction(async tx=>{callbacks++;await tx.get(db.doc(path));tx.set(db.doc(path),{json:'{}'});});
  if(ambiguous)await assert.rejects(operation,/lost committed response/);else await operation;
  assert.equal(commits,1);assert.equal(callbacks,ambiguous?1:2);
 }
});

test('incomplete first-read data rolls back its opened transaction without committing',async()=>{
 const calls=[];const db=transport(async(url,options)=>{calls.push(url);return Response.json(url.endsWith(':batchGet')?[{transaction:'fixture'}]:{});});
 await assert.rejects(db.runTransaction(async tx=>{await tx.get(db.doc(path));tx.set(db.doc(path),{json:'{}'});}),/Incomplete/);
 assert.equal(calls.length,2);assert.ok(calls[1].endsWith(':rollback'));
});
