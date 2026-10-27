import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createActivityServer } from '../server/http/app.js';
import { localTestWalletConfig, isLocalTestRequest } from '../server/testing/local-test-wallet.js';
import { connectLocalWallet } from '../src/platform/local-wallet.js';
import { inspectWalletDatabase } from '../server/sqlite/database.js';

test('local sessions are unavailable unless explicitly enabled on a test database and loopback host',()=>{
  for(const env of [ {},{APP_ENV:'production',HOST:'127.0.0.1',WALLET_ENABLED:'true',DATABASE_PATH:':memory:'},
    {APP_ENV:'test',HOST:'0.0.0.0',WALLET_ENABLED:'true',DATABASE_PATH:':memory:'}]){
    assert.throws(()=>localTestWalletConfig(env),/Local wallet testing requires/);
  }
});

test('local request guards reject remote addresses, DNS rebinding, forwarded tunnels and foreign origins',()=>{
  const req={socket:{localPort:4189,localAddress:'127.0.0.1',remoteAddress:'127.0.0.1'},headers:{host:'127.0.0.1:4189'}};
  assert.equal(isLocalTestRequest(req),true);
  for(const headers of [{host:'evil.example:4189'},{origin:'https://evil.example'},{origin:'null'},
    {'x-forwarded-host':'127.0.0.1:4189'},{'x-forwarded-for':'1.2.3.4'},{forwarded:'for=1.2.3.4'},
    {'cf-connecting-ip':'1.2.3.4'},{'sec-fetch-site':'cross-site'}]){
    assert.equal(isLocalTestRequest({...req,headers:{...req.headers,...headers}}),false);
  }
  assert.equal(isLocalTestRequest({...req,socket:{...req.socket,remoteAddress:'192.168.1.2'}}),false);
});

test('local browser connection fails closed instead of falling back to the browser wallet',async()=>{
  const location={hostname:'127.0.0.1',protocol:'http:',search:'?wallet=local'};
  assert.equal(await connectLocalWallet({...location,search:''},()=>assert.fail()),null);
  for(const changed of [{hostname:'site.netlify.app'},{protocol:'https:'},{search:'?wallet=local&frame_id=test'}]){
    await assert.rejects(connectLocalWallet({...location,...changed},()=>assert.fail()),/本機錢包測試/);
  }
  await assert.rejects(connectLocalWallet(location,async()=>Response.json({}, {status:404})),/尚未啟動/);
  await assert.rejects(connectLocalWallet(location,async()=>Response.json({mode:'browser'})),/連接失敗/);
});

test('local browser profile selection is sent explicitly and keeps each wallet identity',async()=>{
  const activity={mode:'local',user:{id:'100000000000000012'},session:{token:'test-token',userId:'100000000000000012',environment:'test'}};
  const result=await connectLocalWallet({hostname:'127.0.0.1',protocol:'http:',search:'?wallet=local&player=qa-b'},async(path,options)=>{
    assert.equal(path,'/api/local-session');assert.deepEqual(JSON.parse(options.body),{profile:'qa-b'});
    return Response.json(activity);
  });
  assert.deepEqual(result,activity);
});

test('acceptance fixtures stay isolated and never reset balances or checkins on reopen',async t=>{
  const root=await mkdtemp(join(tmpdir(),'circus-qa-fixtures-'));
  const env={APP_ENV:'test',HOST:'127.0.0.1',WALLET_ENABLED:'true',DATABASE_PATH:join(root,'wallet.sqlite')};
  let wallet=localTestWalletConfig(env);
  t.after(async()=>{wallet.store.close();await rm(root,{recursive:true,force:true});});
  const initial=wallet.localOverview();
  assert.deepEqual(initial.profiles.map(profile=>profile.balance),[10000,10000,50,0]);
  assert.ok(initial.profiles.every(profile=>profile.claimed===false&&profile.rounds===0));
  assert.ok(initial.profiles.every(profile=>profile.created===false));
  assert.equal(wallet.store.db.prepare('SELECT COUNT(*) n FROM wallets').get().n,0);
  const sessions={};
  for(const key of ['qa-a','qa-b','qa-low','qa-zero']){
    const login=wallet.service.createLocal(key);sessions[key]=await wallet.service.authorize('Bearer '+login.session.token);
  }
  assert.throws(()=>wallet.service.createLocal('1561284960986599626'),error=>error.status===400);
  const a=sessions['qa-a'],b=sessions['qa-b'],low=sessions['qa-low'],zero=sessions['qa-zero'];
  wallet.store.checkin(a.guild,a.user);assert.equal(wallet.store.state(b.guild,b.user).balance,10000);
  assert.throws(()=>wallet.store.spin(low.guild,low.user,100,'insufficient-qa-request-1'),error=>error.status===409);
  assert.throws(()=>wallet.store.spin(zero.guild,zero.user,20,'insufficient-qa-request-2'),error=>error.status===409);
  assert.equal(wallet.store.state(low.guild,low.user).history.length,0);
  wallet.store.checkin(zero.guild,zero.user);
  const saved=wallet.localOverview();
  assert.deepEqual(saved.profiles.map(profile=>profile.balance),[10500,10000,50,500]);
  wallet.store.close();wallet=localTestWalletConfig(env);
  assert.deepEqual(wallet.localOverview(),saved);
  assert.equal(wallet.store.checkin(zero.guild,zero.user).duplicate,true);
  assert.equal(inspectWalletDatabase(env.DATABASE_PATH,'test').ok,true);
});

test('local game uses persisted server wallets, daily idempotency and saved rounds without Discord',async t=>{
  const root=await mkdtemp(join(tmpdir(),'circus-local-wallet-'));
  const env={APP_ENV:'test',HOST:'127.0.0.1',WALLET_ENABLED:'true',DATABASE_PATH:join(root,'wallet.sqlite')};
  let wallet=localTestWalletConfig(env);
  const server=createActivityServer({wallet,fetchImpl:()=>assert.fail('must not contact Discord')});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});wallet.store.close();await rm(root,{recursive:true,force:true});});
  const origin=`http://127.0.0.1:${server.address().port}`;
  const request=(path,options)=>fetch(origin+path,options);
  assert.equal((await request('/readyz')).status,200,'explicit loopback test mode does not require Discord credentials');
  const loginOptions={method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({userId:'1561284960986599626'})};
  const guide=await request('/wallet-test');assert.equal(guide.status,200);assert.match(await guide.text(),/錢包本機驗收/);
  assert.match(guide.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  const overview=await (await request('/api/local-test')).json();assert.equal(overview.profiles.length,4);assert.equal(overview.cases.length,12);
  assert.ok(!JSON.stringify(overview).includes(root));assert.ok(!JSON.stringify(overview).includes('token'));
  assert.equal((await request('/wallet-test',{headers:{'x-forwarded-host':'evil.example'}})).status,403);
  assert.equal((await request('/api/local-test',{method:'POST'})).status,405);
  assert.equal((await request('/api/local-session',{...loginOptions,body:JSON.stringify({profile:'forged'})})).status,400);
  assert.equal((await request('/api/local-session')).status,405);
  assert.equal((await request('/api/local-session',{...loginOptions,headers:{...loginOptions.headers,Origin:'https://evil.example'}})).status,403);
  assert.equal((await request('/api/local-session',{...loginOptions,headers:{'Content-Type':'application/json'}})).status,403);
  assert.equal((await request('/api/token',loginOptions)).status,404);
  assert.equal((await request('/api/interactions',loginOptions)).status,404);
  assert.equal((await request('/api/wallet')).status,401);
  const activity=await (await request('/api/local-session',loginOptions)).json();
  assert.equal(activity.mode,'local');assert.equal(activity.session.userId,'100000000000000002');
  const headers={Origin:origin,'Content-Type':'application/json',Authorization:'Bearer '+activity.session.token,'X-Wallet-Epoch':activity.session.walletEpoch};
  assert.equal((await request('/api/wallet',{headers:{...headers,'x-forwarded-for':'1.2.3.4'}})).status,403);
  const initial=await (await request('/api/wallet',{headers})).json();assert.equal(initial.state.balance,10000);
  for(let i=0;i<2;i++)assert.equal((await request('/api/checkin',{method:'POST',headers,body:'{}'})).status,200);
  const spin=await (await request('/api/spin',{method:'POST',headers,body:JSON.stringify({bet:100,requestId:'local-test-spin-00000001'})})).json();
  assert.equal(spin.round.before,10500);assert.equal(spin.state.history.length,1);
  const entries=await (await request('/api/ledger',{headers})).json();
  assert.deepEqual(entries.entries.map(entry=>entry.kind),['spin','checkin','test_seed']);
  // Reopen the database and log in again, without browser storage or a Discord token.
  wallet.store.close();
  const restored=localTestWalletConfig(env);
  wallet.store=restored.store;wallet.service=restored.service;
  assert.equal((await request('/api/wallet',{headers})).status,401);
  const second=await (await request('/api/local-session',loginOptions)).json();
  const saved=await (await request('/api/wallet',{headers:{Authorization:'Bearer '+second.session.token,'X-Wallet-Epoch':second.session.walletEpoch}})).json();
  assert.equal(saved.state.balance,spin.state.balance);assert.equal(saved.state.claimed,true);
  assert.equal(saved.state.history[0].id,spin.round.id);
});

test('normal Discord servers do not expose the local session endpoint',async t=>{
  const server=createActivityServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/local-session`,{method:'POST'})).status,404);
  for(const path of ['/wallet-test','/api/local-test'])assert.equal((await fetch(`http://127.0.0.1:${server.address().port}${path}`)).status,404);
});
