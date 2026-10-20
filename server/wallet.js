import { DATABASE_VERSION, openWalletDatabase } from './database.js';
import { randomInt, randomUUID } from 'node:crypto';
import { BETS, roundFromStops, REEL_STRIPS } from '../src/game/index.js';

export const problem = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
export const taipeiDay = now => new Date(now + 8*3600000).toISOString().slice(0,10);
export const nextCheckin = now => new Date(Date.parse(taipeiDay(now)+'T00:00:00+08:00')+86400000).toISOString();
const MAX_BALANCE = 1_000_000_000_000;
const snowflake = value => /^\d{17,20}$/.test(value || '');

export class WalletStore {
  constructor({ filename=':memory:', environment='test', guildIds=[], daily=500, grantMax=100000, grantDaily=1000000, clock=Date.now, spinDelay=2000 }={}) {
    if (!['test','production'].includes(environment)) throw new Error('Invalid wallet environment');
    if (!guildIds.length || guildIds.some(id=>!snowflake(id))) throw new Error('Explicit guild allowlist required');
    for(const value of [daily,grantMax,grantDaily]) if(!Number.isSafeInteger(value)||value<=0||value>MAX_BALANCE) throw new Error('Invalid wallet limits');
    Object.assign(this,{environment,guildIds:new Set(guildIds),daily,grantMax,grantDaily,clock,spinDelay});
    this.db=openWalletDatabase(filename,environment);
  }
  close(){if(this.db.isOpen)this.db.close();}
  isReady(){
    try {
      return this.db.prepare("SELECT value FROM settings WHERE key='environment'").get()?.value===this.environment
        && this.db.prepare('PRAGMA user_version').get().user_version===DATABASE_VERSION;
    } catch { return false; }
  }
  assertGuild(guild){if(!this.guildIds.has(guild))throw problem(403,'此伺服器尚未開放遊戲。','GUILD_CLOSED');}
  validate(guild,user){this.assertGuild(guild);if(!snowflake(user))throw problem(400,'無效的玩家。','PLAYER_INVALID');}
  tx(fn){this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  ensure(guild,user){
    this.validate(guild,user);
    const created=this.db.prepare('INSERT OR IGNORE INTO wallets(guild,user,balance) VALUES(?,?,0)').run(guild,user).changes;
    if(created&&this.environment==='test')this.credit(guild,user,10000,'test_seed',null,'測試環境首次籌碼');
  }
  credit(guild,user,delta,kind,actor,reason,reference=null){
    const before=this.db.prepare('SELECT balance FROM wallets WHERE guild=? AND user=?').get(guild,user).balance;
    const after=before+delta;
    if(!Number.isSafeInteger(after)||after<0||after>MAX_BALANCE)throw problem(409,'餘額不足或超出可記帳範圍。','BALANCE_LIMIT');
    const now=this.clock();
    this.db.prepare('UPDATE wallets SET balance=? WHERE guild=? AND user=?').run(after,guild,user);
    const id=Number(this.db.prepare('INSERT INTO ledger(guild,user,kind,delta,before,after,actor,reason,time,day,reference) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(guild,user,kind,delta,before,after,actor,reason,new Date(now).toISOString(),taipeiDay(now),reference).lastInsertRowid);
    return {id,before,after,delta};
  }
  once(guild,key,fingerprint,fn){
    const existing=this.db.prepare('SELECT fingerprint,result FROM operations WHERE guild=? AND key=?').get(guild,key);
    if(existing){if(existing.fingerprint!==fingerprint)throw problem(409,'此請求編號已用於其他操作。','REQUEST_CONFLICT');return {...JSON.parse(existing.result),duplicate:true};}
    const result=fn();
    this.db.prepare('INSERT INTO operations VALUES(?,?,?,?)').run(guild,key,fingerprint,JSON.stringify(result));return result;
  }
  snapshot(guild,user){
    const wallet=this.db.prepare('SELECT * FROM wallets WHERE guild=? AND user=?').get(guild,user);
    const history=this.db.prepare('SELECT data FROM rounds WHERE guild=? AND user=? ORDER BY created DESC,rowid DESC LIMIT 100').all(guild,user).map(row=>JSON.parse(row.data));
    const claimed=!!this.db.prepare('SELECT 1 FROM operations WHERE guild=? AND key=?').get(guild,`daily:${user}:${taipeiDay(this.clock())}`);
    const revision=this.db.prepare('SELECT COALESCE(MAX(id),0) revision FROM ledger WHERE guild=? AND user=?').get(guild,user).revision;
    const spinCooldownMs=Math.max(0,wallet.last_spin+this.spinDelay-this.clock());
    return {version:3,balance:wallet.balance,history,milestones:wallet.milestone?[12000]:[],environment:this.environment,guildId:guild,daily:this.daily,claimed,nextCheckin:nextCheckin(this.clock()),revision,spinCooldownMs};
  }
  state(guild,user){return this.tx(()=>{this.ensure(guild,user);return this.snapshot(guild,user);});}
  spin(guild,user,bet,requestId){
    this.validate(guild,user);
    if(!BETS.includes(bet)||!/^[-a-zA-Z0-9]{16,80}$/.test(requestId||''))throw problem(400,'無效的下注或請求編號。');
    return this.tx(()=>{
      this.ensure(guild,user);
      const result=this.once(guild,`spin:${user}:${requestId}`,String(bet),()=>{
        const wallet=this.db.prepare('SELECT * FROM wallets WHERE guild=? AND user=?').get(guild,user);
        const retryAfterMs=wallet.last_spin+this.spinDelay-this.clock();
        if(retryAfterMs>0)throw Object.assign(problem(429,'轉輪尚未就緒，請稍後再試。'),{code:'SPIN_COOLDOWN',retryAfterMs});
        if(wallet.balance<bet)throw problem(409,'籌碼不足，請降低下注、簽到或聯絡管理員。');
        const stops=REEL_STRIPS.map(strip=>randomInt(strip.length));
        const outcome=roundFromStops(bet,stops);
        const entry=this.credit(guild,user,outcome.payout-bet,'spin',user,`下注 ${bet}／派彩 ${outcome.payout}`,requestId);
        const milestone=entry.after>=12000&&!wallet.milestone;
        const round={...outcome,id:randomUUID(),time:new Date(this.clock()).toISOString(),bet,before:entry.before,after:entry.after,net:entry.delta,milestone};
        this.db.prepare('UPDATE wallets SET last_spin=?,milestone=? WHERE guild=? AND user=?').run(this.clock(),wallet.milestone||Number(milestone),guild,user);
        this.db.prepare('INSERT INTO rounds VALUES(?,?,?,?,?)').run(guild,user,round.id,JSON.stringify(round),this.clock());
        return {round};
      });
      return {...result,state:this.snapshot(guild,user)};
    });
  }
  checkin(guild,user){return this.tx(()=>{
    this.ensure(guild,user);
    const result=this.once(guild,`daily:${user}:${taipeiDay(this.clock())}`,'daily',()=>({entry:this.credit(guild,user,this.daily,'checkin',user,'每日簽到')}));
    return {...result,state:this.snapshot(guild,user)};
  });}
  grant(guild,actor,user,amount,reason,requestId){
    this.validate(guild,actor);this.validate(guild,user);
    if(!Number.isSafeInteger(amount)||amount<=0||amount>this.grantMax)throw problem(400,`單次發放限 1～${this.grantMax} 籌碼。`,'GRANT_AMOUNT');
    this.reason(reason);this.requestId(requestId);
    return this.tx(()=>this.once(guild,`admin:${requestId}`,JSON.stringify([actor,user,amount,reason]),()=>{
      const used=this.db.prepare("SELECT COALESCE(SUM(delta),0) total FROM ledger WHERE guild=? AND actor=? AND day=? AND kind='grant'").get(guild,actor,taipeiDay(this.clock())).total;
      if(used+amount>this.grantDaily)throw problem(409,'已超過這位管理員今日的發放額度。','GRANT_DAILY');
      this.ensure(guild,user);return {entry:this.credit(guild,user,amount,'grant',actor,reason)};
    }));
  }
  reverse(guild,actor,entryId,reason,requestId){
    this.validate(guild,actor);this.reason(reason);this.requestId(requestId);
    return this.tx(()=>this.once(guild,`admin:${requestId}`,JSON.stringify([actor,entryId,reason]),()=>{
      const entry=this.db.prepare("SELECT * FROM ledger WHERE id=? AND guild=? AND kind='grant'").get(entryId,guild);
      if(!entry)throw problem(404,'找不到這筆管理員發放。','GRANT_MISSING');
      if(this.db.prepare("SELECT 1 FROM ledger WHERE guild=? AND reference=? AND kind='reversal'").get(guild,String(entryId)))throw problem(409,'這筆發放已更正過。','GRANT_REVERSED');
      return {entry:this.credit(guild,entry.user,-entry.delta,'reversal',actor,reason,String(entryId))};
    }));
  }
  reason(reason){if(typeof reason!=='string'||!reason.trim()||reason.length>200)throw problem(400,'原因必填，最多 200 字。','REASON_REQUIRED');}
  requestId(id){if(!/^[-a-zA-Z0-9]{16,80}$/.test(id||''))throw problem(400,'無效的請求編號。','REQUEST_INVALID');}
  history(guild,user,before=Number.MAX_SAFE_INTEGER){
    this.validate(guild,user);if(!Number.isSafeInteger(before)||before<1)throw problem(400,'無效的紀錄游標。');
    return this.db.prepare('SELECT * FROM ledger WHERE guild=? AND user=? AND id<? ORDER BY id DESC LIMIT 50').all(guild,user,before);
  }
  auditHistory(guild,user,{category='rewards',before=Number.MAX_SAFE_INTEGER,days=0}={}){
    this.validate(guild,user);
    const kinds={rewards:['grant','reversal'],checkin:['checkin'],game:['spin'],all:[]};
    if(!Object.hasOwn(kinds,category)||!Number.isSafeInteger(before)||before<1||![0,1,7,30].includes(days))throw problem(400,'無效的紀錄查詢條件。','AUDIT_FILTER');
    const since=days?taipeiDay(this.clock()-(days-1)*86400000):'0000-01-01';
    const filter=kinds[category];
    const rows=this.db.prepare(`SELECT l.*, (SELECT r.id FROM ledger r WHERE r.guild=l.guild AND r.user=l.user AND r.kind='reversal' AND r.reference=CAST(l.id AS TEXT)) AS reversal_id
      FROM ledger l WHERE l.guild=? AND l.user=? AND l.id<? AND l.day>=?
      ${filter.length?`AND l.kind IN (${filter.map(()=>'?').join(',')})`:''} ORDER BY l.id DESC LIMIT 11`).all(guild,user,before,since,...filter);
    return {rows:rows.slice(0,10),next:rows.length>10?rows[9].id:null};
  }
  auditSummary(guild,user,days=0){
    this.validate(guild,user);
    if(![0,1,7,30].includes(days))throw problem(400,'無效的紀錄查詢期間。','AUDIT_FILTER');
    const since=days?taipeiDay(this.clock()-(days-1)*86400000):'0000-01-01';
    const checkin=this.db.prepare("SELECT COUNT(DISTINCT day) days, COALESCE(SUM(delta),0) total FROM ledger WHERE guild=? AND user=? AND kind='checkin' AND day>=?").get(guild,user,since);
    const game=this.db.prepare(`SELECT COUNT(*) rounds, COALESCE(SUM(json_extract(data,'$.bet')),0) bet,
      COALESCE(SUM(json_extract(data,'$.payout')),0) payout FROM rounds WHERE guild=? AND user=? AND created>=?`).get(guild,user,days?Date.parse(since+'T00:00:00+08:00'):0);
    return {checkin,game:{...game,net:game.payout-game.bet}};
  }
}
