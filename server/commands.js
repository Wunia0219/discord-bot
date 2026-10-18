import { createPublicKey, verify } from 'node:crypto';
import { problem } from './wallet.js';

export const commandDefinitions = [
  {name:'簽到',description:'領取本伺服器的每日籌碼',type:1},
  {name:'籌碼',description:'查看本伺服器的籌碼餘額',type:1},
  {name:'籌碼管理',description:'管理本伺服器的虛擬籌碼',type:1,default_member_permissions:'0',options:[
    {type:1,name:'發放',description:'發放籌碼並留下原因',options:[{type:6,name:'成員',description:'接收籌碼的成員',required:true},{type:4,name:'數量',description:'發放數量',required:true,min_value:1,max_value:100000},{type:3,name:'原因',description:'發放原因',required:true,max_length:200}]},
    {type:1,name:'紀錄',description:'查看成員最近十筆帳本紀錄',options:[{type:6,name:'成員',description:'查詢成員',required:true}]},
    {type:1,name:'更正',description:'撤銷一筆誤發籌碼，保留原紀錄',options:[{type:4,name:'紀錄編號',description:'原始發放的帳本編號',required:true,min_value:1},{type:3,name:'原因',description:'更正原因',required:true,max_length:200}]},
  ]},
];
export function validSignature(publicKey, headers, raw, now=Date.now()) {
  const signature=headers['x-signature-ed25519'], timestamp=headers['x-signature-timestamp'];
  if(!/^[a-f\d]{64}$/i.test(publicKey||'')||!/^[a-f\d]{128}$/i.test(signature||'')||!/^\d{10}$/.test(timestamp||'')||Math.abs(now-Number(timestamp)*1000)>300000)return false;
  try {
    const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(publicKey,'hex')]),format:'der',type:'spki'});
    return verify(null,Buffer.concat([Buffer.from(timestamp),raw]),key,Buffer.from(signature,'hex'));
  }catch{return false;}
}
export function handleCommand(interaction, store, adminRoles=[]) {
  const reply=content=>({type:4,data:{content,flags:64,allowed_mentions:{parse:[]}}});
  try {
    if(interaction.type===1)return {type:1};
    if(interaction.type!==2||interaction.member?.user?.bot||!interaction.guild_id||!interaction.member?.user?.id)throw problem(403,'請在已啟用的伺服器內使用指令。');
    const guild=interaction.guild_id,user=interaction.member.user.id;
    store.validate(guild,user);
    if(interaction.data.name==='簽到'){
      const r=store.checkin(guild,user);
      return reply(`${r.duplicate?'今日已領取':'簽到成功，獲得 '+store.daily+' 籌碼'}。餘額：${r.state.balance.toLocaleString('en-US')}。每天台灣時間 00:00 換日。${store.environment==='test'?'（測試環境）':''}`);
    }
    if(interaction.data.name==='籌碼')return reply(`本伺服器餘額：${store.state(guild,user).balance.toLocaleString('en-US')} 籌碼。${store.environment==='test'?'（測試環境）':''}`);
    if(interaction.data.name!=='籌碼管理')throw problem(400,'不支援此指令。');
    const permissions=BigInt(interaction.member.permissions || '0');
    if(!(permissions&8n)&&!interaction.member.roles?.some(id=>adminRoles.includes(id)))throw problem(403,'只有伺服器管理員或指定的籌碼管理身分組可以操作。');
    const sub=interaction.data.options?.[0];
    const args=Object.fromEntries((sub?.options||[]).map(option=>[option.name,option.value]));
    if(sub?.name==='更正'){
      const r=store.reverse(guild,user,args['紀錄編號'],args['原因'],interaction.id);
      return reply(`更正完成。紀錄 #${r.entry.id}，收回 ${-r.entry.delta}，餘額 ${r.entry.after}。${r.duplicate?'此操作已處理，未重複扣除。':''}`);
    }
    const target=args['成員'];
    if(!interaction.data.resolved?.members?.[target]||interaction.data.resolved?.users?.[target]?.bot)throw problem(400,'請選擇本伺服器中的真人成員。');
    if(sub?.name==='發放'){
      const r=store.grant(guild,user,target,args['數量'],args['原因'],interaction.id);
      return reply(`已發放 ${r.entry.delta} 籌碼給 <@${target}>。紀錄 #${r.entry.id}，餘額 ${r.entry.before} → ${r.entry.after}。${r.duplicate?'此操作已處理，未重複發放。':''}`);
    }
    if(sub?.name==='紀錄'){
      const rows=store.history(guild,target).slice(0,10);
      return reply(rows.length?rows.map(r=>`#${r.id} ${r.kind} ${r.delta>=0?'+':''}${r.delta}｜${r.before} → ${r.after}｜${r.time}\n操作人：${r.actor||'系統'}｜${r.reason.slice(0,60)}`).join('\n').slice(0,1900):'尚無帳本紀錄。');
    }
    throw problem(400,'不支援此操作。');
  }catch(error){return reply(error.status?error.message:'暫時無法完成操作，請稍後重試。');}
}
