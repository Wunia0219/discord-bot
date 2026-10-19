import test from 'node:test';
import assert from 'node:assert/strict';
import { BETS, PAYTABLE, BET_DIVISOR } from '../src/game/index.js';
import { rulesExample } from '../src/ui/rules-example.js';
import { waysOracle } from './helpers/ways-oracle.js';
import { SYMBOLS } from '../src/game/symbols.js';

test('the illustrated rules example pays six three-reel hearts for every selectable bet', () => {
  for (const bet of BETS) {
    const example = rulesExample(bet);
    const expected = waysOracle(example.grid, SYMBOLS, PAYTABLE, bet / BET_DIVISOR);
    assert.equal(example.wins.length, 1);
    assert.deepEqual(example.wins[0], {
      symbol: 'king', count: 3, ways: 6, multiplier: 5,
      payout: 30 * bet / BET_DIVISOR,
      cells: [[0, 0], [0, 1], [1, 1], [2, 0], [2, 1], [2, 2]],
    });
    assert.equal(example.payout, expected.payout);
    assert.equal(example.payout - bet, bet / 2);
  }
});
