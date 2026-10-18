import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { MODEL_VERSION, REEL_CODES, REEL_STRIPS, SYMBOLS, PAYTABLE, PAYLINES, TIER_PREVIEW_STOPS, INITIAL_STOPS, roundFromStops, readState, restoredStops, createRound } from '../src/game.js';
import * as v4 from '../src/models/v4/slot-math.js';
import * as v5 from '../src/models/v5/slot-math.js';

test('archived v5 retains its fixed paytable and exact 96% whole-game proof',()=>{
  const { MODEL_VERSION, REEL_CODES, REEL_STRIPS, SYMBOLS, PAYTABLE, PAYLINES, TIER_PREVIEW_STOPS }=v5;
  const roundFromStops=(bet,stops)=>v5.evaluateGrid(v5.gridFromStops(stops),bet);
  const report=JSON.parse(readFileSync(new URL('../docs/math-report-v5.json',import.meta.url)));
  const expected=[[20,100,500],[15,75,250],[10,50,150],[8,40,100],[5,15,40],[5,12,30],[4,10,25],[3,8,20],[20,100,500]];
  assert.equal(MODEL_VERSION,'circus-20-v5');assert.deepEqual(SYMBOLS.map(s=>PAYTABLE[s]),expected);
  assert.equal(report.sha256,createHash('sha256').update(JSON.stringify({REEL_CODES,PAYTABLE,PAYLINES})).digest('hex'));
  assert.equal(report.exact.totalPayoutSum*25,report.exact.totalBetSum*24);
  assert.equal(report.enumeration.coveredStopCombinations,80**5);
  assert.equal(report.exact.maximumTotalBetMultiplier,200);
  assert.equal(Object.entries(report.payoutDistributionInLineBets).reduce((n,[,w])=>n+w,0),80**5);
  assert.equal(Object.entries(report.payoutDistributionInLineBets).reduce((n,[p,w])=>n+Number(p)*w,0),report.exact.totalPayoutSum);
  for(const [i,r] of REEL_STRIPS.entries()) {
    assert.equal(r.length,80);
    const high=r.filter(s=>['scarab','eye','ankh','necklace'].includes(s)).length/80;
    assert.ok(high>=.275&&high<=.4);
    assert.deepEqual(SYMBOLS.map(s=>r.filter(x=>x===s).length),report.counts[i]);
    for(let p=1;p<80;p++)if(80%p===0)assert.ok(r.some((s,j)=>s!==r[j%p]));
    for(let stop=0;stop<80;stop++)assert.ok(![0,1,2,3].every(d=>r[(stop+d)%80]===r[stop]),'no four-symbol stacks');
  }
  for(const [tier,stops] of Object.entries(TIER_PREVIEW_STOPS))for(const bet of [20,100,200,500]) {
    const r=roundFromStops(bet,stops);assert.equal(r.tier,tier);assert.ok(Number.isSafeInteger(r.payout));
    assert.ok(r.payout<=200*bet);if(tier==='mega')assert.equal(r.payout,200*bet);
  }
});

test('v4 stops above 79 and settled awards survive v5 migration and duplicate replay',()=>{
  const stops=[91,51,41,31,151],grid=v4.gridFromStops(stops),outcome=v4.evaluateGrid(grid,100);
  const record={...outcome,id:'v4-old',time:'2026-10-18T15:00:00.000Z',bet:100,before:10000,after:29900,net:19900,grid,stops,symbols:grid.map(c=>c[1]),rules:v4.MODEL_VERSION};
  const old={version:3,balance:29900,history:[record],milestones:[12000]};
  assert.deepEqual(readState(JSON.stringify(old)),old);assert.deepEqual(restoredStops(old),INITIAL_STOPS);
  assert.deepEqual(createRound(old,100,stops,'v4-old').round,record);
  const next=createRound(old,20,TIER_PREVIEW_STOPS.big,'v5-new');
  assert.deepEqual(next.state.history[1],record);assert.deepEqual(readState(JSON.stringify(next.state)),next.state);
  const tampered=structuredClone(old);tampered.history[0].rules=MODEL_VERSION;
  assert.equal(readState(JSON.stringify(tampered)).history.length,0);
});
