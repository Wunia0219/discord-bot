import test from 'node:test';
import assert from 'node:assert/strict';
import {dealerClipForRound,dealerPlacement,dealerFrameSequence} from '../src/ui/dealer/dealer-motion.js';

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

test('the complete dealer silhouette stays inside both viewports and clear of every reel',()=>{
  assert.deepEqual(dealerPlacement(1320),{x:40,y:680,scale:1.65});
  assert.deepEqual(dealerPlacement(1020),{x:156,y:660,scale:.85});
  // Union of the nonzero-alpha bounds across all 204 current idle/win drawings.
  const bounds={left:70,top:32,right:532,bottom:800};
  for(const [width,cropX] of [[1320,-140],[1020,65]]){
    const {x,y,scale}=dealerPlacement(width),factor=256/576*scale;
    const left=x+(bounds.left-288)*factor,right=x+(bounds.right-288)*factor;
    const top=y+(bounds.top-800)*factor,bottom=y+(bounds.bottom-800)*factor;
    assert.ok(left>=cropX+8,'hair, cape and arms must remain inside the visible canvas');
    assert.ok(right<255,'the complete silhouette must stay left of the first reel');
    assert.ok(top>=0,'hair must stay in view');
    assert.ok(bottom<=680,'boots must remain above the control deck');
    assert.ok(right<=cropX+width,'no horizontal cropping');
  }
});
