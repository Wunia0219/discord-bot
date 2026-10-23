import {Firestore} from '@google-cloud/firestore';
import {randomInt,randomUUID,createHash} from 'node:crypto';
import {BETS,roundFromStops,REEL_STRIPS} from '../src/game/index.js';
import {WalletStore,problem,taipeiDay,nextCheckin} from './wallet.js';
import {FirestoreQuota} from './firestore-quota.js';

const maxBalance=1_000_000_000_000,maxDocument=512*1024;
const digest=value=>createHash('sha256').update(value).digest('hex');
const category=kind=>({grant:'rewards',reversal:'rewards',checkin:'checkin',spin:'game'}[kind]||'other');
const zeroSummary=()=>({checkin:{days:0,total:0},game:{rounds:0,bet:0,payout:0,net:0}});
const unpack=doc=>doc.exists?JSON.parse(doc.get('json')):null;
const packed=data=>({json:JSON.stringify(data)});

export class FirestoreWalletStore {
  constructor(settings,{guildIds=[],daily=500,grantMax=100000,grantDaily=1000000,clock=Date.now,spinDelay=2000,db,quota}={}){
    if(!guildIds.length||guildIds.some(id=>!/^\d{17,20}$/.test(id)))throw new Error('Explicit guild allowlist required');
    for(const value of [daily,grantMax,grantDaily])if(!Number.isSafeInteger(value)||value<=0||value>maxBalance)throw new Error('Invalid wallet limits');
    Object.assign(this,{settings,environment:settings.environment,guildIds:new Set(guildIds),daily,grantMax,grantDaily,clock,spinDelay});
    this.backend='firestore';
    this.db=db||new Firestore({projectId:settings.projectId,databaseId:'(default)',...(settings.credentials?{credentials:settings.credentials}:{}),
      ...(settings.emulator?{host:settings.emulator,ssl:false,universeDomain:'googleapis.com'}:{}),preferRest:false,maxIdleChannels:1});
    this.quota=quota||new FirestoreQuota({...settings.quota,clock});
    this.root=this.db.collection('circus_wallet_v1').doc(settings.namespace);
    this.meta=this.root.collection('meta').doc('state');this.cache=new Map();this.pending=new Map();this.closed=false;this.ready=false;this.readyAt=0;
  }
  assertGuild=WalletStore.prototype.assertGuild;
  validate=WalletStore.prototype.validate;
  reason=WalletStore.prototype.reason;
  requestId=WalletStore.prototype.requestId;
  walletRef(guild,user){return this.root.collection('wallets').doc(guild+'_'+user);}
  async read(ref,tx){
    // Covers SDK transport retries conservatively; transaction callbacks reserve anew.
    this.quota.reserve({reads:6});
    const snapshot=await (tx?tx.get(ref):ref.get());
    const data=unpack(snapshot);this.quota.observe(Buffer.byteLength(JSON.stringify(data)));
    return data;
  }
  write(tx,ref,data,{create=false,index={}}={}){
    const body={...packed(data),...index},bytes=Buffer.byteLength(JSON.stringify(body));
    if(bytes>maxDocument)throw problem(503,'遊玩紀錄暫時無法儲存，請稍後再試。','FIRESTORE_DOCUMENT_LIMIT');
    // Count every attempted write and growth even when a transaction later aborts.
    this.quota.reserve({writes:2},{key:digest(this.settings.projectId+':'+ref.path),bytes:bytes*4+512});
    if(create)tx.create(ref,body);else tx.set(ref,body);
  }
  async initialize(){
    try{
      await this.db.runTransaction(async tx=>{
        const meta=await this.read(this.meta,tx);
        if(meta){this.checkMeta(meta);return;}
        this.write(tx,this.meta,{version:1,environment:this.environment,status:'ready',nextId:0},{create:true});
      },{maxAttempts:3});
      this.ready=true;this.readyAt=this.clock();return this;
    }catch(error){this.ready=false;throw this.safe(error);}
  }
  checkMeta(meta){if(meta.version!==1||meta.environment!==this.environment||meta.status!=='ready'||!Number.isSafeInteger(meta.nextId))throw problem(503,'帳號籌碼正在維護，請稍後再試。','FIRESTORE_SCHEMA');}
  async isReady(){
    if(this.closed||this.quota.status().blocked)return false;
    if(this.ready&&this.clock()-this.readyAt<60000)return true;
    try{this.checkMeta(await this.read(this.meta));this.ready=true;this.readyAt=this.clock();return true;}catch{this.ready=false;return false;}
  }
  safe(error){
    if(error.walletProblem)return error;
    this.ready=false;
    return problem(503,'帳號籌碼暫時連不上，請稍後重試；未確認的操作請沿用原請求。','FIRESTORE_UNAVAILABLE');
  }
  snapshot(wallet,now=this.clock()){
    return {version:3,balance:wallet.balance,history:wallet.history,milestones:wallet.milestone?[12000]:[],environment:this.environment,
      guildId:wallet.guild,daily:this.daily,claimed:wallet.claimedDay===taipeiDay(now),nextCheckin:nextCheckin(now),revision:wallet.revision,
      spinCooldownMs:Math.max(0,wallet.last_spin+this.spinDelay-now)};
  }
  async state(guild,user){
    this.validate(guild,user);if(this.closed)throw this.safe({});
    this.quota.reserve({});const key=guild+':'+user,cached=this.cache.get(key);
    if(cached&&this.clock()-cached.at<5000)return this.snapshot(cached.wallet);
    if(this.pending.has(key))return this.pending.get(key);
    const promise=(async()=>{
      try{const wallet=await this.read(this.walletRef(guild,user));
        if(!wallet)return (await this.transact(guild,user,{kind:'ensure'})).state;
        this.cacheWallet(wallet);return this.snapshot(wallet);
      }catch(error){throw this.safe(error);}
    })().finally(()=>this.pending.delete(key));this.pending.set(key,promise);return promise;
  }
  cacheWallet(wallet){
    const current=this.cache.get(wallet.guild+':'+wallet.user);
    if(current&&current.wallet.revision>wallet.revision)return;
    if(this.cache.size>=1000)this.cache.delete(this.cache.keys().next().value);
    this.cache.set(wallet.guild+':'+wallet.user,{wallet,at:this.clock()});
  }
  record(tx,ref,entry){
    const id=String(entry.id).padStart(16,'0'),cat=category(entry.kind);
    for(const name of ['ledger',`entries-${cat}`,`entries-${cat}-${entry.day}`,`entries-all-${entry.day}`]){
      this.write(tx,ref.collection(name).doc(id),entry,{create:true,index:{id:entry.id}});
    }
  }
  async transact(guild,user,operation){
    this.validate(guild,user);if(this.closed)throw this.safe({});
    const ref=this.walletRef(guild,user);
    try{
      const result=await this.db.runTransaction(async tx=>{
        const now=this.clock(),day=taipeiDay(now),kind=operation.kind;
        const key=kind==='checkin'?`daily:${user}:${day}`:kind==='spin'?`spin:${user}:${operation.requestId}`:
          ['grant','reversal','fixture'].includes(kind)?`admin:${operation.requestId}`:null;
        const opRef=key?this.root.collection('operations').doc(digest(guild+'\0'+key)):null;
        const meta=await this.read(this.meta,tx);this.checkMeta(meta);
        let wallet=await this.read(ref,tx);const existing=opRef?await this.read(opRef,tx):null;
        if(existing){if(existing.fingerprint!==operation.fingerprint)throw problem(409,'此請求編號已用於其他操作。','REQUEST_CONFLICT');
          return {...existing.result,duplicate:true,state:wallet?this.snapshot(wallet,now):undefined,wallet};}
        const fresh=!wallet;
        wallet ||= {guild,user,balance:0,last_spin:0,milestone:false,claimedDay:null,revision:0,history:[],summary:zeroSummary()};
        const dayRef=ref.collection('days').doc(day),needsDay=kind==='spin'||kind==='checkin';
        const daySummary=needsDay?(await this.read(dayRef,tx)||zeroSummary()):null;
        const adminRef=kind==='grant'?this.root.collection('adminDays').doc(guild+'_'+operation.actor+'_'+day):null;
        const adminDay=adminRef?(await this.read(adminRef,tx)||{used:0}):null;
        let original,reversalRef;
        if(kind==='reversal'){
          original=await this.read(this.root.collection('ledger').doc(String(operation.entryId)),tx);
          reversalRef=this.root.collection('reversals').doc(String(operation.entryId));
          const reversed=await this.read(reversalRef,tx);
          if(!original||original.kind!=='grant'||original.guild!==guild||original.user!==user)throw problem(404,'找不到這筆管理員發放。','GRANT_MISSING');
          if(reversed)throw problem(409,'這筆發放已更正過。','GRANT_REVERSED');
        }
        if(kind==='spin'){
          const retryAfterMs=wallet.last_spin+this.spinDelay-now;
          if(retryAfterMs>0)throw Object.assign(problem(429,'轉輪尚未就緒，請稍後再試。','SPIN_COOLDOWN'),{retryAfterMs});
          if(wallet.balance+(fresh&&this.environment==='test'?10000:0)<operation.bet)throw problem(409,'籌碼不足，請降低下注、簽到或聯絡管理員。');
        }
        if(adminDay&&adminDay.used+operation.amount>this.grantDaily)throw problem(409,'已超過這位管理員今日的發放額度。','GRANT_DAILY');
        const entries=[];
        const credit=(delta,entryKind,actor,reason,reference=null)=>{
          const before=wallet.balance,after=before+delta;
          if(!Number.isSafeInteger(after)||after<0||after>maxBalance)throw problem(409,'餘額不足或超出可記帳範圍。','BALANCE_LIMIT');
          if(!Number.isSafeInteger(++meta.nextId))throw problem(503,'帳號籌碼正在維護，請稍後再試。','FIRESTORE_SCHEMA');
          const entry={id:meta.nextId,guild,user,kind:entryKind,delta,before,after,actor,reason,time:new Date(now).toISOString(),day,reference};
          wallet.balance=after;wallet.revision=entry.id;entries.push(entry);return entry;
        };
        if(fresh&&this.environment==='test')credit(10000,'test_seed',null,'測試環境首次籌碼');
        let answer={},round;
        if(kind==='spin'){
          const outcome=operation.outcome,entry=credit(outcome.payout-operation.bet,'spin',user,`下注 ${operation.bet}／派彩 ${outcome.payout}`,operation.requestId);
          const milestone=entry.after>=12000&&!wallet.milestone;
          round={...outcome,id:operation.roundId,time:new Date(now).toISOString(),bet:operation.bet,before:entry.before,after:entry.after,net:entry.delta,milestone};
          wallet.last_spin=now;wallet.milestone ||= milestone;wallet.history=[round,...wallet.history].slice(0,100);answer={round};
          for(const summary of [wallet.summary,daySummary]){summary.game.rounds++;summary.game.bet+=round.bet;summary.game.payout+=round.payout;summary.game.net=summary.game.payout-summary.game.bet;}
        }else if(kind==='checkin'){
          answer={entry:credit(this.daily,'checkin',user,'每日簽到')};wallet.claimedDay=day;
          for(const summary of [wallet.summary,daySummary]){summary.checkin.days++;summary.checkin.total+=this.daily;}
        }else if(kind==='grant')answer={entry:credit(operation.amount,'grant',operation.actor,operation.reason)};
        else if(kind==='reversal')answer={entry:credit(-original.delta,'reversal',operation.actor,operation.reason,String(operation.entryId))};
        else if(kind==='fixture')answer={entry:credit(operation.balance-wallet.balance,'test_fixture',null,'本機驗收情境初始餘額')};
        // All transaction reads finish before the first write.
        if(entries.length){
          for(const entry of entries){
            this.record(tx,ref,entry);
            this.write(tx,this.root.collection('ledger').doc(String(entry.id)),entry,{create:true,index:{operationKey:entry.kind==='test_seed'?null:key}});
          }
          this.write(tx,this.meta,meta);this.write(tx,ref,wallet);
        }else if(fresh)this.write(tx,ref,wallet,{create:true});
        if(needsDay)this.write(tx,dayRef,daySummary);
        if(round)this.write(tx,ref.collection('rounds').doc(round.id),round,{create:true});
        if(adminRef)this.write(tx,adminRef,{used:adminDay.used+operation.amount});
        if(reversalRef)this.write(tx,reversalRef,{entryId:answer.entry.id},{create:true});
        if(opRef)this.write(tx,opRef,{fingerprint:operation.fingerprint,result:answer},{create:true});
        return {...answer,state:this.snapshot(wallet,now),wallet};
      },{maxAttempts:3});
      if(result.wallet)this.cacheWallet(result.wallet);delete result.wallet;return result;
    }catch(error){throw this.safe(error);}
  }
  spin(guild,user,bet,requestId){
    this.validate(guild,user);if(!BETS.includes(bet))throw problem(400,'無效的下注或請求編號。');this.requestId(requestId);
    const stops=REEL_STRIPS.map(strip=>randomInt(strip.length));
    return this.transact(guild,user,{kind:'spin',bet,requestId,fingerprint:String(bet),outcome:roundFromStops(bet,stops),roundId:randomUUID()});
  }
  checkin(guild,user){return this.transact(guild,user,{kind:'checkin',fingerprint:'daily'});}
  grant(guild,actor,user,amount,reason,requestId){
    this.validate(guild,actor);this.validate(guild,user);this.reason(reason);this.requestId(requestId);
    if(!Number.isSafeInteger(amount)||amount<=0||amount>this.grantMax)throw problem(400,`單次發放限 1～${this.grantMax} 籌碼。`,'GRANT_AMOUNT');
    return this.transact(guild,user,{kind:'grant',amount,actor,reason,requestId,fingerprint:JSON.stringify([actor,user,amount,reason])});
  }
  async reverse(guild,actor,entryId,reason,requestId){
    this.validate(guild,actor);this.reason(reason);this.requestId(requestId);
    if(!Number.isSafeInteger(entryId)||entryId<1)throw problem(400,'無效的紀錄編號。','GRANT_MISSING');
    try{const original=await this.read(this.root.collection('ledger').doc(String(entryId)));
      if(!original||original.guild!==guild||original.kind!=='grant')throw problem(404,'找不到這筆管理員發放。','GRANT_MISSING');
      return await this.transact(guild,original.user,{kind:'reversal',actor,entryId,reason,requestId,fingerprint:JSON.stringify([actor,entryId,reason])});
    }catch(error){throw this.safe(error);}
  }
  ensureFixture(guild,user,balance,key){
    if(this.environment!=='test')throw new Error('Test fixtures are disabled');
    return this.transact(guild,user,{kind:'fixture',balance,requestId:'local-fixture-'+key,fingerprint:String(balance)});
  }
  async query(ref,before,limit){
    this.quota.reserve({reads:6*limit});
    const snapshot=await ref.where('id','<',before).orderBy('id','desc').limit(limit).get();
    const rows=snapshot.docs.map(unpack);this.quota.observe(Buffer.byteLength(JSON.stringify(rows)));return rows;
  }
  async history(guild,user,before=Number.MAX_SAFE_INTEGER){
    this.validate(guild,user);if(!Number.isSafeInteger(before)||before<1)throw problem(400,'無效的紀錄游標。');
    try{return await this.query(this.walletRef(guild,user).collection('ledger'),before,50);}catch(error){throw this.safe(error);}
  }
  async auditHistory(guild,user,{category:cat='rewards',before=Number.MAX_SAFE_INTEGER,days=0}={}){
    this.validate(guild,user);
    if(!['rewards','checkin','game','all'].includes(cat)||!Number.isSafeInteger(before)||before<1||![0,1,7,30].includes(days))throw problem(400,'無效的紀錄查詢條件。','AUDIT_FILTER');
    try{
      const ref=this.walletRef(guild,user),collections=days?Array.from({length:days},(_,i)=>`entries-${cat}-${taipeiDay(this.clock()-i*86400000)}`):[cat==='all'?'ledger':`entries-${cat}`];
      const rows=[];for(const name of collections)rows.push(...await this.query(ref.collection(name),before,11));
      rows.sort((a,b)=>b.id-a.id);const selected=rows.slice(0,10);
      for(const row of selected)if(row.kind==='grant'){const reversal=await this.read(this.root.collection('reversals').doc(String(row.id)));row.reversal_id=reversal?.entryId||null;}
      return {rows:selected,next:rows.length>10?selected[9].id:null};
    }catch(error){throw this.safe(error);}
  }
  async auditSummary(guild,user,days=0){
    this.validate(guild,user);if(![0,1,7,30].includes(days))throw problem(400,'無效的紀錄查詢期間。','AUDIT_FILTER');
    try{
      if(!days)return (await this.read(this.walletRef(guild,user)))?.summary||zeroSummary();
      const result=zeroSummary();for(let i=0;i<days;i++){
        const data=await this.read(this.walletRef(guild,user).collection('days').doc(taipeiDay(this.clock()-i*86400000)))||zeroSummary();
        for(const group of ['checkin','game'])for(const key of Object.keys(result[group]))result[group][key]+=data[group][key];
      }return result;
    }catch(error){throw this.safe(error);}
  }
  status(){return {backend:'firestore',environment:this.environment,projectId:this.settings.projectId,namespace:this.settings.namespace,quota:this.quota.status(),ready:this.ready&&!this.closed};}
  async close(){if(this.closed)return;this.closed=true;this.cache.clear();await this.db.terminate();this.quota.close();}
}
