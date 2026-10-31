import {DurableObject} from 'cloudflare:workers';
import {createHash} from 'node:crypto';
import {CloudState,CloudSessions,Sealer} from '../../cloud/storage.js';
import {CloudQuota,QUOTA_LIMITS} from '../../cloud/quota.js';
import {WalletService} from '../../server/wallet/wallet-service.js';
import {FirestoreRest} from '../../cloud/firestore-rest.js';
import {FirestoreWalletCore} from '../../server/firestore/wallet-core.js';
import {encodeHistory} from '../../server/firestore/schema.js';
import {roundFromStops} from '../../src/game/index.js';

// Reproduce the published 1.0.0 session persistence solely for cost comparison.
// Both variants use the current authorization and authoritative settlement code.
class PreviousSessions extends CloudSessions {
  set(key,value){
    const previous=this.get(key);
    if(previous?.window>value.window){value.window=previous.window;value.count=previous.count;}
    else if(previous&&previous.window===value.window)value.count=Math.max(previous.count||0,value.count||0);
    this.sql.exec('INSERT INTO sessions VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET expires=excluded.expires,value=excluded.value',key,value.expires,this.sealer.seal(value,'session:'+key));
  }
}
// The released 1.0.1 quota layout, using the same current reservation logic.
class PreviousQuota extends CloudQuota {
  documentBytes(scope,key){return [...this.sql.exec('SELECT bytes FROM quota_documents WHERE scope=? AND key=?',scope,key)][0]?.bytes||0;}
  recordDocument(scope,key,bytes){this.sql.exec('INSERT INTO quota_documents VALUES(?,?,?) ON CONFLICT(scope,key) DO UPDATE SET bytes=MAX(bytes,excluded.bytes)',scope,key,bytes);}
}
export class CloudCostFixture extends DurableObject {
  async fetch(request){
    let written=0,read=0;const sql=this.ctx.storage.sql,statements=new Map();
    const storage={sql:{exec:(query,...args)=>{const cursor=sql.exec(query,...args),rows=[...cursor];written+=cursor.rowsWritten;read+=cursor.rowsRead;const stats=statements.get(query)||{calls:0,rowsWritten:0,rowsRead:0};stats.calls++;stats.rowsWritten+=cursor.rowsWritten;stats.rowsRead+=cursor.rowsRead;statements.set(query,stats);return rows;}},transactionSync:fn=>this.ctx.storage.transactionSync(fn)};
    const path=new URL(request.url).pathname,previous=path.endsWith('/previous'),spins=path.startsWith('/spins/'),Quota=path.endsWith('/optimized')?CloudQuota:PreviousQuota;
    let now=Date.parse('2026-10-31T00:00:00Z');
    const guild='100000000000000001',user='100000000000000002',state=new CloudState(storage),q=new Quota(storage,state,{clock:()=>now});
    q.seed({projectId:'demo-jokers-circus',exportedAt:now,scopes:Object.fromEntries(Object.entries(QUOTA_LIMITS).map(([scope,limits])=>[scope,{limits,growth:0,usage:[],documents:[]}]))},'demo-jokers-circus');q.enableNotificationsOnly({allowPaidUsage:true});
    const sealer=new Sealer('a'.repeat(64)),Sessions=previous?PreviousSessions:CloudSessions,sessions=new Sessions(storage,sealer),token='a'.repeat(43),key=createHash('sha256').update(token).digest('hex');
    sessions.set(key,{guild,user,expires:now+3600000,checked:now,count:0,window:now,profile:{name:'isolated fixture'},accessToken:'not-a-real-token'});
    const service=new WalletService({assertGuild:()=>{}},{sessions,clock:()=>now,fetchImpl:()=>{throw new Error('No Discord call permitted');}});
    const settings={projectId:'demo-jokers-circus',namespace:'cost-test',environment:'test',schemaVersion:2},documents=new Map();
    let firestoreReads=0,firestoreWrites=0,commitAttempts=0,commitFault=null;
    const db=new FirestoreRest({...settings,emulator:'127.0.0.1:8787',fetchImpl:async(url,options)=>{
      const body=JSON.parse(options.body);
      if(url.endsWith(':batchGet')){firestoreReads+=body.documents.length;return Response.json([...(body.newTransaction?[{transaction:'isolated-cost'}]:[]),...body.documents.map(name=>documents.has(name)?{found:documents.get(name)}:{missing:name})]);}
      if(url.endsWith(':commit')){
        commitAttempts++;const fault=commitFault;commitFault=null;
        if(fault==='aborted')return Response.json({error:{status:'ABORTED'}},{status:409});
        for(const w of body.writes)if(w.currentDocument?.exists===false&&documents.has(w.update.name))throw new Error('Duplicate fixture commit');
        for(const w of body.writes)documents.set(w.update.name,w.update);firestoreWrites+=body.writes.length;
        if(fault==='unknown')throw new Error('Response lost after commit');
        return Response.json({});
      }
      if(url.endsWith(':rollback'))return Response.json({});
      throw new Error('Unexpected fixture transport request');
    }});
    const base=db.prefix+'/circus_wallet_v1/cost-test',summary={checkin:{days:0,total:0},game:{rounds:0,bet:0,payout:0,net:0}};
    for(const [path,data] of [['meta/state',{version:2,environment:'test',status:'ready',nextId:1,compactSettlements:true}],['wallets/'+guild+'_'+user,{guild,user,balance:1000000,last_spin:0,milestone:false,claimedDay:null,revision:1,historyRevision:0,historyCache:encodeHistory([]),summary}]]){const name=base+'/'+path;documents.set(name,{name,fields:{json:{stringValue:JSON.stringify(data)}}});}
    const store=new FirestoreWalletCore(settings,{db,quota:q,guildIds:[guild],clock:()=>now});
    const initial=q.status().used;written=0;read=0;statements.clear();
    const operation=i=>({kind:'spin',bet:20,requestId:'isolated-cost-spin-'+String(i).padStart(4,'0'),fingerprint:'20',roundId:'isolated-round-'+i,outcome:roundFromStops(20,[0,0,0,0,0])});
    for(let i=0;i<100;i++){
      now+=2001;const authorized=await service.authorize('Bearer '+token);if(authorized.user!==user)throw new Error('Identity changed');
      if(spins)await store.transact(guild,user,operation(i),{compact:true});
    }
    const rowsWritten=written,rowsRead=read,sqlBreakdown=[...statements].map(([query,stats])=>({query,...stats})),current=q.status().used,wallet=JSON.parse(documents.get(base+'/wallets/'+guild+'_'+user).fields.json.stringValue);
    const result={requests:100,rowsWritten,rowsRead,rowsWrittenPerRequest:rowsWritten/100,sqlBreakdown,firestoreReads,firestoreWrites,used:Object.fromEntries(Object.keys(current).map(k=>[k,current[k]-initial[k]])),balance:wallet.balance,rounds:wallet.summary.game.rounds,persistedSession:new Sessions(storage,sealer).get(key)};
    if(spins){
      const check=(ok,message)=>{if(!ok)throw new Error(message);},failed=async(action,code)=>{try{await action();}catch(error){check(error.code===code,'Unexpected error: '+error.code);return;}throw new Error('Expected '+code);};
      const attempts=commitAttempts,charges=q.status().used.writes;
      const replay=await store.transact(guild,user,operation(99),{compact:true});check(replay.duplicate&&replay.round.id==='isolated-round-99','Replay changed the result');
      await failed(()=>store.transact(guild,user,{...operation(99),bet:40,fingerprint:'40'},{compact:true}),'REQUEST_CONFLICT');
      check(commitAttempts===attempts&&q.status().used.writes===charges,'Replay or conflicting request attempted a write');
      now+=2001;commitFault='unknown';
      await failed(()=>store.transact(guild,user,operation(100),{compact:true}),'FIRESTORE_UNAVAILABLE');
      check(commitAttempts===attempts+1&&q.status().used.writes===charges+8,'Unknown commit was retried or refunded');
      const reopened=new Quota(storage,new CloudState(storage),{clock:()=>now}),restarted=new FirestoreWalletCore(settings,{db,quota:reopened,guildIds:[guild],clock:()=>now});
      const recovered=await restarted.transact(guild,user,operation(100),{compact:true});
      check(recovered.duplicate&&recovered.round.id==='isolated-round-100'&&commitAttempts===attempts+1&&reopened.status().used.writes===charges+8,'Restart lost the original receipt or quota');
      now+=2001;commitFault='aborted';await restarted.transact(guild,user,operation(101),{compact:true});
      check(commitAttempts===attempts+3&&reopened.status().used.writes===charges+24,'ABORTED attempt lost its charge');
      const final=JSON.parse(documents.get(base+'/wallets/'+guild+'_'+user).fields.json.stringValue);
      check(final.summary.game.rounds===102&&final.balance===wallet.balance-40,'Financial result changed');
      result.protections={replay:true,conflict:true,unknownCommit:true,reconstructedReceipt:true,abortedRetry:true,retainedWriteReservations:24,finalRounds:102,finalBalance:final.balance,documentsDigest:createHash('sha256').update(JSON.stringify([...documents].sort(([a],[b])=>a.localeCompare(b)))).digest('hex')};
    }
    return Response.json(result);
  }
}
export default {fetch(request,env){return env.COST.get(env.COST.idFromName(new URL(request.url).pathname)).fetch(request);}};
