import { commandDefinitions } from '../../server/commands.js';
// Uses this application's client credentials, never a user's token or an administrator bot.
const {DISCORD_CLIENT_ID:id,DISCORD_CLIENT_SECRET:secret,ALLOWED_GUILD_IDS:raw}=process.env;
const guilds=(raw||'').split(',').map(s=>s.trim()).filter(Boolean);
if(!/^\d{17,20}$/.test(id||'')||!secret||!guilds.length||guilds.some(g=>!/^\d{17,20}$/.test(g)))throw new Error('請設定 Application、密鑰與伺服器 ID。');
const auth=await fetch('https://discord.com/api/v10/oauth2/token',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(`${id}:${secret}`).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',scope:'applications.commands.update'}),signal:AbortSignal.timeout(15000),redirect:'error'});
if(!auth.ok)throw new Error(`指令授權失敗（HTTP ${auth.status}）`);
const {access_token:token}=await auth.json();
for(const guild of guilds){
  const endpoint=`https://discord.com/api/v10/applications/${id}/guilds/${guild}/commands`;
  const listed=await fetch(endpoint,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!listed.ok)throw new Error('無法確認既有指令，停止註冊。');
  const existing=await listed.json();
  for(const definition of commandDefinitions){
    const legacyName=definition.name.replace('戲籌','\u7c4c\u78bc'),legacy=existing.find(c=>c.type===1&&c.name===legacyName),current=existing.find(c=>c.type===1&&c.name===definition.name);
    if(legacy&&current&&legacy.id!==current.id)throw new Error('新舊指令並存，請先檢查指令權限與 ID。');
    const rename=legacyName!==definition.name&&legacy;
    // POST upserts only our named commands; never bulk-overwrite Discord's Launch entry.
    // PATCH renames in place, retaining the command ID and its guild permissions.
    const response=await fetch(endpoint+(rename?'/'+legacy.id:''),{method:rename?'PATCH':'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(definition),signal:AbortSignal.timeout(15000),redirect:'error'});
    if(!response.ok)throw new Error(`註冊 ${definition.name} 失敗（HTTP ${response.status}）；確認 Application 已安裝至指定伺服器。`);
    console.log(`已註冊 ${definition.name} → ${guild}`);
  }
}
