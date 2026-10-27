import { evaluateGrid } from '../../game/slot-math.js';

// An illustration only: this never draws stops or changes a settled round.
export function rulesExample(bet) {
  const grid = [
    ['king', 'king', 'ace'],
    ['queen', 'king', 'jack'],
    ['king', 'king', 'king'],
    ['ace', 'queen', 'jack'],
    ['eye', 'ankh', 'necklace'],
  ];
  return { grid, ...evaluateGrid(grid, bet) };
}
