import { MODEL_VERSION, REEL_CODES } from './reel-strips.js';
import { PAYOUTS, INITIAL_STOPS, TIER_PREVIEW_STOPS } from './model-config.js';
import { winTier } from './win-tier.js';
export { MAXIMUM_MULTIPLIER, BIG_WIN_MEAN_SPINS, TIER_PREVIEW_STOPS } from './model-config.js';
export { MODEL_VERSION, REEL_CODES };
export const SYMBOL_FRAMES = Object.freeze({ scarab: 'H1.png', eye: 'H2.png', ankh: 'H3.png', necklace: 'H4.png', ace: 'L1.png', king: 'L2.png', queen: 'L3.png', jack: 'L4.png', wild: 'W.png' });
export const SYMBOLS = Object.freeze(Object.keys(SYMBOL_FRAMES));
export const SYMBOL_CODES = Object.freeze(Object.fromEntries(SYMBOLS.map(s => [s, SYMBOL_FRAMES[s].replace('.png', '')])));
export const SYMBOL_NAMES = Object.freeze({ scarab: '聖甲蟲', eye: '荷魯斯之眼', ankh: '生命之符', necklace: '皇家項鍊', ace: 'A', king: 'K', queen: 'Q', jack: 'J', wild: 'WILD' });
const fromCode = Object.fromEntries(SYMBOLS.map(s => [SYMBOL_CODES[s], s]));
export const REEL_STRIPS = Object.freeze(REEL_CODES.map(strip => Object.freeze(strip.map(code => fromCode[code]))));
export const PAYTABLE = Object.freeze(Object.fromEntries(SYMBOLS.map((s, i) => [s, PAYOUTS[i]])));
// Each entry selects one row per reel: 0 = top, 1 = middle, 2 = bottom.
export const PAYLINES = Object.freeze([
  [1,1,1,1,1], [0,0,0,0,0], [2,2,2,2,2], [0,1,2,1,0], [2,1,0,1,2],
  [0,0,1,0,0], [1,2,1,2,1], [0,0,1,2,2], [2,2,1,0,0], [1,2,1,0,1],
  [1,0,1,2,1], [1,1,0,1,1], [2,1,1,1,2], [0,1,0,1,0], [2,1,2,1,2],
  [0,1,1,1,0], [1,1,2,1,1], [0,0,2,0,0], [2,2,0,2,2], [0,2,2,2,0],
].map(Object.freeze));
export const COLS = 5, ROWS = 3;
const wrap = (n, length) => ((n % length) + length) % length;
export function validateStops(stops) {
  if (!Array.isArray(stops) || stops.length !== COLS || stops.some((s, i) => !Number.isInteger(s) || s < 0 || s >= REEL_STRIPS[i].length)) throw new Error('無效的轉輪停點');
}
export function gridFromStops(stops) {
  validateStops(stops);
  return stops.map((stop, i) => [-1, 0, 1].map(offset => REEL_STRIPS[i][wrap(stop + offset, REEL_STRIPS[i].length)]));
}
export function evaluateLine(symbols) {
  let best = { symbol: null, count: 0, multiplier: 0 };
  for (const symbol of SYMBOLS) {
    let count = 0;
    while (count < COLS && (symbols[count] === symbol || (symbol !== 'wild' && symbols[count] === 'wild'))) count++;
    const multiplier = count >= 3 ? PAYTABLE[symbol][count - 3] : 0;
    if (multiplier > best.multiplier) best = { symbol, count, multiplier };
  }
  return best;
}
export function evaluateGrid(grid, bet) {
  if (!Number.isSafeInteger(bet) || bet <= 0 || bet % PAYLINES.length !== 0) throw new Error('總下注須為 20 的正整數倍');
  if (!Array.isArray(grid) || grid.length !== COLS || grid.some(col => !Array.isArray(col) || col.length !== ROWS || col.some(s => !SYMBOLS.includes(s)))) throw new Error('無效的盤面');
  const lineBet = bet / PAYLINES.length;
  const wins = PAYLINES.flatMap((rows, index) => {
    const win = evaluateLine(rows.map((row, col) => grid[col][row]));
    return win.multiplier ? [{ line: index + 1, ...win, payout: win.multiplier * lineBet }] : [];
  });
  const payout = wins.reduce((sum, win) => sum + win.payout, 0);
  const level = payout >= bet * 20 ? 'jackpot' : payout > bet ? 'medium' : payout > 0 ? 'small' : 'none';
  return { wins, lineBet, payout, multiplier: payout / bet, level, tier:winTier(payout,bet), label: payout ? `${wins.length} 條連線得獎` : '寶藏仍在等待' };
}
// Rejection sampling avoids modulo bias, including the 25-stop fifth reel.
export function uniformStop(length, nextUint32 = () => crypto.getRandomValues(new Uint32Array(1))[0]) {
  if (!Number.isInteger(length) || length < 1 || length > 2 ** 32) throw new Error('無效的轉輪長度');
  const ceiling = Math.floor(2 ** 32 / length) * length;
  let value;
  do {
    value = nextUint32();
    if (!Number.isInteger(value) || value < 0 || value >= 2 ** 32) throw new Error('無效的亂數');
  } while (value >= ceiling);
  return value % length;
}
export const drawStops = nextUint32 => REEL_STRIPS.map(strip => uniformStop(strip.length, nextUint32));
// Result begins above the current screen. Increasing Y scrolls downward through
// the same circular strip; no temporary symbols or stop-time replacements.
export function reelMotion(reel, from, to, laps = 1) {
  const strip = REEL_STRIPS[reel], length = strip.length;
  const steps = wrap(from - to, length) + laps * length;
  return { steps, names: Array.from({ length: steps + ROWS }, (_, row) => strip[wrap(to - 1 + row, length)]) };
}
export { INITIAL_STOPS };
export const INITIAL_GRID = gridFromStops(INITIAL_STOPS);
// A real, reachable BIG WIN outcome, used only by the labelled free preview.
export const PREVIEW_STOPS = TIER_PREVIEW_STOPS.big;
