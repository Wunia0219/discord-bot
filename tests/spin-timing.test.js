import test from 'node:test';
import assert from 'node:assert/strict';
import {SpinTimings} from '../server/spin-timing.js';

test('spin timing reports no fabricated average before actual new settlements',()=>{
  const timings=new SpinTimings();
  assert.deepEqual(timings.snapshot(),{samples:0,maximumSamples:50,persistent:false,handler:null,settlement:null});
  timings.record({requestMs:40,settlementMs:30,duplicate:true});timings.record({requestMs:NaN,settlementMs:20});
  assert.equal(timings.snapshot().samples,0);
});

test('timing aggregates contain only the most recent 50 new rounds and restart with the process',()=>{
  const timings=new SpinTimings();for(let i=1;i<=60;i++)timings.record({requestMs:i+10,settlementMs:i});
  const snapshot=timings.snapshot();
  assert.equal(snapshot.samples,50);assert.deepEqual(snapshot.settlement,{meanMs:35.5,p95Ms:58,lastMs:60});
  assert.deepEqual(snapshot.handler,{meanMs:45.5,p95Ms:68,lastMs:70});
  assert.equal(new SpinTimings().snapshot().samples,0);
});
