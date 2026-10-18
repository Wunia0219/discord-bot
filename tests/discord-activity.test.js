import test from 'node:test';
import assert from 'node:assert/strict';
import { connectActivity, isDiscordActivity } from '../src/discord-activity.js';

const clientId='123456789012345678';
const location={hostname:`${clientId}.discordsays.com`,search:'?frame_id=test-frame&instance_id=test-instance&platform=desktop'};

test('ordinary browser preview does not load the SDK or need a client ID',async()=>{
  const result=await connectActivity({location:{hostname:'127.0.0.1',search:''},loadSdk:()=>{throw new Error('Must not load SDK');}});
  assert.deepEqual(result,{mode:'browser'});
});
test('Activity launch is detected from proxy domain or frame parameters',()=>{
  assert.equal(isDiscordActivity(location),true);
  assert.equal(isDiscordActivity({hostname:'localhost',search:location.search}),true);
  assert.equal(isDiscordActivity({hostname:'example.com',search:'?platform=desktop'}),false);
});
test('Activity blocks missing app ID and incomplete launch parameters',async()=>{
  await assert.rejects(connectActivity({location,clientId:''}),/Application ID/);
  await assert.rejects(connectActivity({location:{...location,search:''},clientId}),/啟動資訊/);
});
test('Activity waits for READY before reporting connected (stub transport)',async()=>{
  let ready;
  class SDK {
    constructor(id){assert.equal(id,clientId);}
    ready(){return new Promise(resolve=>{ready=resolve;});}
  }
  let connected=false;
  const pending=connectActivity({location,clientId,loadSdk:async()=>({DiscordSDK:SDK})}).then(result=>{connected=true;return result;});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(connected,false);
  ready();
  const result=await pending;
  assert.equal(result.mode,'discord');assert.ok(result.sdk instanceof SDK);
});
test('an unresponsive Discord handshake produces a recoverable timeout (stub transport)',async()=>{
  class SDK {ready(){return new Promise(()=>{});}}
  await assert.rejects(connectActivity({location,clientId,loadSdk:async()=>({DiscordSDK:SDK}),timeoutMs:10}),/連線逾時/);
});
test('responsive orientation is requested after READY and unsupported clients can still play',async()=>{
  let requested,ready=false;
  class SDK {
    commands={setOrientationLockState:async args=>{assert.equal(ready,true);requested=args;throw new Error('Unsupported client');}};
    async ready(){ready=true;}
  }
  const {mock}=await import('node:test');
  const warning=mock.method(console,'warn',()=>{});
  try {
    const result=await connectActivity({location,clientId,loadSdk:async()=>({DiscordSDK:SDK,Common:{OrientationLockStateTypeObject:{UNLOCKED:1}}})});
    assert.equal(result.mode,'discord');
    assert.deepEqual(requested,{lock_state:1,picture_in_picture_lock_state:1,grid_lock_state:1});
    assert.equal(warning.mock.callCount(),1);
  } finally {warning.mock.restore();}
});
