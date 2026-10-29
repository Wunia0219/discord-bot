import {randomInt,randomUUID,createHash} from 'node:crypto';
import {BETS,roundFromStops,REEL_STRIPS} from '../../src/game/index.js';
import {walletValidation,problem,taipeiDay,nextCheckin} from '../wallet/wallet-common.js';
import {checkinRewards,checkinReceipt,weeklyCheckinState} from '../wallet/weekly-checkin.js';
import {readAuditPage} from './history.js';
import {ledgerIndex,ledgerRange,sequenceKey,encodeHistory,decodeHistory} from './schema.js';
import {highlightEvent,highlightEventPath,highlightEventIndex} from './highlight-data.js';
import {firestoreAdminWallets} from './admin-wallets.js';
import {INITIAL_BALANCE,openingKind,openingReason,isOpeningKind} from '../wallet/wallet-opening.js';

const maxBalance=1_000_000_000_000,maxDocument=512*1024;
const digest=value=>createHash('sha256').update(value).digest('hex');
const category=kind=>({grant:'rewards',reversal:'rewards',reset:'rewards',checkin:'checkin',spin:'game'}[kind]||'other');
const zeroSummary=()=>({checkin:{days:0,total:0},game:{rounds:0,bet:0,payout:0,net:0}});
const unpack=doc=>doc.exists?JSON.parse(doc.get('json')):null;
const packed=data=>({json:JSON.stringify(data)});

export class FirestoreWalletCore {
  constructor(settings,{guildIds=[],weeklyRewards,grantMax=100000,grantDaily=1000000,clock=Date.now,spinDelay=2000,stateCacheMs=5000,db,quota,settlementQueue}={}){
    if(!guildIds.length||guildIds.some(id=>!/^\d{17,20}$/.test(id)))throw new Error('Explicit guild allowlist required');
    for(const value of [grantMax,grantDaily])if(!Number.isSafeInteger(value)||value<=0||value>maxBalance)throw new Error('Invalid wallet limits');
    if(!Number.isInteger(stateCacheMs)||stateCacheMs<0||stateCacheMs>30000)throw new Error('Invalid wallet cache lifetime');
    Object.assign(this,{settings,environment:settings.environment,guildIds:new Set(guildIds),weeklyRewards:checkinRewards(weeklyRewards),grantMax,grantDaily,clock,spinDelay,stateCacheMs});
    this.cacheGeneration=0;
    this.backend='firestore';
    this.schemaVersion=settings.schemaVersion??1;
    if(![1,2].includes(this.schemaVersion))throw new Error('Invalid Firestore schema version');
    this.histories=new Map();
    if(!db||!quota)throw new Error('Firestore transport and persistent quota are required');
    this.db=db;this.quota=quota;this.settlementQueue=settlementQueue;
    this.root=this.db.collection('circus_wallet_v1').doc(settings.namespace);
    this.meta=this.root.collection('meta').doc('state');this.cache=new Map();this.pending=new Map();this.closed=false;this.ready=false;this.readyAt=0;
  }
  assertGuild=walletValidation.assertGuild;
  validate=walletValidation.validate;
  reason=walletValidation.reason;
  requestId=walletValidation.requestId;
  walletRef(guild,user){return this.root.collection('wallets').doc(guild+'_'+user);}
  async read(ref,tx){
    // Covers SDK transport retries conservatively; transaction callbacks reserve anew.
    this.quota.reserve({reads:6});
    const snapshot=await (tx?tx.get(ref):ref.get());
    const data=unpack(snapshot);this.quota.observe(Buffer.byteLength(JSON.stringify(data)));
    return data;
  }
  async readMany(refs,tx){
    // Keep the same per-document retry allowance while sharing one transport
    // round trip. All reads still belong to the same atomic transaction.
    this.quota.reserve({reads:6*refs.length});
    const snapshots=await tx.getAll(...refs);
    return snapshots.map(snapshot=>{const data=unpack(snapshot);this.quota.observe(Buffer.byteLength(JSON.stringify(data)));return data;});
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
        this.write(tx,this.meta,{version:this.schemaVersion,environment:this.environment,status:'ready',nextId:0},{create:true});
      },{maxAttempts:3});
      this.ready=true;this.readyAt=this.clock();return this;
    }catch(error){this.ready=false;throw this.safe(error);}
  }
  checkMeta(meta){if(!meta||meta.version!==this.schemaVersion||meta.environment!==this.environment||meta.status!=='ready'||!Number.isSafeInteger(meta.nextId))throw problem(503,'帳號戲籌正在維護，請稍後再試。','FIRESTORE_SCHEMA');}
  async isReady(){
    if(this.closed||this.quota.status().blocked)return false;
    if(this.ready&&this.clock()-this.readyAt<60000)return true;
    this.readyPending ||= (async()=>{
      try{this.checkMeta(await this.read(this.meta));this.ready=!this.closed;this.readyAt=this.clock();return this.ready;}
      catch{this.ready=false;return false;}
    })().finally(()=>{this.readyPending=null;});
    return this.readyPending;
  }
  safe(error){
    if(error.walletProblem)return error;
    this.invalidateCache();
    this.ready=false;
    return problem(503,'帳號戲籌暫時連不上，請稍後重試；未確認的操作請沿用原請求。','FIRESTORE_UNAVAILABLE');
  }
  snapshot(wallet,now=this.clock()){
    return {version:3,balance:wallet.balance,...(this.schemaVersion===2?{historyRevision:wallet.historyRevision}:{history:wallet.history}),milestones:wallet.milestone?[12000]:[],environment:this.environment,
      guildId:wallet.guild,...weeklyCheckinState(wallet.claimedDay,wallet.checkin,taipeiDay(now),this.weeklyRewards),nextCheckin:nextCheckin(now),revision:wallet.revision,
      spinCooldownMs:Math.max(0,wallet.last_spin+this.spinDelay-now),...(wallet.balanceReset?{balanceReset:wallet.balanceReset}:{})};
  }
  async completeState(guild,user,state){
    if(Array.isArray(state.history))return state;
    if(!state.historyRevision)return {...state,history:[]};
    const key=guild+':'+user+':'+state.historyRevision;
    if(!this.histories.has(key)){
      if(this.histories.size>=100)this.histories.delete(this.histories.keys().next().value);
      const promise=this.rounds(guild,user,{through:state.historyRevision,limit:100})
        .then(page=>page.rows.map(row=>row.round)).catch(error=>{this.histories.delete(key);throw error;});
      this.histories.set(key,promise);
    }
    return {...state,history:await this.histories.get(key)};
  }
  async state(guild,user,{compact=false}={}){
    const state=await this.readState(guild,user);
    return compact?state:this.completeState(guild,user,state);
  }
  async readState(guild,user){
    this.validate(guild,user);if(this.closed)throw this.safe({});
    this.quota.reserve({});const key=guild+':'+user,cached=this.cache.get(key);
    const age=cached?this.clock()-cached.at:-1;
    if(cached&&age>=0&&age<this.stateCacheMs)return this.snapshot(cached.wallet);
    if(this.pending.has(key))return this.pending.get(key);
    const readAt=this.clock(),generation=this.cacheGeneration;
    const promise=(async()=>{
      try{const wallet=await this.read(this.walletRef(guild,user));
        if(this.closed||generation!==this.cacheGeneration)throw new Error('Wallet read invalidated');
        if(!wallet)return (await this.transact(guild,user,{kind:'ensure'},{compact:true})).state;
        return this.snapshot(this.cacheWallet(wallet,{at:readAt}));
      }catch(error){throw this.safe(error);}
    })().finally(()=>this.pending.delete(key));this.pending.set(key,promise);return promise;
  }
  cacheWallet(wallet,{at=this.clock()}={}){
    if(this.closed)return wallet;
    const key=wallet.guild+':'+wallet.user,current=this.cache.get(key);
    if(current&&(current.wallet.revision>wallet.revision||current.wallet.revision===wallet.revision&&current.at>=at))return current.wallet;
    if(!current&&this.cache.size>=1000)this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key,{wallet,at});return wallet;
  }
  invalidateCache(){this.cache.clear();this.cacheGeneration++;}
  record(tx,ref,entry){
    const id=String(entry.id).padStart(16,'0'),cat=category(entry.kind);
    for(const name of ['ledger',`entries-${cat}`,`entries-${cat}-${entry.day}`,`entries-all-${entry.day}`]){
      this.write(tx,ref.collection(name).doc(id),entry,{create:true,index:{id:entry.id}});
    }
  }
  transact(guild,user,operation,options){
    this.validate(guild,user);
    const task=()=>this.settle(guild,user,operation,options);
    return this.settlementQueue?this.settlementQueue.run(task):task();
  }
  async settle(guild,user,operation,{compact=false,profileName}={}){
    this.validate(guild,user);if(this.closed)throw this.safe({});
    const ref=this.walletRef(guild,user);
    try{
      const result=await this.db.runTransaction(async tx=>{
        const now=this.clock(),day=taipeiDay(now),kind=operation.kind;
        const key=kind==='checkin'?`daily:${user}:${day}`:kind==='spin'?`spin:${user}:${operation.requestId}`:
          ['grant','reversal','fixture'].includes(kind)?`admin:${operation.requestId}`:null;
        const opRef=key?this.root.collection('operations').doc(digest(guild+'\0'+key)):null;
        const dayRef=ref.collection('days').doc(day),needsDay=kind==='spin'||kind==='checkin';
        // Accepted rounds still read exactly four documents. Fetching the daily
        // total with the first batch removes another network round trip.
        const [meta,savedWallet,existing,savedDay]=await this.readMany([this.meta,ref,...(opRef?[opRef]:[]),...(needsDay?[dayRef]:[])],tx);this.checkMeta(meta);
        let wallet=savedWallet;
        if(existing){if(existing.fingerprint!==operation.fingerprint)throw problem(409,'此請求編號已用於其他操作。','REQUEST_CONFLICT');
          return {...existing.result,duplicate:true,state:wallet?this.snapshot(wallet,now):undefined,wallet};}
        const fresh=!wallet;
        wallet ||= {guild,user,balance:0,last_spin:0,milestone:false,claimedDay:null,revision:0,
          ...(this.schemaVersion===2?{historyRevision:0,historyCache:encodeHistory([])}:{history:[]}),summary:zeroSummary()};
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
          if(wallet.balance+(fresh?INITIAL_BALANCE:0)<operation.bet)throw problem(409,'戲籌不足，請降低下注、簽到或聯絡管理員。');
        }
        if(adminDay&&adminDay.used+operation.amount>this.grantDaily)throw problem(409,'已超過這位管理員今日的發放額度。','GRANT_DAILY');
        const daySummary=needsDay?(savedDay||zeroSummary()):null;
        const entries=[];
        const credit=(delta,entryKind,actor,reason,reference=null)=>{
          const before=wallet.balance,after=before+delta;
          if(!Number.isSafeInteger(after)||after<0||after>maxBalance)throw problem(409,'餘額不足或超出可記帳範圍。','BALANCE_LIMIT');
          if(!Number.isSafeInteger(++meta.nextId))throw problem(503,'帳號戲籌正在維護，請稍後再試。','FIRESTORE_SCHEMA');
          const entry={id:meta.nextId,guild,user,kind:entryKind,delta,before,after,actor,reason,time:new Date(now).toISOString(),day,reference};
          wallet.balance=after;wallet.revision=entry.id;entries.push(entry);return entry;
        };
        if(fresh)credit(INITIAL_BALANCE,openingKind(this.environment),null,openingReason(this.environment));
        let answer={},round;
        if(kind==='spin'){
          const outcome=operation.outcome,entry=credit(outcome.payout-operation.bet,'spin',user,`下注 ${operation.bet}／派彩 ${outcome.payout}`,operation.requestId);
          const milestone=entry.after>=12000&&!wallet.milestone;
          round={...outcome,id:operation.roundId,time:new Date(now).toISOString(),bet:operation.bet,before:entry.before,after:entry.after,net:entry.delta,milestone};
          wallet.last_spin=now;wallet.milestone ||= milestone;answer={round};
          if(this.schemaVersion===2){
            answer.historyBase=wallet.historyRevision;answer.historyRevision=entry.id;wallet.historyRevision=entry.id;
            wallet.historyCache=encodeHistory([{sequence:entry.id,round},...decodeHistory(wallet.historyCache)]);
          }
          else wallet.history=[round,...wallet.history].slice(0,100);
          for(const summary of [wallet.summary,daySummary]){summary.game.rounds++;summary.game.bet+=round.bet;summary.game.payout+=round.payout;summary.game.net=summary.game.payout-summary.game.bet;}
        }else if(kind==='checkin'){
          const checkin=checkinReceipt(wallet.claimedDay,wallet.checkin,day,this.weeklyRewards),amount=checkin.rewards[checkin.cycleDay-1];
          answer={entry:credit(amount,'checkin',user,`週簽到第 ${checkin.cycleDay} 天`),checkin};wallet.claimedDay=day;wallet.checkin=checkin;
          for(const summary of [wallet.summary,daySummary]){summary.checkin.days++;summary.checkin.total+=amount;}
        }else if(kind==='grant')answer={entry:credit(operation.amount,'grant',operation.actor,operation.reason)};
        else if(kind==='reversal')answer={entry:credit(-original.delta,'reversal',operation.actor,operation.reason,String(operation.entryId))};
        else if(kind==='fixture')answer={entry:credit(operation.balance-wallet.balance,'test_fixture',null,'本機驗收情境初始餘額')};
        // The announcement outbox commits with the original settlement. A lost
        // HTTP response or restart cannot lose it; a replay never creates it twice.
        const announcement=round&&this.highlightsGuild===guild?highlightEvent(guild,profileName,round,now):null;
        if(announcement){meta.highlights=1;meta.highlightsRevision=meta.nextId;}
        // All transaction reads finish before the first write.
        if(entries.length){
          for(const entry of entries){
            if(this.schemaVersion===1)this.record(tx,ref,entry);
            this.write(tx,this.root.collection('ledger').doc(String(entry.id)),entry,{create:true,index:{operationKey:isOpeningKind(entry.kind)?null:key,
              ...(this.schemaVersion===2?ledgerIndex(entry):{})}});
          }
          this.write(tx,this.meta,meta);this.write(tx,ref,wallet);
        }else if(fresh)this.write(tx,ref,wallet,{create:true});
        if(needsDay)this.write(tx,dayRef,daySummary);
        if(round)this.write(tx,ref.collection('rounds').doc(round.id),round,{create:true,index:this.schemaVersion===2?{sequence:wallet.historyRevision}:{}});
        if(adminRef)this.write(tx,adminRef,{used:adminDay.used+operation.amount});
        if(reversalRef)this.write(tx,reversalRef,{entryId:answer.entry.id},{create:true});
        if(opRef)this.write(tx,opRef,{fingerprint:operation.fingerprint,result:answer},{create:true});
        if(announcement)this.write(tx,this.db.doc(this.root.path+'/'+highlightEventPath(announcement)),announcement,{create:true,index:highlightEventIndex(announcement)});
        return {...answer,state:this.snapshot(wallet,now),wallet};
      },{maxAttempts:3});
      const settledWallet=result.wallet;
      if(settledWallet)this.cacheWallet(settledWallet);delete result.wallet;
      if(!compact&&result.state)result.state=await this.completeState(guild,user,result.state);
      // Database round trips have already consumed part of the two-second
      // interval. Do not make the client wait that elapsed time a second time.
      if(result.state&&settledWallet)result.state.spinCooldownMs=Math.max(0,settledWallet.last_spin+this.spinDelay-this.clock());
      return result;
    }catch(error){throw this.safe(error);}
  }
  spin(guild,user,bet,requestId,options){
    this.validate(guild,user);if(!BETS.includes(bet))throw problem(400,'無效的下注或請求編號。');this.requestId(requestId);
    const stops=REEL_STRIPS.map(strip=>randomInt(strip.length));
    return this.transact(guild,user,{kind:'spin',bet,requestId,fingerprint:String(bet),outcome:roundFromStops(bet,stops),roundId:randomUUID()},options);
  }
  checkin(guild,user,options){return this.transact(guild,user,{kind:'checkin',fingerprint:'daily'},options);}
  grant(guild,actor,user,amount,reason,requestId){
    this.validate(guild,actor);this.validate(guild,user);this.reason(reason);this.requestId(requestId);
    if(!Number.isSafeInteger(amount)||amount<=0||amount>this.grantMax)throw problem(400,`單次發放限 1～${this.grantMax} 戲籌。`,'GRANT_AMOUNT');
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
  async queryLedger(guild,user,before,limit,filter={}){
    const {field,prefix}=ledgerRange(guild,user,filter);
    this.quota.reserve({reads:6*limit});
    const snapshot=await this.root.collection('ledger').where(field,'>=',prefix+sequenceKey(0))
      .where(field,'<',prefix+sequenceKey(before)).orderBy(field,'desc').limit(limit).get();
    const rows=snapshot.docs.map(unpack);this.quota.observe(Buffer.byteLength(JSON.stringify(rows)));return rows;
  }
  async rounds(guild,user,{after=0,before=Number.MAX_SAFE_INTEGER,through=Number.MAX_SAFE_INTEGER,limit=100}={}){
    this.validate(guild,user);
    if(this.schemaVersion!==2)throw problem(400,'請重新開啟遊玩紀錄。','HISTORY_UNSUPPORTED');
    if(![after,before,through,limit].every(Number.isSafeInteger)||after<0||before<1||through<0||limit<1||limit>100)
      throw problem(400,'無效的紀錄游標。','HISTORY_CURSOR');
    if(after>=through||after>=before)return {rows:[],next:null};
    try{
      // A lossless recent cache keeps cold login at one wallet read. Only older
      // pages or gaps outside that window query individual authoritative rounds.
      await this.readState(guild,user);
      const wallet=this.cache.get(guild+':'+user)?.wallet;
      if(wallet){
        const recent=decodeHistory(wallet.historyCache),allKnown=wallet.summary.game.rounds<=recent.length;
        const selected=recent.filter(r=>r.sequence>after&&r.sequence<before&&r.sequence<=through);
        const coversLower=allKnown||after>=(recent.at(-1)?.sequence??0);
        const reachesTail=selected.length===limit&&after===0&&selected.at(-1)?.sequence===recent.at(-1)?.sequence;
        if(coversLower||selected.length>limit||reachesTail){
          const rows=selected.slice(0,limit);
          return {rows,next:selected.length>limit||(!allKnown&&reachesTail)?rows.at(-1).sequence:null};
        }
      }
      this.quota.reserve({reads:6*(limit+1)});
      const snapshot=await this.walletRef(guild,user).collection('rounds').where('sequence','>',after)
        .where('sequence','<',before).where('sequence','<=',through).orderBy('sequence','desc').limit(limit+1).get();
      const records=snapshot.docs.map(doc=>({sequence:doc.get('sequence'),round:unpack(doc)}));
      this.quota.observe(Buffer.byteLength(JSON.stringify(records)));
      const rows=records.slice(0,limit);return {rows,next:records.length>limit?rows.at(-1).sequence:null};
    }catch(error){throw this.safe(error);}
  }
  async history(guild,user,before=Number.MAX_SAFE_INTEGER){
    this.validate(guild,user);if(!Number.isSafeInteger(before)||before<1)throw problem(400,'無效的紀錄游標。');
    try{return this.schemaVersion===2?await this.queryLedger(guild,user,before,50):await this.query(this.walletRef(guild,user).collection('ledger'),before,50);}catch(error){throw this.safe(error);}
  }
  async auditHistory(guild,user,{category:cat='rewards',before=Number.MAX_SAFE_INTEGER,days=0}={}){
    this.validate(guild,user);
    if(!['rewards','checkin','game','all'].includes(cat)||!Number.isSafeInteger(before)||before<1||![0,1,7,30].includes(days))throw problem(400,'無效的紀錄查詢條件。','AUDIT_FILTER');
    try{
      const ref=this.walletRef(guild,user),now=this.clock();
      const rows=await readAuditPage({category:cat,before,
        days:Array.from({length:days},(_,i)=>taipeiDay(now-i*86400000)),
        query:(name,cursor,limit)=>this.schemaVersion===2?this.queryLedger(guild,user,cursor,limit,
          {category:cat,day:/\d{4}-\d{2}-\d{2}$/.exec(name)?.[0]}):this.query(ref.collection(name),cursor,limit)});
      const selected=rows.slice(0,10);
      for(const row of selected)if(row.kind==='grant'){const reversal=await this.read(this.root.collection('reversals').doc(String(row.id)));row.reversal_id=reversal?.entryId||null;}
      return {rows:selected,next:rows.length>10?selected[9].id:null};
    }catch(error){throw this.safe(error);}
  }
  async auditSummary(guild,user,days=0){
    this.validate(guild,user);if(![0,1,7,30].includes(days))throw problem(400,'無效的紀錄查詢期間。','AUDIT_FILTER');
    try{
      if(!days)return (await this.read(this.walletRef(guild,user)))?.summary||zeroSummary();
      const now=this.clock(),field='__name__';
      // ISO day document IDs already form a single-field date index. A range
      // query reads only existing days instead of billing missing point reads.
      this.quota.reserve({reads:6*days});
      const snapshot=await this.walletRef(guild,user).collection('days')
        .where(field,'>=',taipeiDay(now-(days-1)*86400000)).where(field,'<=',taipeiDay(now)).limit(days).get();
      const result=zeroSummary();for(const doc of snapshot.docs){
        const data=unpack(doc);this.quota.observe(Buffer.byteLength(JSON.stringify(data)));
        for(const group of ['checkin','game'])for(const key of Object.keys(result[group]))result[group][key]+=data[group][key];
      }return result;
    }catch(error){throw this.safe(error);}
  }
  status(){return {backend:'firestore',schemaVersion:this.schemaVersion,environment:this.environment,projectId:this.settings.projectId,namespace:this.settings.namespace,quota:this.quota.status(),ready:this.ready&&!this.closed};}
  async close(){if(this.closed)return;this.closed=true;this.invalidateCache();this.histories.clear();await this.db.terminate();this.quota.close();}
}
Object.assign(FirestoreWalletCore.prototype,firestoreAdminWallets);
