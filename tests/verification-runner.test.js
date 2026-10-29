import assert from 'node:assert/strict';
import test from 'node:test';
import {runVerificationSteps} from '../scripts/qa/helpers/verification.js';

const step=(id,dependsOn=[])=>({id,label:id,dependsOn});
test('local verification stops on the first failure',async()=>{
  const calls=[];
  const result=await runVerificationSteps([step('first'),step('second')],{execute:async s=>{calls.push(s.id);return 1;}});
  assert.deepEqual(calls,['first']);assert.equal(result.ok,false);
});

test('CI collects independent failures, skips blocked checks and cannot become green later',async()=>{
  const calls=[],saved=[];
  const result=await runVerificationSteps([step('build'),step('security',['build']),step('browser'),step('backend')],{
    keepGoing:true,onResult:result=>saved.push(result),execute:async s=>{
      calls.push(s.id);if(s.id==='build')return 2;if(s.id==='browser')throw new Error('browser launch failed');return 0;
    },
  });
  assert.deepEqual(calls,['build','browser','backend']);
  assert.deepEqual(result.steps.map(s=>s.status),['failed','skipped','failed','passed']);
  assert.equal(result.steps[1].reason,'Blocked by build');
  assert.equal(result.steps[2].error,'browser launch failed');
  assert.deepEqual(saved,result.steps);assert.equal(result.ok,false);
});

test('verification succeeds only when every scheduled check passes',async()=>{
  const result=await runVerificationSteps([step('build'),step('security',['build'])],{keepGoing:true,execute:async()=>0});
  assert.equal(result.ok,true);assert.equal(result.steps.length,2);
});

test('invalid verification dependencies fail instead of running an unchecked prerequisite',async()=>{
  const execute=async()=>0;
  await assert.rejects(runVerificationSteps([step('security',['missing'])],{execute}),/Missing earlier dependency/);
  await assert.rejects(runVerificationSteps([step('build'),step('build')],{execute}),/Duplicate verification step/);
});
