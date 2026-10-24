import test from 'node:test';
import assert from 'node:assert/strict';
import {createWalletClient} from '../src/platform/wallet-client.js';

const session={guildId:'g',userId:'u',token:'isolated-session'};
const row=sequence=>({sequence,round:{id:String(sequence),payout:sequence}});
const snapshot=revision=>({revision,historyRevision:revision,balance:10000+revision});

test('a committed result reaches presentation while older cross-device history is still loading',async()=>{
  let release,completed=false;const events=[],saved=new Map();
  const storage={getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value),removeItem:key=>saved.delete(key)};
  const client=createWalletClient(session,async(path,options)=>{
    events.push(path);
    if(path==='/api/wallet')return Response.json({state:snapshot(1)});
    if(path.startsWith('/api/rounds')){
      if(new URLSearchParams(path.split('?')[1]).get('through')==='1')return Response.json({rows:[row(1)]});
      await new Promise(resolve=>{release=resolve;});completed=true;return Response.json({rows:[row(3),row(2)]});
    }
    assert.equal(path,'/api/spin');assert.equal(JSON.parse(options.body).bet,20);
    return Response.json({state:snapshot(3),round:row(3).round,historyBase:2,historyRevision:3});
  },storage);
  await client.state();
  const pending=client.spin(20,{deferHistory:true});
  assert.equal(events.at(-1),'/api/spin','the request is dispatched synchronously before presentation setup');
  const result=await pending;
  assert.equal(result.round.id,'3');assert.equal(result.state.balance,10003);assert.equal(completed,false);
  assert.deepEqual(result.state.history.map(round=>round.id),['3','1']);
  assert.equal(client.hasPending(),false);assert.equal(saved.size,0,'confirmed settlement does not remain queued for another debit');
  release();const synced=await result.synchronized;
  assert.deepEqual(synced.state.history.map(round=>round.id),['3','2','1']);assert.equal(synced.state.balance,10003);
});

test('history failures after early result delivery do not fail or replay a committed spin',async()=>{
  const requests=[];const client=createWalletClient(session,async(path,options)=>{
    if(path.startsWith('/api/rounds'))return Response.json({error:'offline history'},{status:503});
    requests.push(JSON.parse(options.body));const revision=2+requests.length;
    return Response.json({state:snapshot(revision),round:row(revision).round,historyBase:revision-1,historyRevision:revision});
  },null);
  const first=await client.spin(20,{deferHistory:true});
  assert.equal(first.round.id,'3');await assert.rejects(first.synchronized,/尚未同步/);assert.equal(client.hasPending(),false);
  const second=await client.spin(100,{deferHistory:true});
  assert.equal(second.round.id,'4');await assert.rejects(second.synchronized,/尚未同步/);
  assert.equal(requests.length,2);assert.notEqual(requests[0].requestId,requests[1].requestId);assert.equal(requests[1].bet,100);
});

test('a recovered older round does not move it ahead of newer authoritative history',async()=>{
  const client=createWalletClient(session,async path=>{
    if(path==='/api/wallet')return Response.json({state:snapshot(4)});
    if(path.startsWith('/api/rounds'))return Response.json({rows:[row(4),row(3),row(2),row(1)]});
    return Response.json({state:snapshot(4),round:row(2).round,historyBase:1,historyRevision:2,duplicate:true});
  },null);
  await client.state();const result=await client.spin(20,{deferHistory:true});
  assert.equal(result.round.id,'2');assert.equal(result.state.balance,10004);
  assert.deepEqual(result.state.history.map(round=>round.id),['4','3','2','1']);
  assert.deepEqual((await result.synchronized).state.history.map(round=>round.id),['4','3','2','1']);
});
