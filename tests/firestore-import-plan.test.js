import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,existsSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {spawnSync} from 'node:child_process';
import {WalletStore} from '../server/wallet/wallet.js';
import {firestoreImportPlan} from '../server/firestore/import.js';
import {decodeHistory} from '../server/firestore/schema.js';
import {firestoreSettings} from '../server/firestore/settings.js';
import {assertHighlightEvent,assertHighlightBoard} from '../server/firestore/highlight-data.js';

function source(t){
  const root=resolve('test-results/firestore-plans');mkdirSync(root,{recursive:true});const directory=mkdtempSync(join(root,'case-'));
  t.after(()=>{assert.ok(directory.startsWith(root+sep));rmSync(directory,{recursive:true,force:true});});
  const filename=join(directory,'source.sqlite'),guild='100000000000000001',user='100000000000000002';
  const s=new WalletStore({filename,guildIds:[guild],spinDelay:0}),rounds=[];
  for(let i=0;i<3;i++)rounds.push(s.spin(guild,user,20,'original-request-000'+i).round);
  s.close();return {directory,filename,rounds};
}

test('v2 planning keeps original rounds and request results while replacing all ledger mirrors',t=>{
  const h=source(t),v1=firestoreImportPlan(h.filename,'test'),v2=firestoreImportPlan(h.filename,'test',{version:2});
  assert.equal(v1.version,1);assert.equal(v2.version,2);
  for(const record of v1.resources.filter(r=>r.path.startsWith('operations/')||r.path.includes('/rounds/')))
    assert.deepEqual(v2.resources.find(r=>r.path===record.path).data,record.data);
  assert.equal(v2.resources.filter(r=>/\/entries-|\/ledger\//.test(r.path)).length,0);
  const wallet=v2.resources.find(r=>/^wallets\/[^/]+$/.test(r.path)).data;
  assert.deepEqual(decodeHistory(wallet.historyCache).map(r=>r.round),h.rounds.toReversed());
  assert.ok(v2.resources.filter(r=>r.path.startsWith('ledger/')&&r.data.kind==='spin').every(r=>r.index.operationKey.startsWith('spin:')));
});

test('migration dry-run emits a local plan without opening a quota database or contacting Firestore',t=>{
  const h=source(t),quota=join(h.directory,'quota.sqlite');
  const result=spawnSync(process.execPath,['scripts/admin/import-firestore.js','--from',h.filename,'--dry-run'],{
    env:{...process.env,APP_ENV:'test',FIRESTORE_PROJECT_ID:'demo-jokers-circus',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8799',
      FIRESTORE_SCHEMA_VERSION:'2',FIRESTORE_NAMESPACE:'dry-run-test',FIRESTORE_QUOTA_PATH:quota},encoding:'utf8',windowsHide:true,timeout:10000});
  assert.equal(result.status,0,result.stderr);const plan=JSON.parse(result.stdout);
  assert.equal(plan.dryRun,true);assert.equal(plan.schemaVersion,2);assert.ok(plan.documents>0);assert.equal(existsSync(quota),false);
});

test('schema setting defaults to legacy and rejects unsupported versions',()=>{
  const env={APP_ENV:'test',FIRESTORE_PROJECT_ID:'demo-jokers-circus',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8787'};
  assert.equal(firestoreSettings(env).schemaVersion,1);
  assert.equal(firestoreSettings({...env,FIRESTORE_SCHEMA_VERSION:'2'}).schemaVersion,2);
  for(const value of ['0','3','1.5','invalid'])assert.throws(()=>firestoreSettings({...env,FIRESTORE_SCHEMA_VERSION:value}),/FIRESTORE_SCHEMA_VERSION/);
});

test('migration preserves legacy notification message IDs and fractional retry deadlines while rejecting unsafe board data',t=>{
  assert.throws(()=>assertHighlightBoard(null),/Invalid highlight board/);
  assert.throws(()=>assertHighlightEvent({guild:'100000000000000001',name:'玩家',tier:'super',multiplier:30,occurred:1,status:'pending'}),/Invalid highlight event/);
  const h=source(t),s=new WalletStore({filename:h.filename,guildIds:['100000000000000001']}),deadline=Date.now()+10123.456;
  try{
    s.db.prepare('INSERT INTO highlight_boards VALUES(?,?,?,?,?,?)').run('100000000000000001','100000000000000009',Date.now(),1,
      JSON.stringify([{name:'舊版暱稱',tier:'super',multiplier:30}]),deadline);
    for(const version of [1,2]){
      const board=firestoreImportPlan(h.filename,'test',{version}).resources.find(row=>row.path.startsWith('highlightBoards/')).data;
      assert.equal(board.message_id,'100000000000000009');assert.equal(board.next_attempt,deadline);
    }
    s.db.prepare('UPDATE highlight_boards SET message_id=?').run('../../wrong-destination');
    assert.throws(()=>firestoreImportPlan(h.filename,'test',{version:2}),/Invalid highlight board/);
  }finally{s.close();}
});
