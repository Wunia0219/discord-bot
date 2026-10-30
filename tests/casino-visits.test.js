import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {CasinoVisits,VISIT_CLOSE_GRACE_MS,VISIT_TIMEOUT_MS} from '../server/discord/casino-visits.js';
const guild='100000000000000001',user='100000000000000002';
function fixture(){
  let now=1000000,reads=0,failure=false,balance={balance:10000,net:0,rounds:0,bet:0,payout:0};const saved=new Map(),sent=[];
  const state={get:k=>structuredClone(saved.get(k)),set:(k,v)=>saved.set(k,structuredClone(v))};
  const bot={guild,send:async(payload,id)=>{sent.push({payload,id});return {kind:'sent',messageId:'100000000000000003'};}};
  const options={state,bot,clock:()=>now,readAccount:async()=>{reads++;if(failure)throw new Error('unavailable');return {...balance};}};
  let visits=new CasinoVisits(options);const session={guild,user,expires:now+86400000,profile:{name:'XX @everyone **name**'}};
  return {saved,sent,bot,session,get visits(){return visits;},get reads(){return reads;},set balance(v){balance=v;},fail(v){failure=v;},advance(ms){now+=ms;},restart(){visits=new CasinoVisits(options);},request(action,instanceId){return visits.request(session,{action,instanceId});}};
}
test('entry/exit persist, duplicate requests coalesce, credits are excluded from gaming net',async()=>{
  const f=fixture(),id=randomUUID();await f.request('enter',id);await f.request('enter',id);
  assert.equal(f.visits.status().pending,1);assert.equal(f.reads,1);
  await f.visits.flush();assert.match(f.sent[0].payload.content,/進入賭場/);assert.doesNotMatch(f.sent[0].payload.content,/@everyone/);
  for(let i=0;i<4;i++){f.advance(45000);await f.request('heartbeat',id);}assert.equal(f.reads,1,'heartbeats never read Firestore');
  f.balance={balance:11400,net:400,rounds:3,bet:300,payout:700}; // Includes a 1000 administrator grant.
  await f.request('leave',id);await f.request('leave',id);f.advance(VISIT_CLOSE_GRACE_MS);f.restart();await f.visits.sweep();await f.visits.flush();
  assert.equal(f.reads,2);assert.equal(f.sent.length,2);assert.match(f.sent[1].payload.content,/\+400 戲籌/);assert.match(f.sent[1].payload.content,/11,400/);
  assert.equal(f.visits.status().activeVisits,0);await f.request('leave',id);await f.visits.sweep();assert.equal(f.sent.length,2);
});
test('reload grace and multiple devices create one visit; hiding is not a server event',async()=>{
  const f=fixture(),a=randomUUID(),b=randomUUID();await f.request('enter',a);await f.request('enter',b);await f.request('leave',a);
  f.advance(VISIT_CLOSE_GRACE_MS+1);await f.visits.sweep();assert.equal(f.visits.status().activeVisits,1);
  await f.request('leave',b);f.advance(3000);await f.request('enter',randomUUID());await f.visits.sweep();
  assert.equal(f.visits.status().pending,1);assert.equal(f.reads,1);
});
test('crash timeout closes with an explicit timeout label and preserves state on accounting failure',async()=>{
  const f=fixture(),id=randomUUID();await f.request('enter',id);f.advance(VISIT_TIMEOUT_MS+1);f.fail(true);
  await assert.rejects(f.visits.sweep());assert.equal(f.visits.status().activeVisits,1);assert.equal(f.visits.status().pending,1);
  f.fail(false);f.restart();await f.visits.sweep();await f.visits.flush();f.advance(1000);await f.visits.flush();
  assert.match(f.sent[1].payload.content,/連線逾時/);assert.match(f.sent[1].payload.content,/0 戲籌/);
});
test('a close delivered before enter cannot create a ghost visit; forged amounts and identities are ignored',async()=>{
  const f=fixture(),id=randomUUID();await f.request('leave',id);assert.equal((await f.request('enter',id)).closed,true);assert.equal(f.reads,0);
  assert.equal((await f.request('heartbeat',randomUUID())).active,false);
  await assert.rejects(f.visits.request({...f.session,guild:'100000000000000009'},{action:'enter',instanceId:randomUUID()}),e=>e.status===403);
  await assert.rejects(f.request('enter','-'.repeat(36)),e=>e.status===400);
  await f.visits.request(f.session,{action:'enter',instanceId:randomUUID(),balance:999999,user:'100000000000000009'});
  const data=f.saved.get('casino-visits');assert.equal(Object.values(data.visits)[0].start.balance,10000);assert.equal(Object.values(data.visits)[0].user,user);
});
test('429 delay survives restart; ambiguous POST and interrupted sends never duplicate notices',async()=>{
  const f=fixture();await f.request('enter',randomUUID());let calls=0;
  f.bot.send=async()=>{calls++;return {kind:'retry',delay:900000};};await f.visits.flush();f.restart();f.advance(300000);await f.visits.flush();assert.equal(calls,1);
  f.advance(600000);f.bot.send=async()=>{calls++;return {kind:'uncertain'};};await f.visits.flush();f.restart();f.advance(900000);await f.visits.flush();assert.equal(calls,2);assert.equal(f.visits.status().uncertain,1);
  const data=f.saved.get('casino-visits');data.events[0].status='sending';f.saved.set('casino-visits',data);f.restart();await f.visits.flush();assert.equal(calls,2);
});

test('completed receipts do not exhaust daily capacity; unresolved events are never evicted',async()=>{
  const f=fixture();await f.request('enter',randomUUID());
  const data=f.saved.get('casino-visits'),original=data.events[0];
  data.events=Array.from({length:256},(_,i)=>({...original,id:String(i),status:i<2?'pending':'sent'}));
  f.saved.set('casino-visits',data);f.restart();
  f.visits.enqueue({content:'next visit'});f.visits.save();
  let events=f.saved.get('casino-visits').events;
  assert.equal(events.length,256);assert.deepEqual(events.slice(0,2).map(e=>e.id),['0','1']);
  assert.equal(events.at(-1).status,'pending');assert.equal(events.some(e=>e.id==='2'),false);
  const blocked=f.saved.get('casino-visits');blocked.events=events.map(e=>({...e,status:'pending'}));
  f.saved.set('casino-visits',blocked);f.restart();
  assert.throws(()=>f.visits.enqueue({content:'overflow'}),e=>e.status===503);
  assert.equal(f.visits.status().pending,256);
});
