import test from 'node:test';
import assert from 'node:assert/strict';
import {CloudBackup} from '../cloud/backup.js';
import {FirestoreRest} from '../cloud/firestore-rest.js';

const settings={projectId:'demo-jokers-circus',namespace:'backup-budget-test',emulator:'127.0.0.1:8787'};
function quota(initial=0,limit=6000){return {used:initial,bytes:0,reserve({reads=0}){if(this.used+reads>limit)throw Object.assign(new Error('Budget'),{code:'FIRESTORE_BUDGET'});this.used+=reads;},observe(bytes){this.bytes+=bytes;}};}

test('single-attempt REST backup charges each uncertain attempt before transport without refunding old usage',async()=>{
 const budget=quota(5682);let calls=0,fail=true;
 const db=new FirestoreRest({...settings,fetchImpl:async(url,options)=>{calls++;assert.equal(budget.used,5682+calls*3);if(fail)throw new Error('Lost response');return Response.json(JSON.parse(options.body).documents.map(name=>({found:{name,fields:{json:{stringValue:'{}'}}},readTime:'2026-10-26T00:00:00Z'})));}});
 const backup=new CloudBackup({db,quota:budget}),refs=[1,2,3].map(n=>db.doc(`circus_wallet_v1/${settings.namespace}/ledger/${n}`));
 await assert.rejects(backup.read(refs));assert.equal(calls,1,'transport cannot secretly retry');assert.equal(budget.used,5685);
 fail=false;assert.equal((await backup.read(refs)).length,3);assert.equal(calls,2);assert.equal(budget.used,5688);
 budget.used=5999;await assert.rejects(backup.read(refs),{code:'FIRESTORE_BUDGET'});assert.equal(calls,2,'deny before network');assert.equal(budget.used,5999);
});

test('backup query keeps full page allowance on failure and retries at the identical readTime',async()=>{
 const budget=quota();let fail=true,calls=0;
 const readTime='2026-10-26T00:00:00Z';
 const db=new FirestoreRest({...settings,fetchImpl:async(url,options)=>{calls++;assert.ok(url.endsWith(':runQuery'));const b=JSON.parse(options.body);assert.equal(b.readTime,readTime);assert.equal(b.structuredQuery.limit,20);assert.deepEqual(b.structuredQuery.orderBy,[{field:{fieldPath:'__name__'},direction:'ASCENDING'}]);assert.equal(budget.used,calls*20);if(fail)throw new Error('Lost query response');return Response.json([{readTime}]);}});
 const job={generation:'candidate',readTime,target:0,cursor:0,phase:'collections',startedAt:Date.now(),collection:0,cursorId:null,highlights:false};
 const values=new Map([['backup-job',job]]),state={get:k=>values.get(k),set:(k,v)=>values.set(k,v)};
 const snapshot={format:1,environment:'test',revision:0,tables:{settings:[{key:'environment',value:'test'}],wallets:[],ledger:[],operations:[],rounds:[],highlight_events:[],highlight_boards:[]}};
 let published=false;const vault={manifest:()=>({format:2}),append:()=>{},audit:()=>({revision:0}),storage:{transactionSync:fn=>fn()},publish:()=>{published=true;}};
 const backup=new CloudBackup({db,quota:budget,root:db.collection('circus_wallet_v1').doc(settings.namespace),environment:'test'},state,vault);
 await assert.rejects(backup.step());assert.equal(published,false);assert.equal(job.collection,0);assert.equal(budget.used,20);
 fail=false;assert.equal((await backup.step()).complete,false);assert.equal(published,false);assert.equal((await backup.step()).complete,true);assert.equal(budget.used,40);assert.equal(published,true);
});

test('unrecognized backup adapters keep the existing six-attempt allowance',async()=>{
 const budget=quota();const db={batchGet:async()=>[{data:()=>({})}]};await new CloudBackup({db,quota:budget}).read([{}]);assert.equal(budget.used,6);
});
