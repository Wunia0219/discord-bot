import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {CI_SUITES,verificationPlan} from '../scripts/qa/helpers/verification-plan.js';

test('CI suites retain full coverage and run every integration test file exactly once',()=>{
  const all=verificationPlan({ci:true}),split=CI_SUITES.flatMap(suite=>verificationPlan({ci:true,suite}));
  const ordinary=steps=>steps.filter(step=>step.id!=='firestore').sort((a,b)=>a.id.localeCompare(b.id));
  assert.equal(split.filter(step=>step.id==='build').length,2,'browser and services each build their own assets');
  assert.deepEqual(ordinary(split.filter((step,index)=>step.id!=='build'||index===split.findIndex(item=>item.id==='build'))),ordinary(all));
  const integrations=steps=>steps.flatMap(step=>step.args.filter(arg=>arg.endsWith('.integration.js'))).sort();
  assert.deepEqual(integrations(split),integrations(all));
  assert.equal(new Set(integrations(split)).size,integrations(split).length,'no duplicate integration runs');
  assert.deepEqual(integrations(split),readdirSync('tests').filter(name=>name.endsWith('.integration.js')).map(name=>`tests/${name}`).sort(),'new integration files must join the plan');
});

test('each CI suite retains its prerequisites without sharing an emulator or browser run',()=>{
  for(const suite of CI_SUITES){
    const steps=verificationPlan({ci:true,suite}),seen=new Set();
    for(const step of steps){for(const dependency of step.dependsOn)assert.ok(seen.has(dependency));seen.add(step.id);}
    assert.equal(seen.has('firestore'),suite!=='browser');
    assert.equal(seen.has('build'),suite!=='wallet');
    assert.equal(seen.has('unit'),suite==='browser');
    assert.equal(seen.has('monitor'),suite==='services');
    assert.equal(seen.has('worker'),suite==='services');
    assert.equal(seen.has('monitor-build'),suite==='services');
    if(suite==='services'){
      assert.deepEqual(steps.find(step=>step.id==='worker').dependsOn,['build']);
      assert.deepEqual(steps.find(step=>step.id==='firestore').dependsOn,['worker']);
      assert.deepEqual(steps.find(step=>step.id==='monitor').dependsOn,['monitor-build']);
    }
  }
  const workflow=readFileSync('.github/workflows/verify.yml','utf8');
  assert.deepEqual(workflow.match(/suite: \[([^\]]+)\]/)[1].split(',').map(s=>s.trim()),CI_SUITES,'workflow must schedule every suite');
});

test('local full verification retains its coverage and invalid suite selections fail closed',()=>{
  assert.equal(verificationPlan().length,10);
  assert.equal(verificationPlan({full:true}).length,12);
  assert.equal(verificationPlan({ci:true}).length,14);
  for(const options of [{ci:true,suite:''},{ci:true,suite:'typo'},{suite:'wallet'}])assert.throws(()=>verificationPlan(options),/Use --suite/);
  for(const arg of ['--suite=','--suite=typo']){
    const result=spawnSync(process.execPath,['scripts/qa/verify.js','--ci','--list',arg],{encoding:'utf8',windowsHide:true});
    assert.notEqual(result.status,0);assert.match(result.stderr,/Use --suite/);
  }
});
