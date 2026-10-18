import { createPublicKey, verify } from 'node:crypto';
import { problem } from './wallet.js';

export const commandDefinitions = [
  {name:'簽到',description:'領取本伺服器的每日籌碼',type:1},
  {name:'籌碼',description:'查看本伺服器的籌碼餘額',type:1},
  {name:'籌碼管理',description:'管理本伺服器的虛擬籌碼',type:1,default_member_permissions:'0',options:[
    {type:1,name:'發放',description:'發放籌碼並留下原因',options:[{type:6,name:'成員',description:'接收籌碼的成員',required:true},{type:4,name:'數量',description:'發放數量',required:true,min_value:1,max_value:100000},{type:3,name:'原因',description:'發放原因',required:true,max_length:200}]},
    {type:1,name:'紀錄',description:'分類查詢紀錄，預設顯示發放與更正',options:[
      {type:6,name:'成員',description:'查詢成員',required:true},
      {type:3,name:'分類',description:'預設：發放與更正',choices:[{name:'發放與更正',value:'rewards'},{name:'簽到',value:'checkin'},{name:'遊戲摘要',value:'summary'},{name:'遊戲明細',value:'game'},{name:'全部流水',value:'all'}]},
      {type:4,name:'期間',description:'台灣日曆日，預設全部期間',choices:[{name:'今天',value:1},{name:'近 7 天',value:7},{name:'近 30 天',value:30},{name:'全部期間',value:0}]},
      {type:4,name:'早於編號',description:'依回覆的編號查詢下一頁（不適用遊戲摘要）',min_value:1},
    ]},
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
  const colors={info:0x3498db,success:0x2ecc71,warning:0xf39c12,error:0xe74c3c};
  const reply=(description,title='🔵 籌碼資訊',tone='info',fields=[])=>({type:4,data:{embeds:[{title,description,color:colors[tone],fields,footer:{text:`僅自己可見${store.environment==='test'?' · 測試環境':''}`}}],flags:64,allowed_mentions:{parse:[]}}});
  try {
    if(interaction.type===1)return {type:1};
    if(interaction.type!==2||interaction.member?.user?.bot||!interaction.guild_id||!interaction.member?.user?.id)throw problem(403,'請在已啟用的伺服器內使用指令。');
    const guild=interaction.guild_id,user=interaction.member.user.id;
    store.validate(guild,user);
    if(interaction.data.name==='簽到'){
      const r=store.checkin(guild,user);
      return reply(`${r.duplicate?'今日已領取':'簽到成功，獲得 '+store.daily+' 籌碼'}。餘額：${r.state.balance.toLocaleString('en-US')}。每天台灣時間 00:00 換日。`,r.duplicate?'🟠 今日已領取':'🟢 簽到成功',r.duplicate?'warning':'success');
    }
    if(interaction.data.name==='籌碼')return reply(`本伺服器餘額：${store.state(guild,user).balance.toLocaleString('en-US')} 籌碼。${store.environment==='test'?'（測試環境）':''}`);
    if(interaction.data.name!=='籌碼管理')throw problem(400,'不支援此指令。');
    const permissions=BigInt(interaction.member.permissions || '0');
    if(!(permissions&8n)&&!interaction.member.roles?.some(id=>adminRoles.includes(id)))throw problem(403,'只有伺服器管理員或指定的籌碼管理身分組可以操作。');
    const sub=interaction.data.options?.[0];
    const args=Object.fromEntries((sub?.options||[]).map(option=>[option.name,option.value]));
    if(sub?.name==='更正'){
      const r=store.reverse(guild,user,args['紀錄編號'],args['原因'],interaction.id);
      return reply(`更正完成。紀錄 #${r.entry.id}，收回 ${-r.entry.delta}，餘額 ${r.entry.after}。\n對應原紀錄 #${args['紀錄編號']}。${r.duplicate?'此操作已處理，未重複扣除。':''}`,'🟠 更正發放','warning');
    }
    const target=args['成員'];
    if(!interaction.data.resolved?.members?.[target]||interaction.data.resolved?.users?.[target]?.bot)throw problem(400,'請選擇本伺服器中的真人成員。');
    if(sub?.name==='發放'){
      const r=store.grant(guild,user,target,args['數量'],args['原因'],interaction.id);
      return reply(`已發放 ${r.entry.delta} 籌碼給 <@${target}>。紀錄 #${r.entry.id}，餘額 ${r.entry.before} → ${r.entry.after}。${r.duplicate?'此操作已處理，未重複發放。':''}`,r.duplicate?'🟠 此發放已處理':'🟢 發放成功',r.duplicate?'warning':'success');
    }
    if(sub?.name==='紀錄'){
      const category=args['分類']??'rewards',days=args['期間']??0;
      const labels={rewards:'發放與更正',checkin:'簽到',summary:'遊戲摘要',game:'遊戲明細',all:'全部流水'};
      if(!Object.hasOwn(labels,category))throw problem(400,'無效的紀錄分類。');
      const period=days===0?'全部期間':days===1?'今天':`近 ${days} 天`;
      let description=`成員：<@${target}>｜${period}（台灣時間）`;
      if(category==='summary'){
        if(args['早於編號']!==undefined)throw problem(400,'遊戲摘要不使用早於編號，請改選遊戲明細查詢逐局紀錄。');
        const {game}=store.auditSummary(guild,target,days);
        return reply(description+'\n需要逐局核帳時，請將「分類」選為「遊戲明細」。','🔵 遊戲摘要','info',[
          {name:'遊戲局數',value:number(game.rounds),inline:true},{name:'總下注',value:number(game.bet),inline:true},
          {name:'總派彩',value:number(game.payout),inline:true},{name:'淨增減',value:signed(game.net),inline:true},
        ]);
      }
      const {rows,next}=store.auditHistory(guild,target,{category,days,before:args['早於編號']});
      if(category==='checkin'){
        const {checkin}=store.auditSummary(guild,target,days);
        description+=`\n期間內簽到 ${number(checkin.days)} 天，累計領取 ${number(checkin.total)} 籌碼。`;
      }
      description+=rows.length?'\n依最新到最舊排列。':'\n此分類與查詢範圍內尚無紀錄。';
      description+=next?`\n下一頁：維持相同成員、分類與期間，將「早於編號」填入 ${next}。`:'\n已無更早的符合紀錄。';
      return reply(description,`🔵 ${labels[category]}`,'info',rows.map(recordField));
    }
    throw problem(400,'不支援此操作。');
  }catch(error){return reply(error.status?error.message:'暫時無法完成操作，請稍後重試。','🔴 無法完成操作','error');}
}

const number=value=>value.toLocaleString('en-US');
const signed=value=>`${value>=0?'+':''}${number(value)}`;
const escapeText=value=>value.replace(/[\\`*_{}\[\]()<>~|#]/g,'\\$&');
function recordField(r){
  const labels={grant:'🟢 手動發放',reversal:'🟠 更正發放',checkin:'簽到獎勵',spin:'遊戲結算',test_seed:'測試初始籌碼'};
  const time=new Date(Date.parse(r.time)+8*3600000).toISOString().slice(0,16).replace('T',' ');
  const status=r.kind==='grant'?`\n狀態：${r.reversal_id?`已更正（#${r.reversal_id}）`:'已發放'}`:r.kind==='reversal'?`\n對應原紀錄 #${r.reference}`:'';
  return {name:`#${r.id}｜${labels[r.kind]||'其他紀錄'}｜${signed(r.delta)} 籌碼`,
    value:`${time}｜${r.actor?`<@${r.actor}>`:'系統'}\n原因：${escapeText(r.reason)}\n餘額：${number(r.before)} → ${number(r.after)}${status}`};
}
