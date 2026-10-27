import { createPublicKey, verify } from 'node:crypto';
import { problem } from './wallet-common.js';
import { privateReply, commandError } from './bot-replies.js';

export const commandDefinitions = [
  {name:'簽到',description:'週簽到：連續七天獎勵循環，中斷從第 1 天重新開始',type:1},
  {name:'戲籌',description:'看看你在這個群有多少戲籌',type:1},
  {name:'戲籌管理',description:'幫群友發戲籌、收回誤發或查紀錄',type:1,default_member_permissions:'0',options:[
    {type:1,name:'玩家戲籌',description:'查看本群所有已建立錢包的玩家與目前戲籌',options:[{type:3,name:'起始玩家',description:'接續上一頁：填入上一頁提供的玩家編號',min_length:17,max_length:20}]},
    {type:1,name:'重設戲籌',description:'將本群已有錢包的玩家重設為 10000，保存重設前實際餘額',options:[
      {type:5,name:'確認',description:'執行新一筆重設時請選 True；簽到與歷史均會保留'},
      {type:3,name:'紀錄編號',description:'查看已完成的重設報表，填入先前提供的編號，不會再次重設',min_length:16,max_length:80},
      {type:4,name:'頁碼',description:'重設報表頁碼，每頁 20 位玩家',min_value:1,max_value:5},
    ]},
    {type:1,name:'發放',description:'送戲籌給群友，順便留個原因',options:[{type:6,name:'成員',description:'要送給哪位群友？',required:true},{type:4,name:'數量',description:'要送多少戲籌？',required:true,min_value:1,max_value:100000},{type:3,name:'原因',description:'留個原因，之後查紀錄才記得',required:true,max_length:200}]},
    {type:1,name:'紀錄',description:'看看群友的戲籌紀錄，沒選分類就先看發放與收回',options:[
      {type:6,name:'成員',description:'想看哪位群友的紀錄？',required:true},
      {type:3,name:'分類',description:'想看哪一種？沒選就先看發放與收回',choices:[{name:'發放與收回',value:'rewards'},{name:'週簽到',value:'checkin'},{name:'遊戲摘要',value:'summary'},{name:'遊戲明細',value:'game'},{name:'全部戲籌紀錄',value:'all'}]},
      {type:4,name:'期間',description:'想看多久以前的？日期都按台灣時間算',choices:[{name:'今天',value:1},{name:'近 7 天',value:7},{name:'近 30 天',value:30},{name:'全部期間',value:0}]},
      {type:4,name:'早於編號',description:'想接著看更早的紀錄？填上上一頁提供的編號',min_value:1},
    ]},
    {type:1,name:'更正',description:'收回一筆誤發的戲籌，原本的紀錄會保留',options:[{type:4,name:'紀錄編號',description:'要收回哪筆發放？填那筆的紀錄編號',required:true,min_value:1},{type:3,name:'原因',description:'這筆為什麼要收回？',required:true,max_length:200}]},
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
      const r=await store.checkin(guild,user,{compact:true});
      const progress=r.state.weeklyCheckin,cycle=r.checkin?`週簽到第 ${r.checkin.cycleDay} 天，`:'';
      return reply(`${cycle}${r.duplicate?`今天的 **${number(r.entry.delta)} 戲籌**已經領過囉。`:`今天的 **${number(r.entry.delta)} 戲籌**領到了！`}\n你現在有 **${number(r.state.balance)} 戲籌**。\n\n明天第 ${progress.nextDay} 天可領 **${number(progress.nextReward)} 戲籌**。\n連續七天循環，中斷從第 1 天重新開始；台灣時間午夜換日。`,r.duplicate?'今天已經領過囉':'今天的簽到領到了',r.duplicate?'warning':'success');
    }
    if(['戲籌','\u7c4c\u78bc'].includes(interaction.data.name)){
      const state=await store.state(guild,user,{compact:true});
      return reply(`**${number(state.balance)} 戲籌**\n\n${state.claimed?`今天的週簽到已經領過了，明天可領 **${number(state.weeklyCheckin.nextReward)} 戲籌**。`:`週簽到第 ${state.weeklyCheckin.day} 天，輸入 /簽到 就能領 **${number(state.daily)} 戲籌**。`}\n連續七天循環，中斷從第 1 天重新開始。`);
    }
    if(!['戲籌管理','\u7c4c\u78bc管理'].includes(interaction.data.name))throw problem(400,'不支援此指令。','COMMAND_UNKNOWN');
    const permissions=BigInt(interaction.member.permissions || '0');
    if(!(permissions&8n)&&!interaction.member.roles?.some(id=>adminRoles.includes(id)))throw problem(403,'只有伺服器管理員或指定的戲籌管理身分組可以操作。','COMMAND_ADMIN');
    const sub=interaction.data.options?.[0];
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
  }catch(error){const copy=commandError(error,{store,subcommand:interaction.data?.options?.[0]?.name});return reply(copy.message,copy.title,'error');}
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
