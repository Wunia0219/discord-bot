import test from 'node:test';
import assert from 'node:assert/strict';
import {FirestoreRest} from '../cloud/firestore-rest.js';
import {FirestoreWalletCore} from '../server/firestore-wallet-core.js';
import {encodeHistory} from '../server/firestore-schema.js';

const guild='100000000000000001',user='100000000000000002';
function fixture({cooldown=false,duplicate=false,commitMs=0}={}){
  let now=Date.parse('2026-10-24T03:00:00Z');const began=now,calls=[],usage={reads:0,writes:0};
  const settings={projectId:'demo-jokers-circus',namespace:'latency-test',environment:'test',schemaVersion:2};
  const summary={checkin:{days:0,total:0},game:{rounds:0,bet:0,payout:0,net:0}};
  const wallet={guild,user,balance:10000,last_spin:cooldown?now:0,milestone:false,claimedDay:null,revision:1,historyRevision:0,historyCache:encodeHistory([]),summary};
  const db=new FirestoreRest({...settings,emulator:'127.0.0.1:8787',fetchImpl:async(url,options)=>{
    const body=JSON.parse(options.body);
    if(url.endsWith(':beginTransaction')){calls.push('begin');return Response.json({transaction:'isolated-transaction'});}
    if(url.endsWith(':batchGet')){
      calls.push('read:'+body.documents.length);
      const rows=body.documents.map(name=>{
        const data=name.endsWith('/meta/state')?{version:2,environment:'test',status:'ready',nextId:1}:
          name.includes('/wallets/')&&!name.includes('/days/')?wallet:
          duplicate&&name.includes('/operations/')?{fingerprint:'20',result:{round:{id:'original-round'}}}:null;
        return data?{found:{name,fields:{json:{stringValue:JSON.stringify(data)}}}}:{missing:name};
      });
      if(body.newTransaction){assert.deepEqual(body.newTransaction,{readWrite:{}});rows.unshift({transaction:'isolated-transaction'});}
      return Response.json(rows);
    }
    if(url.endsWith(':commit')){calls.push('commit:'+body.writes.length);now+=commitMs;return Response.json({});}
    if(url.endsWith(':rollback')){calls.push('rollback');return Response.json({});}
    assert.fail('unexpected transport request');
  }});
  const quota={reserve(delta){usage.reads+=delta.reads||0;usage.writes+=delta.writes||0;},observe(){}};
  const store=new FirestoreWalletCore(settings,{db,quota,guildIds:[guild],clock:()=>now});
  return {store,calls,usage,began};
}

test('a new spin opens and reads in one batch then commits, preserving four reads and six atomic writes',async()=>{
  const f=fixture();const result=await f.store.spin(guild,user,20,'batch-spin-latency-0001',{compact:true});
  assert.deepEqual(f.calls,['read:4','commit:6']);
  assert.deepEqual(f.usage,{reads:24,writes:12});assert.equal(result.state.balance,result.round.after);
});

test('weekly checkin keeps the original four reads and five atomic writes without history queries',async()=>{
  const f=fixture(),result=await f.store.checkin(guild,user,{compact:true});
  assert.deepEqual(f.calls,['read:4','commit:5']);assert.deepEqual(f.usage,{reads:24,writes:10});
  assert.equal(result.entry.delta,500);assert.equal(result.checkin.cycleDay,1);
  assert.equal(result.state.weeklyCheckin.nextReward,500);
  assert.deepEqual(await f.store.state(guild,user,{compact:true}),result.state);
  assert.deepEqual(f.calls,['read:4','commit:5']);
});

test('commit time is deducted from the returned cooldown without lowering the actual two-second protection',async()=>{
  for(const commitMs of [250,825,2500]){
    const f=fixture({commitMs});const result=await f.store.spin(guild,user,20,'cooldown-clock-0000001',{compact:true});
    assert.equal(result.state.spinCooldownMs,Math.max(0,2000-commitMs));
    assert.equal(Date.parse(result.round.time),f.began);
  }
  const denied=fixture({cooldown:true});await assert.rejects(denied.store.spin(guild,user,20,'cooldown-denied-000001',{compact:true}),{code:'SPIN_COOLDOWN'});
  assert.deepEqual(denied.calls,['read:4','rollback']);assert.deepEqual(denied.usage,{reads:24,writes:0});
});

test('an existing request still returns its original round without any writes',async()=>{
  const f=fixture({duplicate:true});const result=await f.store.spin(guild,user,20,'duplicate-latency-00001',{compact:true});
  assert.equal(result.duplicate,true);assert.equal(result.round.id,'original-round');
  assert.deepEqual(f.calls,['read:4','rollback']);assert.deepEqual(f.usage,{reads:24,writes:0});
});
