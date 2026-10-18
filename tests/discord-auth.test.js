import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticateActivity } from '../src/discord-auth.js';

const id = '1561284960986599626';
test('OAuth requests identify only, exchanges on our backend, and returns no tokens', async () => {
  const calls = [];
  const sdk = { commands:{
    authorize:async args => { calls.push('authorize'); assert.deepEqual(args.scope,['identify']); assert.equal(args.client_id,id); return { code:'test-code' }; },
    authenticate:async args => { calls.push('authenticate'); assert.deepEqual(args,{access_token:'test-token'}); return { access_token:'test-token', user:{id,username:'tester',global_name:'玩家',avatar:null} }; },
  } };
  const user = await authenticateActivity(sdk,id,async (url,opts) => {
    calls.push('exchange');assert.equal(url,'/api/token');assert.equal(opts.cache,'no-store');
    assert.deepEqual(JSON.parse(opts.body),{code:'test-code'});
    return Response.json({access_token:'test-token'});
  });
  assert.deepEqual(calls,['authorize','exchange','authenticate']);
  assert.deepEqual(user,{id,username:'tester',global_name:'玩家',avatar:null});
});
test('cancelled consent never calls the backend and never exposes raw SDK errors', async () => {
  await assert.rejects(authenticateActivity({commands:{authorize:async()=>{throw new Error('sensitive-provider-detail');}}},id,()=>assert.fail('must not fetch')),error=>/授權尚未完成/.test(error.message)&&!error.message.includes('sensitive'));
});
test('backend failures cannot proceed to SDK authenticate or leak response details', async () => {
  await assert.rejects(authenticateActivity({commands:{authorize:async()=>({code:'test'}),authenticate:()=>assert.fail('must not authenticate')}},id,async()=>Response.json({error:'private'}, {status:503})),/登入服務暫時無法使用/);
});
test('SDK must return a valid identity before login is accepted', async () => {
  await assert.rejects(authenticateActivity({commands:{authorize:async()=>({code:'test'}),authenticate:async()=>null}},id,async()=>Response.json({access_token:'token'})),/身分驗證失敗/);
});
