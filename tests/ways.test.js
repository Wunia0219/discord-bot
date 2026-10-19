import { TEST_STOPS } from './helpers/current-model.js';
import { LEGACY_MODELS } from '../src/game/legacy-models.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGrid,gridFromStops,drawStops,SYMBOLS,PAYTABLE,roundFromStops,readState,createRound,INITIAL_STOPS,MODEL_VERSION,restoredStops } from '../src/game/index.js';
const old=LEGACY_MODELS['circus-20-v5'];
import { waysOracle } from './helpers/ways-oracle.js';

test('ways combine rows, pay the longest eligible length and do not multiply unused reels',()=>{
  const grid=[['ace','ace','eye'],['queen','ace','jack'],['ace','wild','ace'],['queen','jack','eye'],['ace','eye','jack']];
  let r=evaluateGrid(grid,100);
  assert.equal(r.wins.length,1);assert.equal(r.wins[0].ways,6);assert.equal(r.payout,6*5*5);
  assert.deepEqual(r.wins[0].cells,[[0,0],[0,1],[1,1],[2,0],[2,1],[2,2]]);
  grid[3]=['ace','ace','eye'];r=evaluateGrid(grid,100);
  assert.equal(r.wins[0].count,5);assert.equal(r.wins[0].ways,12);assert.equal(r.payout,12*40*5);
  grid[4]=['eye','eye','jack'];r=evaluateGrid(grid,100);
  assert.equal(r.wins[0].count,4);assert.equal(r.payout,12*15*5);
});

test('different ordinary symbols can share a WILD, with accurate winning cells',()=>{
  const grid=[['ace','king','eye'],['king','ace','jack'],['wild','wild','queen'],['queen','jack','eye'],['queen','eye','jack']];
  const r=evaluateGrid(grid,20);assert.equal(r.wins.length,2);assert.equal(r.payout,20);
  assert.deepEqual(r.wins.map(w=>[w.symbol,w.ways]),[['ace',2],['king',2]]);
  assert.ok(r.wins.every(w=>w.cells.some(([col,row])=>col===2&&row===0)));
  assert.throws(()=>evaluateGrid([['wild','ace','eye'],...grid.slice(1)],20));
});

test('5000 deterministic reachable grids match independent path enumeration',()=>{
  let seed=0x1f830001;
  const next=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
  for(let i=0;i<5000;i++){
    const grid=gridFromStops(drawStops(next)),r=evaluateGrid(grid,20),expected=waysOracle(grid,SYMBOLS,PAYTABLE);
    assert.equal(r.payout,expected.payout);
    assert.deepEqual(r.wins.map(({cells,...w})=>w),expected.wins);
    for(const w of r.wins){assert.equal(w.ways,Array.from({length:w.count},(_,col)=>w.cells.filter(c=>c[0]===col).length).reduce((a,b)=>a*b,1));}
  }
});

test('settled v5 rounds keep old awards and replay exactly when migrating to 243 ways',()=>{
  const stops=[18,36,68,1,64],grid=old.gridFromStops(stops),outcome=old.evaluateGrid(grid,100);
  const record={...outcome,id:'old-v5',time:'2026-10-18T15:00:00.000Z',bet:100,before:10000,after:10000-100+outcome.payout,net:outcome.payout-100,grid,stops,symbols:grid.map(c=>c[1]),rules:old.MODEL_VERSION};
  const state={version:3,balance:record.after,history:[record],milestones:[]};
  assert.deepEqual(readState(JSON.stringify(state)),state);assert.deepEqual(restoredStops(state),INITIAL_STOPS);
  assert.deepEqual(createRound(state,100,stops,'old-v5').round,record);
  const result=createRound(state,100,TEST_STOPS.big,'new-ways');
  assert.equal(result.round.rules,MODEL_VERSION);assert.equal(result.round.unitBet,5);
  assert.equal(result.round.lineBet,undefined);assert.deepEqual(result.state.history[1],record);
  assert.deepEqual(readState(JSON.stringify(result.state)),result.state);
  const bad=structuredClone(result.state);bad.history[0].wins[0].ways++;
  assert.equal(readState(JSON.stringify(bad)).history.length,0);
});
