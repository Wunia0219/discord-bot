import test from 'node:test';
import assert from 'node:assert/strict';
import {REEL_STRIPS,INITIAL_STOPS,gridFromStops} from '../src/game/index.js';
import {pendingReelFrame,reelLandingAnimation,reelAnimation,reelOffset,reelSpeed,REEL_STOP_GAP_MS,REEL_SETTLE_MS,REEL_BOUNCE_MS} from '../src/ui/presentation.js';

const cell=136;
const visible=(names,offset)=>names.map((name,row)=>({name,y:(row-1)*cell+offset})).filter(({y})=>y+cell>1e-7&&y<3*cell-1e-7);
const close=(a,b,message)=>assert.ok(Math.abs(a-b)<1e-7,message||`${a} != ${b}`);

test('authoritative results join the current frame without replacing visible symbols or changing cruise velocity',()=>{
  REEL_STRIPS.forEach((strip,reel)=>{
    for(const elapsed of [0,16,60,217,600,2000,20013,120000])for(const quick of [false,true]){
      const frame=pendingReelFrame(strip,INITIAL_STOPS[reel],elapsed,cell),to=strip.length-1;
      const plan=reelLandingAnimation(strip,to,frame.names,frame.offset,reel,cell,{elapsed,quick});
      const before=visible(frame.names,frame.offset),after=visible(plan.names,plan.offset);
      assert.deepEqual(after.map(row=>row.name),before.map(row=>row.name));after.forEach((row,i)=>close(row.y,before[i].y));
      close(reelSpeed(plan.steps*cell,0,plan.stopAt),frame.speed);
      const stops=[...INITIAL_STOPS];stops[reel]=to;
      assert.deepEqual(visible(plan.names,0).map(row=>row.name),gridFromStops(stops)[reel]);
      for(const fps of [30,60,120]){
        let previous=plan.offset;
        for(let t=1000/fps;t<plan.stopAt;t+=1000/fps){const next=reelOffset(plan.steps*cell,t,plan.stopAt);assert.ok(next>=previous&&next<=0);assert.ok(next-previous<cell*.6);previous=next;}
      }
    }
  });
});

test('normal, queued quick and in-flight quick stops have the exact same final braking, bounce and sound cadence',()=>{
  for(const elapsed of [0,73,217,600,2000]){
    const plans=[false,true].map(quick=>REEL_STRIPS.map((strip,reel)=>{
      const frame=pendingReelFrame(strip,INITIAL_STOPS[reel],elapsed,cell);
      return reelLandingAnimation(strip,0,frame.names,frame.offset,reel,cell,{elapsed,quick});
    }));
    for(let reel=0;reel<5;reel++){
      const reference=reelAnimation(REEL_STRIPS[reel],INITIAL_STOPS[reel],0,reel);
      for(const plan of plans.map(p=>p[reel])){
        for(const beforeImpact of [160,120,80,40,1,0]){
          close(reelOffset(plan.steps*cell,plan.stopAt-beforeImpact,plan.stopAt),reelOffset(reference.steps*cell,reference.stopAt-beforeImpact,reference.stopAt));
          close(reelSpeed(plan.steps*cell,plan.stopAt-beforeImpact,plan.stopAt),reelSpeed(reference.steps*cell,reference.stopAt-beforeImpact,reference.stopAt));
        }
      }
      if(reel)for(const group of plans)close(group[reel].stopAt-group[reel-1].stopAt,REEL_STOP_GAP_MS);
    }
  }
});

test('network waiting counts toward normal cruise and quick stop only removes cruise, retaining all five landings',()=>{
  for(const elapsed of [0,60,300,600,2000,20000]){
    const frame=pendingReelFrame(REEL_STRIPS[0],INITIAL_STOPS[0],elapsed,cell);
    const normal=reelLandingAnimation(REEL_STRIPS[0],0,frame.names,frame.offset,0,cell,{elapsed});
    const quick=reelLandingAnimation(REEL_STRIPS[0],0,frame.names,frame.offset,0,cell,{elapsed,quick:true});
    assert.ok(quick.stopAt<=normal.stopAt);
    assert.ok(quick.stopAt+4*REEL_STOP_GAP_MS+REEL_BOUNCE_MS<=750);
    if(elapsed<=600)close(normal.stopAt+elapsed,1400);
    else close(normal.stopAt,quick.stopAt,'a slow response must not restart the long normal cruise');
  }
});

test('switching during cruise keeps the visible window and final speed, while late requests leave the existing tail shorter',()=>{
  for(const elapsed of [0,73,140,240,340,500,600,800]){
    const normal=REEL_STRIPS.map((strip,reel)=>reelAnimation(strip,INITIAL_STOPS[reel],0,reel));
    if(normal[0].stopAt-elapsed<=REEL_SETTLE_MS)continue;
    const plans=normal.map((p,reel)=>reelLandingAnimation(REEL_STRIPS[reel],0,p.names,reelOffset(p.steps*cell,elapsed,p.stopAt),reel,cell,{quick:true}));
    if(plans[0].stopAt>=normal[0].stopAt-elapsed)continue;
    plans.forEach((plan,reel)=>{
      const before=visible(normal[reel].names,reelOffset(normal[reel].steps*cell,elapsed,normal[reel].stopAt)),after=visible(plan.names,plan.offset);
      assert.deepEqual(after.map(row=>row.name),before.map(row=>row.name));after.forEach((row,i)=>close(row.y,before[i].y));
      close(reelSpeed(plan.steps*cell,0,plan.stopAt),cell/60);
    });
  }
});
