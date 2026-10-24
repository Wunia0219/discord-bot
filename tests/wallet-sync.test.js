import test from 'node:test';
import assert from 'node:assert/strict';
import {createWalletSync} from '../src/platform/wallet-sync.js';
import {createWalletClient} from '../src/platform/wallet-client.js';
const row=sequence=>({sequence,round:{id:String(sequence),payout:sequence}});
const state=(revision,historyRevision=revision)=>({revision,historyRevision,balance:10000+revision});

test('compact history loads once, merges local spins and retains history across grants and claims',async()=>{
  const calls=[],sync=createWalletSync(async options=>{calls.push(options);return {rows:[row(3),row(2),row(1)]};});
  let result=await sync({state:state(3)});assert.equal(result.state.history.length,3);assert.equal(calls.length,1);
  result=await sync({state:state(4),round:row(4).round,historyBase:3,historyRevision:4});
  assert.deepEqual(result.state.history.map(r=>r.id),['4','3','2','1']);
  result=await sync({state:state(5,4)});assert.equal(result.state.history.length,4);assert.equal(calls.length,1);
  assert.equal(result.state.historyBefore,1);
});

test('device gaps and old duplicate results fetch missing immutable rounds, capped at 100',async()=>{
  const calls=[],sync=createWalletSync(async options=>{
    calls.push(options);return {rows:Array.from({length:Math.min(100,options.through-options.after)},(_,i)=>row(options.through-i))};
  });
  await sync({state:state(5)});
  let result=await sync({state:state(8),round:row(6).round,historyBase:5,historyRevision:6,duplicate:true});
  assert.deepEqual(calls.at(-1),{after:5,through:8,limit:100});
  assert.deepEqual(result.state.history.map(r=>r.id),['8','7','6','5','4','3','2','1']);
  result=await sync({state:state(208)});assert.equal(result.state.history.length,100);
  assert.equal(result.state.history.at(-1).id,'109');
});

test('slow history responses cannot roll back a newer balance or introduce duplicate rows',async()=>{
  let release;const sync=createWalletSync(async({through})=>{
    if(through===2)await new Promise(resolve=>{release=resolve;});
    return {rows:Array.from({length:through},(_,i)=>row(through-i))};
  });
  const old=sync({state:state(2)});const newer=await sync({state:state(3)});release();
  assert.deepEqual((await old).state,newer.state);
  assert.equal(new Set(newer.state.history.map(r=>r.id)).size,3);
});

test('empty histories and unchanged polls perform no history reads',async()=>{
  const sync=createWalletSync(()=>assert.fail('unexpected history request'));
  assert.deepEqual((await sync({state:state(1,0)})).state.history,[]);
  assert.deepEqual((await sync({state:state(2,0)})).state.history,[]);
});

test('a committed spin whose history sync fails retains its original ID through retry and reload',async()=>{
  const saved=new Map(),storage={getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)};
  let fail=true;const requests=[];
  const fetchImpl=async(path,options)=>{
    if(path.startsWith('/api/rounds'))return fail?Response.json({error:'not allowed'},{status:403}):Response.json({rows:[row(3),row(2),row(1)]});
    requests.push(JSON.parse(options.body));return Response.json({state:state(3),round:row(3).round,historyBase:2,historyRevision:3});
  };
  const session={guildId:'g',userId:'u'};
  const a=createWalletClient(session,fetchImpl,storage);await assert.rejects(a.spin(20),/尚未同步/);assert.equal(a.hasPending(),true);
  fail=false;const b=createWalletClient(session,fetchImpl,storage),result=await b.spin(100);
  assert.deepEqual(requests[1],requests[0]);assert.equal(result.state.history.length,3);assert.equal(b.hasPending(),false);
});

test('history integrity failures do not poison subsequent synchronization',async()=>{
  let broken=true;const sync=createWalletSync(async()=>({rows:broken?[]:[row(1)]}));
  await assert.rejects(sync({state:state(1)}),/尚未同步/);broken=false;
  assert.equal((await sync({state:state(1)})).state.history.length,1);
});

test('switching from a full v2 compatibility response to compact state rebuilds sequence metadata',async()=>{
  let calls=0;const sync=createWalletSync(async()=>{calls++;return {rows:[row(2),row(1)]};});
  await sync({state:{...state(2),history:[row(2).round,row(1).round]}});
  const result=await sync({state:state(3,2)});
  assert.equal(calls,1);assert.deepEqual(result.state.history.map(r=>r.id),['2','1']);assert.equal(result.state.historyBefore,1);
});
