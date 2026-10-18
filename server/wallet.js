import { DatabaseSync } from 'node:sqlite';
import { randomInt, randomUUID } from 'node:crypto';
import { BETS, roundFromStops, REEL_STRIPS } from '../src/game.js';

export const problem = (status, message) => Object.assign(new Error(message), { status });
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
    this.db=new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS wallets(guild TEXT NOT NULL,user TEXT NOT NULL,balance INTEGER NOT NULL CHECK(balance>=0 AND balance<=1000000000000),milestone INTEGER NOT NULL DEFAULT 0,last_spin INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(guild,user));
      CREATE TABLE IF NOT EXISTS ledger(id INTEGER PRIMARY KEY AUTOINCREMENT,guild TEXT NOT NULL,user TEXT NOT NULL,kind TEXT NOT NULL,delta INTEGER NOT NULL,before INTEGER NOT NULL,after INTEGER NOT NULL,actor TEXT,reason TEXT NOT NULL,time TEXT NOT NULL,day TEXT NOT NULL,reference TEXT,FOREIGN KEY(guild,user) REFERENCES wallets(guild,user));
      CREATE INDEX IF NOT EXISTS ledger_user ON ledger(guild,user,id DESC);
      CREATE INDEX IF NOT EXISTS ledger_admin_day ON ledger(guild,actor,day,kind);
      CREATE UNIQUE INDEX IF NOT EXISTS reversal_once ON ledger(guild,reference) WHERE kind='reversal';
      CREATE TABLE IF NOT EXISTS operations(guild TEXT NOT NULL,key TEXT NOT NULL,fingerprint TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(guild,key));
      CREATE TABLE IF NOT EXISTS rounds(guild TEXT NOT NULL,user TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(guild,user,id));
      CREATE INDEX IF NOT EXISTS rounds_user ON rounds(guild,user,created DESC);
      CREATE TRIGGER IF NOT EXISTS ledger_no_update BEFORE UPDATE ON ledger BEGIN SELECT RAISE(ABORT,'ledger is append only'); END;
      CREATE TRIGGER IF NOT EXISTS ledger_no_delete BEFORE DELETE ON ledger BEGIN SELECT RAISE(ABORT,'ledger is append only'); END;`);
    this.db.prepare('INSERT OR IGNORE INTO settings VALUES(?,?)').run('environment',environment);
    if(this.db.prepare('SELECT value FROM settings WHERE key=?').get('environment').value!==environment){this.db.close();throw new Error('Refusing to mix test and production databases');}
  }
  close(){this.db.close();}
  assertGuild(guild){if(!this.guildIds.has(guild))throw problem(403,'此伺服器尚未開放遊戲。');}
  validate(guild,user){this.assertGuild(guild);if(!snowflake(user))throw problem(400,'無效的玩家。');}
  tx(fn){this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  ensure(guild,user){
    this.validate(guild,user);
    const created=this.db.prepare('INSERT OR IGNORE INTO wallets(guild,user,balance) VALUES(?,?,0)').run(guild,user).changes;
    if(created&&this.environment==='test')this.credit(guild,user,10000,'test_seed',null,'測試環境首次籌碼');
  }
  credit(guild,user,delta,kind,actor,reason,reference=null){
    const before=this.db.prepare('SELECT balance FROM wallets WHERE guild=? AND user=?').get(guild,user).balance;
    const after=before+delta;
    if(!Number.isSafeInteger(after)||after<0||after>MAX_BALANCE)throw problem(409,'餘額不足或超出可記帳範圍。');
    const now=this.clock();
    this.db.prepare('UPDATE wallets SET balance=? WHERE guild=? AND user=?').run(after,guild,user);
    const id=Number(this.db.prepare('INSERT INTO ledger(guild,user,kind,delta,before,after,actor,reason,time,day,reference) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(guild,user,kind,delta,before,after,actor,reason,new Date(now).toISOString(),taipeiDay(now),reference).lastInsertRowid);
    return {id,before,after,delta};
  }
  once(guild,key,fingerprint,fn){
    const existing=this.db.prepare('SELECT fingerprint,result FROM operations WHERE guild=? AND key=?').get(guild,key);
    if(existing){if(existing.fingerprint!==fingerprint)throw problem(409,'此請求編號已用於其他操作。');return {...JSON.parse(existing.result),duplicate:true};}
    const result=fn();
    this.db.prepare('INSERT INTO operations VALUES(?,?,?,?)').run(guild,key,fingerprint,JSON.stringify(result));return result;
  }
  snapshot(guild,user){
    const wallet=this.db.prepare('SELECT * FROM wallets WHERE guild=? AND user=?').get(guild,user);
    const history=this.db.prepare('SELECT data FROM rounds WHERE guild=? AND user=? ORDER BY created DESC,rowid DESC LIMIT 100').all(guild,user).map(row=>JSON.parse(row.data));
    const claimed=!!this.db.prepare('SELECT 1 FROM operations WHERE guild=? AND key=?').get(guild,`daily:${user}:${taipeiDay(this.clock())}`);
    const revision=this.db.prepare('SELECT COALESCE(MAX(id),0) revision FROM ledger WHERE guild=? AND user=?').get(guild,user).revision;
    return {version:3,balance:wallet.balance,history,milestones:wallet.milestone?[12000]:[],environment:this.environment,guildId:guild,daily:this.daily,claimed,nextCheckin:nextCheckin(this.clock()),revision};
  }
  state(guild,user){return this.tx(()=>{this.ensure(guild,user);return this.snapshot(guild,user);});}
  spin(guild,user,bet,requestId){
    this.validate(guild,user);
    if(!BETS.includes(bet)||!/^[-a-zA-Z0-9]{16,80}$/.test(requestId||''))throw problem(400,'無效的下注或請求編號。');
    return this.tx(()=>{
      this.ensure(guild,user);
      const result=this.once(guild,`spin:${user}:${requestId}`,String(bet),()=>{
        const wallet=this.db.prepare('SELECT * FROM wallets WHERE guild=? AND user=?').get(guild,user);
        if(this.clock()-wallet.last_spin<this.spinDelay)throw problem(429,'轉輪尚未就緒，請稍後再試。');
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
    if(!Number.isSafeInteger(amount)||amount<=0||amount>this.grantMax)throw problem(400,`單次發放限 1～${this.grantMax} 籌碼。`);
    this.reason(reason);this.requestId(requestId);
    return this.tx(()=>this.once(guild,`admin:${requestId}`,JSON.stringify([actor,user,amount,reason]),()=>{
      const used=this.db.prepare("SELECT COALESCE(SUM(delta),0) total FROM ledger WHERE guild=? AND actor=? AND day=? AND kind='grant'").get(guild,actor,taipeiDay(this.clock())).total;
      if(used+amount>this.grantDaily)throw problem(409,'已超過這位管理員今日的發放額度。');
      this.ensure(guild,user);return {entry:this.credit(guild,user,amount,'grant',actor,reason)};
    }));
  }
  reverse(guild,actor,entryId,reason,requestId){
    this.validate(guild,actor);this.reason(reason);this.requestId(requestId);
    return this.tx(()=>this.once(guild,`admin:${requestId}`,JSON.stringify([actor,entryId,reason]),()=>{
      const entry=this.db.prepare("SELECT * FROM ledger WHERE id=? AND guild=? AND kind='grant'").get(entryId,guild);
      if(!entry)throw problem(404,'找不到這筆管理員發放。');
      if(this.db.prepare("SELECT 1 FROM ledger WHERE guild=? AND reference=? AND kind='reversal'").get(guild,String(entryId)))throw problem(409,'這筆發放已更正過。');
      return {entry:this.credit(guild,entry.user,-entry.delta,'reversal',actor,reason,String(entryId))};
    }));
  }
  reason(reason){if(typeof reason!=='string'||!reason.trim()||reason.length>200)throw problem(400,'原因必填，最多 200 字。');}
  requestId(id){if(!/^[-a-zA-Z0-9]{16,80}$/.test(id||''))throw problem(400,'無效的請求編號。');}
  history(guild,user,before=Number.MAX_SAFE_INTEGER){
    this.validate(guild,user);if(!Number.isSafeInteger(before)||before<1)throw problem(400,'無效的紀錄游標。');
    return this.db.prepare('SELECT * FROM ledger WHERE guild=? AND user=? AND id<? ORDER BY id DESC LIMIT 50').all(guild,user,before);
  }
}
