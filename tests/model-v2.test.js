import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import { winTier } from '../src/win-tier.js';
import { roundFromStops,readState,createRound,restoredStops,INITIAL_STOPS,TIER_PREVIEW_STOPS,REEL_STRIPS,PAYLINES,PAYTABLE,SYMBOLS,MODEL_VERSION } from '../src/game.js';
import * as v1 from '../src/models/v1/slot-math.js';
import * as v2 from '../src/models/v2/slot-math.js';
import * as v3 from '../src/models/v3/slot-math.js';
import * as v4 from '../src/models/v4/slot-math.js';

test('v4 has fixed requested awards, nonperiodic 200-stop strips, lower rare symbols and exact 96%',()=>{
 const {MODEL_VERSION,REEL_STRIPS,SYMBOLS,PAYTABLE,PAYLINES,TIER_PREVIEW_STOPS}=v4;
 const report=JSON.parse(readFileSync(new URL('../docs/math-report-v4.json',import.meta.url)));
 assert.equal(MODEL_VERSION,'circus-20-v4');
 assert.equal(report.exact.rtpFraction,'24/25');
 assert.equal(report.exact.maximumTotalBetMultiplier,200);
 assert.deepEqual(SYMBOLS.map(s=>PAYTABLE[s]),[[20,100,500],[15,75,250],[10,50,150],[8,40,100],[5,15,40],[5,12,30],[4,10,25],[3,8,20],[20,100,500]]);
 assert.deepEqual(report.exact.tierCounts,{big:19992296,super:624504,mega:3456});
 assert.equal(report.enumeration.coveredStopCombinations,200**5);
 for(const r of REEL_STRIPS){
  assert.equal(r.length,200);
  assert.ok(r.filter(s=>s==='wild').length<=5);
  assert.ok(r.filter(s=>['scarab','eye','ankh','necklace'].includes(s)).length<=21);
  for(let period=1;period<200;period++)if(200%period===0)assert.ok(r.some((s,i)=>s!==r[i%period]));
 }
 for(const [tier,stops] of Object.entries(TIER_PREVIEW_STOPS))for(const bet of [20,100,200,500]){
  const r=v4.evaluateGrid(v4.gridFromStops(stops),bet);assert.equal(r.tier,tier);assert.equal(r.payout%1,0);assert.ok(r.payout<=200*bet);
  if(tier==='mega')assert.equal(r.payout,200*bet);
 }
 // First two reels keep WILD away from H1/WILD within two positions, which
 // prevents unintended extra awards at the 200x top combination.
 for(const reel of REEL_STRIPS.slice(0,2))reel.forEach((s,i)=>{if(s==='wild')for(const offset of [-2,-1,1,2])assert.ok(!['wild','scarab'].includes(reel[(i+offset+200)%200]));});
 assert.equal(PAYLINES.length,20);
});

test('v3 balance and original awards remain intact when appending a current round',()=>{
 const stops=[8,5,2,18,7],grid=v3.gridFromStops(stops),outcome=v3.evaluateGrid(grid,100);
 assert.equal(outcome.payout,20000);
 const record={...outcome,id:'v3-old',time:'2026-10-18T14:00:00.000Z',bet:100,before:10000,after:29900,net:19900,grid,stops,symbols:grid.map(c=>c[1]),rules:v3.MODEL_VERSION};
 const old={version:3,balance:29900,history:[record],milestones:[12000]};
 assert.deepEqual(readState(JSON.stringify(old)),old);assert.deepEqual(restoredStops(old),INITIAL_STOPS);
 const next=createRound(old,20,TIER_PREVIEW_STOPS.big,'v4-new');assert.deepEqual(next.state.history[1],record);assert.deepEqual(readState(JSON.stringify(next.state)),next.state);
});
test('tier boundaries use total wager and choose only the highest tier',()=>{
 for(const bet of [20,100,200,500])for(const [amount,tier] of [[20*bet-1,null],[20*bet,'big'],[50*bet-1,'big'],[50*bet,'super'],[200*bet-1,'super'],[200*bet,'mega']])assert.equal(winTier(amount,bet),tier);
 assert.equal(winTier(100,0),null);
});

test('v2 history keeps its original award, tier, balance and duplicate request after v3 upgrade',()=>{
 const stops=[13,10,6,6,13],grid=v2.gridFromStops(stops),outcome=v2.evaluateGrid(grid,500);
 assert.equal(outcome.payout,72050);assert.equal(outcome.tier,'mega');
 const record={...outcome,id:'v2-record',time:'2026-10-18T10:00:00.000Z',bet:500,before:10000,after:81550,net:71550,grid,stops,symbols:grid.map(c=>c[1]),rules:v2.MODEL_VERSION};
 const old={version:3,balance:81550,history:[record],milestones:[12000]};
 assert.deepEqual(readState(JSON.stringify(old)),old);assert.deepEqual(restoredStops(old),INITIAL_STOPS);
 assert.deepEqual(createRound(old,500,stops,'v2-record').round,record);
 const next=createRound(old,20,TIER_PREVIEW_STOPS.big,'v3-record');
 assert.deepEqual(readState(JSON.stringify(next.state)),next.state);assert.deepEqual(next.state.history[1],record);
 const tampered=structuredClone(old);tampered.history[0].wins[0].payout++;assert.equal(readState(JSON.stringify(tampered)).history.length,0);
});
test('v1 history keeps original results and balance while new v2 rounds append safely',()=>{
 const stops=[15,0,8,18,15],grid=v1.gridFromStops(stops),outcome=v1.evaluateGrid(grid,500);
 const record={...outcome,id:'old-record',time:'2026-10-18T10:00:00.000Z',bet:500,before:10000,after:69825,net:59825,grid,stops,symbols:grid.map(c=>c[1]),rules:v1.MODEL_VERSION};
 assert.equal(outcome.payout,60325);
 const old={version:3,balance:69825,history:[record],milestones:[12000]};
 assert.deepEqual(readState(JSON.stringify(old)),old);
 assert.deepEqual(restoredStops(old),INITIAL_STOPS);
 const next=createRound(old,20,TIER_PREVIEW_STOPS.super,'new-record');
 assert.deepEqual(readState(JSON.stringify(next.state)),next.state);
 assert.deepEqual(next.state.history[1],record);
 const tampered=structuredClone(old);tampered.history[0].wins[0].payout++;
 assert.equal(readState(JSON.stringify(tampered)).history.length,0);
});
