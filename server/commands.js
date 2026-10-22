import { createPublicKey, verify } from 'node:crypto';
import { problem } from './wallet.js';
import { privateReply, commandError } from './bot-replies.js';

export const commandDefinitions = [
  {name:'簽到',description:'領今天的籌碼，每天都能來領一份',type:1},
  {name:'籌碼',description:'看看你在這個群有多少籌碼',type:1},
  {name:'籌碼管理',description:'幫群友發籌碼、收回誤發或查紀錄',type:1,default_member_permissions:'0',options:[
    {type:1,name:'發放',description:'送籌碼給群友，順便留個原因',options:[{type:6,name:'成員',description:'要送給哪位群友？',required:true},{type:4,name:'數量',description:'要送多少籌碼？',required:true,min_value:1,max_value:100000},{type:3,name:'原因',description:'留個原因，之後查紀錄才記得',required:true,max_length:200}]},
    {type:1,name:'紀錄',description:'看看群友的籌碼紀錄，沒選分類就先看發放與收回',options:[
      {type:6,name:'成員',description:'想看哪位群友的紀錄？',required:true},
      {type:3,name:'分類',description:'想看哪一種？沒選就先看發放與收回',choices:[{name:'發放與收回',value:'rewards'},{name:'每日簽到',value:'checkin'},{name:'遊戲摘要',value:'summary'},{name:'遊戲明細',value:'game'},{name:'全部籌碼紀錄',value:'all'}]},
      {type:4,name:'期間',description:'想看多久以前的？日期都按台灣時間算',choices:[{name:'今天',value:1},{name:'近 7 天',value:7},{name:'近 30 天',value:30},{name:'全部期間',value:0}]},
      {type:4,name:'早於編號',description:'想接著看更早的紀錄？填上上一頁提供的編號',min_value:1},
    ]},
    {type:1,name:'更正',description:'收回一筆誤發的籌碼，原本的紀錄會保留',options:[{type:4,name:'紀錄編號',description:'要收回哪筆發放？填那筆的紀錄編號',required:true,min_value:1},{type:3,name:'原因',description:'這筆為什麼要收回？',required:true,max_length:200}]},
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
export async function handleCommand(interaction, store, adminRoles=[]) {
  const reply=(...args)=>privateReply(store.environment,...args);
  try {
    if(interaction.type===1)return {type:1};
    if(interaction.type!==2||interaction.member?.user?.bot||!interaction.guild_id||!interaction.member?.user?.id)throw problem(403,'請在已啟用的伺服器內使用指令。','COMMAND_SCOPE');
    const guild=interaction.guild_id,user=interaction.member.user.id;
    store.validate(guild,user);
    // APP_HANDLER opens the Activity without Discord's automatic channel invite.
    if(interaction.data?.type===4)return {type:12};
    if(interaction.data.name==='簽到'){
      const r=await store.checkin(guild,user);
      return reply(`${r.duplicate?`今天的 **${number(store.daily)} 籌碼**已經領過囉。`:`今天的 **${number(store.daily)} 籌碼**領到了！`}\n你現在有 **${number(r.state.balance)} 籌碼**。\n\n台灣時間過午夜，就能再領下一份。`,r.duplicate?'今天已經領過囉':'今天的簽到領到了',r.duplicate?'warning':'success');
    }
    if(interaction.data.name==='籌碼'){
      const state=await store.state(guild,user);
      return reply(`**${number(state.balance)} 籌碼**\n\n${state.claimed?'今天的簽到已經領過了，明天再來補充吧。':`今天的簽到還沒領，輸入 /簽到 就能領 **${number(store.daily)} 籌碼**。`}`);
    }
    if(interaction.data.name!=='籌碼管理')throw problem(400,'不支援此指令。','COMMAND_UNKNOWN');
    const permissions=BigInt(interaction.member.permissions || '0');
    if(!(permissions&8n)&&!interaction.member.roles?.some(id=>adminRoles.includes(id)))throw problem(403,'只有伺服器管理員或指定的籌碼管理身分組可以操作。','COMMAND_ADMIN');
    const sub=interaction.data.options?.[0];
    const args=Object.fromEntries((sub?.options||[]).map(option=>[option.name,option.value]));
    if(sub?.name==='更正'){
      const r=await store.reverse(guild,user,args['紀錄編號'],args['原因'],interaction.id);
      return reply(r.duplicate?`這筆 **${number(-r.entry.delta)} 籌碼**已經收回過，這次沒有再扣一次。`:`已收回 **${number(-r.entry.delta)} 籌碼**，原本的發放紀錄也會保留。`,r.duplicate?'這筆已經收回了':'這筆籌碼收回了','warning',[
        {name:'這筆收回前後',value:`${number(r.entry.before)} → **${number(r.entry.after)}**`,inline:true},
        {name:'對應發放',value:`#${args['紀錄編號']}`,inline:true},
        {name:'這次紀錄',value:`#${r.entry.id}`,inline:true},
        {name:'收回原因',value:escapeText(args['原因'])},
      ]);
    }
    const target=args['成員'];
    if(!interaction.data.resolved?.members?.[target]||interaction.data.resolved?.users?.[target]?.bot)throw problem(400,'請選擇本伺服器中的真人成員。','COMMAND_MEMBER');
    if(sub?.name==='發放'){
      const r=await store.grant(guild,user,target,args['數量'],args['原因'],interaction.id);
      return reply(r.duplicate?`這筆 **${number(r.entry.delta)} 籌碼**之前已經送給 <@${target}>，這次沒有再加一次。`:`已幫 <@${target}> 加上 **${number(r.entry.delta)} 籌碼**。`,r.duplicate?'這筆已經發過了':'籌碼送到了',r.duplicate?'warning':'success',[
        {name:'這筆發放前後',value:`${number(r.entry.before)} → **${number(r.entry.after)}**`,inline:true},
        {name:'紀錄編號',value:`#${r.entry.id}`,inline:true},
        {name:'發放原因',value:escapeText(args['原因'])},
      ]);
    }
    if(sub?.name==='紀錄'){
      const category=args['分類']??'rewards',days=args['期間']??0;
      const labels={rewards:'發放與收回',checkin:'每日簽到',summary:'遊戲摘要',game:'遊戲明細',all:'全部籌碼紀錄'};
      if(!Object.hasOwn(labels,category))throw problem(400,'無效的紀錄分類。','AUDIT_FILTER');
      const period=days===0?'全部期間':days===1?'今天':`近 ${days} 天`;
      let description=`<@${target}> · ${period}（台灣時間）`;
      if(category==='summary'){
        if(args['早於編號']!==undefined)throw problem(400,'遊戲摘要不使用早於編號，請改選遊戲明細查詢逐局紀錄。','SUMMARY_CURSOR');
        const {game}=await store.auditSummary(guild,target,days);
        return reply(description+`\n${game.rounds?`這段時間一共玩了 ${number(game.rounds)} 局。`:'這段時間還沒玩過，之後的紀錄會放在這裡。'}\n想看每一局，把「分類」改成「遊戲明細」就好。`,'遊戲摘要','info',[
          {name:'遊戲局數',value:number(game.rounds),inline:true},{name:'總下注',value:number(game.bet),inline:true},
          {name:'總得獎',value:number(game.payout),inline:true},{name:'籌碼變化',value:signed(game.net),inline:true},
        ]);
      }
      const {rows,next}=await store.auditHistory(guild,target,{category,days,before:args['早於編號']});
      if(category==='checkin'){
        const {checkin}=await store.auditSummary(guild,target,days);
        description+=`\n這段時間簽到 ${number(checkin.days)} 天，共領了 ${number(checkin.total)} 籌碼。`;
      }
      const empty={rewards:'還沒有發放或收回的紀錄。',checkin:'這段時間還沒有簽到紀錄。',game:'這位玩家在這段時間還沒玩過。',all:'這段時間還沒有籌碼變動。'};
      description+=rows.length?'\n最新的放在最上面。':`\n${empty[category]}`;
      if(rows.length)description+=next?`\n想看更早的紀錄，把「早於編號」填入 ${next}，其他條件不用改。`:'\n已經看到最早一筆了。';
      return reply(description,labels[category],'info',rows.map(recordField));
    }
    throw problem(400,'不支援此操作。','COMMAND_UNKNOWN');
  }catch(error){const copy=commandError(error,{store,subcommand:interaction.data?.options?.[0]?.name});return reply(copy.message,copy.title,'error');}
}

const number=value=>value.toLocaleString('en-US');
const signed=value=>`${value>=0?'+':''}${number(value)}`;
const escapeText=value=>String(value).replace(/@/g,'＠').replace(/[\\`*_{}\[\]()<>~|#]/g,'\\$&');
function recordField(r){
  const labels={grant:'收到籌碼',reversal:'收回誤發籌碼',checkin:'每日簽到',spin:'遊玩紀錄',test_seed:'試玩起始籌碼'};
  const time=new Date(Date.parse(r.time)+8*3600000).toISOString().slice(0,16).replace('T',' ');
  const status=r.kind==='grant'?`\n${r.reversal_id?`這筆已收回（#${r.reversal_id}）`:'這筆已收到'}`:r.kind==='reversal'?`\n對應發放：#${r.reference}`:'';
  const reason=r.kind==='test_seed'?'試玩時的起始籌碼':r.kind==='spin'?r.reason.replace('派彩','拿到'):r.reason;
  return {name:`#${r.id}｜${labels[r.kind]||'其他紀錄'}｜${signed(r.delta)} 籌碼`,
    value:`${time}${r.actor?`｜<@${r.actor}>`:''}\n${r.kind==='spin'?'這局':'原因'}：${escapeText(reason)}\n籌碼：${number(r.before)} → ${number(r.after)}${status}`};
}
