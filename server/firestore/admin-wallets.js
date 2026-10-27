import {createHash} from 'node:crypto';
import {problem,taipeiDay} from '../wallet/wallet-common.js';
import {ledgerIndex,decodeHistory} from './schema.js';
import {RESET_BALANCE,RESET_WALLET_LIMIT,RESET_REASON,resetFingerprint,resetMarker,resetResult,compactResetResult,resetEntryIds,resetReportRow,resetIndex} from '../wallet/wallet-admin.js';

const digest=s=>createHash('sha256').update(s).digest('hex');
const unpack=doc=>JSON.parse(doc.get('json'));
const guildQuery=(store,guild)=>store.root.collection('wallets').where('__name__','>=',guild+'_')
  .where('__name__','<',guild+'_\uffff').orderBy('__name__');

export const firestoreAdminWallets={
  async playerWallets(guild,{after='',limit=20}={}){
    this.assertGuild(guild);
    if((after&&!/^\d{17,20}$/.test(after))||!Number.isInteger(limit)||limit<1||limit>20)throw problem(400,'無效的玩家名單頁碼。','WALLET_CURSOR');
    if(this.closed)throw this.safe({});
    try{
      let query=guildQuery(this,guild);if(after)query=query.startAfter(guild+'_'+after);
      this.quota.reserve({reads:6*(limit+1)});const page=await query.limit(limit+1).get();
      const wallets=page.docs.map(unpack);this.quota.observe(Buffer.byteLength(JSON.stringify(wallets)));
      const rows=wallets.slice(0,limit).map(w=>({user:w.user,balance:w.balance,rounds:w.summary.game.rounds}));
      return {rows,next:wallets.length>limit?rows.at(-1).user:null,time:new Date(this.clock()).toISOString()};
    }catch(error){throw this.safe(error);}
  },
  async readResetResult(result,{page,tx,guild}={}){
    if(page!==undefined&&(!Number.isInteger(page)||page<1||page>Math.ceil(result.reset.count/20)))throw problem(400,'沒有此頁報表。','RESET_PAGE');
    let entries;
    if(Array.isArray(result.entries))entries=page===undefined?result.entries:result.entries.slice((page-1)*20,page*20);
    else{
      let ids=resetEntryIds(result);if(page!==undefined)ids=ids.slice((page-1)*20,page*20);
      if(!ids.length)throw problem(503,'報表資料需要核對。','RESET_INVALID');
      const read=async refs=>{if(tx)return this.readMany(refs,tx);this.quota.reserve({reads:6*refs.length});const docs=await this.db.getAll(...refs);return docs.map(doc=>{const row=unpack(doc);this.quota.observe(Buffer.byteLength(JSON.stringify(row)));return row;});};
      const rows=await read(ids.map(id=>this.root.collection('ledger').doc(String(id))));
      entries=rows.map((e,n)=>{
        if(!e||e.id!==ids[n]||e.guild!==guild||e.kind!=='reset'||e.reference!==result.reset.requestId||e.actor!==result.reset.actor||e.time!==result.reset.time||e.after!==RESET_BALANCE||e.delta!==e.after-e.before)throw problem(503,'報表資料需要核對。','RESET_INVALID');
        return resetReportRow(e);
      });
    }
    return {reset:result.reset,entries,...(page!==undefined?{page}:{})};
  },
  async latestWalletReset(guild){
    const query=this.root.collection('operations').where('resetKey','>=',guild+'_').where('resetKey','<',guild+'_\uffff').orderBy('resetKey','desc').limit(1);
    this.quota.reserve({reads:6});const page=await query.get();
    if(page.docs.length){const saved=unpack(page.docs[0]);this.quota.observe(Buffer.byteLength(JSON.stringify(saved)));return saved;}
    // Pre-upgrade receipts have no resetKey. Read only the reset links (never
    // spins/history), so an existing last report remains available without a
    // bulk migration. New receipts and restored backups use the bounded index.
    let cursor,latest=null;
    for(;;){
      let q=this.root.collection('ledger').where('operationKey','>=','reset:').where('operationKey','<','reset;').orderBy('operationKey');if(cursor)q=q.startAfter(cursor);
      this.quota.reserve({reads:6*21});const old=await q.limit(21).get();
      for(const doc of old.docs){const e=unpack(doc);this.quota.observe(Buffer.byteLength(JSON.stringify(e)));if(e.guild===guild&&(!latest||e.id>latest.id))latest=e;}
      if(old.docs.length<21)break;cursor=old.docs.at(-1).get('operationKey');
    }
    return latest?this.read(this.root.collection('operations').doc(digest(guild+'\0reset:'+latest.reference))):null;
  },
  async walletResetReport(guild,actor,requestId,{page}={}){
    this.validate(guild,actor);if(requestId)this.requestId(requestId);if(this.closed)throw this.safe({});
    try{
      const saved=await this.latestWalletReset(guild);
      if(!saved?.result?.reset)throw problem(404,'找不到這筆重設紀錄。','RESET_MISSING');
      if(requestId&&saved.result.reset.requestId!==requestId)throw problem(409,'已有較新的重設報表，請重新開啟。','RESET_REPLACED');
      return {...await this.readResetResult(saved.result,{page,guild}),duplicate:true};
    }catch(error){throw this.safe(error);}
  },
  resetWallets(guild,actor,requestId){
    this.validate(guild,actor);this.requestId(requestId);
    const task=()=>this.settleWalletReset(guild,actor,requestId);
    return this.settlementQueue?this.settlementQueue.run(task):task();
  },
  async settleWalletReset(guild,actor,requestId){
    if(this.closed)throw this.safe({});
    const key='reset:'+requestId,fingerprint=resetFingerprint(actor),opRef=this.root.collection('operations').doc(digest(guild+'\0'+key));
    try{
      const result=await this.db.runTransaction(async tx=>{
        const [meta,existing]=await this.readMany([this.meta,opRef],tx);this.checkMeta(meta);
        if(existing){if(existing.fingerprint!==fingerprint)throw problem(409,'此請求編號已用於其他操作。','REQUEST_CONFLICT');return {...await this.readResetResult(existing.result,{tx,guild}),duplicate:true,wallets:[]};}
        const limit=this.schemaVersion===1?60:RESET_WALLET_LIMIT;
        this.quota.reserve({reads:6*(limit+1)});
        const page=await tx.get(guildQuery(this,guild).limit(limit+1)),wallets=page.docs.map(unpack);
        this.quota.observe(Buffer.byteLength(JSON.stringify(wallets)));
        if(wallets.length>limit)throw problem(409,'玩家數量超出本次安全重設範圍，這次沒有變更任何餘額。','RESET_LIMIT');
        if(!wallets.length)throw problem(409,'本群還沒有已建立錢包的玩家。','RESET_EMPTY');
        if(wallets.some((w,i)=>!/^\d{17,20}$/.test(w.user)||page.docs[i].id!==guild+'_'+w.user))throw problem(503,'玩家錢包資料需要核對，這次沒有變更餘額。','RESET_INVALID');
        const now=this.clock(),time=new Date(now).toISOString(),entries=[];
        for(const wallet of wallets){
          if(wallet.guild!==guild||!Number.isSafeInteger(wallet.balance)||wallet.balance<0||wallet.balance>1e12)throw problem(503,'玩家錢包資料需要核對，這次沒有變更餘額。','RESET_INVALID');
          if(!Number.isSafeInteger(++meta.nextId))throw problem(503,'帳號戲籌正在維護，請稍後再試。','FIRESTORE_SCHEMA');
          const entry={id:meta.nextId,guild,user:wallet.user,kind:'reset',before:wallet.balance,after:RESET_BALANCE,
            delta:RESET_BALANCE-wallet.balance,actor,reason:RESET_REASON,time,day:taipeiDay(now),reference:requestId};
          entries.push(entry);wallet.balance=RESET_BALANCE;wallet.revision=entry.id;
          const prior=this.schemaVersion===2?decodeHistory(wallet.historyCache)[0]?.round:wallet.history[0];
          wallet.balanceReset=resetMarker(entry,prior?.id||null);
        }
        const answer=resetResult(actor,requestId,time,entries.map(({id,user,before,after,delta})=>({id,user,before,after,delta})));
        // Refuse oversize batches BEFORE the first write; never reset half a guild.
        const bytes=wallets.reduce((n,w)=>n+Buffer.byteLength(JSON.stringify(w))*2+2048,0)+Buffer.byteLength(JSON.stringify(answer))*2;
        if(bytes>6*1024**2)throw problem(409,'錢包資料量超出本次安全重設範圍，這次沒有變更任何餘額。','RESET_LIMIT');
        for(let i=0;i<entries.length;i++){
          const entry=entries[i],ref=this.walletRef(guild,entry.user);
          if(this.schemaVersion===1)this.record(tx,ref,entry);
          this.write(tx,this.root.collection('ledger').doc(String(entry.id)),entry,{create:true,index:{
            operationKey:i===0?key:null,...(this.schemaVersion===2?ledgerIndex(entry):{})}});
          this.write(tx,ref,wallets[i]);
        }
        this.write(tx,this.meta,meta);this.write(tx,opRef,{fingerprint,result:compactResetResult(answer)},{create:true,index:resetIndex(guild,answer)});
        return {...answer,wallets};
      },{maxAttempts:3});
      for(const wallet of result.wallets)this.cacheWallet(wallet);delete result.wallets;return result;
    }catch(error){throw this.safe(error);}
  },
};
