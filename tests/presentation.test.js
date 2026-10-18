import test from 'node:test';
import assert from 'node:assert/strict';
import { reelOffset, BOUNCE_MS, LINE_HOLD_MS, WinLineCycle } from '../src/presentation.js';

test('reels maintain speed up to impact, overshoot down, rebound up, and align exactly',()=>{
  const distance=4000,stopAt=1200,cell=136;
  const y=t=>reelOffset(distance,t,stopAt,cell);
  assert.equal(y(0),-distance);assert.equal(y(stopAt),0);
  assert.ok(Math.abs((y(1100)-y(1000))-(y(200)-y(100)))<1e-9);
  assert.ok(y(stopAt+BOUNCE_MS*.25)>0);assert.ok(y(stopAt+BOUNCE_MS*.75)<0);
  for(let t=stopAt;t<stopAt+BOUNCE_MS;t++)assert.ok(Math.abs(y(t))<cell*.17);
  assert.equal(y(stopAt+BOUNCE_MS),0);assert.equal(y(stopAt+10000),0);
  assert.equal(reelOffset(distance,stopAt+20,stopAt,cell,true),0);
  for(let reel=0;reel<4;reel++)assert.ok(1200+reel*230+BOUNCE_MS<1200+(reel+1)*230);
});
test('line display proceeds in order with the original individual payouts and loops',()=>{
  const cycle=new WinLineCycle(),seen=[];
  const wins=[{line:1,payout:50},{line:7,payout:25},{line:12,payout:100}];
  cycle.start(wins,(win,index,total)=>seen.push([win.line,win.payout,index,total]));
  cycle.tick(16);cycle.tick(LINE_HOLD_MS-1);assert.equal(seen.length,1);
  cycle.tick(1);cycle.tick(LINE_HOLD_MS);cycle.tick(LINE_HOLD_MS);
  assert.deepEqual(seen,[[1,50,0,3],[7,25,1,3],[12,100,2,3],[1,50,0,3]]);
});
test('celebration pauses line display; clearing/replacing prevents stale round callbacks',()=>{
  const cycle=new WinLineCycle(),seen=[];
  cycle.start([{line:1},{line:2}],win=>seen.push(win.line));
  cycle.tick(10000,true);assert.deepEqual(seen,[]);
  cycle.tick(16);cycle.tick(10000,true);assert.deepEqual(seen,[1]);
  cycle.start([{line:9}],win=>seen.push(win.line));cycle.tick(16);
  cycle.clear();cycle.tick(10000);assert.deepEqual(seen,[1,9]);
  cycle.start([],()=>assert.fail('losing rounds must not show a line'));cycle.tick(10000);
});
