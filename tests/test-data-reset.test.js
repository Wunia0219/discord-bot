import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTestReset} from '../cloud/test-data-reset.js';

test('test deletion refuses production, absent enablement, live writers and unsafe paths',()=>{
 const id='a'.repeat(32),settings={projectId:'demo-test',namespace:'fixture-test',environment:'test',schemaVersion:2};
 const manifest={format:2,generation:'backup',sha256:'b'.repeat(64),revision:1,segments:[{table:'wallets',rows:1}]};
 const input={id,projectId:settings.projectId,namespace:settings.namespace,confirm:'DELETE ALL TEST PLAYERS',generation:manifest.generation,sha256:manifest.sha256,revision:1,paths:['wallets/100000000000000001_100000000000000002']};
 const context={settings,enabledId:id,manifest,mode:'paused'};
 assert.equal(validateTestReset(input,context).paths.length,1);
 for(const change of [{enabledId:''},{mode:'active'},{settings:{...settings,environment:'production'}},{settings:{...settings,namespace:'fixture-production'}},{settings:{...settings,schemaVersion:1}}])assert.throws(()=>validateTestReset(input,{...context,...change}));
 for(const change of [{confirm:''},{namespace:'another-test'},{revision:2},{generation:'old'},{paths:[...input.paths,...input.paths]},{paths:[...input.paths,'meta/state']},{paths:[...input.paths,'wallets/../secrets']},{paths:[]}])assert.throws(()=>validateTestReset({...input,...change},context));
});
