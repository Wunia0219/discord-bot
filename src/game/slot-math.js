import { MODEL_VERSION, REEL_CODES } from './reel-strips.js';
import { PAYOUTS, INITIAL_STOPS } from './model-config.js';
import { evaluateWays } from './ways-engine.js';
export { MAXIMUM_MULTIPLIER, BIG_WIN_MEAN_SPINS, THEORETICAL_RTP } from './model-config.js';
export { MODEL_VERSION, REEL_CODES };
export { SYMBOL_FRAMES,SYMBOLS,SYMBOL_CODES,SYMBOL_NAMES } from './symbols.js';
import { SYMBOLS } from './symbols.js';
import { makeReels,validateReelStops,gridFromReels,uniformStop,wrap } from './reel-utils.js';
export { uniformStop };
export const REEL_STRIPS=makeReels(REEL_CODES);
export const PAYTABLE=Object.freeze(Object.fromEntries(SYMBOLS.map((s,i)=>[s,PAYOUTS[i]])));
export const COLS=5,ROWS=3;
export const validateStops=stops=>validateReelStops(REEL_STRIPS,stops);
export const gridFromStops=stops=>gridFromReels(REEL_STRIPS,stops);
export const BET_DIVISOR = 20;
export const WAYS = 3 ** 5;
export const evaluateGrid=(grid,bet)=>evaluateWays(grid,bet,PAYTABLE,BET_DIVISOR);
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
