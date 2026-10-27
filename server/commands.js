import { createPublicKey, verify } from 'node:crypto';
import { problem } from './wallet-common.js';
import { privateReply, commandError } from './bot-replies.js';
import {adminPanel,handlePanel,launchControls,parsePanel,panelId} from './discord-panel.js';

export const commandDefinitions = [
  {name:'戲籌',description:'查看自己的戲籌，或直接開啟遊戲',type:1,options:[]},
  {name:'戲籌管理',description:'開啟私人管理面板：玩家戲籌、發放、紀錄與全群重設',type:1,default_member_permissions:'0',options:[]},
];
export const retiredCommandNames=['簽到'];
export function validSignature(publicKey, headers, raw, now=Date.now()) {
  const signature=headers['x-signature-ed25519'], timestamp=headers['x-signature-timestamp'];
  if(!/^[a-f\d]{64}$/i.test(publicKey||'')||!/^[a-f\d]{128}$/i.test(signature||'')||!/^\d{10}$/.test(timestamp||'')||Math.abs(now-Number(timestamp)*1000)>300000)return false;
  try {
    const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(publicKey,'hex')]),format:'der',type:'spki'});
    return verify(null,Buffer.concat([Buffer.from(timestamp),raw]),key,Buffer.from(signature,'hex'));
  }catch{return false;}
}
export async function handleCommand(interaction, store, adminRoles=[],commandChannelIds=[]) {
  const reply=(...args)=>privateReply(store.environment,...args);
  try {
    if(interaction.type===1)return {type:1};
    if(![2,3,5].includes(interaction.type)||interaction.member?.user?.bot||!interaction.guild_id||!interaction.member?.user?.id)throw problem(403,'請在已啟用的伺服器內使用指令。','COMMAND_SCOPE');
    const guild=interaction.guild_id,user=interaction.member.user.id;
    store.validate(guild,user);
    if(commandChannelIds.length&&!commandChannelIds.includes(interaction.channel_id||interaction.channel?.id))throw Object.assign(problem(403,'請到指定頻道使用指令。','COMMAND_CHANNEL'),{channel:commandChannelIds[0]});
    const panel=[3,5].includes(interaction.type)?parsePanel(interaction):null;
    if(panel?.action==='go')return {type:12};
    // APP_HANDLER opens the Activity without Discord's automatic channel invite.
    if(interaction.data?.type===4)return {type:12};
    if(interaction.data.name==='簽到'){
      const result=reply('簽到獎勵已移至遊戲內。\n請開啟遊戲，點上方「週簽到」查看進度並領取獎勵。','請在遊戲內簽到');
      result.data.components=launchControls(interaction);return result;
    }
    if(['戲籌','\u7c4c\u78bc'].includes(interaction.data.name)){
      const state=await store.state(guild,user,{compact:true});
      const result=reply(`**${number(state.balance)} 戲籌**\n\n${state.claimed?`今天的週簽到已經領過了，明天可領 **${number(state.weeklyCheckin.nextReward)} 戲籌**。`:`週簽到第 ${state.weeklyCheckin.day} 天，可在遊戲內領取 **${number(state.daily)} 戲籌**。`}\n連續七天循環，中斷從第 1 天重新開始。`);
      result.data.components=launchControls(interaction);return result;
    }
    if(!panel&&!['戲籌管理','\u7c4c\u78bc管理'].includes(interaction.data.name))throw problem(400,'不支援此指令。','COMMAND_UNKNOWN');
    const permissions=BigInt(interaction.member.permissions || '0');
    if(!(permissions&8n)&&!interaction.member.roles?.some(id=>adminRoles.includes(id)))throw problem(403,'只有伺服器管理員或指定的戲籌管理身分組可以操作。','COMMAND_ADMIN');
    if(panel)return await handlePanel(interaction,store,recordField,panel);
    const sub=interaction.data.options?.[0];
    if(!sub)return adminPanel(interaction,store.environment);
    const args=Object.fromEntries((sub?.options||[]).map(option=>[option.name,option.value]));
    if(sub?.name==='玩家戲籌'){
      const page=await store.playerWallets(guild,{after:args['起始玩家']??''});
      return reply(`本群已建立錢包的玩家，包括只有簽到的玩家。\n查詢時間：${taipeiTime(page.time)}\n這是查詢當下的餘額；重設時會另外保存實際餘額。\n\n${page.rows.length?'每頁最多 20 位。':'本群還沒有已建立錢包的玩家。'}${page.next?`\n下一頁：/戲籌管理 玩家戲籌 起始玩家:${page.next}`:''}`,'玩家戲籌','info',
        page.rows.map(w=>({name:`玩家 ${w.user}`,value:`<@${w.user}> · **${number(w.balance)} 戲籌**\n遊玩 ${number(w.rounds)} 局`})));
    }
    if(sub?.name==='重設戲籌'){
      const saved=args['紀錄編號'],page=args['頁碼']??1;
      if(!Number.isInteger(page)||page<1||page>5||(!saved&&page!==1))throw problem(400,'請先執行重設，再使用紀錄編號查看其他頁。','RESET_PAGE');
      if(!saved&&args['確認']!==true)throw problem(400,'請將確認選為 True，才會重設本群所有已建立錢包的玩家。','RESET_CONFIRM');
      const r=saved?await store.walletResetReport(guild,user,saved):await store.resetWallets(guild,user,interaction.id);
      const pages=Math.ceil(r.entries.length/20);
      if(page>pages)throw problem(400,'這筆紀錄沒有此頁。','RESET_PAGE');
      const rows=r.entries.slice((page-1)*20,page*20),id=r.reset.requestId;
      return reply(`${r.duplicate?'以下為原重設報表，這次沒有再次重設。':'本群所有已建立錢包的玩家，已在同一筆交易中重設為 **10,000 戲籌**。'}\n重設時間：${taipeiTime(r.reset.time)}\n共 ${r.reset.count} 位玩家；重設前總戲籌 **${BigInt(r.reset.totalBefore).toLocaleString('en-US')}**。\n\n下方為重設前一刻的實際餘額 → 重設餘額。\n週簽到進度與遊玩歷史均已保留。重設後的新遊玩會從 10,000 開始結算。\n\n紀錄編號：\`${id}\`\n第 ${page} / ${pages} 頁${pages>1?`\n翻頁：/戲籌管理 重設戲籌 紀錄編號:${id} 頁碼:${page<pages?page+1:1}`:''}`,
        r.duplicate?'重設紀錄':'戲籌已重設','info',rows.map(w=>({name:`玩家 ${w.user}`,value:`<@${w.user}>\n**${number(w.before)} → ${number(w.after)}** 戲籌`})));
    }
    if(sub?.name==='更正'){
      const r=await store.reverse(guild,user,args['紀錄編號'],args['原因'],interaction.id);
      return reply(r.duplicate?`這筆 **${number(-r.entry.delta)} 戲籌**已經收回過，這次沒有再扣一次。`:`已收回 **${number(-r.entry.delta)} 戲籌**，原本的發放紀錄也會保留。`,r.duplicate?'這筆已經收回了':'這筆戲籌收回了','warning',[
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
      return reply(r.duplicate?`這筆 **${number(r.entry.delta)} 戲籌**之前已經送給 <@${target}>，這次沒有再加一次。`:`已幫 <@${target}> 加上 **${number(r.entry.delta)} 戲籌**。`,r.duplicate?'這筆已經發過了':'戲籌送到了',r.duplicate?'warning':'success',[
        {name:'這筆發放前後',value:`${number(r.entry.before)} → **${number(r.entry.after)}**`,inline:true},
        {name:'紀錄編號',value:`#${r.entry.id}`,inline:true},
        {name:'發放原因',value:escapeText(args['原因'])},
      ]);
    }
    if(sub?.name==='紀錄'){
      const category=args['分類']??'rewards',days=args['期間']??0;
      const labels={rewards:'發放與收回',checkin:'週簽到',summary:'遊戲摘要',game:'遊戲明細',all:'全部戲籌紀錄'};
      if(!Object.hasOwn(labels,category))throw problem(400,'無效的紀錄分類。','AUDIT_FILTER');
      const period=days===0?'全部期間':days===1?'今天':`近 ${days} 天`;
      let description=`<@${target}> · ${period}（台灣時間）`;
      if(category==='summary'){
        if(args['早於編號']!==undefined)throw problem(400,'遊戲摘要不使用早於編號，請改選遊戲明細查詢逐局紀錄。','SUMMARY_CURSOR');
        const {game}=await store.auditSummary(guild,target,days);
        return reply(description+`\n${game.rounds?`這段時間一共玩了 ${number(game.rounds)} 局。`:'這段時間還沒玩過，之後的紀錄會放在這裡。'}\n想看每一局，把「分類」改成「遊戲明細」就好。`,'遊戲摘要','info',[
          {name:'遊戲局數',value:number(game.rounds),inline:true},{name:'總下注',value:number(game.bet),inline:true},
          {name:'總得獎',value:number(game.payout),inline:true},{name:'戲籌變化',value:signed(game.net),inline:true},
        ]);
      }
      const {rows,next}=await store.auditHistory(guild,target,{category,days,before:args['早於編號']});
      if(category==='checkin'){
        const {checkin}=await store.auditSummary(guild,target,days);
        description+=`\n這段時間簽到 ${number(checkin.days)} 天，共領了 ${number(checkin.total)} 戲籌。`;
      }
      const empty={rewards:'還沒有發放或收回的紀錄。',checkin:'這段時間還沒有簽到紀錄。',game:'這位玩家在這段時間還沒玩過。',all:'這段時間還沒有戲籌變動。'};
      description+=rows.length?'\n最新的放在最上面。':`\n${empty[category]}`;
      if(rows.length)description+=next?`\n想看更早的紀錄，把「早於編號」填入 ${next}，其他條件不用改。`:'\n已經看到最早一筆了。';
      return reply(description,labels[category],'info',rows.map(recordField));
    }
    throw problem(400,'不支援此操作。','COMMAND_UNKNOWN');
  }catch(error){
    const copy=commandError(error,{store,subcommand:interaction.data?.custom_id?.split('|')[1]==='vs'?'更正':interaction.data?.options?.[0]?.name}),result=reply(copy.message,copy.title,'error');
    // PATCH leaves omitted components unchanged. Replace the old confirmation
    // controls explicitly when a component/form fails, including an empty report.
    if([3,5].includes(interaction.type))result.data.components=/^\d{17,20}$/.test(interaction.guild_id||'')&&/^\d{17,20}$/.test(interaction.member?.user?.id||'')
      ?[{type:1,components:[{type:2,style:2,label:'返回管理面板',custom_id:panelId(interaction,'home')}]}]:[];
    return result;
  }
}

const number=value=>value.toLocaleString('en-US');
const signed=value=>`${value>=0?'+':''}${number(value)}`;
const taipeiTime=value=>new Date(Date.parse(value)+8*3600000).toISOString().slice(0,19).replace('T',' ')+'（台灣時間）';
const escapeText=value=>String(value).replace(/@/g,'＠').replace(/[\\`*_{}\[\]()<>~|#]/g,'\\$&');
function recordField(r){
  if(r.kind==='reset')return {name:`#${r.id}｜餘額重設｜重設為 ${number(r.after)} 戲籌`,value:`${taipeiTime(r.time)}\n管理員：<@${r.actor}>\n重設前餘額：${number(r.before)}\n重設後餘額：${number(r.after)}\n週簽到進度與遊玩歷史保留。`};
  const labels={grant:'收到戲籌',reversal:'收回誤發戲籌',checkin:'週簽到',spin:'遊玩紀錄',test_seed:'試玩起始戲籌',welcome:'新手戲籌'};
  const time=new Date(Date.parse(r.time)+8*3600000).toISOString().slice(0,16).replace('T',' ');
  const status=r.kind==='grant'?`\n${r.reversal_id?`這筆已收回（#${r.reversal_id}）`:'這筆已收到'}`:r.kind==='reversal'?`\n對應發放：#${r.reference}`:'';
  const reason=r.kind==='test_seed'?'試玩時的起始戲籌':r.kind==='spin'?r.reason.replace('派彩','拿到'):r.reason;
  return {name:`#${r.id}｜${labels[r.kind]||'其他紀錄'}｜${signed(r.delta)} 戲籌`,
    value:`${time}${r.actor?`｜<@${r.actor}>`:''}\n${r.kind==='spin'?'這局':'原因'}：${escapeText(reason)}\n戲籌：${number(r.before)} → ${number(r.after)}${status}`};
}
