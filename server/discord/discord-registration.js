import { commandDefinitions,retiredCommandNames } from './commands.js';
// Uses this application's client credentials, never a user's token or an administrator bot.
export async function registerCommands({env=process.env,fetchImpl=fetch,log=console.log}={}){
const {DISCORD_CLIENT_ID:id,DISCORD_CLIENT_SECRET:secret,ALLOWED_GUILD_IDS:raw}=env;
const guilds=(raw||'').split(',').map(s=>s.trim()).filter(Boolean);
if(!/^\d{17,20}$/.test(id||'')||!secret||!guilds.length||guilds.some(g=>!/^\d{17,20}$/.test(g)))throw new Error('請設定 Application、密鑰與伺服器 ID。');
const auth=await fetchImpl('https://discord.com/api/v10/oauth2/token',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(`${id}:${secret}`).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',scope:'applications.commands.update'}),signal:AbortSignal.timeout(15000),redirect:'error'});
if(!auth.ok)throw new Error(`指令授權失敗（HTTP ${auth.status}）`);
const {access_token:token}=await auth.json();
for(const guild of guilds){
  const endpoint=`https://discord.com/api/v10/applications/${id}/guilds/${guild}/commands`;
  const listed=await fetchImpl(endpoint,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!listed.ok)throw new Error('無法確認既有指令，停止註冊。');
  const existing=await listed.json();
  for(const definition of commandDefinitions){
    const legacyName=definition.name.replace('戲籌','\u7c4c\u78bc'),legacy=existing.find(c=>c.type===1&&c.name===legacyName),current=existing.find(c=>c.type===1&&c.name===definition.name);
    if(legacy&&current&&legacy.id!==current.id)throw new Error('新舊指令並存，請先檢查指令權限與 ID。');
    const original=current||legacy;
    // POST upserts only our named commands; never bulk-overwrite Discord's Launch entry.
    // PATCH renames in place, retaining the command ID and its guild permissions.
    const response=await fetchImpl(endpoint+(original?'/'+original.id:''),{method:original?'PATCH':'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(definition),signal:AbortSignal.timeout(15000),redirect:'error'});
    if(!response.ok)throw new Error(`註冊 ${definition.name} 失敗（HTTP ${response.status}）；確認 Application 已安裝至指定伺服器。`);
    log(`已註冊 ${definition.name} → ${guild}`);
  }
  for(const command of existing.filter(c=>c.type===1&&retiredCommandNames.includes(c.name))){
    const response=await fetchImpl(endpoint+'/'+command.id,{method:'DELETE',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000),redirect:'error'});
    if(!response.ok&&response.status!==404)throw new Error('移除舊指令失敗，請核對遠端狀態。');
    log(`已移除 ${command.name} → ${guild}`);
  }
}
// Retired global slash commands must also disappear; leave the Activity entry
// and every unrelated command untouched.
const endpoint=`https://discord.com/api/v10/applications/${id}/commands`;
const listed=await fetchImpl(endpoint,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000),redirect:'error'});
if(!listed.ok)throw new Error('無法確認全域指令。');
for(const command of (await listed.json()).filter(c=>c.type===1&&retiredCommandNames.includes(c.name))){
  const response=await fetchImpl(endpoint+'/'+command.id,{method:'DELETE',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!response.ok&&response.status!==404)throw new Error('移除全域舊指令失敗。');
  log(`已移除全域 ${command.name}`);
}

}
