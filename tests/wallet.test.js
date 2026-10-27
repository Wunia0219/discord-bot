import { LEGACY_MODELS } from '../src/game/legacy-models.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WalletStore, taipeiDay } from '../server/wallet/wallet.js';
const v1=LEGACY_MODELS['kemet-20-v1'];
const v2=LEGACY_MODELS['kemet-20-v2'];
const v4=LEGACY_MODELS['circus-20-v4'];
const oldWays=LEGACY_MODELS['circus-243-v1'];
import { MODEL_VERSION, REEL_STRIPS } from '../src/game/slot-math.js';
const guild='1441097301685698703',other='1441097301685698704',user='1561284960986599626',admin='1561284960986599627';
function store(t,opts={}){const s=new WalletStore({guildIds:[guild,other],...opts});t.after(()=>s.close());return s;}

test('wallet retries of deployed 243 v1 rounds keep original scores under 96% v2',t=>{
 const s=store(t,{spinDelay:0}),request=randomUUID(),stops=[8,16,34,6,93];s.state(guild,user);
 const grid=oldWays.gridFromStops(stops),outcome=oldWays.evaluateGrid(grid,100);
 const round={...outcome,id:randomUUID(),bet:100,stops,grid,symbols:grid.map(c=>c[1]),rules:oldWays.MODEL_VERSION,time:new Date().toISOString(),before:10000,after:279900,net:269900,milestone:false};
 s.tx(()=>{
  s.credit(guild,user,round.net,'spin',user,'old 243 settlement',request);
  s.db.prepare('INSERT INTO rounds VALUES(?,?,?,?,?)').run(guild,user,round.id,JSON.stringify(round),Date.now());
  s.db.prepare('INSERT INTO operations VALUES(?,?,?,?)').run(guild,`spin:${user}:${request}`,'100',JSON.stringify({round}));
 });
 const replay=s.spin(guild,user,100,request);assert.ok(replay.duplicate);assert.deepEqual(replay.round,round);assert.equal(replay.state.balance,279900);
 const update=s.spin(guild,user,20,randomUUID());assert.equal(update.round.rules,MODEL_VERSION);
 assert.equal(s.history(guild,user).filter(e=>e.kind==='spin').length,2);
});

test('v4 wallet retries preserve settled 200-stop results while current rounds use verified reels',t=>{
 const s=store(t,{spinDelay:0}),request=randomUUID(),stops=[91,51,41,31,151];s.state(guild,user);
 const grid=v4.gridFromStops(stops),outcome=v4.evaluateGrid(grid,100);
 const old={...outcome,id:randomUUID(),bet:100,stops,grid,symbols:grid.map(c=>c[1]),rules:v4.MODEL_VERSION,time:new Date().toISOString(),before:10000,after:29900,net:19900,milestone:false};
 s.tx(()=>{
  s.credit(guild,user,old.net,'spin',user,'v4 settlement',request);
  s.db.prepare('INSERT INTO rounds VALUES(?,?,?,?,?)').run(guild,user,old.id,JSON.stringify(old),Date.now());
  s.db.prepare('INSERT INTO operations VALUES(?,?,?,?)').run(guild,`spin:${user}:${request}`,'100',JSON.stringify({round:old}));
 });
 const replay=s.spin(guild,user,100,request);assert.equal(replay.duplicate,true);assert.deepEqual(replay.round,old);assert.equal(replay.state.balance,29900);
 const next=s.spin(guild,user,20,randomUUID());assert.equal(next.round.rules,MODEL_VERSION);
 assert.ok(next.round.stops.every((stop,i)=>stop>=0&&stop<REEL_STRIPS[i].length));
 assert.ok(REEL_STRIPS.every(r=>r.length>0));assert.equal(s.history(guild,user).filter(e=>e.kind==='spin').length,2);
});

test('stored v2 wallet spin survives v3 upgrade and replay without another ledger entry',t=>{
 const s=store(t),request=randomUUID(),stops=[13,10,6,6,13];s.state(guild,user);
 const grid=v2.gridFromStops(stops),outcome=v2.evaluateGrid(grid,500);
 const old={...outcome,id:randomUUID(),bet:500,stops,grid,symbols:grid.map(c=>c[1]),rules:v2.MODEL_VERSION,time:new Date().toISOString(),before:10000,after:81550,net:71550,milestone:false};
 s.tx(()=>{
  s.credit(guild,user,old.net,'spin',user,'v2 settlement',request);
  s.db.prepare('INSERT INTO rounds VALUES(?,?,?,?,?)').run(guild,user,old.id,JSON.stringify(old),Date.now());
  s.db.prepare('INSERT INTO operations VALUES(?,?,?,?)').run(guild,`spin:${user}:${request}`,'500',JSON.stringify({round:old}));
 });
 const before=s.history(guild,user),replay=s.spin(guild,user,500,request);
 assert.equal(replay.duplicate,true);assert.deepEqual(replay.round,old);assert.equal(replay.state.balance,81550);assert.deepEqual(s.history(guild,user),before);
});
test('opening credit is once per wallet; guilds and users are isolated; production receives welcome chips',t=>{
 const s=store(t);assert.equal(s.state(guild,user).balance,10000);assert.equal(s.state(guild,user).balance,10000);
 s.checkin(guild,user);assert.equal(s.state(other,user).balance,10000);assert.equal(s.state(guild,admin).balance,10000);
 const prod=store(t,{environment:'production'});assert.equal(prod.state(guild,user).balance,10000);assert.equal(prod.history(guild,user)[0].kind,'welcome');
 assert.throws(()=>s.state('123456789012345678',user),/尚未開放/);
});
test('Taipei checkin is atomic once per calendar day across devices and survives midnight',t=>{
 let now=Date.parse('2026-10-18T15:59:59Z');const s=store(t,{clock:()=>now});
 assert.equal(taipeiDay(now),'2026-10-18');s.checkin(guild,user);
 for(let i=0;i<20;i++)assert.equal(s.checkin(guild,user).duplicate,true);
 assert.equal(s.state(guild,user).balance,10500);now+=2000;
 assert.equal(s.checkin(guild,user).state.balance,11000);assert.equal(s.history(guild,user).filter(e=>e.kind==='checkin').length,2);
});
test('server spins are replayable forever with original stops and cannot alter a reused request',t=>{
 let now=Date.now();const s=store(t,{clock:()=>now});const key=randomUUID();const r=s.spin(guild,user,100,key);
 for(let i=0;i<5;i++){const retry=s.spin(guild,user,100,key);assert.deepEqual(retry.round,r.round);assert.equal(retry.state.balance,r.state.balance);}
 assert.throws(()=>s.spin(guild,user,200,key),/請求編號/);
 assert.throws(()=>s.spin(guild,user,100,randomUUID()),/尚未就緒/);
 assert.equal(s.history(guild,user).filter(e=>e.kind==='spin').length,1);
 now+=2100;s.spin(guild,user,20,randomUUID());
 const entries=s.history(guild,user);assert.equal(entries.reduce((n,e)=>n+e.delta,0),s.state(guild,user).balance);
});
test('insufficient balance, illegal bets and failed grants roll back without changing ledger',t=>{
 const s=store(t,{environment:'production'});s.db.prepare('INSERT INTO wallets(guild,user,balance) VALUES(?,?,0)').run(guild,user);
 assert.throws(()=>s.spin(guild,user,20,randomUUID()),/戲籌不足/);
 assert.throws(()=>s.spin(guild,user,7,randomUUID()),/無效/);assert.equal(s.state(guild,user).balance,0);
 assert.throws(()=>s.grant(guild,admin,user,-1,'bad',randomUUID()),/發放限/);assert.equal(s.history(guild,user).length,0);
});
test('admin grant caps, duplicate delivery, and compensating reversal preserve an append-only audit',t=>{
 const s=store(t,{environment:'production',grantMax:1000,grantDaily:1500});const id=randomUUID();
 const r=s.grant(guild,admin,user,1000,'活動獎勵',id);assert.equal(s.grant(guild,admin,user,1000,'活動獎勵',id).duplicate,true);
 assert.throws(()=>s.grant(guild,admin,user,600,'超額',randomUUID()),/額度/);
 const reversal=s.reverse(guild,admin,r.entry.id,'誤發更正',randomUUID());assert.equal(reversal.entry.after,10000);
 assert.throws(()=>s.reverse(guild,admin,r.entry.id,'再扣一次',randomUUID()),/更正過/);
 assert.throws(()=>s.grant(guild,admin,user,600,'撤銷不重置額度',randomUUID()),/額度/);
 assert.equal(s.history(guild,user).length,3);
 assert.throws(()=>s.db.prepare('DELETE FROM ledger').run(),/append only/);
});
test('wallet survives reopen and refuses to open a test DB as production',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'kemet-wallet-'));t.after(()=>rm(dir,{recursive:true,force:true}));const filename=join(dir,'wallet.sqlite');
 const a=new WalletStore({filename,guildIds:[guild]});a.checkin(guild,user);a.close();
 const b=new WalletStore({filename,guildIds:[guild]});assert.equal(b.state(guild,user).balance,10500);b.close();
 assert.throws(()=>new WalletStore({filename,guildIds:[guild],environment:'production'}),/mix test/);
});

test('retry of a stored v1 spin after upgrade preserves its original settlement',t=>{
 const s=store(t),request=randomUUID(),stops=[15,0,8,18,15];
 s.state(guild,user);
 const grid=v1.gridFromStops(stops),outcome=v1.evaluateGrid(grid,500);
 const old={...outcome,id:randomUUID(),bet:500,stops,grid,symbols:grid.map(c=>c[1]),rules:v1.MODEL_VERSION,time:new Date().toISOString(),before:10000,after:69825,net:59825,milestone:false};
 s.tx(()=>{
  s.credit(guild,user,old.net,'spin',user,'舊版下注 500／派彩 60325',request);
  s.db.prepare('INSERT INTO rounds VALUES(?,?,?,?,?)').run(guild,user,old.id,JSON.stringify(old),Date.now());
  s.db.prepare('INSERT INTO operations VALUES(?,?,?,?)').run(guild,`spin:${user}:${request}`,'500',JSON.stringify({round:old}));
 });
 const before=s.history(guild,user);
 const replay=s.spin(guild,user,500,request);
 assert.equal(replay.duplicate,true);assert.deepEqual(replay.round,old);
 assert.equal(replay.state.balance,69825);assert.deepEqual(s.history(guild,user),before);
});
