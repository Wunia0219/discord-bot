import {createHash} from 'node:crypto';
const snowflake=value=>/^\d{17,20}$/.test(value||'');

export function casinoBotSettings(env,store){
  if(!env.DISCORD_CASINO_ENABLED||env.DISCORD_CASINO_ENABLED==='false')return null;
  if(env.DISCORD_CASINO_ENABLED!=='true')throw new Error('Invalid casino notification switch');
  const guild=env.DISCORD_CASINO_GUILD_ID?.trim()||(store.guildIds.size===1?[...store.guildIds][0]:''),channel=env.DISCORD_CASINO_CHANNEL_ID?.trim(),applicationId=env.DISCORD_CLIENT_ID;
  store.assertGuild(guild);
  const token=env.DISCORD_BOT_TOKEN?.trim();
  if(!snowflake(channel)||!snowflake(applicationId)||!/^[-\w.]{30,200}$/.test(token||''))throw new Error('Casino bot configuration is incomplete');
  return {guild,channel,applicationId,token};
}

// REST delivery does not require a Gateway connection or an online presence.
// Never log upstream response bodies, headers or credentials.
export class CasinoBot {
  constructor({guild,channel,applicationId,token,fetchImpl=fetch,clock=Date.now}){Object.assign(this,{guild,channel,applicationId,token,fetchImpl,clock});this.verified=false;this.blockedUntil=0;}
  request(path,options={}){return this.fetchImpl('https://discord.com/api/v10'+path,{...options,headers:{Authorization:'Bot '+this.token,'Content-Type':'application/json'},signal:AbortSignal.timeout(8000),redirect:'error'});}
  async verify(){
    const identity=await this.request('/users/@me');const bot=identity.ok?await identity.json():null;
    if(bot?.id!==this.applicationId||bot.bot!==true)throw new Error('Bot identity mismatch');
    const response=await this.request('/channels/'+this.channel),channel=response.ok?await response.json():null;
    if(channel?.id!==this.channel||channel.guild_id!==this.guild||![0,5].includes(channel.type))throw new Error('Bot destination mismatch');
    this.verified=true;
  }
  async send(payload,eventId){
    if(this.blockedUntil>this.clock())return {kind:'retry',delay:this.blockedUntil-this.clock()};
    if(!this.verified){try{await this.verify();}catch{return {kind:'retry',delay:300000};}}
    const nonce=createHash('sha256').update(eventId).digest('hex').slice(0,24);
    let response;
    try{response=await this.request('/channels/'+this.channel+'/messages',{method:'POST',body:JSON.stringify({...payload,allowed_mentions:{parse:[]},nonce,enforce_nonce:true})});}
    catch{return {kind:'uncertain'};}
    const reset=Number(response.headers.get('X-RateLimit-Reset-After'));
    if(response.headers.get('X-RateLimit-Remaining')==='0'&&Number.isFinite(reset)&&reset>0)this.blockedUntil=this.clock()+Math.ceil(reset*1000);
    if(response.ok){
      let message;try{message=await response.json();}catch{}
      return snowflake(message?.id)&&message.channel_id===this.channel?{kind:'sent',messageId:message.id}:{kind:'uncertain'};
    }
    if(response.status===429){
      let body;try{body=await response.json();}catch{}
      const seconds=Number(body?.retry_after??response.headers.get('Retry-After'));
      const delay=Number.isFinite(seconds)&&seconds>0?Math.min(Number.MAX_SAFE_INTEGER-this.clock(),Math.ceil(seconds*1000)):60000;
      this.blockedUntil=Math.max(this.blockedUntil,this.clock()+delay);return {kind:'retry',delay};
    }
    if([400,401,403,404].includes(response.status)){this.verified=false;return {kind:'retry',delay:300000};}
    return {kind:'uncertain'};
  }
}
