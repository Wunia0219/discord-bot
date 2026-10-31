import test from 'node:test';
import assert from 'node:assert/strict';
import {walletSettings} from '../server/wallet/settings.js';
import {cloudPlan,activationPlanVerified} from '../cloud/plan.js';

const role='100000000000000001',other='100000000000000002';

test('Node and Worker use the same wallet settings with trimmed guild and role IDs',()=>{
  const env={ALLOWED_GUILD_IDS:` ${role}, ${other} `,CHIP_ADMIN_ROLE_IDS:` ${role} `,ADMIN_GRANT_MAX:'500',ADMIN_DAILY_MAX:'5000'};
  assert.deepEqual(walletSettings(env,{cloud:true}),walletSettings(env));
  assert.deepEqual(walletSettings(env).guildIds,[role,other]);
  assert.deepEqual(walletSettings(env).adminRoles,[role]);
  assert.equal(walletSettings(env).grantMax,500);
  assert.equal(walletSettings(env).grantDaily,5000);
});

test('legacy Worker roles remain valid without expanding permissions or ignoring conflicts',()=>{
  assert.deepEqual(walletSettings({ADMIN_ROLE_IDS:role},{cloud:true}).adminRoles,[role]);
  assert.deepEqual(walletSettings({ADMIN_ROLE_IDS:role}).adminRoles,[]);
  assert.deepEqual(walletSettings({CHIP_ADMIN_ROLE_IDS:role,ADMIN_ROLE_IDS:` ${role} `},{cloud:true}).adminRoles,[role]);
  for(const primary of ['',other])assert.throws(()=>walletSettings({CHIP_ADMIN_ROLE_IDS:primary,ADMIN_ROLE_IDS:role},{cloud:true}),/Conflicting/);
  for(const key of ['CHIP_ADMIN_ROLE_IDS','ADMIN_ROLE_IDS'])assert.throws(()=>walletSettings({[key]:'invalid'},{cloud:true}),/Invalid CHIP_ADMIN_ROLE_IDS/);
});

test('plan metadata and writer activation retain explicit matching confirmation',()=>{
  for(const plan of ['free','paid']){
    assert.equal(cloudPlan(plan),plan);
    assert.equal(activationPlanVerified({plan,planVerified:true},plan),true);
    assert.equal(activationPlanVerified({plan,planVerified:false},plan),false);
  }
  for(const plan of [undefined,'','pro','unknown'])assert.throws(()=>cloudPlan(plan));
  assert.equal(activationPlanVerified({freePlanVerified:true},'paid'),false);
  assert.equal(activationPlanVerified({plan:'free',planVerified:true},'paid'),false);
  assert.equal(activationPlanVerified({freePlanVerified:true},'free'),true);
});
