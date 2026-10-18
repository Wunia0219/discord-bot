import test from 'node:test';
import assert from 'node:assert/strict';
import { reelAnimation, reelOffset, REEL_SETTLE_MS, LINE_HOLD_MS, WinLineCycle } from '../src/presentation.js';
import { REEL_STRIPS, INITIAL_STOPS, gridFromStops } from '../src/slot-math.js';
import { WinSymbolPop, SYMBOL_POP_MS } from '../src/presentation.js';

test('winning symbols pop twice, settle, and restart on every line display',()=>{
  const pop = new WinSymbolPop();
  pop.start();
  assert.equal(pop.tick(0),1);
  assert.ok(pop.tick(240)>1.15);
  assert.equal(pop.tick(240),1);
  assert.ok(pop.tick(240)>1.10);
  assert.equal(pop.tick(240),1);
  pop.start();assert.ok(pop.tick(240)>1.15);
  pop.start();assert.ok(pop.tick(240)>1.15);
  pop.clear();pop.start();assert.ok(pop.tick(240)>1.15);
});

test('symbol pop pauses with celebrations and skips motion for reduced-motion users',()=>{
  const pop = new WinSymbolPop();pop.start();
  assert.equal(pop.tick(SYMBOL_POP_MS,true),1);
  assert.ok(pop.tick(240)>1);
  assert.equal(pop.tick(0,false,true),1);
  pop.start(true);assert.equal(pop.tick(240),1);
  pop.clear();assert.equal(pop.tick(240),1);
});

test('all five reels move down at the same readable speed and settle without reversing',()=>{
  for(const reduced of [false,true]) {
    const plans=REEL_STRIPS.map((strip,reel)=>reelAnimation(strip,INITIAL_STOPS[reel],strip.length-1,reel,reduced));
    const cell=136;
    const offsets=plans.map(plan=>t=>reelOffset(plan.steps*cell,t,plan.stopAt,reduced));
    for(let reel=0;reel<plans.length;reel++) {
      const {steps,stopAt}=plans[reel],y=offsets[reel];
      assert.equal(y(-1),-steps*cell);assert.equal(y(0),-steps*cell);
      assert.equal(y(stopAt),0);assert.equal(y(stopAt+10000),0);
      assert.ok(Math.abs((y(100)-y(0))-(offsets[0](100)-offsets[0](0)))<1e-9);
      if(reel)assert.ok(stopAt>plans[reel-1].stopAt);
      for(const fps of [30,60,120]) {
        let previous=y(0);
        for(let t=1000/fps;t<stopAt;t+=1000/fps) {
          const next=y(t);
          assert.ok(next>=previous && next<=0,'reels must never move upward or overshoot');
          assert.ok(next-previous<cell*.6,'travel must stay below one symbol per frame');
          previous=next;
        }
      }
      if(!reduced) {
        assert.ok(y(stopAt-20)-y(stopAt-40)<y(200)-y(180));
        const boundary=stopAt-REEL_SETTLE_MS;
        assert.ok(Math.abs(y(boundary+.001)-y(boundary-.001))<.01);
      }
    }
  }
});

test('animation preserves actual starting and landing windows at reel wraps and repeated stops',()=>{
  REEL_STRIPS.forEach((strip,reel)=>{
    for(const reduced of [false,true])for(const from of [0,1,INITIAL_STOPS[reel],strip.length-1])for(const to of [from,0,1,strip.length-1]) {
      const {steps,names}=reelAnimation(strip,from,to,reel,reduced);
      const stops=[...INITIAL_STOPS];stops[reel]=from;
      assert.deepEqual(names.slice(steps+1,steps+4),gridFromStops(stops)[reel]);
      stops[reel]=to;
      assert.deepEqual(names.slice(1,4),gridFromStops(stops)[reel]);
      assert.equal(names[0],strip[(to-2+strip.length)%strip.length]);
      assert.equal(names[steps],strip[(from-2+strip.length)%strip.length]);
      assert.equal(names[steps+4],strip[(from+2)%strip.length]);
      assert.ok(names.every(name=>strip.includes(name)));
      assert.ok(steps<40,'long math strips must not require hundreds of visible steps');
      // Every intermediate viewport has a symbol above and below it.
      for(let travelled=0;travelled<=steps;travelled+=.25) {
        const top=steps-travelled;
        assert.ok(Math.floor(top)>=0 && Math.ceil(top+3)<names.length);
      }
    }
  });
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
