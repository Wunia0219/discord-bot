import test from 'node:test';
import assert from 'node:assert/strict';
import {checkDiscordReadiness,publicOrigin} from '../server/discord-readiness.js';
import {commandDefinitions} from '../server/commands.js';
import {MODEL_VERSION} from '../src/game/slot-math.js';
const id='100000000000000001',guild='100000000000000002';
const env={DISCORD_CLIENT_ID:id,DISCORD_CLIENT_SECRET:'never-output-secret',DISCORD_PUBLIC_KEY:'a'.repeat(64),
  ALLOWED_GUILD_IDS:guild,WALLET_ENABLED:'true',WALLET_BACKEND:'firestore',APP_ENV:'test',HOST:'127.0.0.1',PORT:'4188'};
const frontend={VITE_DISCORD_CLIENT_ID:id,VITE_DISCORD_AUTH_ENABLED:'true',VITE_DISCORD_WALLET_ENABLED:'true'};
const config={env,frontend,built:true};
function fake(url,options={}){
  if(url.endsWith('/oauth2/token'))return Response.json({access_token:'never-output-token'});
  if(url.includes('/guilds/'))return Response.json(commandDefinitions);
  if(url.endsWith('/commands'))return Response.json([{type:4,handler:1}]);
  if(url.endsWith('/healthz'))return Response.json({ok:true,model:MODEL_VERSION});
  if(url.endsWith('/readyz'))return Response.json({ok:true});
  if(url.endsWith('/api/wallet')||url.endsWith('/api/interactions'))return Response.json({error:'private'},{status:401});
  return new Response('<html></html>',{headers:{'Content-Type':'text/html'}});
}
test('offline readiness validates config without opening databases or using network',async()=>{
  const result=await checkDiscordReadiness({...config,offline:true,fetchImpl:()=>assert.fail('offline')});
  assert.equal(result.ok,true);assert.equal(result.scope,'configuration-only');assert.ok(result.manual.length);
  assert.doesNotMatch(JSON.stringify(result),/never-output|aaaaaaa/);
  for(const changes of [{LOCAL_WALLET_TEST:'true'},{ALLOWED_GUILD_IDS:''},{DISCORD_CLIENT_SECRET:''},{PORT:'no'}])
    assert.equal((await checkDiscordReadiness({...config,env:{...env,...changes},offline:true})).ok,false);
  assert.equal((await checkDiscordReadiness({...config,frontend:{...frontend,VITE_CLIENT_SECRET:'secret'},offline:true})).ok,false);
});
test('readiness checks routes and command definitions without sending messages or modifying Discord',async()=>{
  const calls=[];const result=await checkDiscordReadiness({...config,discord:true,origin:'https://game.example',fetchImpl:async(url,options)=>{
    calls.push({url,options});return fake(url,options);
  }});
  assert.equal(result.ok,true);assert.ok(result.checks.some(row=>row.code==='ACTIVITY_ENTRY'&&row.status==='pass'));
  assert.ok(calls.every(({url,options})=>!options.method||options.method==='GET'||url.endsWith('/oauth2/token')||url.endsWith('/api/interactions')));
  assert.ok(calls.every(({url})=>!url.includes('/messages')));
  assert.doesNotMatch(JSON.stringify(result),/never-output/);
});
test('wrong static API mappings, missing commands and OAuth errors fail closed without secret output',async()=>{
  const result=await checkDiscordReadiness({...config,discord:true,fetchImpl:async(url,options)=>{
    if(url.endsWith('/api/wallet'))return new Response('<html></html>',{headers:{'Content-Type':'text/html'}});
    if(url.includes('/guilds/'))return Response.json([]);return fake(url,options);
  }});
  assert.equal(result.ok,false);assert.ok(result.checks.some(row=>row.code==='LOCAL:/api/wallet'&&row.status==='fail'));
  const failed=await checkDiscordReadiness({...config,discord:true,fetchImpl:async()=>{throw new Error('never-output-secret');}});
  assert.equal(failed.ok,false);assert.doesNotMatch(JSON.stringify(failed),/never-output/);
});
test('public probes require explicit HTTPS origin and cannot be combined with offline mode',async()=>{
  for(const value of ['http://game.example','https://user:secret@game.example','https://game.example/path','https://game.example/?token=x'])assert.throws(()=>publicOrigin(value));
  await assert.rejects(checkDiscordReadiness({...config,offline:true,discord:true}),/Offline/);
});
