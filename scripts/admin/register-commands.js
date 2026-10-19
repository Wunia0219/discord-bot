import { commandDefinitions } from '../../server/commands.js';
// Uses this application's client credentials, never a user's token or an administrator bot.
const {DISCORD_CLIENT_ID:id,DISCORD_CLIENT_SECRET:secret,ALLOWED_GUILD_IDS:raw}=process.env;
const guilds=(raw||'').split(',').map(s=>s.trim()).filter(Boolean);
if(!/^\d{17,20}$/.test(id||'')||!secret||!guilds.length||guilds.some(g=>!/^\d{17,20}$/.test(g)))throw new Error('請設定 Application、密鑰與伺服器 ID。');
const auth=await fetch('https://discord.com/api/v10/oauth2/token',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(`${id}:${secret}`).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',scope:'applications.commands.update'}),signal:AbortSignal.timeout(15000),redirect:'error'});
if(!auth.ok)throw new Error(`指令授權失敗（HTTP ${auth.status}）`);
const {access_token:token}=await auth.json();
for(const guild of guilds){
  for(const definition of commandDefinitions){
    // POST upserts only our named commands; never bulk-overwrite Discord's Launch entry.
    const response=await fetch(`https://discord.com/api/v10/applications/${id}/guilds/${guild}/commands`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(definition),signal:AbortSignal.timeout(15000),redirect:'error'});
    if(!response.ok)throw new Error(`註冊 ${definition.name} 失敗（HTTP ${response.status}）；確認 Application 已安裝至指定伺服器。`);
    console.log(`已註冊 ${definition.name} → ${guild}`);
  }
}
