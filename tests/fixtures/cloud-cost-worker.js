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
export class CloudCostFixture extends DurableObject {
  async fetch(request){
    let written=0,read=0;const sql=this.ctx.storage.sql;
    const storage={sql:{exec:(query,...args)=>{const cursor=sql.exec(query,...args);written+=cursor.rowsWritten;const rows=[...cursor];read+=cursor.rowsRead;return rows;}},transactionSync:fn=>this.ctx.storage.transactionSync(fn)};
    const path=new URL(request.url).pathname,previous=path.endsWith('/previous'),spins=path.startsWith('/spins/');
    let now=Date.parse('2026-10-31T00:00:00Z');
    const guild='100000000000000001',user='100000000000000002',state=new CloudState(storage),q=new CloudQuota(storage,state,{clock:()=>now});
    q.seed({projectId:'demo-jokers-circus',exportedAt:now,scopes:Object.fromEntries(Object.entries(QUOTA_LIMITS).map(([scope,limits])=>[scope,{limits,growth:0,usage:[],documents:[]}]))},'demo-jokers-circus');q.enableNotificationsOnly({allowPaidUsage:true});
    const sealer=new Sealer('a'.repeat(64)),Sessions=previous?PreviousSessions:CloudSessions,sessions=new Sessions(storage,sealer),token='a'.repeat(43),key=createHash('sha256').update(token).digest('hex');
    sessions.set(key,{guild,user,expires:now+3600000,checked:now,count:0,window:now,profile:{name:'isolated fixture'},accessToken:'not-a-real-token'});
    const service=new WalletService({assertGuild:()=>{}},{sessions,clock:()=>now,fetchImpl:()=>{throw new Error('No Discord call permitted');}});
    const settings={projectId:'demo-jokers-circus',namespace:'cost-test',environment:'test',schemaVersion:2},documents=new Map();
    let firestoreReads=0,firestoreWrites=0;
    const db=new FirestoreRest({...settings,emulator:'127.0.0.1:8787',fetchImpl:async(url,options)=>{
      const body=JSON.parse(options.body);
      if(url.endsWith(':batchGet')){firestoreReads+=body.documents.length;return Response.json([...(body.newTransaction?[{transaction:'isolated-cost'}]:[]),...body.documents.map(name=>documents.has(name)?{found:documents.get(name)}:{missing:name})]);}
      if(url.endsWith(':commit')){for(const w of body.writes){if(w.currentDocument?.exists===false&&documents.has(w.update.name))throw new Error('Duplicate fixture commit');documents.set(w.update.name,w.update);}firestoreWrites+=body.writes.length;return Response.json({});}
      if(url.endsWith(':rollback'))return Response.json({});
      throw new Error('Unexpected fixture transport request');
    }});
    const base=db.prefix+'/circus_wallet_v1/cost-test',summary={checkin:{days:0,total:0},game:{rounds:0,bet:0,payout:0,net:0}};
    for(const [path,data] of [['meta/state',{version:2,environment:'test',status:'ready',nextId:1,compactSettlements:true}],['wallets/'+guild+'_'+user,{guild,user,balance:1000000,last_spin:0,milestone:false,claimedDay:null,revision:1,historyRevision:0,historyCache:encodeHistory([]),summary}]]){const name=base+'/'+path;documents.set(name,{name,fields:{json:{stringValue:JSON.stringify(data)}}});}
    const store=new FirestoreWalletCore(settings,{db,quota:q,guildIds:[guild],clock:()=>now});
    const initial=q.status().used;written=0;read=0;
    for(let i=0;i<100;i++){
      now+=2001;const authorized=await service.authorize('Bearer '+token);if(authorized.user!==user)throw new Error('Identity changed');
      if(spins)await store.transact(guild,user,{kind:'spin',bet:20,requestId:'isolated-cost-spin-'+String(i).padStart(4,'0'),fingerprint:'20',roundId:'isolated-round-'+i,outcome:roundFromStops(20,[0,0,0,0,0])},{compact:true});
    }
    const rowsWritten=written,rowsRead=read,current=q.status().used,wallet=JSON.parse(documents.get(base+'/wallets/'+guild+'_'+user).fields.json.stringValue);
    return Response.json({requests:100,rowsWritten,rowsRead,rowsWrittenPerRequest:rowsWritten/100,firestoreReads,firestoreWrites,used:Object.fromEntries(Object.keys(current).map(k=>[k,current[k]-initial[k]])),balance:wallet.balance,rounds:wallet.summary.game.rounds,persistedSession:new Sessions(storage,sealer).get(key)});
  }
}
export default {fetch(request,env){return env.COST.get(env.COST.idFromName(new URL(request.url).pathname)).fetch(request);}};
