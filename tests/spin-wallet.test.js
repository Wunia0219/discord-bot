import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { WalletStore } from '../server/wallet.js';
import { createWalletClient } from '../src/platform/wallet-client.js';
import { SpinControls } from '../src/ui/spin-controls.js';

const guild='100000000000000002',user='100000000000000004';

function fixture(t){
  let now=Date.parse('2026-10-19T05:00:00Z');
  const store=new WalletStore({guildIds:[guild],clock:()=>now});
  t.after(()=>store.close());
  const requests=[],waits=[],data=new Map();
  const storage={getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
  const client=createWalletClient({guildId:guild,userId:user,token:'test-session'},async(path,options)=>{
    assert.equal(path,'/api/spin');
    const body=JSON.parse(options.body);requests.push({time:now,...body});
    try{return Response.json(store.spin(guild,user,body.bet,body.requestId));}
    catch(error){return Response.json({error:error.message,code:error.code,retryAfterMs:error.retryAfterMs},{status:error.status});}
  },storage,{clock:()=>now,wait:async delay=>{assert.ok(delay>0&&delay<=60000);waits.push(delay);now+=delay;}});
  return {store,client,requests,waits,advance:delay=>{now+=delay;}};
}

test('rapid spins after quick stops wait for the real wallet cooldown without errors or duplicate debits',async t=>{
  const h=fixture(t),rounds=[];
  for(let i=0;i<6;i++){
    rounds.push((await h.client.spin(20)).round);
    h.advance(25); // Quick-stop animation finishes well before the backend's two seconds.
  }
  assert.equal(new Set(rounds.map(round=>round.id)).size,6);
  assert.equal(h.store.history(guild,user).filter(entry=>entry.kind==='spin').length,6);
  assert.equal(h.store.state(guild,user).balance,10000+rounds.reduce((sum,round)=>sum+round.net,0));
  assert.equal(h.waits.length,5);
  const times=[...rounds].reverse().map(round=>Date.parse(round.time));
  assert.ok(times.slice(0,-1).every((time,i)=>time-times[i+1]>=2000));
  assert.equal(h.client.hasPending(),false);
});

test('auto continues through six short animations with the real backend cooldown and stops on demand',async t=>{
  const h=fixture(t),errors=[],queued=new Map();
  let busy=false,pending,attempts=0,timerId=0;
  const controls=new SpinControls({
    isReady:()=>true,isBusy:()=>busy,onAutoChange:()=>{},stopReels:()=>{},
    schedule:(callback,delay)=>{queued.set(++timerId,{callback,delay});return timerId;},cancel:id=>queued.delete(id),
    startSpin:()=>{
      busy=true;controls.beginRound();attempts++;
      pending=(async()=>{
        try{await h.client.spin(20);h.advance(250);}
        catch(error){errors.push(error);controls.stopAuto();}
        finally{busy=false;controls.endRound(650);}
      })();
    },
  });
  controls.toggleAuto();
  for(let i=0;i<6;i++){
    await pending;
    assert.equal(errors.length,0,'normal cooldown must not stop AUTO or open an error');
    assert.equal(controls.auto,true);
    assert.equal(queued.size,1);
    if(i===5)break;
    const [id,{callback,delay}]=[...queued][0];queued.delete(id);h.advance(delay);callback();
  }
  controls.stopAuto();
  assert.equal(queued.size,0);assert.equal(attempts,6);
  assert.equal(h.store.history(guild,user).filter(entry=>entry.kind==='spin').length,6);
});

test('a spin from another device is handled by waiting and retrying the same request ID once',async t=>{
  const h=fixture(t);
  await h.client.spin(20);h.advance(2000);
  h.store.spin(guild,user,20,randomUUID());
  const before=h.requests.length;
  await h.client.spin(20);
  const retry=h.requests.slice(before);
  assert.equal(retry.length,2);
  assert.equal(retry[0].requestId,retry[1].requestId);
  assert.equal(retry[0].bet,retry[1].bet);
  assert.ok(retry[1].time-retry[0].time>=2000);
  assert.equal(h.store.history(guild,user).filter(entry=>entry.kind==='spin').length,3);
});
