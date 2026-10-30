import {randomUUID} from 'node:crypto';
import {highlightCard,highlightTier,HIGHLIGHT_INTERVAL_MS,HIGHLIGHT_WINDOW_MS,HIGHLIGHT_MAX_AGE_MS,HIGHLIGHT_VISIBLE} from '../discord/highlight-card.js';
import {highlightEventPath,highlightEventIndex,assertHighlightEvent,assertHighlightBoard} from './highlight-data.js';
import {CasinoBot} from '../discord/casino-bot.js';
import {highlightAnnouncement} from '../discord/highlight-card.js';
const snowflake=value=>/^\d{17,20}$/.test(value||'');
const batchSize=5,leaseMs=60000;
const blank=guild=>({guild,message_id:null,started:0,total:0,entries:'[]',next_attempt:0});
export class FirestoreHighlights {
  constructor(store,{guild,webhookUrl,botSettings,bot,fetchImpl=globalThis.fetch.bind(globalThis),clock=Date.now,warn=message=>console.warn(message),ownsStore=false}){
    store.assertGuild(guild);Object.assign(this,{store,guild,webhookUrl,fetchImpl,clock,warn,ownsStore});
    this.bot=bot||(botSettings?new CasinoBot({...botSettings,fetchImpl,clock}):null);
    this.board=store.root.collection('highlightBoards').doc(guild);
    this.dirty=true;this.nextAttempt=0;this.destinationVerified=false;this.running=null;this.timer=null;this.stopping=false;
  }
  // Only a wake-up hint: the event itself was saved in the wallet transaction.
  enqueue(session,roundId,round){if(session.guild!==this.guild||!round||round.id!==roundId||!highlightTier(round.payout,round.bet))return false;this.dirty=true;return true;}
  start(){if(!this.timer){this.timer=setInterval(()=>void this.flush(),HIGHLIGHT_INTERVAL_MS);this.timer.unref();void this.flush();}}
  async close(){this.stopping=true;clearInterval(this.timer);this.timer=null;await this.running;if(this.ownsStore)await this.store.close();}
  flush(){
    if(this.stopping||(!this.dirty&&!this.running)||this.clock()<this.nextAttempt)return this.running||Promise.resolve();
    this.running ||= this.deliver().catch(()=>{
      this.dirty=true;this.nextAttempt=this.clock()+300000;this.warn('Discord highlights: queue unavailable');
    }).finally(()=>{this.running=null;});return this.running;
  }
  async query(tx,status,limit=batchSize){
    const prefix=this.guild+':'+status+':';this.store.quota.reserve({reads:6*limit});
    const result=await tx.get(this.store.root.collection('highlightEvents').where('queueKey','>=',prefix)
      .where('queueKey','<',prefix+'\uf8ff').orderBy('queueKey').limit(limit));
    const rows=result.docs.map(doc=>{
      const row=JSON.parse(doc.get('json'));assertHighlightEvent(row);
      if(row.guild!==this.guild||row.status!==status||doc.id!==row.guild+'_'+row.round_id
        ||doc.get('queueKey')!==highlightEventIndex(row).queueKey)throw new Error('Highlight queue identity mismatch');
      return row;
    });
    this.store.quota.observe(Buffer.byteLength(JSON.stringify(rows)));return rows;
  }
  event(tx,event,status){const row={...event,status};this.store.write(tx,this.store.db.doc(this.store.root.path+'/'+highlightEventPath(row)),row,{index:highlightEventIndex(row)});}
  async claim(){
    return this.store.db.runTransaction(async tx=>{
      const now=this.clock(),board=await this.store.read(this.board,tx)||blank(this.guild);
      assertHighlightBoard(board);if(board.guild!==this.guild)throw new Error('Highlight board identity mismatch');
      if(board.delivery?.until>now)return {wait:board.delivery.until};
      // Expired leases and restored sending events must be resolved before any
      // new network request. Unknown POSTs are never sent again automatically.
      if(board.delivery){
        const events=await this.query(tx,'sending');
        for(const event of events)this.event(tx,event,board.delivery.editing?'pending':'uncertain');
        delete board.delivery;if(board.message_id)board.next_attempt=now;
        this.store.write(tx,this.board,board);return {again:true};
      }
      if(board.next_attempt>now)return {wait:board.next_attempt};
      let sending=await this.query(tx,'sending',1);
      if(sending.length)sending=await this.query(tx,'sending');
      if(sending.length){for(const event of sending)this.event(tx,event,!this.bot&&board.message_id?'pending':'uncertain');return {again:true};}
      const pending=await this.query(tx,'pending',this.bot?1:batchSize);if(!pending.length)return {empty:true};
      const expired=pending.filter(event=>now-event.occurred>HIGHLIGHT_MAX_AGE_MS||event.occurred>now);
      if(expired.length){for(const event of expired)this.event(tx,event,'expired');return {again:true};}
      const editing=!this.bot&&!!board.message_id&&now-board.started<HIGHLIGHT_WINDOW_MS;
      const entries=[...pending].reverse().map(({name,tier,multiplier})=>({name,tier,multiplier}));
      entries.push(...(editing?JSON.parse(board.entries):[]));entries.splice(HIGHLIGHT_VISIBLE);
      const delivery={id:randomUUID(),until:now+leaseMs,editing,events:pending.map(event=>event.round_id),
        entries:JSON.stringify(entries),total:pending.length+(editing?board.total:0),started:editing?board.started:now};
      const saved=editing?{...board}:{guild:this.guild,message_id:null,started:now,total:delivery.total,entries:delivery.entries,next_attempt:now+HIGHLIGHT_WINDOW_MS};
      saved.delivery=delivery;
      for(const event of pending)this.event(tx,event,'sending');this.store.write(tx,this.board,saved);
      return {board:saved,delivery,pending};
    },{maxAttempts:3});
  }
  async finish(claim,{kind,messageId,delay=60000}){
    const {delivery,pending}=claim;
    await this.store.db.runTransaction(async tx=>{
      const board=await this.store.read(this.board,tx);
      if(board?.delivery?.id!==delivery.id)return;
      const now=this.clock();delete board.delivery;
      if(kind==='sent')Object.assign(board,{message_id:messageId,started:delivery.started,total:delivery.total,entries:delivery.entries,next_attempt:now+HIGHLIGHT_INTERVAL_MS});
      else if(kind==='missing')Object.assign(board,blank(this.guild),{next_attempt:now+HIGHLIGHT_INTERVAL_MS});
      else if(delivery.editing)board.next_attempt=Math.min(Number.MAX_SAFE_INTEGER,now+delay);
      else if(kind==='retry')Object.assign(board,blank(this.guild),{next_attempt:Math.min(Number.MAX_SAFE_INTEGER,now+delay)});
      else if(this.bot&&kind==='uncertain')board.next_attempt=now+HIGHLIGHT_INTERVAL_MS;
      // For an ambiguous create, retain the whole-window guard persisted before POST.
      for(const event of pending)this.event(tx,event,kind==='sent'?'sent':kind==='uncertain'&&!delivery.editing?'uncertain':'pending');
      this.store.write(tx,this.board,board);
    },{maxAttempts:3});
  }
  async deliver(){
    // Clear before awaiting so a settlement during this run cannot lose its hint.
    this.dirty=false;
    if(!this.bot&&!this.destinationVerified){
      try{
        const response=await this.fetchImpl(this.webhookUrl,{signal:AbortSignal.timeout(8000),redirect:'error'});
        const webhook=response.ok?await response.json():null;
        if(webhook?.type!==1||webhook.guild_id!==this.guild||!snowflake(webhook.channel_id))throw new Error('destination');
        this.destinationVerified=true;
      }catch{this.dirty=true;this.nextAttempt=this.clock()+300000;this.warn('Discord highlights: dedicated channel unavailable');return;}
    }
    const claim=await this.claim();
    if(claim.empty)return;
    this.dirty=true;
    if(claim.wait){this.nextAttempt=claim.wait;return;}
    if(claim.again){this.nextAttempt=this.clock()+HIGHLIGHT_INTERVAL_MS;return;}
    if(this.bot){
      const event=claim.pending[0],outcome=await this.bot.send(highlightAnnouncement(event),'win:'+this.guild+':'+event.round_id);
      await this.finish(claim,outcome);this.nextAttempt=this.clock()+(outcome.delay||HIGHLIGHT_INTERVAL_MS);return;
    }
    const {board,delivery}=claim,payload=highlightCard(JSON.parse(delivery.entries),delivery.total);
    if(delivery.editing)delete payload.flags;else payload.username='Joker’s Circus';
    const url=delivery.editing?`${this.webhookUrl}/messages/${board.message_id}`:`${this.webhookUrl}?wait=true`;
    let response,outcome;
    try{response=await this.fetchImpl(url,{method:delivery.editing?'PATCH':'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload),signal:AbortSignal.timeout(8000),redirect:'error'});}
    catch{outcome={kind:'uncertain'};}
    if(response?.ok){
      let result;try{result=await response.json();}catch{}
      const messageId=delivery.editing?board.message_id:result?.id;
      outcome=snowflake(messageId)?{kind:'sent',messageId}:{kind:'uncertain'};
    }else if(response){
      if(response.status===429){
        let retry;try{retry=Number((await response.json()).retry_after);}catch{}
        outcome={kind:'retry',delay:Number.isFinite(retry)&&retry>0?Math.min(Number.MAX_SAFE_INTEGER,Math.max(HIGHLIGHT_INTERVAL_MS,Math.ceil(retry*1000))):60000};
      }else if(delivery.editing&&response.status===404)outcome={kind:'missing'};
      else if([400,401,403,404].includes(response.status))outcome={kind:'retry',delay:300000};
      else outcome={kind:'uncertain'};
      this.warn(`Discord highlights: HTTP ${response.status}`);
    }else this.warn('Discord highlights: delivery uncertain');
    await this.finish(claim,outcome);
    this.nextAttempt=Math.min(Number.MAX_SAFE_INTEGER,this.clock()+(outcome.kind==='sent'||outcome.kind==='missing'?HIGHLIGHT_INTERVAL_MS:outcome.kind==='uncertain'&&!delivery.editing?HIGHLIGHT_WINDOW_MS:outcome.delay||60000));
  }
}
