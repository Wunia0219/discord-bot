import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
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
test('admin command permissions are enforced on the server, including configured roles and guild isolation',t=>{
 const s=new WalletStore({guildIds:[guild],environment:'production'});t.after(()=>s.close());
 const i={type:2,id:'1561284960986599700',guild_id:guild,member:{user:{id:user},roles:[],permissions:'0'},data:{name:'籌碼管理',resolved:{members:{[target]:{}},users:{[target]:{bot:false}}},options:[{name:'發放',options:[{name:'成員',value:target},{name:'數量',value:500},{name:'原因',value:'測試'}]}]}};
 assert.match(handleCommand(i,s).data.content,/只有伺服器管理員/);assert.equal(s.state(guild,target).balance,0);
 i.member.roles=['role'];assert.match(handleCommand(i,s,['role']).data.content,/已發放/);assert.equal(s.state(guild,target).balance,500);
 assert.match(handleCommand(i,s,['role']).data.content,/未重複發放/);
 i.guild_id='123456789012345678';assert.match(handleCommand(i,s,['role']).data.content,/尚未開放/);
});
