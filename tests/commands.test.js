import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, randomUUID } from 'node:crypto';
import { validSignature, handleCommand } from '../server/commands.js';
import { WalletStore } from '../server/wallet.js';
const guild='1441097301685698703',user='1561284960986599626',target='1561284960986599627';
test('Discord signatures reject tampering, wrong keys and expired timestamps',()=>{
 const keys=generateKeyPairSync('ed25519');const pub=keys.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('hex');
 const timestamp=String(Math.floor(Date.now()/1000)),raw=Buffer.from('{"type":1}');
 const signature=sign(null,Buffer.concat([Buffer.from(timestamp),raw]),keys.privateKey).toString('hex');
 const headers={'x-signature-timestamp':timestamp,'x-signature-ed25519':signature};
 assert.equal(validSignature(pub,headers,raw),true);assert.equal(validSignature(pub,headers,Buffer.from('{}')),false);assert.equal(validSignature(pub,headers,raw,Date.now()+400000),false);
});

function historyCommand(options=[]){return {type:2,id:randomUUID(),guild_id:guild,member:{user:{id:user},permissions:'8'},data:{name:'籌碼管理',resolved:{members:{[target]:{}},users:{[target]:{bot:false}}},options:[{name:'紀錄',options:[{name:'成員',value:target},...options]}]}};}
test('reward audit survives more than 50 spins, paginates and links corrections',t=>{
 const s=new WalletStore({guildIds:[guild],environment:'production',spinDelay:0});t.after(()=>s.close());
 const grant=s.grant(guild,user,target,100000,'活動獎勵',randomUUID());
 const corrected=s.grant(guild,user,target,1,'誤發',randomUUID());
 s.reverse(guild,user,corrected.entry.id,'更正',randomUUID());
 for(let i=0;i<12;i++)s.grant(guild,user,target,1,'小獎',randomUUID());
 for(let i=0;i<60;i++)s.spin(guild,target,20,randomUUID());
 const first=handleCommand(historyCommand(),s).data;
 assert.equal(first.flags,64);assert.deepEqual(first.allowed_mentions,{parse:[]});assert.equal(first.embeds[0].fields.length,10);
 assert.match(first.embeds[0].title,/發放與收回/);assert.doesNotMatch(JSON.stringify(first),/遊玩紀錄/);
 const cursor=Number(first.embeds[0].description.match(/填入 (\d+)/)[1]);
 const second=handleCommand(historyCommand([{name:'早於編號',value:cursor}]),s).data.embeds[0];
 assert.equal(second.fields.length,5);assert.match(JSON.stringify(second),/已收回/);assert.match(JSON.stringify(second),/對應發放/);
 assert.ok(second.fields.some(f=>f.name.startsWith(`#${grant.entry.id}｜`)));
 assert.match(second.description,/最早一筆/);
 const game=handleCommand(historyCommand([{name:'分類',value:'game'}]),s).data.embeds[0];
 assert.equal(game.fields.length,10);assert.ok(game.fields.every(f=>f.name.includes('遊玩紀錄')));
});
test('game and checkin summaries cover full selected Taipei calendar period and isolate members',t=>{
 let now=Date.parse('2026-10-17T15:59:59Z');
 const s=new WalletStore({guildIds:[guild],clock:()=>now,spinDelay:0});t.after(()=>s.close());
 s.checkin(guild,target);s.spin(guild,target,20,randomUUID());
 now+=2000;s.checkin(guild,target);
 const rounds=Array.from({length:105},()=>s.spin(guild,target,20,randomUUID()).round);
 s.spin(guild,user,100,randomUUID());
 const summary=s.auditSummary(guild,target,1);
 assert.equal(summary.game.rounds,105);assert.equal(summary.game.bet,2100);
 assert.equal(summary.game.payout,rounds.reduce((n,r)=>n+r.payout,0));assert.equal(summary.game.net,summary.game.payout-2100);
 assert.equal(summary.checkin.days,1);assert.equal(s.auditSummary(guild,target).checkin.days,2);
 const reply=handleCommand(historyCommand([{name:'分類',value:'summary'},{name:'期間',value:1}]),s).data.embeds[0];
 assert.equal(reply.fields[0].value,'105');assert.match(reply.description,/遊戲明細/);
 const checkin=handleCommand(historyCommand([{name:'分類',value:'checkin'},{name:'期間',value:1}]),s).data.embeds[0];
 assert.equal(checkin.fields.length,1);assert.match(checkin.description,/簽到 1 天/);assert.match(checkin.fields[0].value,/2026-10-18 00:00/);
});
test('cards preserve privacy, colors, empty states and Discord text limits',t=>{
 const s=new WalletStore({guildIds:[guild],environment:'production'});t.after(()=>s.close());
 assert.match(handleCommand(historyCommand(),s).data.embeds[0].description,/還沒有發放或收回/);
 for(let i=0;i<10;i++)s.grant(guild,user,target,1,'*'.repeat(200),randomUUID());
 const card=handleCommand(historyCommand(),s).data.embeds[0];
 const size=card.author.name.length+card.title.length+card.description.length+card.footer.text.length+card.fields.reduce((n,f)=>n+f.name.length+f.value.length,0);
 assert.ok(size<=6000);assert.ok(card.fields.every(f=>f.value.length<=1024));assert.equal(card.color,0xd6b775);
 const invalid=handleCommand(historyCommand([{name:'分類',value:'summary'},{name:'早於編號',value:1}]),s).data.embeds[0];assert.equal(invalid.color,0xc85c76);
 const checkin=historyCommand();checkin.data={name:'簽到'};
 assert.equal(handleCommand(checkin,s).data.embeds[0].color,0x68a880);
 assert.equal(handleCommand(checkin,s).data.embeds[0].color,0xc99456);
});
test('admin command permissions are enforced on the server, including configured roles and guild isolation',t=>{
 const s=new WalletStore({guildIds:[guild],environment:'production'});t.after(()=>s.close());
 const i={type:2,id:'1561284960986599700',guild_id:guild,member:{user:{id:user},roles:[],permissions:'0'},data:{name:'籌碼管理',resolved:{members:{[target]:{}},users:{[target]:{bot:false}}},options:[{name:'發放',options:[{name:'成員',value:target},{name:'數量',value:500},{name:'原因',value:'測試'}]}]}};
 assert.match(handleCommand(i,s).data.embeds[0].description,/需要管理員/);assert.equal(s.state(guild,target).balance,0);
 i.member.roles=['role'];assert.match(handleCommand(i,s,['role']).data.embeds[0].description,/500.*籌碼/);assert.equal(s.state(guild,target).balance,500);
 assert.match(handleCommand(i,s,['role']).data.embeds[0].description,/沒有再加一次/);
 i.guild_id='123456789012345678';assert.match(handleCommand(i,s,['role']).data.embeds[0].description,/有開放遊戲的群/);
});

test('unknown and provider failures never reach players as raw diagnostic text',()=>{
 const command={type:2,guild_id:guild,member:{user:{id:user}},data:{name:'籌碼'}};
 for(const status of [undefined,400,503]){
   const store={environment:'test',validate:()=>{},state:()=>{throw Object.assign(new Error('sqlite-secret-path / provider-token / internal-request-id'),{status});}};
   const response=handleCommand(command,store);
   assert.equal(response.data.flags,64);
   assert.deepEqual(response.data.allowed_mentions,{parse:[]});
   assert.equal(response.data.embeds[0].title,'剛剛卡住了');
   assert.match(response.data.embeds[0].description,/再試一次/);
   assert.doesNotMatch(JSON.stringify(response),/sqlite|provider-token|internal-request-id|測試環境/);
 }
});

test('duplicate management replies label the original change and never present it as a current balance',t=>{
 const store=new WalletStore({guildIds:[guild],environment:'production',spinDelay:0});t.after(()=>store.close());
 const grant={...historyCommand(),id:randomUUID(),data:{...historyCommand().data,options:[{name:'發放',options:[{name:'成員',value:target},{name:'數量',value:1000},{name:'原因',value:'@everyone **獎勵**'}]}]}};
 const first=handleCommand(grant,store).data.embeds[0];
 assert.equal(first.title,'籌碼送到了');
 store.spin(guild,target,20,randomUUID());
 const balance=store.state(guild,target).balance;
 const duplicate=handleCommand(grant,store).data.embeds[0];
 assert.equal(duplicate.title,'這筆已經發過了');
 assert.match(duplicate.description,/沒有再加一次/);
 assert.deepEqual(duplicate.fields,first.fields);
 assert.equal(duplicate.fields[0].name,'這筆發放前後');
 assert.doesNotMatch(duplicate.fields[2].value,/@everyone/);
 assert.equal(store.state(guild,target).balance,balance);
 assert.equal(store.history(guild,target).filter(entry=>entry.kind==='grant').length,1);
});
