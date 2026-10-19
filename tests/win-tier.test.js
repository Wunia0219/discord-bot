import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WIN_THRESHOLDS, winTier } from '../src/game/win-tier.js';
import { BETS, evaluateGrid, gridFromStops, BET_DIVISOR } from '../src/game/index.js';

test('WIN presentation uses 10/30/100 total-bet thresholds for every supported bet',()=>{
  assert.deepEqual(WIN_THRESHOLDS,{big:10,super:30,mega:100});
  for(const bet of BETS){
    for(const [payout,expected] of [[10*bet-1,null],[10*bet,'big'],[30*bet-1,'big'],[30*bet,'super'],[100*bet-1,'super'],[100*bet,'mega'],[2700*bet,'mega']]){
      assert.equal(winTier(payout,bet),expected,`payout ${payout}, bet ${bet}`);
    }
  }
});

test('current presentation examples retain their audited payouts and use the new tiers',()=>{
  const report=JSON.parse(readFileSync(new URL('../docs/data/math-report.json',import.meta.url)));
  assert.deepEqual(report.winThresholds,WIN_THRESHOLDS);
  for(const tier of ['big','super','mega']){
    const example=report.examples[tier];
    const result=evaluateGrid(gridFromStops(example.stops),BET_DIVISOR);
    assert.equal(result.payout,example.payout);
    assert.equal(result.tier,tier);
  }
});
