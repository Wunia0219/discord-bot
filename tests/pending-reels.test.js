import test from 'node:test';
import assert from 'node:assert/strict';
import {REEL_STRIPS,INITIAL_STOPS,gridFromStops} from '../src/game/index.js';
import {pendingReelFrame,quickStopAnimation,quickStopOffset,quickStopSpeed} from '../src/ui/presentation.js';

const cell=136;
const visible=(names,offset)=>names.map((name,row)=>({name,y:(row-1)*cell+offset})).filter(({y})=>y+cell>1e-7&&y<3*cell-1e-7);

test('pending reels move on the first frame and keep a bounded, fully covered window during long network waits',()=>{
  REEL_STRIPS.forEach((strip,reel)=>{
    const start=pendingReelFrame(strip,INITIAL_STOPS[reel],0,cell);
    assert.deepEqual(visible(start.names,start.offset).map(row=>row.name),gridFromStops(INITIAL_STOPS)[reel]);
    assert.ok(pendingReelFrame(strip,INITIAL_STOPS[reel],16,cell).offset>start.offset);
    for(const elapsed of [16,59.9,60,60.1,120,2000,20000,120000]){
      const frame=pendingReelFrame(strip,INITIAL_STOPS[reel],elapsed,cell);
      assert.equal(frame.names.length,6);assert.ok(frame.offset>=0&&frame.offset<cell);assert.ok(frame.speed>0);
      const view=visible(frame.names,frame.offset);assert.ok(view[0].y<=0);assert.ok(view.at(-1).y+cell>=3*cell);
      assert.ok(frame.names.every(name=>strip.includes(name)));
    }
    for(const boundary of [60,120,600,60000]){
      const a=pendingReelFrame(strip,INITIAL_STOPS[reel],boundary-.00001,cell),b=pendingReelFrame(strip,INITIAL_STOPS[reel],boundary+.00001,cell);
      const before=visible(a.names,a.offset).slice(0,3),after=visible(b.names,b.offset).slice(1);
      assert.deepEqual(after.map(row=>row.name),before.map(row=>row.name));
      after.forEach((row,i)=>assert.ok(Math.abs(row.y-before[i].y)<.001));
    }
  });
});

test('a delayed authoritative result stitches into the moving frame without swapping symbols or changing velocity',()=>{
  REEL_STRIPS.forEach((strip,reel)=>{
    for(const elapsed of [0,16,60,217,2000,20013,120000])for(const quick of [false,true]){
      const frame=pendingReelFrame(strip,INITIAL_STOPS[reel],elapsed,cell),to=strip.length-1;
      const plan=quickStopAnimation(strip,to,frame.names,frame.offset,frame.speed,reel,cell,quick?4+reel:8+reel*2);
      const before=visible(frame.names,frame.offset),after=visible(plan.names,plan.offset);
      assert.deepEqual(after.map(row=>row.name),before.map(row=>row.name));
      after.forEach((row,i)=>assert.ok(Math.abs(row.y-before[i].y)<1e-7));
      assert.ok(Math.abs(quickStopSpeed(plan.offset,0,plan.duration)-frame.speed)<1e-7);
      const stops=[...INITIAL_STOPS];stops[reel]=to;
      assert.deepEqual(visible(plan.names,0).map(row=>row.name),gridFromStops(stops)[reel]);
      for(const fps of [30,60,120]){
        let previous=plan.offset;
        for(let t=1000/fps;t<plan.duration;t+=1000/fps){
          const next=quickStopOffset(plan.offset,t,plan.duration);assert.ok(next>=previous&&next<=0);assert.ok(next-previous<cell*.6);previous=next;
        }
      }
    }
  });
});

test('a quick stop after a delayed result uses its current decelerating speed and never extends the landing',()=>{
  REEL_STRIPS.forEach((strip,reel)=>{
    const frame=pendingReelFrame(strip,INITIAL_STOPS[reel],2317,cell);
    const normal=quickStopAnimation(strip,0,frame.names,frame.offset,frame.speed,reel,cell,8+reel*2);
    for(const fraction of [0,.1,.5,.9]){
      const elapsed=normal.duration*fraction,offset=quickStopOffset(normal.offset,elapsed,normal.duration),speed=quickStopSpeed(normal.offset,elapsed,normal.duration);
      const quick=quickStopAnimation(strip,0,normal.names,offset,speed,reel,cell);
      if(quick.duration>=normal.duration-elapsed)continue;
      assert.deepEqual(visible(quick.names,quick.offset).map(row=>row.name),visible(normal.names,offset).map(row=>row.name));
      assert.ok(Math.abs(quickStopSpeed(quick.offset,0,quick.duration)-speed)<1e-7);
    }
    assert.equal(quickStopSpeed(normal.offset,normal.duration,normal.duration),0);
  });
});
