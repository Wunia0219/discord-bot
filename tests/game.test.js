import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { webpSize } from './helpers/webp.js';
import { freshState, createRound, readState, SYMBOLS, SYMBOL_FRAMES, INITIAL_GRID, INITIAL_STOPS, PREVIEW_STOPS, TIER_PREVIEW_STOPS, restoredStops, REEL_STRIPS, REEL_CODES, PAYLINES, PAYTABLE, MODEL_VERSION, gridFromStops, evaluateLine, evaluateGrid, uniformStop, drawStops, reelMotion } from '../src/game.js';

test('all nine symbols resolve to valid renamed atlas frames',()=>{
  const atlas=JSON.parse(readFileSync(new URL('../images/symbols.json',import.meta.url),'utf8'));
  assert.equal(atlas.meta.image,'symbols.webp');
  const [width,height]=webpSize(new URL('../images/symbols.webp',import.meta.url));
  assert.equal(SYMBOLS.length,9);
  for(const symbol of SYMBOLS){
    const {x,y,w,h}=atlas.frames[SYMBOL_FRAMES[symbol]].frame;
    assert.ok(x>=0&&y>=0&&w>0&&h>0&&x+w<=width&&y+h<=height);
    assert.ok(INITIAL_GRID.flat().includes(symbol));
  }
});
test('20 unique five-reel paylines and immutable circular strips',()=>{
  assert.equal(PAYLINES.length,20);assert.equal(new Set(PAYLINES.map(JSON.stringify)).size,20);
  for(const line of PAYLINES){assert.equal(line.length,5);assert.ok(line.every(r=>[0,1,2].includes(r)));}
  assert.throws(()=>REEL_STRIPS[0].reverse());
  assert.throws(()=>PAYLINES[0].push(0));
  const grid=gridFromStops([0,0,0,0,0]);
  REEL_STRIPS.forEach((r,i)=>assert.deepEqual(grid[i],[r.at(-1),r[0],r[1]]));
});
test('left-to-right only, highest award, W substitution and pure W awards',()=>{
  for(const [symbols,payout,count] of [
    [['wild','wild','wild','scarab','scarab'],500,5],
    [['wild','wild','wild','jack','jack'],20,3],
    [['scarab','wild','scarab','eye','scarab'],20,3],
    [['eye','scarab','scarab','scarab','scarab'],0,0],
    [['scarab','scarab','eye','scarab','scarab'],0,0],
    [Array(5).fill('wild'),500,5],
    [['wild','eye','wild','eye','jack'],75,4],
  ]) {const win=evaluateLine(symbols);assert.equal(win.multiplier,payout);assert.equal(win.count,count);}
});
test('all lines pay independently without double-paying prefixes or rounding',()=>{
  const grid=Array.from({length:5},()=>Array(3).fill('wild'));
  const result=evaluateGrid(grid,100);
  // Synthetic all-W grid is unreachable on the strips. The scorer does not
  // clip awards: the 200x bound comes from the reachable reel distribution.
  assert.equal(result.wins.length,20);assert.equal(result.payout,50000);
  assert.throws(()=>evaluateGrid(grid,50));
  assert.throws(()=>evaluateGrid(grid.slice(1),100));
  const stops=TIER_PREVIEW_STOPS.mega;
  assert.equal(evaluateGrid(gridFromStops(stops),20).payout,4000);
  assert.equal(evaluateGrid(gridFromStops(stops),500).payout,100000);
});
test('uniform RNG rejects overflow tail and draws all five stops independently',()=>{
  for(const [length,tail,last] of [[20,4294967280,4294967279],[25,4294967275,4294967274]]){
    const values=[4294967295,tail,last];let calls=0;
    assert.equal(uniformStop(length,()=>{calls++;return values.shift();}),length-1);assert.equal(calls,3);
    assert.equal(uniformStop(length,()=>0),0);
  }
  const values=[1,2,3,4,24];assert.deepEqual(drawStops(()=>values.shift()),[1,2,3,4,24]);
  for(const value of [-1,NaN,1.5,2**32])assert.throws(()=>uniformStop(20,()=>value));
});
test('downward reel animation begins and ends at actual adjacent strip cells for every pair of stops',()=>{
  REEL_STRIPS.forEach((strip,reel)=>{
    for(let from=0;from<strip.length;from++)for(let to=0;to<strip.length;to++){
      const {steps,names}=reelMotion(reel,from,to);
      const cells=stop=>[-1,0,1].map(d=>strip[(stop+d+strip.length)%strip.length]);
      assert.deepEqual(names.slice(steps,steps+3),cells(from));assert.deepEqual(names.slice(0,3),cells(to));
      for(let i=0;i<names.length;i++)assert.equal(names[i],strip[(to-1+i+strip.length)%strip.length]);
      assert.ok(steps>=strip.length);
    }
  });
});
test('rounds reconcile, retain stops/wins, and duplicate settlement is idempotent',()=>{
  const first=createRound(freshState(),100,PREVIEW_STOPS,'one');
  assert.equal(first.state.balance,10000-100+first.round.payout);
  assert.equal(first.round.net,first.round.payout-100);
  assert.deepEqual(first.round.grid,gridFromStops(PREVIEW_STOPS));
  assert.deepEqual(createRound(first.state,20,INITIAL_STOPS,'one'),{state:first.state,round:first.round,duplicate:true});
  assert.deepEqual(readState(JSON.stringify(first.state)),first.state);
});
test('invalid inputs and insufficient balance cannot settle',()=>{
  for(const bet of [-1,0,50,250,NaN,1.5])assert.throws(()=>createRound(freshState(),bet,INITIAL_STOPS,'one'));
  for(const stops of [null,[],[0,0,0,0,200],[-1,0,0,0,0],[NaN,0,0,0,0],[.5,0,0,0,0]])assert.throws(()=>createRound(freshState(),100,stops,'one'));
  assert.throws(()=>createRound({...freshState(),balance:19},20,INITIAL_STOPS,'one'));
});
test('milestone does not pay extra and triggers once; ledger retains 100 rounds',()=>{
  let state=freshState(),count=0,total=10000;
  for(let i=0;i<150;i++){const r=createRound(state,100,PREVIEW_STOPS,`id-${i}`);state=r.state;if(r.round.milestone)count++;total+=r.round.payout-100;}
  assert.equal(count,1);assert.equal(state.history.length,100);assert.equal(state.balance,total);
  assert.deepEqual(readState(JSON.stringify(state)),state);
});
test('new records reject tampered stops, payouts, grids, wins, and balances',()=>{
  const {state}=createRound(freshState(),100,PREVIEW_STOPS,'one');
  for(const mutate of [s=>s.history[0].grid.pop(),s=>s.history[0].stops[0]=(s.history[0].stops[0]+1)%REEL_STRIPS[0].length,s=>s.history[0].wins[0].payout++,s=>s.history[0].rules='unknown',s=>s.balance++,s=>s.history[0].payout++]){
    const invalid=structuredClone(state);mutate(invalid);assert.deepEqual(readState(JSON.stringify(invalid)),freshState());
  }
  for(const raw of [null,'bad','{}',JSON.stringify({...freshState(),balance:-1})])assert.deepEqual(readState(raw),freshState());
});
test('legacy v2 balance and history migrate, but old fake grid is not used for new reels',()=>{
  const record={id:'legacy',time:new Date().toISOString(),bet:50,before:10000,payout:100,after:10050,net:50,symbols:INITIAL_GRID.map(c=>c[1]),grid:INITIAL_GRID,rules:'kemet-preview-v2'};
  const migrated=readState(JSON.stringify({version:2,balance:10050,history:[record],milestones:[]}));
  assert.equal(migrated.version,3);assert.equal(migrated.balance,10050);assert.deepEqual(migrated.history,[record]);
  assert.deepEqual(restoredStops(migrated),INITIAL_STOPS);
  const next=createRound(migrated,20,PREVIEW_STOPS,'new');assert.deepEqual(restoredStops(next.state),PREVIEW_STOPS);
  assert.deepEqual(readState(JSON.stringify(next.state)),next.state);
});
test('exact weighted line expectation is 24/25 and verified full-grid report matches this model',()=>{
  const counts=REEL_STRIPS.map(r=>SYMBOLS.map(s=>r.filter(x=>x===s).length));let weighted=0n;
  for(let key=0;key<9**5;key++){
    let value=key,probability=1n;const line=Array(5);
    for(let i=4;i>=0;i--){const symbol=value%9;value=Math.floor(value/9);line[i]=SYMBOLS[symbol];probability*=BigInt(counts[i][symbol]);}
    weighted+=probability*BigInt(evaluateLine(line).multiplier);
  }
  const outcomes=REEL_STRIPS.reduce((n,r)=>n*BigInt(r.length),1n);
  assert.equal(weighted*25n,outcomes*24n);
  const report=JSON.parse(readFileSync(new URL('../docs/math-report.json',import.meta.url),'utf8'));
  assert.equal(report.model,MODEL_VERSION);
  assert.equal(report.sha256,createHash('sha256').update(JSON.stringify({REEL_CODES,PAYTABLE,PAYLINES})).digest('hex'));
  assert.equal(report.exact.totalPayoutSum*25,report.exact.totalBetSum*24);
});
