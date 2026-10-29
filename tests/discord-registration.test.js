import test from 'node:test';
import assert from 'node:assert/strict';
import {registerCommands} from '../server/discord/discord-registration.js';
import {checkDiscordReadiness} from '../server/discord/discord-readiness.js';
import {commandDefinitions} from '../server/discord/commands.js';
const guild='100000000000000001',app='100000000000000002',env={DISCORD_CLIENT_ID:app,DISCORD_CLIENT_SECRET:'fixture-private',ALLOWED_GUILD_IDS:guild};
test('registration patches existing IDs, removes only retired slash commands and preserves Launch and unrelated commands',async()=>{
  const calls=[],messages=[],guildCommands=[{type:1,name:'戲籌',id:'balance'},{type:1,name:'戲籌管理',id:'admin'},{type:1,name:'簽到',id:'retired'},{type:2,name:'簽到',id:'context'}];
  const globalCommands=[{type:4,name:'Launch',id:'entry'},{type:1,name:'簽到',id:'global-retired'},{type:1,name:'unrelated',id:'other'}];
  await registerCommands({env,log:s=>messages.push(s),fetchImpl:async(url,options={})=>{
    calls.push({url,...options});
    if(url.endsWith('/oauth2/token'))return Response.json({access_token:'fixture-token'});
    if(!options.method)return Response.json(url.includes('/guilds/')?guildCommands:globalCommands);
    return new Response(options.method==='DELETE'?null:'{}',{status:options.method==='DELETE'?204:200});
  }});
  const edits=calls.filter(c=>['PATCH','POST','PUT','DELETE'].includes(c.method)&&!c.url.endsWith('/oauth2/token'));
  assert.deepEqual(edits.map(c=>[c.method,c.url.split('/').at(-1)]),[['PATCH','balance'],['PATCH','admin'],['DELETE','retired'],['DELETE','global-retired']]);
  assert.ok(edits.filter(c=>c.method==='PATCH').every(c=>JSON.parse(c.body).options.length===0));assert.doesNotMatch(messages.join('\n'),/fixture-private|fixture-token/);
});
test('registration fails closed if current and legacy names have different IDs',async()=>{
  const writes=[];
  await assert.rejects(registerCommands({env,log:()=>{},fetchImpl:async(url,options={})=>{
    if(url.endsWith('/oauth2/token'))return Response.json({access_token:'token'});
    if(!options.method)return Response.json([{type:1,name:'戲籌',id:'new'},{type:1,name:'籌碼',id:'old'}]);
    writes.push(url);return Response.json({});
  }}),/新舊指令並存/);assert.equal(writes.length,0);
});
test('readiness rejects a retired checkin command left in either scope',async()=>{
  for(const scope of ['guild','global']){
    const result=await checkDiscordReadiness({env:{...env,DISCORD_PUBLIC_KEY:'a'.repeat(64),WALLET_ENABLED:'true',APP_ENV:'test',HOST:'127.0.0.1'},discord:true,built:true,fetchImpl:async(url)=>{
      if(url.endsWith('/oauth2/token'))return Response.json({access_token:'fixture'});
      if(url.includes('/guilds/'))return Response.json([...commandDefinitions,...(scope==='guild'?[{type:1,name:'簽到'}]:[])]);
      if(url.endsWith('/commands'))return Response.json([{type:4,handler:1},...(scope==='global'?[{type:1,name:'簽到'}]:[])]);
      return Response.json({});
    }});
    assert.ok(result.checks.some(c=>c.code===(scope==='guild'?'RETIRED_COMMANDS:1':'GLOBAL_RETIRED_COMMANDS')&&c.status==='fail'));
  }
});
