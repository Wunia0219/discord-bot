import test from 'node:test';
import assert from 'node:assert/strict';
import { createWalletClient } from '../src/platform/wallet-client.js';

test('overlapping wallet refreshes share a request and failures do not prevent later refresh',async()=>{
 let release,calls=0,fail=false;
 const client=createWalletClient({guildId:'guild',userId:'user'},async()=>{
  calls++;await new Promise(resolve=>{release=resolve;});
  if(fail)throw new Error('offline');return Response.json({state:{balance:calls}});
 },null);
 const a=client.state(),b=client.state();assert.equal(a,b);assert.equal(calls,1);
 release();assert.equal((await a).state.balance,1);
 fail=true;const failed=client.state();release();await assert.rejects(failed,/網路/);
 fail=false;const recovered=client.state();release();assert.equal((await recovered).state.balance,3);
});
test('lost response retries the same bet and id, including a page reload, without storing session secrets',async()=>{
 const data=new Map();const storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 const session={token:'private-session',guildId:'guild',userId:'user'};let first;
 const a=createWalletClient(session,async(url,opts)=>{first=JSON.parse(opts.body);throw new Error('network');},storage);
 await assert.rejects(a.spin(100),/網路/);assert.ok(![...data.values()].join('').includes(session.token));
 const b=createWalletClient(session,async(url,opts)=>{assert.deepEqual(JSON.parse(opts.body),first);return Response.json({round:{id:'same'}});},storage);
 await b.spin(500);assert.equal(b.hasPending(),false);assert.equal(data.size,0);
});

test('unrelated throttling, invalid cooldown metadata and authentication errors are not retried',async()=>{
 const session={token:'test-session',guildId:'guild',userId:'user'};
 for(const [status,body] of [
  [429,{error:'操作過於頻繁'}],
  ...[-1,0,60001,'2000'].map(retryAfterMs=>[429,{error:'尚未就緒',code:'SPIN_COOLDOWN',retryAfterMs}]),
  [401,{error:'登入已過期'}],[409,{error:'籌碼不足'}],[503,{error:'服務不可用'}],
 ]){
  let calls=0;
  const client=createWalletClient(session,async()=>{calls++;return Response.json(body,{status});},null,{wait:()=>assert.fail('must not retry this error')});
  await assert.rejects(client.spin(20),error=>error.status===status);
  assert.equal(calls,1);
 }
});

test('repeated cooldown responses have a bounded retry count and retain one request ID',async()=>{
 let now=0;const bodies=[],waits=[];
 const client=createWalletClient({guildId:'guild',userId:'user'},async(path,options)=>{
  bodies.push(JSON.parse(options.body));
  return Response.json({error:'尚未就緒',code:'SPIN_COOLDOWN',retryAfterMs:2000},{status:429});
 },null,{clock:()=>now,wait:async delay=>{waits.push(delay);now+=delay;}});
 await assert.rejects(client.spin(100),error=>error.status===429);
 assert.equal(bodies.length,3);assert.equal(waits.length,2);
 assert.equal(new Set(bodies.map(body=>body.requestId)).size,1);
 assert.equal(client.hasPending(),false);
});

test('repeated inputs while waiting share one spin and keep the original bet',async()=>{
 let now=0,release;const requests=[];
 const client=createWalletClient({guildId:'guild',userId:'user'},async(path,options)=>{
  requests.push(JSON.parse(options.body));
  return Response.json({round:{id:String(requests.length)},state:{spinCooldownMs:2000}});
 },null,{clock:()=>now,wait:delay=>new Promise(resolve=>{release=()=>{now+=delay;resolve();};})});
 await client.spin(20);
 const first=client.spin(100),second=client.spin(500);
 assert.equal(first,second);assert.equal(requests.length,1);
 release();const [a,b]=await Promise.all([first,second]);
 assert.equal(a.round.id,b.round.id);assert.equal(requests.length,2);
 assert.equal(requests[1].bet,100);
});
