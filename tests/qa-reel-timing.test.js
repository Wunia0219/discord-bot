import assert from 'node:assert/strict';
import test from 'node:test';
import {assertReelCadence} from '../scripts/qa/helpers/reel-timing.js';

const cues=step=>Array.from({length:5},(_,index)=>{
  const scheduled=1400+index*60,clock=Math.ceil(scheduled/step)*step;
  return {index,scheduled,previousClock:clock-step,clock};
});

test('QA accepts ordered 60ms deadlines on smooth and stalled frames',()=>{
  for(const step of [5,16,50,200,500])assertReelCadence(cues(step),`${step}ms frames`);
  assert.equal(cues(200)[1].clock,cues(200)[2].clock);
});

test('QA rejects changed cadence, early/late callbacks, missing cues and incomplete observations',()=>{
  for(const mutate of [
    events=>{events[1].scheduled+=1;events[1].previousClock+=1;events[1].clock+=1;},
    events=>{events[0].clock=events[0].scheduled-1;},
    events=>{events[0].previousClock=events[0].scheduled;events[0].clock+=5;},
    events=>{events.pop();},
    events=>{events[1].index=0;},
    events=>{delete events[0].previousClock;},
  ]){
    const events=cues(5);mutate(events);
    assert.throws(()=>assertReelCadence(events,'regression'),assert.AssertionError);
  }
});
