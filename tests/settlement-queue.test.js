import test from 'node:test';
import assert from 'node:assert/strict';
import {SettlementQueue} from '../server/wallet/settlement-queue.js';
import {createWalletClient} from '../src/platform/wallet-client.js';

test('settlements serialize, a failed task releases its slot, overflow never starts work',async()=>{
  const q=new SettlementQueue({limit:2}),events=[];let release;
  const a=q.run(async()=>{events.push('a');await new Promise(r=>release=r);throw new Error('lost response');});
  const failed=assert.rejects(a,/lost response/);
  const b=q.run(()=>{events.push('b');return 2;});
  await assert.rejects(q.run(()=>assert.fail('overflow executed')),{code:'SETTLEMENT_BUSY'});
  assert.deepEqual(events,['a']);release();await failed;assert.equal(await b,2);assert.deepEqual(events,['a','b']);
});
test('waiting deadlines remove only unstarted work; active transaction retains ownership',async()=>{
  const q=new SettlementQueue({waitMs:10});let release;
  const a=q.run(()=>new Promise(r=>release=r));
  await assert.rejects(q.run(()=>assert.fail('expired work executed')),{code:'SETTLEMENT_BUSY'});
  assert.equal(q.running,true);release(1);assert.equal(await a,1);assert.equal(await q.run(()=>2),2);
});
test('busy settlement retains original pending request across a retry with a different bet',async()=>{
  let first,calls=0;const c=createWalletClient({guildId:'g',userId:'u'},async(_,options)=>{
    const body=JSON.parse(options.body);calls++;
    if(calls===1){first=body;return Response.json({error:'busy',code:'SETTLEMENT_BUSY',retryAfterMs:1000},{status:429});}
    assert.deepEqual(body,first);return Response.json({round:{id:'original'}});
  },null);
  await assert.rejects(c.spin(20),{code:'SETTLEMENT_BUSY'});assert.equal(c.hasPending(),true);
  await c.spin(100);assert.equal(c.hasPending(),false);
});
