import test from 'node:test';
import assert from 'node:assert/strict';
import {createActivityServer} from '../server/http/app.js';

test('Node applies privacy headers on rejected requests as well as successful API responses',async t=>{
 const server=createActivityServer({});await new Promise(done=>server.listen(0,'127.0.0.1',done));
 t.after(()=>new Promise(done=>{server.close(done);server.closeAllConnections();}));
 const origin=`http://127.0.0.1:${server.address().port}`;
 for(const path of ['/healthz','/api/wallet','/.env','/api/unknown']){
  const response=await fetch(origin+path);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.get('referrer-policy'),'no-referrer');
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 }
});
