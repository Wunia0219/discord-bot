import test from 'node:test';
import assert from 'node:assert/strict';
import { createWalletClient } from '../src/wallet-client.js';
test('lost response retries the same bet and id, including a page reload, without storing session secrets',async()=>{
 const data=new Map();const storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 const session={token:'private-session',guildId:'guild',userId:'user'};let first;
 const a=createWalletClient(session,async(url,opts)=>{first=JSON.parse(opts.body);throw new Error('network');},storage);
 await assert.rejects(a.spin(100),/網路/);assert.ok(![...data.values()].join('').includes(session.token));
 const b=createWalletClient(session,async(url,opts)=>{assert.deepEqual(JSON.parse(opts.body),first);return Response.json({round:{id:'same'}});},storage);
 await b.spin(500);assert.equal(b.hasPending(),false);assert.equal(data.size,0);
});
