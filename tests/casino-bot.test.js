import test from 'node:test';
import assert from 'node:assert/strict';
import {CasinoBot,casinoBotSettings} from '../server/discord/casino-bot.js';
import {highlightAnnouncement} from '../server/discord/highlight-card.js';
const guild='100000000000000001',channel='100000000000000002',applicationId='100000000000000003',token='isolated-bot-token-'.repeat(3);
function fixture({identity=applicationId,destination=guild,send}={}){
  const calls=[];let now=1000;
  const bot=new CasinoBot({guild,channel,applicationId,token,clock:()=>now,fetchImpl:async(url,options)=>{
    calls.push({url,options});assert.equal(options.headers.Authorization,'Bot '+token);assert.equal(options.redirect,'error');
    if(url.endsWith('/users/@me'))return Response.json({id:identity,bot:true});
    if(url.endsWith('/channels/'+channel))return Response.json({id:channel,guild_id:destination,type:0});
    return send?send(options):Response.json({id:'100000000000000004',channel_id:channel});
  }});return {bot,calls,advance(ms){now+=ms;}};
}
test('bot REST posts individual push-eligible wins as the verified bot without username overrides or mentions',async()=>{
  const f=fixture(),payload=highlightAnnouncement({name:'A',tier:'mega',multiplier:100});
  assert.equal('flags' in payload,false);assert.doesNotMatch(payload.embeds[0].footer.text,/10 分鐘/);
  assert.equal((await f.bot.send(payload,'win:1')).kind,'sent');assert.equal((await f.bot.send(payload,'win:1')).kind,'sent');
  const posts=f.calls.filter(c=>c.options.method==='POST').map(c=>JSON.parse(c.options.body));
  assert.equal(posts[0].nonce,posts[1].nonce);assert.equal(posts[0].enforce_nonce,true);assert.deepEqual(posts[0].allowed_mentions,{parse:[]});assert.equal('username' in posts[0],false);
});
test('wrong bot or guild never receives a message',async()=>{
  for(const options of [{identity:'100000000000000008'},{destination:'100000000000000009'}]){
    const f=fixture(options);assert.equal((await f.bot.send({content:'test'},'one')).kind,'retry');assert.equal(f.calls.some(c=>c.options.method==='POST'),false);
  }
});
test('provider rate limits are honored without shortening long waits; uncertain network writes are quarantined',async()=>{
  const f=fixture({send:()=>Response.json({retry_after:900},{status:429})});
  assert.equal((await f.bot.send({content:'test'},'one')).delay,900000);const n=f.calls.length;f.advance(1000);assert.equal((await f.bot.send({},'two')).kind,'retry');assert.equal(f.calls.length,n);
  const lost=fixture({send:()=>{throw new Error('network');}});assert.equal((await lost.bot.send({},'one')).kind,'uncertain');
});
test('feature requires explicit bot configuration and defaults off',()=>{
  const store={guildIds:new Set([guild]),assertGuild:g=>assert.equal(g,guild)};
  assert.equal(casinoBotSettings({},store),null);assert.throws(()=>casinoBotSettings({DISCORD_CASINO_ENABLED:'true'},store));
  const settings=casinoBotSettings({DISCORD_CASINO_ENABLED:'true',DISCORD_CLIENT_ID:applicationId,DISCORD_CASINO_CHANNEL_ID:channel,DISCORD_BOT_TOKEN:token},store);assert.equal(settings.guild,guild);
});
