import test from 'node:test';
import assert from 'node:assert/strict';
import {REEL_STRIPS,INITIAL_STOPS,gridFromStops} from '../src/game/index.js';
import {pendingReelFrame} from '../src/ui/reels/presentation.js';

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
