import test from 'node:test';
import assert from 'node:assert/strict';
import {FirestoreWalletCore} from '../server/firestore/wallet-core.js';

const guild='100000000000000001',user='100000000000000002';
const wallet=(revision,balance=10000)=>({guild,user,revision,balance,last_spin:0,claimedDay:null,milestone:false,historyRevision:0});
function fixture(stateCacheMs){
 let now=100000,reads=0,remote=wallet(1),hold=null,blocked=false;
 const db={collection:path=>({doc:id=>ref(path+'/'+id)}),terminate:async()=>{}};
 function ref(path){return {path,collection:name=>({doc:id=>ref(path+'/'+name+'/'+id)}),get:async()=>{
  reads++;const data=structuredClone(remote);if(blocked)await new Promise(resolve=>hold=resolve);
  return {exists:true,get:()=>JSON.stringify(data)};
 }};}
 const store=new FirestoreWalletCore({projectId:'demo-test',namespace:'cache-test',environment:'test',schemaVersion:2},{db,quota:{reserve(){},observe(){},close(){}},guildIds:[guild],clock:()=>now,...(stateCacheMs===undefined?{}:{stateCacheMs})});
 return {store,advance:n=>now+=n,set:value=>remote=value,reads:()=>reads,block:()=>blocked=true,release:()=>{blocked=false;hold();}};
}

test('cloud-length lease reduces idle reads without sliding on cache hits; Node keeps five seconds',async()=>{
 for(const [ttl,expected] of [[undefined,5],[30000,3]]){
  const h=fixture(ttl);await h.store.readState(guild,user);
  for(let i=0;i<4;i++){h.advance(17500);await h.store.readState(guild,user);}
  assert.equal(h.reads(),expected);
 }
 const h=fixture(30000);await h.store.readState(guild,user);h.advance(29999);await h.store.readState(guild,user);assert.equal(h.reads(),1);
 h.advance(1);await h.store.readState(guild,user);assert.equal(h.reads(),2);
});

test('late reads return the newer local settlement and cannot replace it or renew its lease',async()=>{
 const h=fixture(30000);h.block();const pending=h.store.readState(guild,user);
 h.advance(100);h.store.cacheWallet(wallet(2,10500));h.release();
 assert.equal((await pending).balance,10500);assert.equal((await h.store.readState(guild,user)).revision,2);
 h.advance(29999);await h.store.readState(guild,user);assert.equal(h.reads(),1);
});

test('in-flight old reads cannot refill a cache invalidated after an unknown transaction outcome',async()=>{
 const h=fixture(30000);h.block();const pending=h.store.readState(guild,user);
 const rejected=assert.rejects(pending,{code:'FIRESTORE_UNAVAILABLE'});
 h.store.safe(new Error('ambiguous commit'));h.set(wallet(3,9900));h.release();await rejected;
 assert.equal(h.store.cache.size,0);assert.equal((await h.store.readState(guild,user)).balance,9900);
});

test('coalesced reads, clock rollback, shutdown and invalid lifetimes fail safely',async()=>{
 const h=fixture(30000);h.block();const a=h.store.readState(guild,user),b=h.store.readState(guild,user);h.release();await Promise.all([a,b]);assert.equal(h.reads(),1);
 h.advance(-1);await h.store.readState(guild,user);assert.equal(h.reads(),2);
 h.store.invalidateCache();h.block();const pending=h.store.readState(guild,user),rejected=assert.rejects(pending,{code:'FIRESTORE_UNAVAILABLE'});await h.store.close();h.release();await rejected;
 h.store.cacheWallet(wallet(4));assert.equal(h.store.cache.size,0,'late commits cannot repopulate a closed store');
 for(const value of [-1,30001,1.5,NaN])assert.throws(()=>fixture(value),/cache lifetime/);
});
