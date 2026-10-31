import {problem,taipeiDay} from '../wallet/wallet-common.js';
import {readAuditPage} from './history.js';
import {ledgerRange,sequenceKey,decodeHistory} from './schema.js';
import {unpack,zeroSummary} from './documents.js';

// Read-only queries merge original rounds with compact operation receipts.
export const firestoreWalletHistory={
  async query(ref,before,limit){
    this.quota.reserve({reads:6*limit});
    const snapshot=await ref.where('id','<',before).orderBy('id','desc').limit(limit).get();
    const rows=snapshot.docs.map(unpack);this.quota.observe(Buffer.byteLength(JSON.stringify(rows)));return rows;
  },
  async queryLedger(guild,user,before,limit,filter={}){
    const {field,prefix}=ledgerRange(guild,user,filter);
    this.quota.reserve({reads:6*limit});
    const snapshot=await this.root.collection('ledger').where(field,'>=',prefix+sequenceKey(0))
      .where(field,'<',prefix+sequenceKey(before)).orderBy(field,'desc').limit(limit).get();
    const rows=snapshot.docs.map(doc=>({...unpack(doc),...(filter.displayCodes&&doc.get('recordCode')?{recordCode:doc.get('recordCode')}:{}) ,
      ...(filter.displayCodes&&doc.get('referenceCode')?{referenceCode:doc.get('referenceCode')}:{})}));
    this.quota.observe(Buffer.byteLength(JSON.stringify(rows)));return rows;
  },
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
      const records=[];
      if(wallet?.operationRoundsAfter!==undefined){
        const prefix=guild+'_'+user+':';
        this.quota.reserve({reads:6*(limit+1)});
        const snapshot=await this.root.collection('operations').where('roundKey','>',prefix+sequenceKey(after))
          .where('roundKey','<',prefix+sequenceKey(before)).where('roundKey','<=',prefix+sequenceKey(through))
          .orderBy('roundKey','desc').limit(limit+1).get();
        for(const doc of snapshot.docs){const receipt=unpack(doc);if(receipt.roundStorage!=='operation-v1'||!receipt.result?.round)throw new Error('Invalid round receipt');
          records.push({sequence:Number(doc.get('roundKey').slice(prefix.length)),round:receipt.result.round});}
      }
      // Older documents remain readable without rewriting or deleting them.
      const legacyThrough=wallet?.legacyRoundThrough??Number.MAX_SAFE_INTEGER;
      if(after<legacyThrough&&(records.length<=limit||records.at(-1).sequence<=legacyThrough)){
        this.quota.reserve({reads:6*(limit+1)});
        const snapshot=await this.walletRef(guild,user).collection('rounds').where('sequence','>',after)
          .where('sequence','<',before).where('sequence','<=',Math.min(through,legacyThrough)).orderBy('sequence','desc').limit(limit+1).get();
        for(const doc of snapshot.docs)records.push({sequence:doc.get('sequence'),round:unpack(doc)});
      }
      records.sort((a,b)=>b.sequence-a.sequence);
      this.quota.observe(Buffer.byteLength(JSON.stringify(records)));
      const rows=records.slice(0,limit);return {rows,next:records.length>limit?rows.at(-1).sequence:null};
    }catch(error){throw this.safe(error);}
  },
  async history(guild,user,before=Number.MAX_SAFE_INTEGER){
    this.validate(guild,user);if(!Number.isSafeInteger(before)||before<1)throw problem(400,'無效的紀錄游標。');
    try{return this.schemaVersion===2?await this.queryLedger(guild,user,before,50):await this.query(this.walletRef(guild,user).collection('ledger'),before,50);}catch(error){throw this.safe(error);}
  },
  async auditHistory(guild,user,{category:cat='rewards',before=Number.MAX_SAFE_INTEGER,days=0}={}){
    this.validate(guild,user);
    if(!['rewards','checkin','game','all'].includes(cat)||!Number.isSafeInteger(before)||before<1||![0,1,7,30].includes(days))throw problem(400,'無效的紀錄查詢條件。','AUDIT_FILTER');
    try{
      const ref=this.walletRef(guild,user),now=this.clock();
      const rows=await readAuditPage({category:cat,before,
        days:Array.from({length:days},(_,i)=>taipeiDay(now-i*86400000)),
        query:(name,cursor,limit)=>this.schemaVersion===2?this.queryLedger(guild,user,cursor,limit,
          {category:cat,day:/\d{4}-\d{2}-\d{2}$/.exec(name)?.[0],displayCodes:true}):this.query(ref.collection(name),cursor,limit)});
      const selected=rows.slice(0,10);
      for(const row of selected)if(row.kind==='grant'){const reversal=await this.read(this.root.collection('reversals').doc(String(row.id)));row.reversal_id=reversal?.entryId||null;if(reversal?.recordCode)row.reversalCode=reversal.recordCode;}
      return {rows:selected,next:rows.length>10?selected[9].id:null};
    }catch(error){throw this.safe(error);}
  },
  async auditSummary(guild,user,days=0){
    this.validate(guild,user);if(![0,1,7,30].includes(days))throw problem(400,'無效的紀錄查詢期間。','AUDIT_FILTER');
    try{
      if(!days)return (await this.read(this.walletRef(guild,user)))?.summary||zeroSummary();
      const now=this.clock(),field='__name__',first=taipeiDay(now-(days-1)*86400000),last=taipeiDay(now);
      // ISO day document IDs already form a single-field date index. A range
      // query reads only existing days instead of billing missing point reads.
      return await this.db.runTransaction(async tx=>{
        const ref=this.walletRef(guild,user),wallet=await this.read(ref,tx);
        this.quota.reserve({reads:6*days});
        const snapshot=await tx.get(ref.collection('days').where(field,'>=',first).where(field,'<=',last).limit(days));
        const daily=new Map(snapshot.docs.map(doc=>[doc.id,unpack(doc)]));
        this.quota.observe(Buffer.byteLength(JSON.stringify([...daily])));
        if(wallet?.pendingDay&&wallet.pendingDay.day>=first&&wallet.pendingDay.day<=last)daily.set(wallet.pendingDay.day,wallet.pendingDay.summary);
        const result=zeroSummary();for(const data of daily.values()){
        for(const group of ['checkin','game'])for(const key of Object.keys(result[group]))result[group][key]+=data[group][key];
        }return result;
      },{readOnly:true});
    }catch(error){throw this.safe(error);}
  },
};
