import test from 'node:test';
import assert from 'node:assert/strict';
import { reelAnimation, reelOffset, reelSpeed, quickStopAnimation, quickStopOffset, reelBounceOffset, REEL_BOUNCE_MS, roundFeedbackTiming, REEL_SETTLE_MS, WIN_HOLD_MS, WinCycle } from '../src/ui/presentation.js';
import { REEL_STRIPS, INITIAL_STOPS, gridFromStops } from '../src/game/slot-math.js';
import { WinSymbolPop, SYMBOL_POP_MS } from '../src/ui/presentation.js';

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

test('each reel lands with the original downward overshoot and smaller upward rebound',()=>{
  for(const cell of [96,136,180])for(const fps of [30,60,120]){
    const samples=[];
    for(let elapsed=0;elapsed<REEL_BOUNCE_MS;elapsed+=1000/fps){
      const offset=reelBounceOffset(elapsed,cell);
      samples.push(offset);
      // Guard cells keep both sides of the reel mask filled during the rebound.
      assert.ok(-cell+offset<=0);
      assert.ok(4*cell+offset>=3*cell);
    }
    assert.ok(Math.max(...samples)>cell*.09,'the downward overshoot must be visible');
    assert.ok(Math.min(...samples)<-cell*.01,'the reel must rebound upward before settling');
    assert.ok(Math.abs(Math.min(...samples))<Math.max(...samples),'the rebound should be smaller than the impact');
    assert.equal(reelBounceOffset(-1,cell),0);
    assert.equal(reelBounceOffset(0,cell),0);
    assert.equal(reelBounceOffset(REEL_BOUNCE_MS,cell),0);
    assert.equal(reelBounceOffset(REEL_BOUNCE_MS+1000,cell),0);
  }
});

test('normal and quick stops share the landing bounce, while reduced motion skips it',()=>{
  for(const reduced of [false,true]){
    const impacts=REEL_STRIPS.map((strip,reel)=>{
      const normal=reelAnimation(strip,INITIAL_STOPS[reel],0,reel,reduced);
      const speed=reelSpeed(normal.steps*136,0,normal.stopAt,reduced);
      const quick=quickStopAnimation(strip,0,normal.names,-normal.steps*136,speed,reel,136);
      for(const impactAt of [normal.stopAt,Math.min(quick.duration,normal.stopAt)]){
        const at=elapsed=>reelBounceOffset(elapsed-impactAt,136,reduced);
        assert.equal(at(impactAt),0);
        assert.equal(at(impactAt+REEL_BOUNCE_MS),0);
        if(reduced){assert.equal(at(impactAt+40),0);assert.equal(at(impactAt+140),0);}
        else {assert.ok(at(impactAt+40)>0);assert.ok(at(impactAt+140)<0);}
      }
      return Math.min(quick.duration,normal.stopAt)+(reduced?0:REEL_BOUNCE_MS);
    });
    assert.ok(impacts.every((time,reel)=>!reel||time>=impacts[reel-1]),'the bounce must preserve left-to-right stops');
  }
});

test('quick stop preserves every visible symbol and its exact fractional position before braking',()=>{
  const cell=136;
  const visible=(names,offset)=>names.map((name,row)=>({name,y:(row-1)*cell+offset})).filter(({y})=>y+cell>1e-7&&y<3*cell-1e-7);
  REEL_STRIPS.forEach((strip,reel)=>{
    for(const from of [0,INITIAL_STOPS[reel],strip.length-1])for(const to of [from,0,strip.length-1]){
      const regular=reelAnimation(strip,from,to,reel);
      for(const elapsed of [0,73,340,811,1100]){
        const offset=reelOffset(regular.steps*cell,elapsed,regular.stopAt);
        const speed=reelSpeed(regular.steps*cell,elapsed,regular.stopAt);
        const quick=quickStopAnimation(strip,to,regular.names,offset,speed,reel,cell);
        const before=visible(regular.names,offset),after=visible(quick.names,quick.offset);
        assert.deepEqual(after.map(row=>row.name),before.map(row=>row.name),'requesting a stop must not swap onscreen symbols');
        after.forEach((row,i)=>assert.ok(Math.abs(row.y-before[i].y)<1e-7,'requesting a stop must not shift the current frame'));
        const stops=[...INITIAL_STOPS];stops[reel]=to;
        assert.deepEqual(visible(quick.names,0).map(row=>row.name),gridFromStops(stops)[reel]);
        assert.ok(quick.names.every(name=>strip.includes(name)));
        const initialSpeed=(quickStopOffset(quick.offset,.001,quick.duration,quick.speed)-quick.offset)/.001;
        assert.ok(Math.abs(initialSpeed-speed)<.00001,'braking starts at the existing reel velocity');
        for(const fps of [30,60,120]){
          let previous=quick.offset;
          for(let t=1000/fps;t<quick.duration;t+=1000/fps){
            const next=quickStopOffset(quick.offset,t,quick.duration,quick.speed);
            assert.ok(next>=previous&&next<=0,'quick stop must move down without reversing');
            assert.ok(next-previous<cell*.6,'quick stop must not flash several cells in one frame');
            previous=next;
          }
        }
        assert.equal(Math.abs(quickStopOffset(quick.offset,quick.duration,quick.duration,quick.speed)),0);
        assert.equal(Math.abs(quickStopOffset(quick.offset,quick.duration+1000,quick.duration,quick.speed)),0);
      }
    }
  });
});

test('quick stop lands the five reels in order within a second, and never prolongs a late or reduced-motion stop',()=>{
  for(const reduced of [false,true])for(const elapsed of [0,150,700,1100,1400,1800]){
    const landing=REEL_STRIPS.map((strip,reel)=>{
      const regular=reelAnimation(strip,INITIAL_STOPS[reel],0,reel,reduced);
      const remaining=Math.max(0,regular.stopAt-elapsed);
      if(!remaining)return 0;
      const offset=reelOffset(regular.steps*136,elapsed,regular.stopAt,reduced);
      const speed=reelSpeed(regular.steps*136,elapsed,regular.stopAt,reduced);
      const quick=quickStopAnimation(strip,0,regular.names,offset,speed,reel,136);
      const duration=Math.min(remaining,quick.duration);
      assert.ok(duration<=remaining);
      return duration;
    });
    assert.ok(landing.every((time,i)=>!i||time>=landing[i-1]),'reels should settle from left to right');
    if(!reduced&&elapsed===0){assert.ok(landing[0]>=300);assert.ok(landing[4]+REEL_BOUNCE_MS<=830);}
  }
});

test('feedback protects all winning-symbol pops and count-ups while retaining existing auto timing',()=>{
  const timing=(count,milestone=false,tier=null)=>roundFeedbackTiming({wins:Array(count).fill({}),milestone},tier);
  assert.deepEqual(timing(0),{hold:0,autoDelay:650});
  for(const count of [1,2,3,4]){
    const {hold}=timing(count);
    assert.ok(hold>=1200,'the payout count-up must finish');
    assert.ok(hold>=count*WIN_HOLD_MS,'each winning combination must get a full display');
  }
  assert.deepEqual(timing(1),{hold:1600,autoDelay:0});
  assert.deepEqual(timing(1,false,'big'),{hold:4500,autoDelay:700});
  assert.deepEqual(timing(1,true),{hold:6300,autoDelay:700});
  assert.deepEqual(timing(1,true,'mega'),{hold:9000,autoDelay:800});
});
test('automatic spins wait for the complete dealer gesture without extending the manual spin lock',()=>{
  for(const count of [1,2,3]){
    const round={wins:Array(count).fill({}),milestone:false};
    const normal=roundFeedbackTiming(round,null),withDealer=roundFeedbackTiming(round,null,3600);
    assert.equal(withDealer.hold,normal.hold);
    assert.ok(withDealer.hold+withDealer.autoDelay>=3600);
    assert.equal(withDealer.autoDelay,Math.max(normal.autoDelay,3600-normal.hold));
  }
});

test('line display proceeds in order with the original individual payouts and loops',()=>{
  const cycle=new WinCycle(),seen=[];
  const wins=[{line:1,payout:50},{line:7,payout:25},{line:12,payout:100}];
  cycle.start(wins,(win,index,total)=>seen.push([win.line,win.payout,index,total]));
  cycle.tick(16);cycle.tick(WIN_HOLD_MS-1);assert.equal(seen.length,1);
  cycle.tick(1);cycle.tick(WIN_HOLD_MS);cycle.tick(WIN_HOLD_MS);
  assert.deepEqual(seen,[[1,50,0,3],[7,25,1,3],[12,100,2,3],[1,50,0,3]]);
});
test('celebration pauses line display; clearing/replacing prevents stale round callbacks',()=>{
  const cycle=new WinCycle(),seen=[];
  cycle.start([{line:1},{line:2}],win=>seen.push(win.line));
  cycle.tick(10000,true);assert.deepEqual(seen,[]);
  cycle.tick(16);cycle.tick(10000,true);assert.deepEqual(seen,[1]);
  cycle.start([{line:9}],win=>seen.push(win.line));cycle.tick(16);
  cycle.clear();cycle.tick(10000);assert.deepEqual(seen,[1,9]);
  cycle.start([],()=>assert.fail('losing rounds must not show a line'));cycle.tick(10000);
});
