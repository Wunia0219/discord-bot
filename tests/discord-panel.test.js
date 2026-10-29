import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync,sign} from 'node:crypto';
import {WalletStore} from '../server/wallet/wallet.js';
import {handleCommand,commandDefinitions} from '../server/discord/commands.js';
import {panelId,deferWalletInteraction} from '../server/discord/discord-panel.js';
import {createActivityServer} from '../server/http/app.js';
const guild='100000000000000001',actor='100000000000000002',target='100000000000000003',channel='100000000000000004';
let serial=0n;
const snowflake=(offset=0)=>String((BigInt(Date.now()+offset)-1420070400000n)<<22n|(++serial%4194304n));
const base=()=>({type:2,id:snowflake(),guild_id:guild,channel_id:channel,member:{user:{id:actor},permissions:'8',roles:[]},data:{name:'戲籌管理'}});
const component=(custom_id,values)=>({...base(),type:3,message:{flags:64},data:{custom_id,...(values?{values}:{})}});
const control=(r,name)=>r.data.components.flatMap(row=>row.components).find(c=>c.label===name||c.placeholder===name);
const click=(r,name,values)=>component(control(r,name).custom_id,values);
const form=(r,fields,rootResolved=false)=>({...base(),type:5,data:{custom_id:r.data.custom_id,
  components:Object.entries(fields).map(([custom_id,value])=>({type:18,component:custom_id==='member'?{type:5,custom_id,values:[value],...(!rootResolved?{resolved:{members:{[value]:{}},users:{[value]:{id:value}}}}:{})}:{type:4,custom_id,value}})),
  ...(rootResolved?{resolved:{members:{[fields.member]:{}},users:{[fields.member]:{id:fields.member}}}}:{})}});
function fixture(t){const s=new WalletStore({guildIds:[guild],environment:'production',spinDelay:0});t.after(()=>s.close());return s;}
const run=(i,s)=>handleCommand(i,s,[],[channel]);

test('two simple slash roots open a private zero-read menu; only the game awards checkin',async()=>{
  assert.deepEqual(commandDefinitions.map(c=>[c.name,c.options]),[['戲籌',[]],['戲籌管理',[]]]);
  const s={environment:'production',grantMax:1000,validate:()=>{},state:()=>assert.fail('menu must not load wallets'),checkin:()=>assert.fail('retired command must not award')};
  const panel=await run(base(),s);assert.equal(panel.data.flags,64);assert.deepEqual(panel.data.allowed_mentions,{parse:[]});
  assert.deepEqual(panel.data.components.flatMap(r=>r.components.map(c=>c.label)),['玩家戲籌','發放戲籌','查詢紀錄','重設全群']);
  const retired=base();retired.data.name='簽到';const r=await run(retired,s);assert.equal(r.data.embeds[0].title,'請在遊戲內簽到');
  const go=click(r,'開啟遊戲');go.member.permissions='0';assert.deepEqual(await run(go,s),{type:12});
  for(const name of ['發放戲籌','查詢紀錄'])assert.equal((await run(click(panel,name),s)).type,9);
});

test('roster advances and returns to the first page without scanning skipped rows or writing the database',async t=>{
  const s=fixture(t);for(let n=0;n<43;n++)s.state(guild,String(100000000000000100n+BigInt(n)));
  const writes=s.db.prepare('SELECT COUNT(*) n FROM ledger').get().n,panel=await run(base(),s),first=await run(click(panel,'玩家戲籌'),s);
  const second=await run(click(first,'下一頁'),s),third=await run(click(second,'下一頁'),s);
  assert.equal(third.data.embeds[0].fields.length,3);assert.equal(control(third,'下一頁'),undefined);
  const again=await run(click(third,'回到第一頁'),s);
  assert.deepEqual(again.data.embeds[0].fields,first.data.embeds[0].fields);
  assert.equal(control(again,'回到第一頁'),undefined);assert.equal(s.db.prepare('SELECT COUNT(*) n FROM ledger').get().n,writes);
  assert.equal(new Set([first,second,third].flatMap(r=>r.data.embeds[0].fields.map(f=>f.value))).size,43);
  assert.equal(first.type,7);assert.ok(!Object.hasOwn(first.data,'flags'));
});

test('native forms resolve guild players and use the original form request for financial deduplication',async t=>{
  const s=fixture(t),panel=await run(base(),s),modal=await run(click(panel,'發放戲籌'),s);
  assert.equal(modal.type,9);assert.ok(modal.data.components.every(c=>c.type===18));assert.equal(modal.data.components[0].component.type,5);
  const submission=form(modal,{member:target,amount:'500',reason:'活動獎勵'}),grant=await run(submission,s);assert.match(grant.data.embeds[0].description,/10,000 → \*\*10,500/);
  s.spin(guild,target,20,randomUUID());const balance=s.state(guild,target).balance;
  submission.id=snowflake();const retry=await run(submission,s);assert.match(retry.data.embeds[0].description,/沒有再次發放/);assert.equal(s.state(guild,target).balance,balance);
  const reverseModal=await run(click(grant,'收回這筆發放'),s),reverse=form(reverseModal,{reason:'更正誤發'});
  const reversed=await run(reverse,s);assert.match(reversed.data.embeds[0].description,/原始發放紀錄保留/);const after=s.state(guild,target).balance;
  reverse.id=snowflake();assert.match((await run(reverse,s)).data.embeds[0].description,/沒有再次扣除/);assert.equal(s.state(guild,target).balance,after);
  const queryModal=await run(click(panel,'查詢紀錄'),s),history=await run(form(queryModal,{member:target},true),s);
  assert.match(JSON.stringify(history.data.embeds[0].fields),/已收回/);
  const malformed=form(modal,{member:target,amount:'0',reason:'bad'});assert.match((await run(malformed,s)).data.embeds[0].description,/正整數/);
  const bot=form(queryModal,{member:target});bot.data.components[0].component.resolved.users[target].bot=true;
  assert.match((await run(bot,s)).data.embeds[0].description,/真人/);
});

test('reset card captures actual balances at confirmation, preserves progress and cannot reset subsequent play twice',async t=>{
  const s=fixture(t);s.checkin(guild,target);const weekly=s.state(guild,target).weeklyCheckin,panel=await run(base(),s);
  const confirmation=await run(click(panel,'重設全群'),s);assert.equal(s.state(guild,target).balance,10500);
  s.grant(guild,actor,target,500,'just before reset',randomUUID());
  const confirmed=click(confirmation,'確認重設全群'),r=await run(confirmed,s);assert.match(r.data.embeds[0].fields[0].name,/11,000 → 10,000/);
  assert.deepEqual(s.state(guild,target).weeklyCheckin,weekly);assert.equal(s.state(guild,target).balance,10000);
  s.spin(guild,target,20,randomUUID());const balance=s.state(guild,target).balance;
  confirmed.id=snowflake();const repeat=await run(confirmed,s);assert.match(repeat.data.embeds[0].description,/沒有再次重設/);assert.equal(s.state(guild,target).balance,balance);
  assert.deepEqual(repeat.data.embeds[0].fields,r.data.embeds[0].fields);
  const modal=await run(click(panel,'查詢紀錄'),s),history=await run(form(modal,{member:target}),s),reset=history.data.embeds[0].fields.find(f=>f.name.includes('重設'));
  assert.doesNotMatch(JSON.stringify(reset),/[+-]1,?000/);
  const report=await run(click(history,'上次重設報表'),s);
  assert.deepEqual(report.data.embeds[0].fields,r.data.embeds[0].fields);
});

test('history filtering and pagination use buttons and retain within Discord component and text limits',async t=>{
  const s=fixture(t);for(let n=0;n<12;n++)s.grant(guild,actor,target,1,'*'.repeat(200),randomUUID());
  const panel=await run(base(),s),modal=await run(click(panel,'查詢紀錄'),s),first=await run(form(modal,{member:target}),s),next=await run(click(first,'更早的紀錄'),s);
  assert.equal(first.data.embeds[0].fields.length,10);assert.equal(next.data.embeds[0].fields.length,2);
  assert.equal(new Set([...first.data.embeds[0].fields,...next.data.embeds[0].fields].map(f=>f.name)).size,12);
  const category=control(next,'紀錄分類'),summary=await run(component(category.custom_id,['s']),s);assert.equal(summary.data.embeds[0].fields[0].value,'0');
  const period=control(summary,'查詢期間'),today=await run(component(period.custom_id,['1']),s);assert.match(today.data.embeds[0].description,/今天/);
  const card=first.data.embeds[0],size=card.author.name.length+card.title.length+card.description.length+card.footer.text.length+card.fields.reduce((n,f)=>n+f.name.length+f.value.length,0);assert.ok(size<6000);assert.ok(first.data.components.length<=5);
  for(const r of [panel,modal,first,next,summary,today])for(const row of r.data.components)for(const c of row.components||[row.component])if(c.custom_id)assert.ok(c.custom_id.length<=100);
});

test('last-report button opens directly without an ID form; stale pagination cannot switch into another reset',async t=>{
  const s=fixture(t),panel=await run(base(),s),card=await run(click(panel,'重設全群'),s);
  assert.equal(deferWalletInteraction(click(card,'上次重設報表')),true);
  const empty=await run(click(card,'上次重設報表'),s);assert.equal(empty.data.embeds[0].title,'還沒有重設報表');
  assert.deepEqual(empty.data.components.flatMap(r=>r.components.map(c=>c.label)),['返回管理面板']);
  for(let n=0;n<21;n++)s.state(guild,String(100000000000000100n+BigInt(n)));
  s.resetWallets(guild,actor,randomUUID());const result=await run(click(card,'上次重設報表'),s);
  assert.equal(result.type,7);assert.equal(result.data.embeds[0].title,'上次重設報表');assert.equal(result.data.embeds[0].fields.length,20);
  assert.doesNotMatch(result.data.embeds[0].description,/報表編號/);
  const next=click(result,'下一頁'),page=await run(next,s);assert.equal(page.data.embeds[0].fields.length,1);assert.match(page.data.embeds[0].description,/第 2 \/ 2 頁/);
  s.resetWallets(guild,actor,randomUUID());assert.equal((await run(next,s)).data.embeds[0].title,'已有更新的重設報表');
});

test('every callback rechecks channel, owner, guild, role, form type and mutation expiry before any write',async t=>{
  const s=fixture(t);s.state(guild,target);const panel=await run(base(),s),confirmation=await run(click(panel,'重設全群'),s),ok=click(confirmation,'確認重設全群');
  const bad=[];let i=structuredClone(ok);i.channel_id=target;bad.push([i,/<#100000000000000004>/]);
  i=structuredClone(ok);i.member.permissions='0';bad.push([i,/需要管理員/]);
  i=structuredClone(ok);i.member.user.id=target;bad.push([i,/別人的面板/]);
  i=structuredClone(ok);i.guild_id=target;bad.push([i,/有開放遊戲/]);
  i=component(panelId(base(),'ra',snowflake(-31*60000)));bad.push([i,/重新開啟表單或確認卡/]);
  i=structuredClone(ok);i.type=5;i.data.components=[];bad.push([i,/重新輸入 \/戲籌管理/]);
  i=structuredClone(ok);i.data.custom_id='x'.repeat(101);bad.push([i,/重新輸入 \/戲籌管理/]);
  for(const [interaction,pattern]of bad)assert.match((await run(interaction,s)).data.embeds[0].description,pattern);
  assert.equal(s.history(guild,target).filter(r=>r.kind==='reset').length,0);
  assert.throws(()=>panelId(base(),'h','x'.repeat(100)),{code:'PANEL_INVALID'});
});

test('resetting a test ledger invalidates previously opened mutation cards',async t=>{
 const s=fixture(t);s.state(guild,target);
 const panel=await run(base(),s),confirmation=await run(click(panel,'重設全群'),s);
 s.resetAt=Date.now()+1;
 assert.match((await run(click(confirmation,'確認重設全群'),s)).data.embeds[0].description,/重新開啟/);
 assert.equal(s.history(guild,target).filter(r=>r.kind==='reset').length,0);
});

test('signed Firestore callbacks acknowledge updates immediately, while forms and launch remain synchronous',async t=>{
  const key=generateKeyPairSync('ed25519'),application='100000000000000009',publicKey=key.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('hex');
  let resolveRoster,patch;const store={backend:'firestore',environment:'production',validate:()=>{},grantMax:1000,playerWallets:()=>new Promise(resolve=>{resolveRoster=resolve;}),walletResetReport:async()=>{throw Object.assign(new Error('empty'),{code:'RESET_MISSING'});}};
  const server=createActivityServer({clientId:application,publicKey,wallet:{store,commandChannelIds:[channel]},fetchImpl:async(url,options)=>{patch=JSON.parse(options.body);return Response.json({});}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const send=async i=>{const body=JSON.stringify({...i,application_id:application,token:'fixture-token-1234567890'}),timestamp=String(Math.floor(Date.now()/1000));
    return (await fetch(`http://127.0.0.1:${server.address().port}/api/interactions`,{method:'POST',headers:{'x-signature-timestamp':timestamp,'x-signature-ed25519':sign(null,Buffer.concat([Buffer.from(timestamp),Buffer.from(body)]),key.privateKey).toString('hex')},body})).json();};
  const panel=await run(base(),store),roster=click(panel,'玩家戲籌');assert.equal(deferWalletInteraction(roster),true);
  assert.deepEqual(await send(roster),{type:6});assert.equal(patch,undefined);
  resolveRoster({rows:[],next:null,previous:null,time:new Date().toISOString()});await server.drainCommands();assert.match(patch.embeds[0].description,/還沒有玩家/);
  const confirm=await run(click(panel,'重設全群'),store);assert.deepEqual(await send(click(confirm,'上次重設報表')),{type:6});await server.drainCommands();
  assert.equal(patch.embeds[0].title,'還沒有重設報表');assert.deepEqual(patch.components.flatMap(r=>r.components.map(c=>c.label)),['返回管理面板']);
  assert.equal((await send(click(panel,'發放戲籌'))).type,9);
  const retired=base();retired.data.name='簽到';assert.equal((await send(retired)).type,4);
  assert.deepEqual(await send(component(panelId(base(),'go'))),{type:12});
});
