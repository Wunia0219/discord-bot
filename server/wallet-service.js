import { createHash, randomBytes } from 'node:crypto';
import { problem } from './wallet-common.js';

const hash = token=>createHash('sha256').update(token).digest('hex');
export class WalletService {
  constructor(store,{fetchImpl=globalThis.fetch.bind(globalThis),clock=Date.now,sessions=new Map()}={}) {Object.assign(this,{store,fetchImpl,clock,sessions});}
  async discord(path,token){
    let response;
    try{response=await this.fetchImpl('https://discord.com/api/v10'+path,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(8000),redirect:'error'});}
    catch{throw problem(503,'Discord 身分服務暫時無法使用，請稍後重試。');}
    if(!response.ok)throw problem(response.status===401||response.status===403||response.status===404?401:503,'無法確認 Discord 帳號或伺服器成員資格，請重新開啟活動。');
    return response.json();
  }
  async member(guild,user,accessToken){
    const member=await this.discord(`/users/@me/guilds/${guild}/member`,accessToken);
    if(member.user?.id!==user||member.user?.bot||member.pending)throw problem(403,'請先完成此伺服器的加入／規則驗證。');
    return member;
  }
  async create(token,guild){
    this.store.assertGuild(guild);
    if(!String(token.scope).split(' ').includes('guilds.members.read'))throw problem(403,'請重新授權伺服器成員資格。');
    const user=await this.discord('/users/@me',token.access_token);
    this.store.validate(guild,user.id);
    const member=await this.member(guild,user.id,token.access_token);
    if(this.sessions.prune)this.sessions.prune(this.clock());
    else for(const [key,session] of this.sessions)if(session.expires<=this.clock())this.sessions.delete(key);
    if(this.sessions.size>=10000)throw problem(503,'登入人數已達服務容量，請稍後再試。');
    const sessionToken=randomBytes(32).toString('base64url');
    const expires=this.clock()+Math.min(3600,Math.max(0,Number(token.expires_in)||0))*1000;
    if(expires<=this.clock())throw problem(401,'Discord 授權已過期，請重新開啟活動。');
    this.sessions.set(hash(sessionToken),{guild,user:user.id,profile:{name:member.nick||user.global_name||user.username||'玩家'},expires,accessToken:token.access_token,checked:this.clock(),count:0,window:this.clock()});
    return {token:sessionToken,expiresAt:new Date(expires).toISOString(),userId:user.id,guildId:guild,environment:this.store.environment};
  }
  async authorize(header){
    const token=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(header||'')?.[1];
    const session=token&&this.sessions.get(hash(token));
    if(!session||session.expires<=this.clock()){if(token)this.sessions.delete(hash(token));throw problem(401,'登入已過期，請重新開啟活動。');}
    this.store.assertGuild(session.guild);
    if(this.clock()-session.window>=60000){session.window=this.clock();session.count=0;}
    session.count++;this.sessions.set(hash(token),session);
    if(session.count>120)throw problem(429,'操作過於頻繁，請稍後再試。');
    if(this.clock()-session.checked>300000){
      try{const member=await this.member(session.guild,session.user,session.accessToken);if(member.nick)session.profile.name=member.nick;session.checked=this.clock();}
      catch(error){if(error.status!==503)this.sessions.delete(hash(token));throw error;}
    }
    // Another in-flight membership check may have revoked this session.
    // A late successful response must not recreate it in persistent storage.
    if(!this.sessions.get(hash(token))||session.expires<=this.clock())throw problem(401,'登入已過期，請重新開啟活動。');
    this.sessions.set(hash(token),session);
    return session;
  }
}
