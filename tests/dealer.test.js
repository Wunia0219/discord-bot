import test from 'node:test';
import assert from 'node:assert/strict';
import {dealerClipForRound,dealerPlacement,dealerFrameSequence} from '../src/ui/dealer-motion.js';

test('dealer only reacts to profitable small wins while the WIN overlay owns big prizes',()=>{
  for(const bet of [20,100,200,500]){
    for(const [payout,clip] of [[0,'idle'],[bet/2,'idle'],[bet,'idle'],[bet+1,'win'],[10*bet-1,'win'],[10*bet,'idle'],[30*bet,'idle'],[100*bet,'idle']]){
      assert.equal(dealerClipForRound({bet,payout}),clip);
    }
  }
});

test('dealer playback reuses ordered drawings and includes return poses in its timing',()=>{
  const clip={pages:[{frames:{'gesture-000':{durationMs:120},'gesture-001':{durationMs:80}}},{frames:{'gesture-002':{durationMs:160}}}],order:['gesture-000','gesture-001','gesture-002','gesture-001','gesture-000']};
  const sequence=dealerFrameSequence(clip,12);
  assert.deepEqual(sequence.map(({key,pageIndex,durationMs})=>[key,pageIndex,durationMs]),[
    ['gesture-000',0,120],['gesture-001',0,80],['gesture-002',1,160],['gesture-001',0,80],['gesture-000',0,120],
  ]);
  assert.equal(sequence.reduce((sum,frame)=>sum+frame.durationMs,0),560);
});

test('legacy dealer clips use natural key order and default frame timing',()=>{
  const clip={pages:[{frames:{'idle-10':{},'idle-2':{},'idle-1':{durationMs:140}}}]};
  const sequence=dealerFrameSequence(clip,20);
  assert.deepEqual(sequence.map(frame=>frame.key),['idle-1','idle-2','idle-10']);
  assert.deepEqual(sequence.map(frame=>frame.durationMs),[140,50,50]);
  assert.throws(()=>dealerFrameSequence({...clip,order:['missing']},20),/Unknown dealer drawing/);
});

test('dealer placement leaves the first reel and control deck clear',()=>{
  assert.deepEqual(dealerPlacement(1160),{x:137,y:655,scale:1.04});
  assert.deepEqual(dealerPlacement(970),{x:186,y:645,scale:.60});
  for(const width of [970,1160]){
    const {x,y,scale}=dealerPlacement(width);
    // New 448px authored frames reserve 32px on each side for motion padding.
    // A separate asset check must verify each actual silhouette fits that box.
    const right=x+(416/448-.5)*256*scale;
    assert.ok(right<255,'the visible silhouette must stay left of the first reel');
    assert.ok(y<=655,'feet remain above the control deck');
  }
});
