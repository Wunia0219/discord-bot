import {privateReply} from './bot-replies.js';
import {problem} from '../wallet/wallet-common.js';

const id=s=>typeof s==='string'&&/^\d{17,20}$/.test(s);
const num=n=>n.toLocaleString('en-US');
const esc=s=>String(s).replace(/@/g,'＠').replace(/[\\`*_{}\[\]()<>~|#]/g,'\\$&');
const time=s=>new Date(s).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false});
const categories={r:['發放、收回與重設','rewards'],c:['週簽到','checkin'],s:['遊玩摘要','summary'],g:['逐局紀錄','game'],a:['全部變動','all']};
const periods={0:'全部期間',1:'今天',7:'近 7 天',30:'近 30 天'};
const row=(...components)=>({type:1,components:components.filter(Boolean)});
export function panelId(i,action,...args){
  const value=['jc',action,i.guild_id,i.member.user.id,...args.map(String)].join('|');
  if(value.length>100)throw problem(400,'面板資料過長，請重新開啟。','PANEL_INVALID');return value;
}
export function parsePanel(i){
  const value=i.data?.custom_id;if(typeof value!=='string'||value.length>100)throw problem(400,'請重新開啟管理面板。','PANEL_INVALID');
  const [prefix,action,guild,owner,...args]=value.split('|');
  if(prefix!=='jc'||!id(guild)||!id(owner))throw problem(400,'請重新開啟管理面板。','PANEL_INVALID');
  if(guild!==i.guild_id||owner!==i.member.user.id)throw problem(403,'請使用自己開啟的面板。','PANEL_OWNER');
  if((i.type===5)!==['gs','hs','vs','rs'].includes(action))throw problem(400,'請重新開啟面板。','PANEL_INVALID');
  if(i.data.values&&(!Array.isArray(i.data.values)||i.data.values.length!==1||typeof i.data.values[0]!=='string'))throw problem(400,'請只選一個項目。','PANEL_INVALID');
  return {action,args};
}
export function deferWalletInteraction(i){
  if(i.type===2)return i.data?.type!==4&&i.data?.name!=='簽到';
  if(![3,5].includes(i.type))return false;
  return ['p','h','hc','hd','rp','rr','ra','rf','gs','hs','vs','rs'].includes(i.data?.custom_id?.split('|')[1]);
}
const button=(i,label,action,args=[],style=2)=>({type:2,style,label,custom_id:panelId(i,action,...args)});
const home=i=>button(i,'返回管理面板','home');
const response=(i,env,title,description,fields=[],components=[],tone='info')=>{
  const result=privateReply(env,description,title,tone,fields);result.data.components=components;
  if(i.type===3&&((i.message?.flags||0)&64)){result.type=7;delete result.data.flags;}return result;
};
export const launchControls=i=>[row(button(i,'開啟遊戲','go',[],1))];
export function adminPanel(i,env){return response(i,env,'戲籌管理','選擇下方功能。若要收回誤發戲籌，請先查詢該筆發放紀錄。',[],[
  row(button(i,'玩家戲籌','p'),button(i,'發放戲籌','gf',[],1),button(i,'查詢紀錄','hf')),
  row(button(i,'重設全群','reset',[],4)),
]);}
const text=(custom_id,placeholder,max_length=200,value)=>({type:4,custom_id,style:max_length===200?2:1,required:true,min_length:1,max_length,placeholder,...(value?{value}:{})});
const label=(name,component,description)=>({type:18,label:name,component,...(description?{description}:{})});
const userSelect=()=>label('玩家',{type:5,custom_id:'member',min_values:1,max_values:1,required:true,placeholder:'搜尋並選擇本群玩家'});
const select=(i,action,args,options,placeholder)=>row({type:3,custom_id:panelId(i,action,...args),min_values:1,max_values:1,placeholder,options});
const modal=(i,title,action,args,components)=>({type:9,data:{title,custom_id:panelId(i,action,...args),components}});
function request(i){if(!id(i.id))throw problem(400,'請重新開啟面板。','PANEL_INVALID');return i.id;}
function fresh(requestId,notBefore=0){
  if(!id(requestId))throw problem(400,'此操作已過期，請重新開啟面板。','PANEL_EXPIRED');
  const created=Number((BigInt(requestId)>>22n)+1420070400000n),age=Date.now()-created;
  if(created<notBefore||age< -60000||age>30*60000)throw problem(400,'此操作已過期，請重新開啟面板。','PANEL_EXPIRED');
}
function inputs(i){
  const fields=new Map(),resolved={users:{},members:{}};
  const visit=(nodes,depth=0)=>{
    if(depth>4||!Array.isArray(nodes)||nodes.length>25)throw problem(400,'表單格式不正確。','PANEL_INVALID');
    for(const c of nodes){
      if(c.resolved)for(const key of ['users','members'])Object.assign(resolved[key],c.resolved[key]);
      if(c.custom_id){if(fields.has(c.custom_id))throw problem(400,'表單欄位重複。','PANEL_INVALID');fields.set(c.custom_id,c);}
      if(c.component)visit([c.component],depth+1);if(c.components)visit(c.components,depth+1);
    }
  };
  visit(i.data.components);for(const key of ['users','members'])Object.assign(resolved[key],i.data.resolved?.[key]);
  const one=name=>{const c=fields.get(name);if(c?.values){if(c.values.length!==1)throw problem(400,'請只選一個項目。','PANEL_INVALID');return c.values[0];}return c?.value;};
  const member=()=>{const target=one('member');if(!id(target)||!resolved.members[target]||!resolved.users[target]||resolved.users[target].bot)throw problem(400,'請選擇本群真人玩家。','COMMAND_MEMBER');return target;};
  return {one,member};
}
function integer(value){if(!/^[1-9]\d{0,15}$/.test(value||'')||!Number.isSafeInteger(Number(value)))throw problem(400,'請填寫正整數。','PANEL_NUMBER');return Number(value);}
function report(i,env,result,page=1){
  const pages=Math.ceil(result.reset.count/20);if(!Number.isInteger(page)||page<1||page>pages)throw problem(400,'沒有此頁報表。','RESET_PAGE');
  const r=result.reset,rows=result.page?result.entries:result.entries.slice((page-1)*20,page*20);
  return response(i,env,result.duplicate?'上次重設報表':'戲籌已重設',`${result.duplicate?'以下為上次重設的實際結果，這次沒有再次重設。':'本群所有已有錢包的玩家，已重設為 **10,000 戲籌**。'}\n\n重設時間：${time(r.time)}（台灣時間）\n玩家：${r.count} 位｜重設前總戲籌：**${BigInt(r.totalBefore).toLocaleString('en-US')}**\n下方為「重設前餘額 → 重設後餘額」，不隨後續遊玩變動。\n週簽到與遊玩歷史均保留。\n僅提供最近一次報表。\n\n第 ${page} / ${pages} 頁`,
    rows.map(w=>({name:`${num(w.before)} → ${num(w.after)} 戲籌`,value:`<@${w.user}>`})),[
      row(page>1&&button(i,'上一頁','rp',[r.requestId,page-1]),page<pages&&button(i,'下一頁','rp',[r.requestId,page+1]),home(i)),
    ]);
}
async function history(i,store,recordField,target,category='r',days=0,before){
  if(!id(target)||!Object.hasOwn(categories,category)||!Object.hasOwn(periods,days))throw problem(400,'請重新選擇查詢條件。','AUDIT_FILTER');
  const [title,filter]=categories[category];let fields=[],next=null;
  let description=`<@${target}> · ${periods[days]}（台灣時間）`;
  let rows=[];
  if(filter==='summary'){
    const {game}=await store.auditSummary(i.guild_id,target,days);description+='\n想看單局結果，可將分類切換為「逐局紀錄」。';
    fields=[{name:'遊玩局數',value:num(game.rounds),inline:true},{name:'總下注',value:num(game.bet),inline:true},{name:'總得獎',value:num(game.payout),inline:true},{name:'戲籌變化',value:`${game.net>=0?'+':''}${num(game.net)}`,inline:true}];
  }else{
    const page=await store.auditHistory(i.guild_id,target,{category:filter,days,...(before?{before:integer(before)}:{})});rows=page.rows;next=page.next;
    fields=rows.map(recordField);description+=rows.length?'\n最新紀錄在上方，可切換分類與期間。':'\n這個範圍還沒有紀錄。';
    if(filter==='checkin'){const {checkin}=await store.auditSummary(i.guild_id,target,days);description+=`\n共簽到 ${num(checkin.days)} 天，領取 ${num(checkin.total)} 戲籌。`;}
  }
  const components=[
    select(i,'hc',[target,days],Object.entries(categories).map(([value,[name]])=>({label:name,value,default:value===category})),'紀錄分類'),
    select(i,'hd',[target,category],Object.entries(periods).map(([value,name])=>({label:name,value,default:Number(value)===Number(days)})),'查詢期間'),
    row(next&&button(i,'更早的紀錄','h',[target,category,days,next]),before&&button(i,'回到最新','h',[target,category,days]),button(i,'換一位玩家','hf'),home(i)),
  ];
  const grants=rows.filter(r=>r.kind==='grant'&&!r.reversal_id);
  if(grants.length)components.push(select(i,'rv',[],grants.map(r=>({label:`#${r.id} · ${num(r.delta)} 戲籌`,value:String(r.id),description:String(r.reason).slice(0,100)})),'選擇一筆發放，收回誤發戲籌'));
  if(rows.some(r=>r.kind==='reset'))components.push(row(button(i,'上次重設報表','rf')));
  return response(i,store.environment,title,description,fields,components);
}
export async function handlePanel(i,store,recordField,parsed){
  const {action,args}=parsed,env=store.environment,guild=i.guild_id,actor=i.member.user.id;
  if(action==='home')return adminPanel(i,env);
  if(action==='p'){
    const [cursor='']=args;
    const page=await store.playerWallets(guild,{after:cursor});
    return response(i,env,'全群玩家戲籌',`本群已有錢包的玩家。\n查詢時間：${time(page.time)}（台灣時間）\n餘額以查詢時間為準。${page.rows.length?'':'\n目前還沒有玩家錢包。'}`,
      page.rows.map(w=>({name:`${num(w.balance)} 戲籌`,value:`<@${w.user}> · 已遊玩 ${num(w.rounds)} 局`})),[
        row(cursor&&button(i,'回到第一頁','p'),page.next&&button(i,'下一頁','p',[page.next]),home(i)),
      ]);
  }
  if(action==='gf')return modal(i,'發放戲籌','gs',[request(i)],[userSelect(),label('數量',text('amount',`1～${num(store.grantMax)}`,String(store.grantMax).length)),label('發放原因',text('reason','例如活動獎勵',200,'活動獎勵'))]);
  if(action==='hf')return modal(i,'查詢玩家紀錄','hs',[],[userSelect()]);
  if(action==='hs'){const f=inputs(i);return history(i,store,recordField,f.member());}
  if(action==='gs'){
    fresh(args[0],store.resetAt);const f=inputs(i),target=f.member(),r=await store.grant(guild,actor,target,integer(f.one('amount')),f.one('reason'),args[0]);
    return response(i,env,r.duplicate?'這筆已經發放過':'戲籌已發放',`${r.duplicate?'這次沒有再次發放。':'已發放 '+num(r.entry.delta)+' 戲籌給 <@'+target+'>。'}\n本筆發放前後：${num(r.entry.before)} → **${num(r.entry.after)}**\n原因：${esc(f.one('reason'))}\n紀錄編號：#${r.entry.id}`,[],[
      row(button(i,'查看玩家紀錄','h',[target,'r',0]),button(i,'收回這筆發放','rv',[r.entry.id],4),button(i,'繼續發放','gf'),home(i)),
    ],r.duplicate?'warning':'success');
  }
  if(action==='rv'){
    const entry=String(integer(args[0]||i.data.values?.[0]));
    return modal(i,'收回誤發戲籌','vs',[entry,request(i)],[label(`收回發放 #${entry}`,text('reason','請說明收回原因',200,'更正誤發'),'會收回該筆發放的完整金額，原始紀錄保留。')]);
  }
  if(action==='vs'){
    fresh(args[1],store.resetAt);const f=inputs(i),entry=integer(args[0]),r=await store.reverse(guild,actor,entry,f.one('reason'),args[1]);
    return response(i,env,r.duplicate?'這筆已經收回過':'誤發戲籌已收回',`${r.duplicate?'這次沒有再次扣除戲籌。':'已收回 '+num(-r.entry.delta)+' 戲籌。'}\n對應發放：#${entry}\n本筆收回前後：${num(r.entry.before)} → **${num(r.entry.after)}**\n原因：${esc(f.one('reason'))}\n原始發放紀錄保留。`,[],[row(home(i))],'warning');
  }
  if(action==='h')return history(i,store,recordField,args[0],args[1],Number(args[2]),args[3]);
  if(action==='hc')return history(i,store,recordField,args[0],i.data.values?.[0],Number(args[1]));
  if(action==='hd')return history(i,store,recordField,args[0],args[1],Number(i.data.values?.[0]));
  if(action==='reset')return response(i,env,'重設全群戲籌','這會將本群所有已有錢包的玩家設為 **10,000 戲籌**。\n週簽到與遊玩歷史保留；確認時會記下每位玩家重設前的實際餘額。\n\n確認後會立即執行，請先核對玩家戲籌。',[],[
    row(button(i,'確認重設全群','ra',[request(i)],4),button(i,'上次重設報表','rf'),button(i,'取消','home')),
  ],'warning');
  if(action==='ra'){fresh(args[0],store.resetAt);return report(i,env,await store.resetWallets(guild,actor,args[0]));}
  // Legacy forms/selects also open the latest reset report.
  if(['rf','rs','rr'].includes(action))return report(i,env,await store.walletResetReport(guild,actor,undefined,{page:1}));
  if(action==='rp')return report(i,env,await store.walletResetReport(guild,actor,args[0],{page:Number(args[1])}),Number(args[1]));
  throw problem(400,'請重新開啟管理面板。','PANEL_INVALID');
}
