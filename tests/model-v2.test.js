import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import { winTier } from '../src/win-tier.js';
import { roundFromStops,readState,createRound,restoredStops,INITIAL_STOPS,TIER_PREVIEW_STOPS,REEL_STRIPS,PAYLINES,MODEL_VERSION } from '../src/game.js';
import * as v1 from '../src/models/v1/slot-math.js';
import {webpSize} from './helpers/webp.js';

test('v2 has 60–70% low symbols, exact agreed tail frequency and reachable tier previews',()=>{
 const report=JSON.parse(readFileSync(new URL('../docs/math-report.json',import.meta.url)));
 assert.equal(MODEL_VERSION,'kemet-20-v2');
 assert.equal(report.exact.tails[20].count,4177);
 assert.ok(report.exact.tails[20].meanSpins>=600&&report.exact.tails[20].meanSpins<=1000);
 for(const r of REEL_STRIPS){const ratio=r.filter(s=>['ace','king','queen','jack'].includes(s)).length/r.length;assert.ok(ratio>=.6&&ratio<=.7);}
 for(const [tier,stops] of Object.entries(TIER_PREVIEW_STOPS))for(const bet of [20,100,200,500]){
  const r=roundFromStops(bet,stops);assert.equal(r.tier,tier);assert.equal(r.payout%1,0);
 }
 // Adjacent duplicate symbols would visually stack and alter the agreed layout.
 for(const reel of REEL_STRIPS)reel.forEach((s,i)=>assert.notEqual(s,reel[(i+1)%reel.length]));
 assert.equal(PAYLINES.length,20);
});
test('tier boundaries use total wager and choose only the highest tier',()=>{
 for(const [amount,tier] of [[9999,null],[10000,'big'],[24999,'big'],[25000,'super'],[49999,'super'],[50000,'mega']])assert.equal(winTier(amount,500),tier);
 assert.equal(winTier(100,0),null);
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
test('new title exports use identical slots and safe alpha bounds',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../images/fx/win-titles.json',import.meta.url)));
 assert.deepEqual(manifest.size,[1072,264]);
 for(const tier of ['super','mega']){
  assert.deepEqual(webpSize(new URL(`../images/fx/${tier}-win-title.webp`,import.meta.url)),[1072,264]);
  const [x,y,right,bottom]=manifest.titles[tier].bounds;
  assert.ok(x>=16&&y>=12&&right<=1056&&bottom<=252);
 }
});
