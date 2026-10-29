import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createActivityServer } from '../server/http/app.js';
import { WalletStore } from '../server/wallet/wallet.js';
import { WalletService } from '../server/wallet/wallet-service.js';
import { createWalletClient } from '../src/platform/wallet-client.js';
import { LoginRateLimit } from '../server/http/login-rate-limit.js';

const id='1561284960986599626';
async function fixture(t, options={}) {
  const root=await mkdtemp(join(tmpdir(),'kemet-auth-'));
  await writeFile(join(root,'index.html'),'<html>game</html>');
  await writeFile(join(root,'background.mp3'),Buffer.from([0x49,0x44,0x33]));
  await writeFile(join(root,'.env.server.local'),'private-secret');
  const server=createActivityServer({distDir:root,clientId:id,clientSecret:'test-secret',publicKey:'ab'.repeat(32),...options});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await rm(root,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  return (path,options)=>fetch(base+path,options);
}
const post = (body, origin=`https://${id}.discordsays.com`) => ({method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)});

test('readiness checks the actual wallet database and stays separate from process liveness',async t=>{
  const disabled=await fixture(t);
  assert.equal((await disabled('/healthz')).status,200);
  assert.equal((await disabled('/readyz')).status,503);
  const store=new WalletStore({guildIds:['1441097301685698703']});t.after(()=>store.close());
  const request=await fixture(t,{wallet:{store}});
  const ready=await request('/readyz');
  assert.equal(ready.status,200);assert.equal(ready.headers.get('cache-control'),'no-store');
  assert.deepEqual(await ready.json(),{ok:true});
  const head=await request('/readyz',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  assert.equal((await request('/readyz',{method:'POST'})).status,405);
  store.close();
  const unavailable=await request('/readyz');assert.equal(unavailable.status,503);
  assert.deepEqual(await unavailable.json(),{ok:false});
  assert.equal((await request('/healthz')).status,200);
});

test('the configured local backend port is allowed without trusting arbitrary request origins',async t=>{
  let exchanges=0;
  const request=await fixture(t,{localPort:4189,fetchImpl:async()=>{
    exchanges++;return Response.json({access_token:'access-test',scope:'identify'});
  }});
  assert.equal((await request('/api/token',post({code:'code'},'http://127.0.0.1:4189'))).status,200);
  assert.equal((await request('/api/token',post({code:'code'},'http://127.0.0.1:4190'))).status,403);
  assert.equal(exchanges,1);
});

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

test('Discord readiness refuses incomplete credentials even when its database is healthy',async t=>{
  const store=new WalletStore({guildIds:['1441097301685698703']});t.after(()=>store.close());
  for(const options of [{clientId:'invalid'},{clientSecret:''},{publicKey:undefined},{publicKey:'not-a-key'}]){
    const request=await fixture(t,{wallet:{store},...options});
    assert.equal((await request('/healthz')).status,200);
    const response=await request('/readyz');
    assert.equal(response.status,503);assert.deepEqual(await response.json(),{ok:false});
  }
});

test('sequential failed logins are limited across rotating codes and spoofed forwarding headers, then recover',async t=>{
  let now=0,calls=0,succeed=false;
  const request=await fixture(t,{loginClock:()=>now,fetchImpl:async()=>{
    calls++;
    return succeed?Response.json({access_token:'access-test',scope:'identify'}):Response.json({error:'private-provider-detail'},{status:400});
  }});
  for(let i=0;i<10;i++){
    const options=post({code:`different-code-${i}`});
    options.headers['X-Forwarded-For']=`203.0.113.${i+1}`;
    options.headers['CF-Connecting-IP']=`203.0.113.${i+1}`;
    const response=await request('/api/token',options);
    assert.equal(response.status,502);assert.ok(!(await response.text()).includes('private-provider-detail'));
  }
  const blocked=await request('/api/token',post({code:'another-code'}));
  assert.equal(blocked.status,429);assert.equal(blocked.headers.get('Retry-After'),'60');assert.equal(calls,10);
  now=59001;
  const waiting=await request('/api/token',post({code:'later-code'}));
  assert.equal(waiting.status,429);assert.equal(waiting.headers.get('Retry-After'),'1');assert.equal(calls,10);
  now=60000;succeed=true;
  assert.equal((await request('/api/token',post({code:'recovered-code'}))).status,200);
  assert.equal(calls,11);
});

test('successful logins do not consume the failure budget or erase recent failures',async t=>{
  let fail=false;
  const request=await fixture(t,{loginClock:()=>0,fetchImpl:async()=>fail?Response.json({},{status:400}):Response.json({access_token:'access-test',scope:'identify'})});
  for(let i=0;i<12;i++)assert.equal((await request('/api/token',post({code:'success-'+i}))).status,200);
  fail=true;
  for(let i=0;i<9;i++)assert.equal((await request('/api/token',post({code:'failure-'+i}))).status,502);
  fail=false;assert.equal((await request('/api/token',post({code:'success-between-failures'}))).status,200);
  fail=true;assert.equal((await request('/api/token',post({code:'tenth-failure'}))).status,502);
  assert.equal((await request('/api/token',post({code:'blocked-after-success'}))).status,429);
});

test('login attempt budgets roll forward and concurrent late failures wait for enough slots',()=>{
  let now=0;
  const rate=new LoginRateLimit({clock:()=>now});
  for(let i=0;i<120;i++)assert.equal(rate.take(),0);
  assert.equal(rate.take(),60000);assert.equal(rate.attempts.length,120);
  now=60000;assert.equal(rate.take(),0);
  for(let i=0;i<11;i++){now=60000+i*1000;rate.failed();}
  assert.equal(rate.take(),51000);
  now=120000;assert.equal(rate.take(),1000,'one expiration does not yet reopen an overfull failure window');
  now=121000;assert.equal(rate.take(),0);
  assert.equal(rate.failures.length,9);
});

test('upstream 429 backoff blocks further exchanges and preserves Retry-After',async t=>{
  let now=0,calls=0;
  const request=await fixture(t,{loginClock:()=>now,fetchImpl:async()=>{
    calls++;
    return calls===1?Response.json({},{status:429,headers:{'Retry-After':'12'}}):Response.json({access_token:'access-test',scope:'identify'});
  }});
  const first=await request('/api/token',post({code:'provider-limited'}));
  assert.equal(first.status,429);assert.equal(first.headers.get('Retry-After'),'12');
  now=1000;
  const second=await request('/api/token',post({code:'not-sent-to-provider'}));
  assert.equal(second.status,429);assert.equal(second.headers.get('Retry-After'),'11');assert.equal(calls,1);
  now=12000;
  assert.equal((await request('/api/token',post({code:'after-provider-backoff'}))).status,200);
  assert.equal(calls,2);
});

test('eight concurrent exchanges keep a ninth request away from the provider and release their slots',{timeout:5000},async t=>{
  let calls=0,entered;
  const allEntered=new Promise(resolve=>{entered=resolve;});
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const request=await fixture(t,{fetchImpl:async()=>{
    if(++calls===8)entered();
    await gate;return Response.json({access_token:'access-test',scope:'identify'});
  }});
  const requests=Array.from({length:8},(_,i)=>request('/api/token',post({code:'concurrent-'+i})));
  try{
    await allEntered;
    const response=await request('/api/token',post({code:'ninth-code'}));
    assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'1');assert.equal(calls,8);
  }finally{release();await Promise.all(requests);}
  assert.equal((await request('/api/token',post({code:'after-slots-released'}))).status,200);
});

test('invalid upstream retry intervals use a finite fallback and recover',async t=>{
  for(const interval of ['NaN','-1','1e300']){
    let now=0,calls=0;
    const request=await fixture(t,{loginClock:()=>now,fetchImpl:async()=>{calls++;return Response.json({},{status:429,headers:{'Retry-After':interval}});}});
    const response=await request('/api/token',post({code:'provider-backoff'}));
    assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'60');
    now=60000;
    const recovered=await request('/api/token',post({code:'provider-backoff-again'}));
    assert.equal(recovered.headers.get('Retry-After'),'60');assert.equal(calls,2);
  }
});
test('static server serves the built entry but blocks dotfiles, source paths, and traversal',async t=>{
  const request=await fixture(t);
  assert.equal(await (await request('/')).text(),'<html>game</html>');
  for(const path of ['/.env.server.local','/%2eenv.server.local','/src/main.js','/..%2f.env.server.local','/api/unknown']){
    assert.equal((await request(path)).status,404,path);
  }
  const head=await request('/',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  const music=await request('/background.mp3');assert.equal(music.status,200);assert.equal(music.headers.get('content-type'),'audio/mpeg');
  assert.equal(music.headers.get('accept-ranges'),'bytes');
  assert.deepEqual(Buffer.from(await music.arrayBuffer()),Buffer.from([0x49,0x44,0x33]));
});

test('MP3 media supports iOS range probes, suffixes and seeking without changing ordinary static responses',async t=>{
  const request=await fixture(t);
  for(const [range,expected,contentRange] of [
    ['bytes=0-1',[0x49,0x44],'bytes 0-1/3'],
    ['bytes=1-',[0x44,0x33],'bytes 1-2/3'],
    ['bytes=-1',[0x33],'bytes 2-2/3'],
    ['bytes=-5',[0x49,0x44,0x33],'bytes 0-2/3'],
    ['bytes=1-99',[0x44,0x33],'bytes 1-2/3'],
  ]){
    const response=await request('/background.mp3',{headers:{Range:range}});
    assert.equal(response.status,206);assert.equal(response.headers.get('content-type'),'audio/mpeg');
    assert.equal(response.headers.get('content-range'),contentRange);assert.equal(response.headers.get('content-length'),String(expected.length));
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],expected);
  }
  for(const range of ['bytes=3-','bytes=2-1','bytes=-0','bytes=9007199254740992-']){
    const response=await request('/background.mp3',{headers:{Range:range}});
    assert.equal(response.status,416);assert.equal(response.headers.get('content-range'),'bytes */3');assert.equal(await response.text(),'');
  }
  for(const range of ['bytes=-','bytes=0-1,2-2','invalid'])assert.equal((await request('/background.mp3',{headers:{Range:range}})).status,200);
  const head=await request('/background.mp3',{method:'HEAD',headers:{Range:'bytes=0-1'}});
  assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),'3');assert.equal(await head.text(),'');
  assert.equal((await request('/background.mp3',{headers:{Range:'bytes=0-1','If-Range':'unknown-validator'}})).status,200);
  assert.equal((await request('/',{headers:{Range:'bytes=0-1'}})).status,200);
});

test('wallet HTTP routes require verified sessions, isolate callers and settle concurrent retries once',async t=>{
 let now=Date.parse('2026-10-19T05:00:00Z');
 const guild='1441097301685698703',store=new WalletStore({guildIds:[guild],clock:()=>now});t.after(()=>store.close());
 const service=new WalletService(store,{fetchImpl:async url=>Response.json(url.endsWith('/users/@me')?{id}:{user:{id}})});
 const request=await fixture(t,{wallet:{store,service,adminRoles:[]},fetchImpl:async()=>Response.json({access_token:'provider-token',expires_in:3600,scope:'identify guilds.members.read'})});
 assert.equal((await request('/api/wallet')).status,401);
 const login=await (await request('/api/token',post({code:'code',guildId:guild,userId:'not-trusted'}))).json();
 assert.equal(login.session.userId,id);
 const headers={'Content-Type':'application/json',Authorization:'Bearer '+login.session.token};
 const requests=await Promise.all(Array.from({length:40},()=>request('/api/checkin',{method:'POST',headers,body:'{}'})));
 assert.ok(requests.every(r=>r.status===200));assert.equal(store.state(guild,id).balance,10500);
 const spins=await Promise.all(Array.from({length:20},()=>request('/api/spin',{method:'POST',headers,body:JSON.stringify({bet:100,requestId:'11111111-2222-3333-4444-555555555555',userId:'fake',guildId:'fake',stops:[0,0,0,0,0],payout:9999999})}).then(r=>r.json())));
 assert.ok(spins.every(r=>r.round.id===spins[0].round.id));assert.equal(store.history(guild,id).filter(e=>e.kind==='spin').length,1);
 assert.equal(store.history(guild,id).filter(e=>e.kind==='checkin').length,1);
 assert.equal(spins[0].state.spinCooldownMs,2000);
 const next={method:'POST',headers,body:JSON.stringify({bet:20,requestId:'11111111-2222-3333-4444-555555555556'})};
 const cooldown=await request('/api/spin',next);
 assert.equal(cooldown.status,429);assert.equal(cooldown.headers.get('retry-after'),'2');
 assert.deepEqual(await cooldown.json(),{error:'轉輪尚未就緒，請稍後再試。',code:'SPIN_COOLDOWN',retryAfterMs:2000});
 assert.equal(store.history(guild,id).filter(e=>e.kind==='spin').length,1);
 now+=2000;
 const retry=await request('/api/spin',next);assert.equal(retry.status,200);
 assert.equal(retry.headers.get('server-timing'),null);
 assert.equal(store.history(guild,id).filter(e=>e.kind==='spin').length,2);
 assert.equal((await request('/api/interactions',post({type:2}))).status,401);
});

test('separate device sessions share wallet, checkin and rounds in both directions', async t => {
  let now=Date.parse('2026-10-20T02:00:00Z');
  const guild='1441097301685698703';
  const store=new WalletStore({guildIds:[guild],clock:()=>now});t.after(()=>store.close());
  const service=new WalletService(store,{clock:()=>now,fetchImpl:async(url,options)=>{
    assert.ok(['Bearer provider-desktop','Bearer provider-mobile'].includes(options.headers.Authorization));
    return Response.json(url.endsWith('/users/@me')?{id}:{user:{id},pending:false});
  }});
  const request=await fixture(t,{wallet:{store,service,adminRoles:[]},fetchImpl:async(url,options)=>
    Response.json({access_token:'provider-'+options.body.get('code'),expires_in:3600,scope:'identify guilds.members.read'})});
  async function device(code) {
    const response=await request('/api/token',post({code,guildId:guild}));
    assert.equal(response.status,200);
    const {session}=await response.json();
    return {session,client:createWalletClient(session,request,null,{clock:()=>now,wait:async ms=>{now+=ms;}})};
  }
  const desktop=await device('desktop'),mobile=await device('mobile');
  assert.notEqual(desktop.session.token,mobile.session.token);
  assert.equal(desktop.session.userId,mobile.session.userId);
  assert.equal(desktop.session.guildId,mobile.session.guildId);
  assert.deepEqual((await desktop.client.state()).state,(await mobile.client.state()).state);

  const desktopRound=await desktop.client.spin(100);
  assert.deepEqual((await mobile.client.state()).state,desktopRound.state);
  const mobileCheckin=await mobile.client.checkin();
  assert.equal(mobileCheckin.state.claimed,true);
  assert.deepEqual((await desktop.client.state()).state,mobileCheckin.state);
  const repeatedCheckin=await desktop.client.checkin();
  assert.equal(repeatedCheckin.duplicate,true);
  assert.equal(repeatedCheckin.state.balance,mobileCheckin.state.balance);

  now+=2000;
  const mobileRound=await mobile.client.spin(20);
  const desktopView=(await desktop.client.state()).state;
  assert.deepEqual(desktopView,mobileRound.state);
  assert.deepEqual(desktopView.history.map(round=>round.id),[mobileRound.round.id,desktopRound.round.id]);
  assert.equal(desktopView.balance,10500+desktopRound.round.net+mobileRound.round.net);
  const desktopLedger=await desktop.client.ledger(),mobileLedger=await mobile.client.ledger();
  assert.deepEqual(desktopLedger,mobileLedger);
  const entries=store.history(guild,id);
  assert.equal(entries.filter(entry=>entry.kind==='spin').length,2);
  assert.equal(entries.filter(entry=>entry.kind==='checkin').length,1);
});

test('announcement failures cannot fail a settled spin or trust client identity/result fields', async t => {
  const guild='1441097301685698703',store=new WalletStore({guildIds:[guild]});t.after(()=>store.close());
  const session={guild,user:id,profile:{name:'Discord 驗證的名稱'}};
  const { mock }=await import('node:test');
  const warning=mock.method(console,'warn',()=>{});t.after(()=>warning.mock.restore());
  let queued;
  const wallet={store,service:{authorize:async()=>session},highlights:{enqueue:(verified,roundId)=>{
    queued={verified,roundId};throw new Error('webhook-not-available');
  }}};
  const request=await fixture(t,{wallet});
  const response=await request('/api/spin',post({bet:20,requestId:'11111111-2222-3333-4444-555555555555',userId:'forged',payout:999999,name:'forged'}));
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(queued.verified,session);assert.equal(queued.roundId,result.round.id);
  assert.equal(store.history(guild,id).filter(entry=>entry.kind==='spin').length,1);
  assert.equal(warning.mock.callCount(),1);
  assert.ok(!JSON.stringify(result).includes('webhook'));
});
