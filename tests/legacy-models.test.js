import { TEST_STOPS } from './helpers/current-model.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { LEGACY_MODELS } from '../src/game/legacy-models.js';
import { readState,createRound,restoredStops,INITIAL_STOPS,MODEL_VERSION } from '../src/game/index.js';

for(const old of Object.values(LEGACY_MODELS).filter(m=>m.evaluateLine))test(`${old.MODEL_VERSION}: consolidated evaluator matches every historical line and 2000 historical grids`,()=>{
  const lines=createHash('sha256');
  for(let key=0;key<9**5;key++){
    let k=key;const a=Array(5);for(let i=4;i>=0;i--){a[i]=old.SYMBOLS[k%9];k=Math.floor(k/9);}
    lines.update(JSON.stringify(old.evaluateLine(a))+'\n');
  }
  assert.equal(lines.digest('hex'),old.verification.lineSha256);
  let seed=old.verification.gridSeed;
  const next=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
  const grids=createHash('sha256');
  for(let i=0;i<old.verification.gridOutcomes;i++){
    const stops=old.drawStops(next),r=old.evaluateGrid(old.gridFromStops(stops),100);
    grids.update(JSON.stringify({wins:r.wins,lineBet:r.lineBet,payout:r.payout,multiplier:r.multiplier,level:r.level,tier:r.tier})+'\n');
  }
  assert.equal(grids.digest('hex'),old.verification.gridSha256);
});

test('all five historical generations preserve original awards, wallets and duplicate requests',()=>{
  const fixtures=[['kemet-20-v1',[15,0,8,18,15],500,60325],['kemet-20-v2',[13,10,6,6,13],500,72050],['circus-20-v3',[8,5,2,18,7],100,20000],['circus-20-v4',[91,51,41,31,151],100,20000],['circus-20-v5',[18,36,68,1,64],100,20000]];
  for(const [version,stops,bet,payout] of fixtures){
    const old=LEGACY_MODELS[version],grid=old.gridFromStops(stops),result=old.evaluateGrid(grid,bet);
    assert.equal(result.payout,payout);
    const record={...result,id:version,time:'2026-10-18T15:00:00.000Z',bet,before:10000,after:10000-bet+payout,net:payout-bet,grid,stops,symbols:grid.map(c=>c[1]),rules:version};
    const state={version:3,balance:record.after,history:[record],milestones:[12000]};
    assert.deepEqual(readState(JSON.stringify(state)),state);assert.deepEqual(restoredStops(state),INITIAL_STOPS);
    assert.deepEqual(createRound(state,bet,stops,version).round,record);
    const update=createRound(state,20,TEST_STOPS.big,'new');
    assert.equal(update.round.rules,MODEL_VERSION);assert.deepEqual(update.state.history[1],record);
    assert.deepEqual(readState(JSON.stringify(update.state)),update.state);
    const bad=structuredClone(state);bad.history[0].wins[0].payout++;
    assert.equal(readState(JSON.stringify(bad)).history.length,0);
  }
});

test('deployed 243 v1 grids and settled wallets remain unchanged under 96% v2',()=>{
  const old=LEGACY_MODELS['circus-243-v1'];let seed=old.verification.gridSeed;
  const next=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
  const digest=createHash('sha256');
  for(let i=0;i<old.verification.gridOutcomes;i++){const stops=old.drawStops(next);digest.update(JSON.stringify(old.evaluateGrid(old.gridFromStops(stops),100))+'\n');}
  assert.equal(digest.digest('hex'),old.verification.gridSha256);
  const stops=[8,16,34,6,93],grid=old.gridFromStops(stops),outcome=old.evaluateGrid(grid,100);
  assert.equal(outcome.payout,270000);
  const round={...outcome,id:'old-ways-v1',time:'2026-10-19T00:20:00+08:00',bet:100,before:10000,after:279900,net:269900,grid,stops,symbols:grid.map(c=>c[1]),rules:old.MODEL_VERSION};
  const state={version:3,balance:round.after,history:[round],milestones:[]};
  assert.deepEqual(readState(JSON.stringify(state)),state);
  assert.deepEqual(createRound(state,100,stops,round.id).round,round);
  const update=createRound(state,20,TEST_STOPS.none,'new-ways-v2');
  assert.equal(update.round.rules,MODEL_VERSION);assert.deepEqual(update.state.history[1],round);
  assert.deepEqual(readState(JSON.stringify(update.state)),update.state);
});
