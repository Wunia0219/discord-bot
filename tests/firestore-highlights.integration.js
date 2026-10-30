import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,mkdirSync,rmSync,readFileSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {FirestoreWalletStore} from '../server/firestore/wallet.js';
import {firestoreSettings} from '../server/firestore/settings.js';
import {FirestoreHighlights,firestoreHighlightsConfig} from '../server/firestore/highlights.js';
import {highlightEventPath} from '../server/firestore/highlight-data.js';
import {roundFromStops} from '../src/game/index.js';
import {HIGHLIGHT_INTERVAL_MS,HIGHLIGHT_WINDOW_MS,HIGHLIGHT_MAX_AGE_MS} from '../server/discord/highlight-card.js';
import {operationsSettings} from '../server/operations/operations-settings.js';
import {MaintenanceQuota,performFirestoreMaintenance} from '../server/firestore/backup.js';
import {firestoreImportPlan,importFirestore} from '../server/firestore/import.js';
import {createActivityServer} from '../server/http/app.js';
import {firestoreWalletConfig} from '../server/firestore/config.js';

assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8787');
const guild='100000000000000001',user='100000000000000002',other='100000000000000003',messageId='100000000000000004';
const webhookUrl='https://discord.com/api/webhooks/100000000000000005/emulator-only-secret';
const examples=JSON.parse(readFileSync(new URL('../docs/data/math-report.json',import.meta.url))).examples;
async function fixture(t){
  const root=resolve('test-results/firestore-highlights');mkdirSync(root,{recursive:true});const directory=mkdtempSync(join(root,'case-'));
  let now=Date.now();const stores=[],workers=[],calls=[],warnings=[];
  const env={WALLET_ENABLED:'true',WALLET_BACKEND:'firestore',APP_ENV:'test',FIRESTORE_SCHEMA_VERSION:'2',
    FIRESTORE_PROJECT_ID:'demo-jokers-circus',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8787',
    FIRESTORE_NAMESPACE:'highlights-'+randomUUID()+'-test',FIRESTORE_QUOTA_PATH:join(directory,'quota.sqlite'),BACKUP_DIRECTORY:join(directory,'backups')};
  const settings=firestoreSettings(env);
  const create=async(config=settings)=>{const s=new FirestoreWalletStore(config,{guildIds:[guild,other],spinDelay:0,clock:()=>now});stores.push(s);await s.initialize();return s;};
  const s=await create();s.highlightsGuild=guild;await s.state(guild,user);
  const worker=(store=s,send)=>{
    const q=new FirestoreHighlights(store,{guild,webhookUrl,clock:()=>now,warn:text=>warnings.push(text),fetchImpl:async(url,options={})=>{
      if(!options.method)return Response.json({type:1,guild_id:guild,channel_id:other});
      const call={url,method:options.method,payload:JSON.parse(options.body)};calls.push(call);
      return send?send(call):Response.json({id:messageId});
    }});workers.push(q);return q;
  };
  const settle=async(tier='super',options={})=>{
    const requestId=options.requestId||randomUUID();
    return s.transact(options.guild||guild,user,{kind:'spin',requestId,fingerprint:'20',bet:20,
      outcome:roundFromStops(20,examples[tier].stops),roundId:randomUUID()},{compact:true,profileName:options.name||'驗證暱稱'});
  };
  const event=result=>s.read(s.db.doc(s.root.path+'/'+highlightEventPath({guild,round_id:result.round.id})));
  t.after(async()=>{for(const q of workers)await q.close();for(const store of stores)await store.close();assert.ok(directory.startsWith(root+sep));rmSync(directory,{recursive:true,force:true});});
  return {s,env,settings,directory,create,worker,settle,event,calls,warnings,workers,stores,advance:ms=>{now+=ms;}};
}

test('Firestore atomically saves qualifying outbox events, keeps ordinary spins at six writes, and replays without new writes',async t=>{
  const h=await fixture(t);let before=h.s.quota.status().used.writes;
  const ordinary=await h.settle('small');assert.equal(h.s.quota.status().used.writes-before,12);assert.equal(await h.event(ordinary),null);
  before=h.s.quota.status().used.writes;const requestId=randomUUID(),win=await h.settle('mega',{requestId});
  assert.equal(h.s.quota.status().used.writes-before,14);const saved=await h.event(win);assert.equal(saved.status,'pending');assert.equal(saved.tier,'mega');
  assert.deepEqual(Object.keys(saved).sort(),['guild','round_id','name','tier','multiplier','occurred','status'].sort());
  assert.equal((await h.s.root.collection('highlightEvents').doc(guild+'_'+win.round.id).get()).get('recipientId'),user);
  before=h.s.quota.status().used.writes;const repeat=await h.settle('mega',{requestId,name:'must not overwrite'});
  assert.equal(repeat.duplicate,true);assert.deepEqual(repeat.round,win.round);assert.equal(h.s.quota.status().used.writes,before);
  assert.deepEqual(await h.event(win),saved);assert.equal((await h.s.read(h.s.meta)).highlights,1);
  const cross=await h.settle('mega',{guild:other});assert.equal(await h.s.read(h.s.root.collection('highlightEvents').doc(other+'_'+cross.round.id)),null);
  const q=h.worker();assert.equal(q.enqueue({guild},ordinary.round.id,ordinary.round),false);
  // No enqueue hint is needed: a fresh worker discovers a commit after a lost response.
  await q.flush();assert.equal(h.calls.length,1);assert.equal((await h.event(win)).status,'sent');
  h.advance(HIGHLIGHT_INTERVAL_MS);await q.flush();const idle=h.s.quota.status().used;
  for(let i=0;i<100;i++){h.advance(HIGHLIGHT_INTERVAL_MS);await q.flush();}
  assert.deepEqual(h.s.quota.status().used,idle,'empty queue does not poll Firestore');
});

test('outbox write budget failure aborts the entire spin without losing ledger or dedup consistency',async t=>{
  const h=await fixture(t),wallet=await h.s.read(h.s.walletRef(guild,user)),meta=await h.s.read(h.s.meta);
  h.s.quota.limits.writes=h.s.quota.status().used.writes+13;
  await assert.rejects(h.settle('mega'),{code:'FIRESTORE_BUDGET'});
  assert.deepEqual(await h.s.read(h.s.walletRef(guild,user)),wallet);assert.deepEqual(await h.s.read(h.s.meta),meta);
  assert.equal((await h.s.root.collection('highlightEvents').get()).size,0);
});

test('concurrent retries from separate game processes create one outbox event and one settlement',async t=>{
  const h=await fixture(t),second=await h.create();second.highlightsGuild=guild;
  const operation={kind:'spin',requestId:randomUUID(),fingerprint:'20',bet:20,outcome:roundFromStops(20,examples.mega.stops)};
  const results=await Promise.all([h.s,second].map(s=>s.transact(guild,user,{...operation,roundId:randomUUID()},{compact:true,profileName:'同一玩家'})));
  assert.equal(results.filter(r=>r.duplicate).length,1);assert.deepEqual(results[0].round,results[1].round);
  assert.equal((await h.s.root.collection('highlightEvents').get()).size,1);
  assert.equal((await h.s.auditSummary(guild,user)).game.rounds,1);
});

test('real Firestore server configuration can enable the queue on v1 and v2 without contacting Discord at startup',async t=>{
  const h=await fixture(t);
  for(const version of [1,2]){
    const config=await firestoreWalletConfig({...h.env,FIRESTORE_NAMESPACE:'configured-'+randomUUID()+'-test',FIRESTORE_SCHEMA_VERSION:String(version),
      HOST:'127.0.0.1',ALLOWED_GUILD_IDS:guild,DISCORD_CLIENT_ID:other,DISCORD_CLIENT_SECRET:'fixture-only',DISCORD_PUBLIC_KEY:'a'.repeat(64),
      DISCORD_HIGHLIGHTS_WEBHOOK_URL:webhookUrl});
    h.stores.push(config.store);h.workers.push(config.highlights);
    assert.equal(config.store.highlightsGuild,guild);assert.equal(config.highlights.destinationVerified,false);
    assert.equal(await config.store.isReady(),true);
  }
});

test('durable leases coordinate independent dispatchers and coalesce five recent wins into one ten-minute card',async t=>{
  const h=await fixture(t),q=h.worker(),second=await h.create(),otherWorker=h.worker(second);
  for(let i=0;i<7;i++)await h.settle(i===6?'mega':'super',{name:'玩家 '+i});
  await Promise.all([q.flush(),otherWorker.flush()]);assert.equal(h.calls.length,1);assert.equal(h.calls[0].method,'POST');
  assert.deepEqual(h.calls[0].payload.allowed_mentions,{parse:[],users:[user]});assert.equal(h.calls[0].payload.content,`<@${user}>`);assert.equal(h.calls[0].payload.flags,4096);
  h.advance(HIGHLIGHT_INTERVAL_MS);await Promise.all([q.flush(),otherWorker.flush()]);assert.equal(h.calls.length,2);
  assert.equal(h.calls[1].method,'PATCH');assert.equal(h.calls[1].payload.flags,undefined);assert.equal(h.calls[1].payload.username,undefined);
  assert.match(h.calls[1].payload.embeds[0].footer.text,/7 次/);assert.equal(h.calls[1].payload.embeds[0].fields.length,5);
  const before=h.s.quota.status().used.writes;await q.flush();assert.equal(h.s.quota.status().used.writes,before);
  h.advance(HIGHLIGHT_WINDOW_MS);const win=await h.settle('mega');q.enqueue({guild},win.round.id,win.round);await q.flush();
  assert.equal(h.calls.at(-1).method,'POST');assert.match(h.calls.at(-1).payload.embeds[0].footer.text,/1 次/);
});

test('Discord 429 delay, deleted message recovery, and expired events preserve the wallet result',async t=>{
  const h=await fixture(t);let count=0;
  const q=h.worker(h.s,()=>++count===1?Response.json({retry_after:45},{status:429}):count===3?Response.json({}, {status:404}):Response.json({id:messageId}));
  const win=await h.settle();await q.flush();assert.equal((await h.event(win)).status,'pending');
  h.advance(44000);await q.flush();assert.equal(h.calls.length,1);
  h.advance(1000);await q.flush();assert.equal((await h.event(win)).status,'sent');
  h.advance(HIGHLIGHT_INTERVAL_MS);const next=await h.settle();q.enqueue({guild},next.round.id,next.round);await q.flush();
  assert.equal(h.calls.at(-1).method,'PATCH');assert.equal((await h.event(next)).status,'pending');
  h.advance(HIGHLIGHT_INTERVAL_MS);await q.flush();assert.equal(h.calls.at(-1).method,'POST');
  assert.equal((await h.event(next)).status,'sent');const stale=await h.settle();h.advance(HIGHLIGHT_MAX_AGE_MS+1);
  q.enqueue({guild},stale.round.id,stale.round);await q.flush();assert.equal((await h.event(stale)).status,'expired');
  assert.equal((await h.s.auditSummary(guild,user)).game.rounds,3);
});

test('uncertain creates and abandoned POST leases are quarantined without duplicate public messages',async t=>{
  const h=await fixture(t),q=h.worker(h.s,()=>{throw new Error(webhookUrl);});
  const first=await h.settle();await q.flush();assert.equal((await h.event(first)).status,'uncertain');
  const second=await h.settle();q.enqueue({guild},second.round.id,second.round);h.advance(60000);await q.flush();assert.equal(h.calls.length,1);
  assert.ok(h.warnings.every(text=>!text.includes('emulator-only-secret')));
  h.advance(HIGHLIGHT_WINDOW_MS);const crashed=h.worker();const claim=await crashed.claim();assert.ok(claim.delivery);
  const restarted=h.worker();await restarted.flush();assert.equal(h.calls.length,1);
  h.advance(60001);await restarted.flush();assert.equal((await h.event(second)).status,'uncertain');assert.equal(h.calls.length,1);
});

test('an interrupted PATCH safely retries the same aggregate after restart',async t=>{
  const h=await fixture(t),q=h.worker();await h.settle();await q.flush();h.advance(HIGHLIGHT_INTERVAL_MS);
  const next=await h.settle();const claim=await q.claim();assert.equal(claim.delivery.editing,true);
  // Pretend Discord accepted PATCH but the process died before recording success.
  const expected=claim.delivery;h.advance(60001);const restarted=h.worker();await restarted.flush();
  assert.equal((await h.event(next)).status,'pending');h.advance(HIGHLIGHT_INTERVAL_MS);await restarted.flush();
  assert.equal(h.calls.at(-1).method,'PATCH');assert.match(h.calls.at(-1).payload.embeds[0].footer.text,/2 次/);
  const board=await h.s.read(q.board);assert.equal(board.entries,expected.entries);assert.equal(board.total,expected.total);
  assert.equal((await h.event(next)).status,'sent');
});

test('long rate limits survive restart and corrupted queue routing cannot publish across guilds',async t=>{
  const h=await fixture(t),q=h.worker(h.s,()=>Response.json({retry_after:600.25},{status:429}));
  const win=await h.settle();await q.flush();const board=await h.s.read(q.board);assert.ok(Number.isSafeInteger(board.next_attempt));
  h.advance(300001);const restarted=h.worker();await restarted.flush();assert.equal(h.calls.length,1);
  h.advance(300249);await restarted.flush();assert.equal(h.calls.length,2);assert.equal((await h.event(win)).status,'sent');
  const next=await h.settle(),ref=h.s.root.collection('highlightEvents').doc(guild+'_'+next.round.id),event=await h.event(next);
  await ref.update({json:JSON.stringify({...event,guild:other})});h.advance(HIGHLIGHT_INTERVAL_MS);
  const isolated=h.worker();await isolated.flush();assert.equal(h.calls.length,2);assert.match(h.warnings.at(-1),/queue unavailable/);
});

test('notification allowance is persistent and isolated while the disabled feature costs no extra game writes',async t=>{
  const h=await fixture(t);assert.equal(firestoreHighlightsConfig({},h.s),null);
  assert.throws(()=>firestoreHighlightsConfig({DISCORD_HIGHLIGHTS_WEBHOOK_URL:webhookUrl,DISCORD_HIGHLIGHTS_GUILD_ID:other,LOCAL_WALLET_TEST:'true'},h.s),/fixture/);
  const env={...h.env,DISCORD_HIGHLIGHTS_WEBHOOK_URL:webhookUrl,DISCORD_HIGHLIGHTS_GUILD_ID:guild,FIRESTORE_HIGHLIGHTS_READ_BUDGET:'1'};
  const q=firestoreHighlightsConfig(env,h.s,{fetchImpl:async()=>Response.json({type:1,guild_id:guild,channel_id:other}),warn:()=>{}});h.workers.push(q);
  const first=await h.settle();await q.flush();assert.equal((await h.event(first)).status,'pending');
  const second=await h.settle('big');assert.equal(second.duplicate,undefined);
  assert.throws(()=>q.store.quota.reserve({reads:2}),{code:'FIRESTORE_BUDGET'});
  assert.ok(q.nextAttempt>Date.now());
  q.store.quota.reserve({reads:1});await q.close();
  const reopened=firestoreHighlightsConfig(env,h.s,{warn:()=>{}});h.workers.push(reopened);
  assert.throws(()=>reopened.store.quota.reserve({reads:1}),{code:'FIRESTORE_BUDGET'},'restart must not reset the delivery allowance');
});

test('full and incremental snapshots retain mutable notification state across v2 and v1 restoration',async t=>{
  const h=await fixture(t),q=h.worker(),first=await h.settle('big');await q.flush();
  h.advance(HIGHLIGHT_INTERVAL_MS);const second=await h.settle('big');const claim=await q.claim();assert.equal(claim.delivery.editing,true);
  const settings=operationsSettings(h.env),maintenance=new FirestoreWalletStore(h.settings,{guildIds:[guild],quota:new MaintenanceQuota(settings)});h.stores.push(maintenance);
  const backup=()=>performFirestoreMaintenance(settings,{store:maintenance,forceBackup:true});
  const snapshot=await backup();assert.equal(snapshot.backup?.verified,true,JSON.stringify(snapshot));
  const filename=join(settings.directory,snapshot.backup.file);
  for(const version of [2,1]){
    const plan=firestoreImportPlan(filename,'test',{version}),restored=await h.create({...h.settings,schemaVersion:version,namespace:'queue-restore-'+version+'-'+randomUUID()+'-test'});
    await importFirestore(restored,plan);assert.equal((await restored.read(restored.meta)).highlights,1);
    const row=await restored.read(restored.root.collection('highlightEvents').doc(guild+'_'+second.round.id));assert.equal(row.status,'sending');
    assert.equal((await restored.root.collection('highlightEvents').doc(guild+'_'+second.round.id).get()).get('recipientId'),user,'restoring from SQLite recovers the recipient from the authoritative round owner');
    const worker=h.worker(restored);h.advance(60001);await worker.flush();h.advance(HIGHLIGHT_INTERVAL_MS);await worker.flush();
    assert.equal(h.calls.at(-1).method,'PATCH');assert.match(h.calls.at(-1).payload.embeds[0].footer.text,/2 次/);
    assert.equal((await restored.state(guild,user)).balance,second.state.balance);
  }
  await q.finish(claim,{kind:'sent',messageId});const next=await backup();assert.equal(next.backup?.verified,true,JSON.stringify(next));
  const plan=firestoreImportPlan(join(settings.directory,next.backup.file),'test',{version:2});
  assert.equal(plan.nextId,(await h.s.read(h.s.meta)).nextId);
  assert.equal(plan.resources.find(row=>row.path===highlightEventPath({guild,round_id:second.round.id})).data.status,'sent');
  assert.equal((await h.event(first)).status,'sent');
});

test('HTTP settlement uses the verified Discord profile for the atomic event, ignoring forged client names',async t=>{
  const h=await fixture(t);
  h.s.spin=(g,u,bet,requestId,options)=>h.s.transact(g,u,{kind:'spin',bet,requestId,fingerprint:String(bet),outcome:roundFromStops(bet,examples.mega.stops),roundId:randomUUID()},options);
  const q=h.worker(),server=createActivityServer({wallet:{store:h.s,highlights:q,service:{authorize:async()=>({guild,user,profile:{name:'經驗證的暱稱'}})}}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/spin`,{method:'POST',headers:{'Content-Type':'application/json','X-Wallet-View':'compact-v1'},body:JSON.stringify({bet:20,requestId:randomUUID(),profileName:'偽造',profile:{name:'偽造'}})});
  assert.equal(response.status,200);const result=await response.json();assert.equal((await h.event(result)).name,'經驗證的暱稱');
  await q.flush();assert.equal(h.calls[0].payload.embeds[0].fields[0].name,'經驗證的暱稱');
});

test('bot mode delivers each committed win individually and never edits an earlier aggregate',async t=>{
  const h=await fixture(t),first=await h.settle('super'),second=await h.settle('mega'),messages=[];
  const requestId=randomUUID(),before=h.s.quota.status().used.writes,third=await h.settle('big',{requestId});
  assert.equal(h.s.quota.status().used.writes-before,14);
  const writes=h.s.quota.status().used.writes;assert.equal((await h.settle('big',{requestId})).duplicate,true);assert.equal(h.s.quota.status().used.writes,writes);
  let now=Date.now();
  const bot={send:async(payload,id)=>{messages.push({payload,id});return {kind:'sent',messageId};}};
  const q=new FirestoreHighlights(h.s,{guild,bot,clock:()=>now});h.workers.push(q);
  await q.flush();now+=HIGHLIGHT_INTERVAL_MS;await q.flush();now+=HIGHLIGHT_INTERVAL_MS;await q.flush();
  assert.equal(messages.length,3);assert.equal(new Set(messages.map(m=>m.id)).size,3);
  assert.ok(messages.every(m=>m.payload.embeds.length===1&&(m.payload.embeds[0].image||m.payload.embeds[0].thumbnail).url.endsWith('.webp')&&!('flags' in m.payload)));
  const big=messages.find(m=>m.payload.embeds[0].title==='BIG WIN');assert.ok(big.payload.embeds[0].thumbnail);assert.equal('image' in big.payload.embeds[0],false);
  for(const message of messages){assert.ok(message.payload.content.includes(`<@${user}>`));assert.deepEqual(message.payload.allowed_mentions,{parse:[],users:[user]});}
  assert.equal((await h.event(first)).status,'sent');assert.equal((await h.event(second)).status,'sent');assert.equal((await h.event(third)).status,'sent');
  const start=await h.s.casinoAccount(guild,user);await h.s.checkin(guild,user);const after=await h.s.casinoAccount(guild,user);
  assert.equal(after.net,start.net);assert.equal(after.rounds,3);assert.ok(after.balance>start.balance);
});

test('bot sending recovery quarantines orphaned POSTs even when an older message ID exists',async t=>{
  const h=await fixture(t),win=await h.settle('mega'),event=await h.event(win);let sent=0;
  const q=new FirestoreHighlights(h.s,{guild,bot:{send:async()=>{sent++;return {kind:'sent',messageId};}}});h.workers.push(q);
  await h.s.db.runTransaction(async tx=>{
    q.event(tx,event,'sending');h.s.write(tx,q.board,{guild,message_id:messageId,started:0,total:1,entries:'[]',next_attempt:0});
  });
  await q.flush();assert.equal(sent,0);assert.equal((await h.event(win)).status,'uncertain');
});
