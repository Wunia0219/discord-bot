import { DATABASE_VERSION, openWalletDatabase } from '../sqlite/database.js';
import { randomInt, randomUUID } from 'node:crypto';
import { BETS, roundFromStops, REEL_STRIPS } from '../../src/game/index.js';

import {problem,taipeiDay,nextCheckin} from './wallet-common.js';
import {checkinRewards,checkinReceipt,weeklyCheckinState} from './weekly-checkin.js';
import {INITIAL_BALANCE,openingKind,openingReason} from './wallet-opening.js';
import {RESET_BALANCE,RESET_WALLET_LIMIT,RESET_REASON,resetFingerprint,resetMarker,resetResult,compactResetResult,expandResetResult,resetEntryIds,resetReportRow} from './wallet-admin.js';
export {problem,taipeiDay,nextCheckin} from './wallet-common.js';
const MAX_BALANCE=1_000_000_000_000;
const snowflake=value=>/^\d{17,20}$/.test(value||'');

export class WalletStore {
  constructor({ filename=':memory:', environment='test', guildIds=[], weeklyRewards, grantMax=100000, grantDaily=1000000, clock=Date.now, spinDelay=2000 }={}) {
    if (!['test','production'].includes(environment)) throw new Error('Invalid wallet environment');
    if (!guildIds.length || guildIds.some(id=>!snowflake(id))) throw new Error('Explicit guild allowlist required');
    for(const value of [grantMax,grantDaily]) if(!Number.isSafeInteger(value)||value<=0||value>MAX_BALANCE) throw new Error('Invalid wallet limits');
    Object.assign(this,{environment,guildIds:new Set(guildIds),weeklyRewards:checkinRewards(weeklyRewards),grantMax,grantDaily,clock,spinDelay});
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
    if(created)this.credit(guild,user,INITIAL_BALANCE,openingKind(this.environment),null,openingReason(this.environment));
  }
  credit(guild,user,delta,kind,actor,reason,reference=null,now=this.clock()){
    const before=this.db.prepare('SELECT balance FROM wallets WHERE guild=? AND user=?').get(guild,user).balance;
    const after=before+delta;
    if(!Number.isSafeInteger(after)||after<0||after>MAX_BALANCE)throw problem(409,'餘額不足或超出可記帳範圍。','BALANCE_LIMIT');
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
  lastCheckin(guild,user){
    // ISO dates sort lexically. This range uses the existing (guild,key) PK;
    // it never scans the player's spins or rewrites historical claims.
    const prefix=`daily:${user}:`,row=this.db.prepare('SELECT key,result FROM operations WHERE guild=? AND key>=? AND key<? ORDER BY key DESC LIMIT 1').get(guild,prefix,prefix+'\uffff');
    return row?{day:row.key.slice(prefix.length),...JSON.parse(row.result)}:null;
  }
  snapshot(guild,user,now=this.clock()){
    const wallet=this.db.prepare('SELECT * FROM wallets WHERE guild=? AND user=?').get(guild,user);
    const history=this.db.prepare('SELECT data FROM rounds WHERE guild=? AND user=? ORDER BY created DESC,rowid DESC LIMIT 100').all(guild,user).map(row=>JSON.parse(row.data));
    const last=this.lastCheckin(guild,user),checkin=weeklyCheckinState(last?.day,last?.checkin,taipeiDay(now),this.weeklyRewards);
    const revision=this.db.prepare('SELECT COALESCE(MAX(id),0) revision FROM ledger WHERE guild=? AND user=?').get(guild,user).revision;
    const spinCooldownMs=Math.max(0,wallet.last_spin+this.spinDelay-now);
    const reset=this.db.prepare("SELECT id,time,after FROM ledger WHERE guild=? AND user=? AND kind='reset' ORDER BY id DESC LIMIT 1").get(guild,user);
    const prior=reset?this.db.prepare("SELECT reference FROM ledger WHERE guild=? AND user=? AND kind='spin' AND id<? ORDER BY id DESC LIMIT 1").get(guild,user,reset.id):null;
    const priorRound=prior?JSON.parse(this.db.prepare('SELECT result FROM operations WHERE guild=? AND key=?').get(guild,`spin:${user}:${prior.reference}`).result).round.id:null;
    return {version:3,balance:wallet.balance,history,milestones:wallet.milestone?[12000]:[],environment:this.environment,guildId:guild,...checkin,nextCheckin:nextCheckin(now),revision,spinCooldownMs,...(reset?{balanceReset:resetMarker(reset,priorRound)}:{})};
  }
  state(guild,user){return this.tx(()=>{this.ensure(guild,user);return this.snapshot(guild,user);});}
  spin(guild,user,bet,requestId){
    this.validate(guild,user);
    if(!BETS.includes(bet)||!/^[-a-zA-Z0-9]{16,80}$/.test(requestId||''))throw problem(400,'無效的下注或請求編號。');
    return this.tx(()=>{
      this.ensure(guild,user);
      const result=this.once(guild,`spin:${user}:${requestId}`,String(bet),()=>{
        const settledAt=this.clock();
        const wallet=this.db.prepare('SELECT * FROM wallets WHERE guild=? AND user=?').get(guild,user);
        const retryAfterMs=wallet.last_spin+this.spinDelay-settledAt;
        if(retryAfterMs>0)throw Object.assign(problem(429,'轉輪尚未就緒，請稍後再試。'),{code:'SPIN_COOLDOWN',retryAfterMs});
        if(wallet.balance<bet)throw problem(409,'戲籌不足，請降低下注、簽到或聯絡管理員。');
        const stops=REEL_STRIPS.map(strip=>randomInt(strip.length));
        const outcome=roundFromStops(bet,stops);
        const entry=this.credit(guild,user,outcome.payout-bet,'spin',user,`下注 ${bet}／派彩 ${outcome.payout}`,requestId,settledAt);
        const milestone=entry.after>=12000&&!wallet.milestone;
        const round={...outcome,id:randomUUID(),time:new Date(settledAt).toISOString(),bet,before:entry.before,after:entry.after,net:entry.delta,milestone};
        this.db.prepare('UPDATE wallets SET last_spin=?,milestone=? WHERE guild=? AND user=?').run(settledAt,wallet.milestone||Number(milestone),guild,user);
        this.db.prepare('INSERT INTO rounds VALUES(?,?,?,?,?)').run(guild,user,round.id,JSON.stringify(round),settledAt);
        return {round};
      });
      return {...result,state:this.snapshot(guild,user)};
    });
  }
  checkin(guild,user){return this.tx(()=>{
    this.ensure(guild,user);
    const claimedAt=this.clock();
    const day=taipeiDay(claimedAt);
    const result=this.once(guild,`daily:${user}:${day}`,'daily',()=>{
      const last=this.lastCheckin(guild,user),checkin=checkinReceipt(last?.day,last?.checkin,day,this.weeklyRewards);
      return {entry:this.credit(guild,user,checkin.rewards[checkin.cycleDay-1],'checkin',user,`週簽到第 ${checkin.cycleDay} 天`,null,claimedAt),checkin};
    });
    return {...result,state:this.snapshot(guild,user,claimedAt)};
  });}
  grant(guild,actor,user,amount,reason,requestId){
    this.validate(guild,actor);this.validate(guild,user);
    if(!Number.isSafeInteger(amount)||amount<=0||amount>this.grantMax)throw problem(400,`單次發放限 1～${this.grantMax} 戲籌。`,'GRANT_AMOUNT');
    this.reason(reason);this.requestId(requestId);
    return this.tx(()=>this.once(guild,`admin:${requestId}`,JSON.stringify([actor,user,amount,reason]),()=>{
      const used=this.db.prepare("SELECT COALESCE(SUM(delta),0) total FROM ledger WHERE guild=? AND actor=? AND day=? AND kind='grant'").get(guild,actor,taipeiDay(this.clock())).total;
      if(used+amount>this.grantDaily)throw problem(409,'已超過這位管理員今日的發放額度。','GRANT_DAILY');
      this.ensure(guild,user);return {entry:this.credit(guild,user,amount,'grant',actor,reason)};
    }));
  }
  playerWallets(guild,{after='',limit=20}={}){
    this.assertGuild(guild);
    if((after&&!snowflake(after))||!Number.isInteger(limit)||limit<1||limit>20)throw problem(400,'無效的玩家名單頁碼。','WALLET_CURSOR');
    const wallets=this.db.prepare('SELECT w.user,w.balance,(SELECT COUNT(*) FROM rounds r WHERE r.guild=w.guild AND r.user=w.user) rounds FROM wallets w WHERE w.guild=? AND w.user>? ORDER BY w.user LIMIT ?').all(guild,after,limit+1);
    const rows=wallets.slice(0,limit).map(w=>({...w}));return {rows,next:wallets.length>limit?rows.at(-1).user:null,time:new Date(this.clock()).toISOString()};
  }
  walletResetReport(guild,actor,requestId,{page}={}){
    this.validate(guild,actor);if(requestId)this.requestId(requestId);
    const latest=this.db.prepare("SELECT reference FROM ledger WHERE guild=? AND kind='reset' ORDER BY id DESC LIMIT 1").get(guild);
    if(requestId&&latest&&requestId!==latest.reference)throw problem(409,'已有較新的重設報表，請重新開啟。','RESET_REPLACED');
    const saved=latest&&this.db.prepare('SELECT result FROM operations WHERE guild=? AND key=?').get(guild,'reset:'+latest.reference);
    if(!saved)throw problem(404,'找不到這筆重設紀錄。','RESET_MISSING');
    const result=JSON.parse(saved.result),entry=this.db.prepare('SELECT * FROM ledger WHERE id=?');
    if(page!==undefined){
      if(!Number.isInteger(page)||page<1||page>Math.ceil(result.reset.count/20))throw problem(400,'沒有此頁報表。','RESET_PAGE');
      const ids=resetEntryIds(result).slice((page-1)*20,page*20);
      return {reset:result.reset,entries:ids.map(id=>resetReportRow(entry.get(id))),page,duplicate:true};
    }
    return {...expandResetResult(result,id=>entry.get(id)),duplicate:true};
  }
  resetWallets(guild,actor,requestId){
    this.validate(guild,actor);this.requestId(requestId);
    return this.tx(()=>{
      const key='reset:'+requestId,fingerprint=resetFingerprint(actor),saved=this.db.prepare('SELECT * FROM operations WHERE guild=? AND key=?').get(guild,key);
      if(saved){if(saved.fingerprint!==fingerprint)throw problem(409,'此請求編號已用於其他操作。','REQUEST_CONFLICT');return {...expandResetResult(JSON.parse(saved.result),id=>this.db.prepare('SELECT * FROM ledger WHERE id=?').get(id)),duplicate:true};}
      const wallets=this.db.prepare('SELECT user,balance FROM wallets WHERE guild=? ORDER BY user LIMIT ?').all(guild,RESET_WALLET_LIMIT+1);
      if(wallets.length>RESET_WALLET_LIMIT)throw problem(409,'玩家數量超出本次安全重設範圍，這次沒有變更任何餘額。','RESET_LIMIT');
      if(!wallets.length)throw problem(409,'本群還沒有已建立錢包的玩家。','RESET_EMPTY');
      const now=this.clock(),time=new Date(now).toISOString();
      const entries=wallets.map(w=>({user:w.user,...this.credit(guild,w.user,RESET_BALANCE-w.balance,'reset',actor,RESET_REASON,requestId,now)}));
      const result=resetResult(actor,requestId,time,entries);
      this.db.prepare('INSERT INTO operations(guild,key,fingerprint,result) VALUES(?,?,?,?)').run(guild,key,fingerprint,JSON.stringify(compactResetResult(result)));
      return result;
    });
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
    const kinds={rewards:['grant','reversal','reset'],checkin:['checkin'],game:['spin'],all:[]};
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
