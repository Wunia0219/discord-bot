import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {FirestoreWalletStore} from '../server/firestore/wallet.js';
import {firestoreSettings} from '../server/firestore/settings.js';

assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8787');
const guild='100000000000000001',user='100000000000000002',other='100000000000000004',admin='100000000000000003';
test('single-writer cache immediately reflects every mutation and still expires independently of polling',async t=>{
 mkdirSync('test-results/state-cache',{recursive:true});const directory=mkdtempSync(resolve('test-results/state-cache/case-'));
 const settings=firestoreSettings({APP_ENV:'test',FIRESTORE_PROJECT_ID:'demo-jokers-circus',FIRESTORE_NAMESPACE:'cache-'+randomUUID()+'-test',FIRESTORE_SCHEMA_VERSION:'2',FIRESTORE_EMULATOR_HOST:process.env.FIRESTORE_EMULATOR_HOST,FIRESTORE_QUOTA_PATH:join(directory,'quota.sqlite')});
 let now=Date.parse('2026-10-28T02:00:00Z');const store=new FirestoreWalletStore(settings,{guildIds:[guild],stateCacheMs:30000,clock:()=>now});t.after(()=>store.close());await store.initialize();
 const view=()=>store.state(guild,user,{compact:true});
 await view();await store.state(guild,other,{compact:true});
 const originalRead=store.read.bind(store);let reads=0;store.read=(...args)=>{reads++;return originalRead(...args);};
 now+=17500;assert.equal((await view()).balance,10000);assert.equal(reads,0,'idle polling uses the committed writer cache');
 const grant=await store.grant(guild,admin,user,250,'cache integration',randomUUID());assert.equal((await view()).balance,10250);
 await store.reverse(guild,admin,grant.entry.id,'cache reversal',randomUUID());assert.equal((await view()).balance,10000);
 const claim=await store.checkin(guild,user,{compact:true});assert.equal((await view()).balance,claim.state.balance);assert.equal((await view()).claimed,true);
 now+=2000;const requestId=randomUUID(),round=await store.spin(guild,user,20,requestId,{compact:true});
 assert.equal((await view()).balance,round.state.balance);assert.equal((await view()).historyRevision,round.state.historyRevision);
 assert.equal((await store.spin(guild,user,20,requestId,{compact:true})).duplicate,true);assert.equal((await view()).balance,round.state.balance);
 await store.resetWallets(guild,admin,randomUUID());
 assert.equal((await view()).balance,10000);assert.equal((await store.state(guild,other,{compact:true})).balance,10000);assert.ok((await view()).balanceReset);
 reads=0;now+=17500;await view();assert.equal(reads,0);now+=12500;await view();assert.equal(reads,1,'cache expires at 30 seconds despite intermediate polls');
 store.invalidateCache();reads=0;await view();assert.equal(reads,1,'ownership invalidation forces a fresh authoritative read');
});
