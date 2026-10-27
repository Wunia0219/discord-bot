import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {completeDeferredCommand} from '../server/discord/deferred-command.js';
import {createActivityServer} from '../server/http/app.js';
const application='100000000000000001',user='100000000000000002';
const interaction=()=>({type:2,id:'100000000000000003',application_id:application,token:'private-fixture-token-12345',guild_id:application,
  member:{user:{id:user},permissions:'0'},data:{name:'戲籌'}});
function wallet(){let calls=0;return {store:{backend:'firestore',environment:'test',validate:()=>{},
  state:async()=>{calls++;return {balance:10100,claimed:false,daily:500,weeklyCheckin:{day:1,nextDay:2,nextReward:500}};}},get calls(){return calls;}};}
test('deferred delivery retries PATCH while executing the financial command only once',async()=>{
  const w=wallet(),attempts=[];
  const ok=await completeDeferredCommand(interaction(),w,{wait:async()=>{},fetchImpl:async(url,options)=>{
    attempts.push({url,options});return new Response('{}',{status:attempts.length<3?502:200});}});
  assert.equal(ok,true);assert.equal(w.calls,1);assert.equal(attempts.length,3);
  assert.ok(attempts.every(row=>row.options.method==='PATCH'&&row.url.endsWith('/messages/@original')));
  assert.equal(attempts[0].options.body,attempts[2].options.body);
  const data=JSON.parse(attempts[0].options.body);assert.deepEqual(data.allowed_mentions,{parse:[]});assert.ok(!Object.hasOwn(data,'flags'));
});
test('rate limits respect bounded retry waits and permanent failures do not retry',async()=>{
  const waits=[];let calls=0;
  assert.equal(await completeDeferredCommand(interaction(),wallet(),{wait:async ms=>waits.push(ms),
    fetchImpl:async()=>new Response('{}',{status:++calls===1?429:200,headers:{'Retry-After':'2'}})}),true);
  assert.deepEqual(waits,[2000]);let warned=0;
  assert.equal(await completeDeferredCommand(interaction(),wallet(),{warn:()=>warned++,fetchImpl:async()=>new Response('{}',{status:404})}),false);
  assert.equal(warned,1);
});
test('asynchronous provider failures produce a private natural reply without diagnostic text',async()=>{
  const w=wallet();w.store.state=async()=>{throw new Error('credential-private-path provider-token');};let body;
  await completeDeferredCommand(interaction(),w,{fetchImpl:async(url,options)=>{body=options.body;return new Response('{}',{status:200});}});
  assert.doesNotMatch(body,/credential-private-path|provider-token/);assert.match(body,/再試/);
});
test('signed cloud commands acknowledge before a delayed database call completes',async t=>{
  let finish,calls=0;const w=wallet();w.store.state=()=>new Promise(resolve=>{finish=resolve;});
  const keys=generateKeyPairSync('ed25519'),publicKey=keys.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('hex');
  const server=createActivityServer({clientId:application,publicKey,wallet:w,fetchImpl:async()=>{calls++;return new Response('{}',{status:200});}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const body=JSON.stringify(interaction()),timestamp=String(Math.floor(Date.now()/1000));
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/interactions`,{method:'POST',headers:{
    'x-signature-timestamp':timestamp,'x-signature-ed25519':sign(null,Buffer.concat([Buffer.from(timestamp),Buffer.from(body)]),keys.privateKey).toString('hex')},body});
  assert.deepEqual(await response.json(),{type:5,data:{flags:64}});assert.equal(calls,0);assert.equal(typeof finish,'function');
  finish({balance:10100,claimed:false,daily:500,weeklyCheckin:{day:1,nextDay:2,nextReward:500}});await server.drainCommands();assert.equal(calls,1);
});
