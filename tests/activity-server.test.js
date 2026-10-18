import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createActivityServer } from '../server/app.js';

const id='1561284960986599626';
async function fixture(t, options={}) {
  const root=await mkdtemp(join(tmpdir(),'kemet-auth-'));
  await writeFile(join(root,'index.html'),'<html>game</html>');
  await writeFile(join(root,'.env.server.local'),'private-secret');
  const server=createActivityServer({distDir:root,clientId:id,clientSecret:'test-secret',...options});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await rm(root,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  return (path,options)=>fetch(base+path,options);
}
const post = (body, origin=`https://${id}.discordsays.com`) => ({method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)});

test('backend exchanges an app-specific code and returns only the short-lived access token with no-store',async t=>{
  const request=await fixture(t,{fetchImpl:async(url,opts)=>{
    assert.equal(url,'https://discord.com/api/oauth2/token');
    assert.equal(opts.body.get('client_id'),id);assert.equal(opts.body.get('client_secret'),'test-secret');
    assert.equal(opts.body.get('code'),'abc-code');assert.equal(opts.redirect,'error');
    return Response.json({access_token:'access-test',refresh_token:'never-return',scope:'identify'});
  }});
  const response=await request('/api/token',post({code:'abc-code'}));
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(await response.json(),{access_token:'access-test'});
});
test('bad origins, methods, content types, codes, and oversized requests never reach Discord',async t=>{
  const request=await fixture(t,{fetchImpl:()=>assert.fail('must not contact Discord')});
  assert.equal((await request('/api/token')).status,405);
  assert.equal((await request('/api/token',post({code:'x'},'https://other.example'))).status,403);
  assert.equal((await request('/api/token',{method:'POST',body:'code=x'})).status,415);
  assert.equal((await request('/api/token',post({code:''}))).status,400);
  assert.equal((await request('/api/token',post({code:'x'.repeat(5000)}))).status,413);
});
test('missing credentials and upstream errors are safe and do not leak secrets',async t=>{
  const missing=await fixture(t,{clientSecret:'',fetchImpl:()=>assert.fail('must not fetch')});
  assert.equal((await missing('/api/token',post({code:'x'}))).status,503);
  const broken=await fixture(t,{fetchImpl:async()=>Response.json({error:'test-secret'}, {status:401})});
  const response=await broken('/api/token',post({code:'x'}));
  assert.equal(response.status,502);assert.ok(!(await response.text()).includes('test-secret'));
});
test('static server serves the built entry but blocks dotfiles, source paths, and traversal',async t=>{
  const request=await fixture(t);
  assert.equal(await (await request('/')).text(),'<html>game</html>');
  for(const path of ['/.env.server.local','/%2eenv.server.local','/src/main.js','/..%2f.env.server.local','/api/unknown']){
    assert.equal((await request(path)).status,404,path);
  }
  const head=await request('/',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
});
