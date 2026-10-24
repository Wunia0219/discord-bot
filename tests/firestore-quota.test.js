import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {spawnSync} from 'node:child_process';
import {FirestoreQuota} from '../server/firestore-quota.js';
import {firestoreSettings} from '../server/firestore-settings.js';
import {operationsSettings} from '../server/operations-settings.js';

function directory(t){const root=resolve('test-results/firestore-quota');mkdirSync(root,{recursive:true});const path=mkdtempSync(join(root,'case-'));
  t.after(()=>{assert.ok(path.startsWith(root+sep));rmSync(path,{recursive:true,force:true});});return path;}
test('Firestore rolling allowances survive restarts and expire conservatively after 24 hours',t=>{
  const filename=join(directory(t),'quota.sqlite');let now=Date.parse('2026-10-22T00:00:00Z');
  const options={filename,projectId:'demo-test',reads:10,writes:10,clock:()=>now};
  let quota=new FirestoreQuota(options);quota.reserve({reads:8,writes:3,storageBytes:100});quota.close();
  quota=new FirestoreQuota(options);assert.equal(quota.status().used.reads,8);assert.throws(()=>quota.reserve({reads:3}),{code:'FIRESTORE_BUDGET'});
  now+=86400000;assert.throws(()=>quota.reserve({reads:3}),{code:'FIRESTORE_BUDGET'});
  now+=120001;quota.reserve({reads:3});assert.equal(quota.status().used.reads,3);assert.equal(quota.status().used.storageBytes,100);quota.close();
});
test('multiple local quota connections share reservations, including uncertain failures',t=>{
  const options={filename:join(directory(t),'quota.sqlite'),projectId:'demo-test',writes:10};
  const a=new FirestoreQuota(options),b=new FirestoreQuota(options);
  a.reserve({writes:8});assert.throws(()=>b.reserve({writes:3}),{code:'FIRESTORE_BUDGET'});assert.equal(b.status().used.writes,8);a.close();b.close();
});
test('a separate Node process cannot bypass a shared quota reservation',t=>{
  const filename=join(directory(t),'quota.sqlite'),quota=new FirestoreQuota({filename,projectId:'demo-test',writes:10});quota.reserve({writes:8});
  const child=spawnSync(process.execPath,['--input-type=module','-e',
    "import {FirestoreQuota} from './server/firestore-quota.js';const q=new FirestoreQuota({filename:process.env.TASK_QUOTA_FILE,projectId:'demo-test',writes:10});try{q.reserve({writes:3});process.exitCode=2;}catch(e){console.log(e.code);}finally{q.close();}"],
    {env:{...process.env,TASK_QUOTA_FILE:filename},encoding:'utf8',windowsHide:true});
  assert.equal(child.status,0);assert.match(child.stdout,/FIRESTORE_BUDGET/);assert.equal(quota.status().used.writes,8);quota.close();
});
test('egress and estimated storage stop later requests without resetting daily growth',t=>{
  const options={filename:join(directory(t),'quota.sqlite'),projectId:'demo-test',egressBytes:100,storageBytes:200};
  const quota=new FirestoreQuota(options);quota.reserve({storageBytes:199});assert.throws(()=>quota.reserve({storageBytes:2}),{code:'FIRESTORE_BUDGET'});
  quota.observe(101);assert.equal(quota.status().blocked,true);assert.throws(()=>quota.reserve({reads:1}),{code:'FIRESTORE_BUDGET'});quota.close();
});
test('quota corruption and project mismatches fail closed',t=>{
  const filename=join(directory(t),'quota.sqlite');const quota=new FirestoreQuota({filename,projectId:'demo-one'});quota.close();
  assert.throws(()=>new FirestoreQuota({filename,projectId:'demo-two'}),/project mismatch/);
  const broken=join(directory(t),'broken.sqlite');writeFileSync(broken,'not sqlite');assert.throws(()=>new FirestoreQuota({filename:broken,projectId:'demo-one'}));
});
test('updating an existing document reserves growth once and retains the high-water estimate',t=>{
  const quota=new FirestoreQuota({filename:join(directory(t),'quota.sqlite'),projectId:'demo-test',storageBytes:1000});
  quota.reserve({writes:2},{key:'wallet-hash',bytes:300});quota.reserve({writes:2},{key:'wallet-hash',bytes:300});
  quota.reserve({writes:2},{key:'wallet-hash',bytes:100});assert.equal(quota.status().used.storageBytes,300);
  quota.reserve({writes:2},{key:'wallet-hash',bytes:500});assert.equal(quota.status().used.storageBytes,500);
  quota.reserve({writes:2},{key:'new-ledger-hash',bytes:200});assert.equal(quota.status().used.storageBytes,700);quota.close();
});
test('Firestore configuration cannot silently contact production from emulator tests',()=>{
  const env={APP_ENV:'test',FIRESTORE_PROJECT_ID:'demo-circus',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8787'};
  assert.equal(firestoreSettings(env).quota.reads,40000);
  for(const invalid of [{APP_ENV:'production'},{FIRESTORE_PROJECT_ID:'real-circus'},{FIRESTORE_EMULATOR_HOST:'example.com:8787'},
    {FIRESTORE_NAMESPACE:'wrong-production'},{FIRESTORE_READ_BUDGET:'50001'},{FIRESTORE_WRITE_BUDGET:'20001'}])assert.throws(()=>firestoreSettings({...env,...invalid}));
  assert.throws(()=>firestoreSettings({APP_ENV:'test',FIRESTORE_PROJECT_ID:'real-circus'}),/FIRESTORE_LIVE_ENABLED/);
  assert.equal(operationsSettings({WALLET_ENABLED:'true',WALLET_BACKEND:'firestore',OPERATIONS_ENABLED:'false'}),null);
});
