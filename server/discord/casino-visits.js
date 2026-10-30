import {randomUUID} from 'node:crypto';
import {playerName,playerMention,playerMentions} from './player-display.js';
import {problem} from '../wallet/wallet-common.js';

export const VISIT_HEARTBEAT_MS=45000,VISIT_TIMEOUT_MS=180000,VISIT_CLOSE_GRACE_MS=10000;
const id=value=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value||''),keyOf=session=>session.guild+':'+session.user;
const fmt=value=>value.toLocaleString('en-US'),signed=value=>(value>0?'+':'')+fmt(value);
const account=value=>{for(const k of ['balance','net','rounds','bet','payout'])if(!Number.isSafeInteger(value?.[k]))throw new Error('Invalid visit account');return value;};

export function casinoVisitStatus(data){
  if(!data)return null;
  const status={activeVisits:Object.keys(data.visits).length,pending:0,oldestPendingAt:null,uncertain:0};
  for(const event of data.events){
    if(event.status==='uncertain')status.uncertain++;
    if(event.status==='pending'){
      status.pending++;
      status.oldestPendingAt=Math.min(status.oldestPendingAt??event.at,event.at);
    }
  }
  return status;
}
export function visitMessage(visit,end,reason){
  const name=playerMention(visit.user)||`**${playerName(visit.name)}**`,allowed_mentions=playerMentions([visit.user]);
  if(!end)return {content:`♠ ${name} 進入賭場，歡迎入座！`,allowed_mentions};
  account(end);const net=end.net-visit.start.net,rounds=end.rounds-visit.start.rounds;
  if(!Number.isSafeInteger(net)||rounds<0)throw new Error('Visit accounting moved backwards');
  const goodbye=reason==='timeout'?`♣ ${name} 暫時離開賭場，先替你收好這趟的帳目。`:`♣ ${name} 離開賭場，下次見！`;
  const result=rounds===0?'這次還沒下注。':`本次輸贏：**${signed(net)} 戲籌**${net===0?'（不賺不賠）':''} · 共玩 **${fmt(rounds)} 局**`;
  return {content:`${goodbye}\n${result}\n手上戲籌：**${fmt(end.balance)}**`,allowed_mentions};
}

// Devices share one visit; only entry/exit read the authoritative ledger.
export class CasinoVisits {
  constructor({state,bot,readAccount,clock=Date.now,wake=()=>{},warn=()=>{}}){
    Object.assign(this,{state,bot,readAccount,clock,wake,warn});this.tail=Promise.resolve();this.running=null;
    this.data=state.get('casino-visits')||{version:1,visits:{},closed:{},events:[],nextAttempt:0};
    if(this.data.version!==1)throw new Error('Unknown casino visit state');
    let changed=false;for(const e of this.data.events)if(e.status==='sending'){e.status='uncertain';changed=true;}
    if(changed)this.save();
  }
  save(){this.state.set('casino-visits',this.data);}
  serial(task){const next=this.tail.then(task);this.tail=next.catch(()=>{});return next;}
  prune(){const now=this.clock();this.data.events=this.data.events.filter(e=>e.status==='pending'||e.status==='sending'||now-e.at<86400000);}
  enqueue(payload){
    this.prune();
    // Completed receipts must not turn a queue bound into a daily visit limit.
    while(this.data.events.length>=256){
      const receipt=this.data.events.findIndex(e=>e.status==='sent');
      if(receipt<0)throw problem(503,'公告佇列暫時已滿，遊戲仍可使用。');
      this.data.events.splice(receipt,1);
    }
    this.data.events.push({id:randomUUID(),at:this.clock(),payload,status:'pending'});
  }
  async finish(key,visit,reason){
    const end=account(await this.readAccount(visit.guild,visit.user));
    this.enqueue(visitMessage(visit,end,reason));delete this.data.visits[key];this.save();
  }
  request(session,input){return this.serial(async()=>{
    if(session.guild!==this.bot.guild)throw problem(403,'此群組未開啟賭場公告。');
    if(!input||!id(input.instanceId)||!['enter','heartbeat','leave'].includes(input.action))throw problem(400,'遊戲連線狀態無效。');
    const key=keyOf(session),now=this.clock();let visit=this.data.visits[key];
    const instanceKey=key+':'+input.instanceId;
    for(const [instance,until] of Object.entries(this.data.closed))if(until<=now)delete this.data.closed[instance];
    if(input.action==='leave'){
      if(Object.keys(this.data.closed).length>=1024&&!this.data.closed[instanceKey])throw problem(429,'公告操作過於頻繁。');
      this.data.closed[instanceKey]=now+VISIT_TIMEOUT_MS;this.save();
    }else if(this.data.closed[instanceKey]>now)return {enabled:true,active:false,closed:true};
    if(visit&&this.deadline(visit)<=now){await this.finish(key,visit,visit.closing?'closed':'timeout');visit=null;}
    if(input.action==='enter'){
      if(!visit){
        if(Object.keys(this.data.visits).length>=128)throw problem(503,'公告連線數已達上限，遊戲仍可使用。');
        const start=account(await this.readAccount(session.guild,session.user));
        visit={guild:session.guild,user:session.user,name:String(session.profile?.name||'玩家').slice(0,160),start,leases:{},closing:0};
        this.enqueue(visitMessage(visit));this.data.visits[key]=visit;
      }
      // Expired instances cannot keep a disconnected tab alive indefinitely.
      for(const [instance,expires] of Object.entries(visit.leases))if(expires<=now)delete visit.leases[instance];
      if(!visit.leases[input.instanceId]&&Object.keys(visit.leases).length>=8)throw problem(429,'遊戲分頁過多。');
      visit.leases[input.instanceId]=Math.min(session.expires,now+VISIT_TIMEOUT_MS);visit.closing=0;this.save();
    }else if(visit&&visit.leases[input.instanceId]>now){
      if(input.action==='leave'){
        delete visit.leases[input.instanceId];
        if(!Object.values(visit.leases).some(expires=>expires>now))visit.closing=now+VISIT_CLOSE_GRACE_MS;
      }else visit.leases[input.instanceId]=Math.min(session.expires,now+VISIT_TIMEOUT_MS);
      this.save();
    }
    if(input.action!=='heartbeat')this.wake();
    return {enabled:true,active:Boolean(visit?.leases[input.instanceId]>now),heartbeatMs:VISIT_HEARTBEAT_MS};
  });}
  deadline(visit){return visit.closing||Math.max(0,...Object.values(visit.leases));}
  sweep(){return this.serial(async()=>{
    const now=this.clock();let count=0;
    for(const [key,visit] of Object.entries(this.data.visits))if(this.deadline(visit)<=now){await this.finish(key,visit,visit.closing?'closed':'timeout');if(++count>=4)break;}
  });}
  flush(){
    this.running ||= this.deliver().catch(()=>this.warn('Casino announcement delivery unavailable')).finally(()=>{this.running=null;});return this.running;
  }
  async deliver(){
    for(let i=0;i<5;i++){
      const event=await this.serial(()=>{
        if(this.data.nextAttempt>this.clock())return null;
        const e=this.data.events.find(e=>e.status==='pending');if(!e)return null;e.status='sending';this.save();return structuredClone(e);
      });
      if(!event)return;
      let outcome;try{outcome=await this.bot.send(event.payload,'visit:'+event.id);}catch{outcome={kind:'uncertain'};}
      await this.serial(()=>{
        const e=this.data.events.find(e=>e.id===event.id);if(!e)return;
        e.status=outcome.kind==='retry'?'pending':outcome.kind;e.messageId=outcome.messageId;
        this.data.nextAttempt=this.clock()+(outcome.kind==='retry'?outcome.delay:1000);this.save();
      });
      if(outcome.kind!=='sent')return;
    }
  }
  nextDelay(){
    const due=Object.values(this.data.visits).map(v=>this.deadline(v));
    if(this.data.events.some(e=>e.status==='pending'))due.push(this.data.nextAttempt);
    return due.length?Math.max(1000,Math.min(...due)-this.clock()):600000;
  }
  status(){return casinoVisitStatus(this.data);}
}
