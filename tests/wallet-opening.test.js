import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {WalletStore} from '../server/wallet.js';
import {inspectWalletDatabase} from '../server/database.js';
import {snapshotForCloud,restoreCloudSnapshot} from '../server/cloud-handoff.js';
import {auditSnapshot} from '../cloud/snapshot.js';
import {auditRows} from '../cloud/snapshot-audit.js';
import {firestoreImportPlan} from '../server/firestore-import.js';

const guild='100000000000000001',user='100000000000000002',zero='100000000000000003',old='100000000000000004';
function fixture(t){
  const root=resolve('test-results/wallet-opening');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'case-')),filename=join(dir,'production.sqlite');
  const s=new WalletStore({filename,environment:'production',guildIds:[guild],spinDelay:0});t.after(()=>s.close());return {s,filename,dir};
}
test('production opening credits exactly once and never tops up existing zero or nonzero wallets across restart',t=>{
  const {s,filename}=fixture(t);
  // Genuine pre-upgrade wallets: no initial credit existed at creation time.
  s.db.prepare('INSERT INTO wallets(guild,user,balance) VALUES(?,?,0)').run(guild,zero);
  s.db.prepare('INSERT INTO wallets(guild,user,balance) VALUES(?,?,0)').run(guild,old);
  s.grant(guild,old,old,7350,'existing balance',randomUUID());const history=s.history(guild,old);
  const first=s.state(guild,user);assert.equal(first.balance,10000);assert.equal(s.state(guild,user).balance,10000);
  assert.equal(s.history(guild,user).length,1);assert.equal(s.history(guild,user)[0].kind,'welcome');
  assert.equal(s.state(guild,zero).balance,0);assert.equal(s.history(guild,zero).length,0);
  assert.equal(s.state(guild,old).balance,7350);assert.deepEqual(s.history(guild,old),history);s.close();
  const reopened=new WalletStore({filename,environment:'production',guildIds:[guild]});t.after(()=>reopened.close());
  assert.equal(reopened.state(guild,user).balance,10000);assert.equal(reopened.state(guild,zero).balance,0);assert.equal(reopened.state(guild,old).balance,7350);
  assert.deepEqual(reopened.history(guild,old),history);assert.equal(inspectWalletDatabase(filename,'production').ok,true);
});
test('first spin/checkin/grant include the one-time credit and backups preserve both welcome and legacy empty wallets',t=>{
  const {s,filename,dir}=fixture(t);s.db.prepare('INSERT INTO wallets(guild,user,balance) VALUES(?,?,0)').run(guild,zero);
  const spin=s.spin(guild,user,100,randomUUID());assert.equal(spin.round.before,10000);
  const checkin=s.checkin(guild,old);assert.equal(checkin.entry.before,10000);assert.equal(checkin.state.balance,10500);
  const grantUser='100000000000000005';assert.equal(s.grant(guild,user,grantUser,200,'reward',randomUUID()).entry.after,10200);
  const snapshot=snapshotForCloud(filename,'production');assert.equal(snapshot.tables.ledger.filter(e=>e.kind==='welcome').length,3);
  assert.deepEqual(auditRows(snapshot,t=>snapshot.tables[t],'production',()=>new Map()),auditSnapshot(snapshot,'production'));
  const restoredFile=join(dir,'restored.sqlite');assert.equal(restoreCloudSnapshot(snapshot,restoredFile,'production').ok,true);
  const restored=new WalletStore({filename:restoredFile,environment:'production',guildIds:[guild]});t.after(()=>restored.close());
  assert.equal(restored.state(guild,zero).balance,0);assert.equal(restored.state(guild,user).balance,spin.state.balance);assert.equal(restored.checkin(guild,old).duplicate,true);
  assert.deepEqual(snapshotForCloud(restoredFile,'production').tables,snapshot.tables);
  for(const version of [1,2]){
    const plan=firestoreImportPlan(filename,'production',{version});assert.equal(plan.resources.find(r=>r.path===`wallets/${guild}_${zero}`).data.balance,0);
    assert.equal(plan.resources.filter(r=>/^ledger\//.test(r.path)&&r.data.kind==='welcome').length,3);
  }
  const bad=structuredClone(snapshot);bad.tables.ledger.find(e=>e.kind==='welcome').reason='invalid opening';
  assert.throws(()=>auditSnapshot(bad,'production'),/Welcome/);assert.throws(()=>auditRows(bad,t=>bad.tables[t],'production',()=>new Map()),/Welcome/);
});
