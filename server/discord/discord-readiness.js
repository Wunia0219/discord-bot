import {discordConfigurationReady} from './discord-config.js';
import {commandDefinitions,retiredCommandNames} from './commands.js';
import {highlightSettings} from './highlights.js';
import {CasinoBot} from './casino-bot.js';
import {MODEL_VERSION} from '../../src/game/slot-math.js';

const snowflake=value=>/^\d{17,20}$/.test(value||'');
const list=value=>(value||'').split(',').map(s=>s.trim()).filter(Boolean);
const matches=(actual,expected)=>Array.isArray(expected)?(actual==null&&expected.length===0)||(Array.isArray(actual)&&actual.length===expected.length&&expected.every((v,i)=>matches(actual[i],v)))
  :expected&&typeof expected==='object'?!!actual&&Object.entries(expected).every(([key,value])=>matches(actual[key],value)):actual===expected;
export function publicOrigin(value){
  let url;try{url=new URL(value);}catch{throw new Error('Invalid public HTTPS origin');}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('Use an HTTPS origin without credentials, path, query or fragment');
  return url.origin;
}

// Read-only diagnostics. OAuth obtains a short-lived application token, then
// only GETs command definitions. It never registers commands or posts messages.
export async function checkDiscordReadiness({env,frontend={},built=false,offline=false,discord=false,origin,cloud=false,fetchImpl=fetch}){
  if(cloud&&!origin)throw new Error('Cloud checks require a public origin');
  if(offline&&(discord||origin))throw new Error('Offline checks cannot include remote checks');
  if(origin)origin=publicOrigin(origin);
  const checks=[],add=(code,ok,detail)=>checks.push({code,status:ok?'pass':'fail',detail}),note=(code,detail)=>checks.push({code,status:'unverified',detail});
  const configured=discordConfigurationReady({clientId:env.DISCORD_CLIENT_ID,clientSecret:env.DISCORD_CLIENT_SECRET,publicKey:env.DISCORD_PUBLIC_KEY});
  add('DISCORD_CONFIG',configured,'後端 Application ID、密鑰及簽章公鑰格式');
  add('FRONTEND_CONFIG',frontend.VITE_DISCORD_AUTH_ENABLED==='true'&&frontend.VITE_DISCORD_WALLET_ENABLED==='true'
    &&frontend.VITE_DISCORD_CLIENT_ID===env.DISCORD_CLIENT_ID,'前後端 Application ID 一致，登入與錢包已啟用');
  add('PUBLIC_ENV_SECRETS',!Object.keys(frontend).some(key=>/^VITE_.*(SECRET|TOKEN|PRIVATE_KEY)/i.test(key)&&frontend[key]),'公開前端設定不含密鑰');
  const guilds=list(env.ALLOWED_GUILD_IDS),roles=list(env.CHIP_ADMIN_ROLE_IDS);
  add('GUILD_SCOPE',guilds.length>0&&guilds.every(snowflake)&&roles.every(snowflake),'已指定合法的群組與管理角色範圍');
  add('WALLET_MODE',env.WALLET_ENABLED==='true'&&env.LOCAL_WALLET_TEST!=='true'&&['test','production'].includes(env.APP_ENV)
    &&(!env.WALLET_BACKEND||['sqlite','firestore'].includes(env.WALLET_BACKEND)),'使用 Discord 錢包模式及明確資料環境');
  const port=Number(env.PORT||4188),hostValid=env.HOST==='127.0.0.1'&&Number.isInteger(port)&&port>0&&port<65536;
  add('LISTEN_ADDRESS',hostValid,'本機後端位址及連接埠有效');
  add('BUILD_PRESENT',built,'已建立 dist/index.html；仍須確認建置使用最新的前端設定');
  let highlights;
  try{highlights=highlightSettings(env,{guildIds:new Set(guilds),assertGuild:g=>{if(!guilds.includes(g))throw new Error('guild');}});
    if(highlights)add('HIGHLIGHTS_CONFIG',true,highlights.botSettings?'公告機器人、目的群與頻道設定有效':'公告目的群及 Webhook 格式有效');
    else note('HIGHLIGHTS_DISABLED','尚未設定專用公告頻道；遊戲仍可運行');
  }catch{add('HIGHLIGHTS_CONFIG',false,'公告設定無效；未輸出 Webhook 或憑證');}
  const request=(url,options={})=>fetchImpl(url,{...options,signal:AbortSignal.timeout(10000),redirect:'error'});
  const probe=async(base,label)=>{
    for(const path of ['/healthz','/readyz','/',...(cloud?['/terms','/privacy']:['/terms.html','/privacy.html']),'/api/wallet','/api/interactions']){
      try{
        const interaction=path==='/api/interactions';
        const response=await request(base+path,interaction?{method:'POST',headers:{'Content-Type':'application/json'},body:'{"type":1}'}:{});
        let ok=response.status===(path.startsWith('/api/')?401:200);
        if(path==='/healthz'||path==='/readyz'){
          const body=await response.json();ok &&= body.ok===true&&(path!=='/healthz'||body.model===MODEL_VERSION);
        }else if(!path.startsWith('/api/'))ok &&= (response.headers.get('content-type')||'').includes('text/html');
        add(label+':'+path,ok,'HTTP '+response.status);
      }catch{add(label+':'+path,false,'無法連線、回應不符或被轉址');}
    }
  };
  if(!offline&&!cloud&&hostValid)await probe(`http://127.0.0.1:${port}`,'LOCAL');
  else note('LOCAL_RUNTIME','本次未探測運行中的服務');
  if(origin)await probe(origin,'PUBLIC');else note('PUBLIC_RUNTIME','尚未探測公開 HTTPS 入口與路由');
  if(discord&&configured&&guilds.length&&guilds.every(snowflake)){
    try{
      const response=await request('https://discord.com/api/v10/oauth2/token',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(env.DISCORD_CLIENT_ID+':'+env.DISCORD_CLIENT_SECRET).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({grant_type:'client_credentials',scope:'applications.commands.update'})});
      const token=response.ok?(await response.json()).access_token:null;if(typeof token!=='string'||!token)throw new Error('auth');
      add('DISCORD_AUTH',true,'應用程式授權有效');const headers={Authorization:'Bearer '+token};
      const global=await request(`https://discord.com/api/v10/applications/${env.DISCORD_CLIENT_ID}/commands`,{headers});
      const globalCommands=global.ok?await global.json():[],entries=globalCommands.filter(row=>row.type===4);
      add('ACTIVITY_ENTRY',entries.length===1&&entries[0].handler===1,'唯一 Activity 入口使用 APP_HANDLER 安靜啟動');
      add('GLOBAL_RETIRED_COMMANDS',global.ok&&!globalCommands.some(row=>row.type===1&&retiredCommandNames.includes(row.name)),'全域簽到指令已移除');
      for(let i=0;i<guilds.length;i++){
        const response=await request(`https://discord.com/api/v10/applications/${env.DISCORD_CLIENT_ID}/guilds/${guilds[i]}/commands`,{headers});
        const commands=response.ok?await response.json():[];
        add(`RETIRED_COMMANDS:${i+1}`,response.ok&&!commands.some(row=>row.type===1&&retiredCommandNames.includes(row.name)),'群組簽到指令已移除');
        for(const definition of commandDefinitions)add(`COMMAND:${i+1}:${definition.name}`,
          Array.isArray(commands)&&commands.some(row=>matches(row,definition)),'已安裝的指令定義與程式一致');
      }
      if(highlights?.botSettings){
        await new CasinoBot({...highlights.botSettings,fetchImpl}).verify();
        add('CASINO_BOT_DESTINATION',true,'機器人身分與公告頻道所屬群一致；不發送訊息');
      }else if(highlights){
        const response=await request(highlights.webhookUrl),destination=response.ok?await response.json():null;
        add('HIGHLIGHTS_DESTINATION',destination?.type===1&&destination.guild_id===highlights.guild&&snowflake(destination.channel_id),'公告 Webhook 確實屬於指定群；不發送訊息');
      }
    }catch{add('DISCORD_READ_CHECK',false,'Discord 授權或唯讀查詢失敗；未輸出供應商原始回應');}
  }else note('DISCORD_REMOTE','本次未驗證 Discord 憑證與遠端指令');
  return {checkedAt:new Date().toISOString(),scope:offline?'configuration-only':'runtime-probes',
    ok:checks.every(row=>row.status!=='fail'),checks,
    manual:['Developer Portal 的 Activity URL Mapping、Interactions Endpoint、OAuth redirect 與支援平台',
      'Discord 桌面／手機實際登入、啟動、音效、背景恢復與跨裝置驗收'],
    note:'通過只代表列出的自動檢查通過，不代表完整 Discord 真人驗收或已發布新程式。'};
}
