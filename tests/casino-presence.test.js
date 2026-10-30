import test from 'node:test';
import assert from 'node:assert/strict';
import {createCasinoPresence} from '../src/platform/casino-presence.js';
test('browser hides keep the visit; closing sends one authenticated keepalive without client accounting',async()=>{
  const target=new EventTarget();target.document=new EventTarget();target.document.visibilityState='visible';const calls=[];let interval;
  const presence=createCasinoPresence({token:'private-session',walletEpoch:'epoch'},{target,setTimer:fn=>{interval=fn;return 1;},clearTimer:()=>{},fetchImpl:async(url,options)=>{calls.push({url,options,body:JSON.parse(options.body)});return Response.json({enabled:true,active:true});}});
  await presence.start();target.document.visibilityState='hidden';target.document.dispatchEvent(new Event('visibilitychange'));assert.equal(calls.length,1);
  await presence.pulse();target.dispatchEvent(new Event('pagehide'));target.dispatchEvent(new Event('pagehide'));await Promise.resolve();
  assert.deepEqual(calls.map(c=>c.body.action),['enter','heartbeat','leave']);assert.equal(calls[2].options.keepalive,true);
  assert.equal(calls[2].options.headers.Authorization,'Bearer private-session');assert.equal(calls[2].options.headers['X-Wallet-Epoch'],'epoch');
  assert.deepEqual(Object.keys(calls[2].body).sort(),['action','instanceId']);interval();assert.equal(calls.length,3);presence.dispose();
});
test('a failed entry retries without throwing into gameplay and BFCache receives a fresh instance',async()=>{
  const target=new EventTarget();const calls=[];let fail=true;
  const p=createCasinoPresence({token:'fixture'},{target,setTimer:()=>1,clearTimer:()=>{},fetchImpl:async(url,options)=>{const body=JSON.parse(options.body);calls.push(body);if(fail)throw new Error('offline');return Response.json({enabled:true,active:false});}});
  await p.start();fail=false;await p.pulse();assert.deepEqual(calls.map(c=>c.action),['enter','heartbeat','enter']);
  p.leave();const before=calls[0].instanceId;const event=new Event('pageshow');event.persisted=true;target.dispatchEvent(event);await Promise.resolve();
  assert.notEqual(calls.at(-1).instanceId,before);p.dispose();
});

test('late responses from a cached page cannot disable its new visit or trigger duplicate entries',async()=>{
  for(const lateAction of ['enter','heartbeat']){
    const target=new EventTarget(),calls=[];let release,hold=true;
    const p=createCasinoPresence({token:'fixture'},{target,setTimer:()=>1,clearTimer:()=>{},fetchImpl:async(url,options)=>{
      const body=JSON.parse(options.body);calls.push(body);
      if(hold&&body.action===lateAction){hold=false;return new Promise(resolve=>{release=resolve;});}
      return Response.json({enabled:true,active:true});
    }});
    let pending;
    if(lateAction==='enter')pending=p.start();else{await p.start();pending=p.pulse();}
    p.leave();const event=new Event('pageshow');event.persisted=true;target.dispatchEvent(event);
    await p.start();const instance=calls.at(-1).instanceId;
    release(Response.json({enabled:false,active:false}));await pending;
    const before=calls.length;await p.pulse();
    assert.equal(calls.length,before+1);assert.equal(calls.at(-1).action,'heartbeat');assert.equal(calls.at(-1).instanceId,instance);
    p.dispose();
  }
});

test('a stale heartbeat cannot clear the new visit single-flight request',async()=>{
  const target=new EventTarget(),pending=[],calls=[];
  const p=createCasinoPresence({token:'fixture'},{target,setTimer:()=>1,clearTimer:()=>{},fetchImpl:async(url,options)=>{
    const body=JSON.parse(options.body);calls.push(body);
    return body.action==='heartbeat'?new Promise(resolve=>pending.push(resolve)):Response.json({enabled:true,active:true});
  }});
  await p.start();const old=p.pulse();p.leave();const event=new Event('pageshow');event.persisted=true;target.dispatchEvent(event);
  await p.start();const current=p.pulse();
  pending[0](Response.json({enabled:true,active:false}));await old;
  const before=calls.length;assert.equal(p.pulse(),current);assert.equal(calls.length,before);
  pending[1](Response.json({enabled:true,active:true}));await current;p.dispose();
});
