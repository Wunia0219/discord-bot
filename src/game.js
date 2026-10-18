export const INITIAL_BALANCE = 10000;
export const BETS = [50, 100, 250, 500];
export const SYMBOLS = ['ankh', 'eye', 'necklace', 'scarab', 'wild'];
export const SYMBOL_NAMES = { ankh: '生命之符', eye: '荷魯斯之眼', necklace: '皇家項鍊', scarab: '聖甲蟲', wild: 'WILD' };
export const COLS = 5, ROWS = 3;
// Column-major 5 × 3 display. Only the middle line pays in this visual prototype.
export function makeGrid(symbols, seed = 0) {
  return symbols.map((symbol, col) => [SYMBOLS[(col + seed) % SYMBOLS.length], symbol, SYMBOLS[(col + seed + 2) % SYMBOLS.length]]);
}
export const INITIAL_GRID = makeGrid(['ankh', 'eye', 'wild', 'scarab', 'necklace'], 2);
// Illustrative preview distribution, NOT approved production odds.
export const OUTCOMES = [
  { limit: .50, symbols: ['eye', 'ankh', 'necklace', 'scarab', 'eye'], multiplier: 0, label: '寶藏仍在等待', level: 'none' },
  { limit: .80, symbols: Array(5).fill('ankh'), multiplier: 2, label: '生命之符的祝福', level: 'small' },
  { limit: .95, symbols: Array(5).fill('eye'), multiplier: 5, label: '荷魯斯的眷顧', level: 'medium' },
  { limit: 1, symbols: Array(5).fill('wild'), multiplier: 20, label: '法老王的寶藏', level: 'jackpot' },
];
export const freshState = () => ({ version: 2, balance: INITIAL_BALANCE, history: [], milestones: [] });
export function createRound(state, bet, roll, id, time = new Date().toISOString()) {
  if (state.history.some(r => r.id === id)) return { state, round: state.history.find(r => r.id === id), duplicate: true };
  if (!BETS.includes(bet)) throw new Error('請選擇有效的下注額');
  if (!Number.isSafeInteger(state.balance) || state.balance < bet) throw new Error('測試籌碼不足，請重設試玩');
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) throw new Error('無效的測試亂數');
  const outcome = OUTCOMES.find(o => roll < o.limit);
  const payout = bet * outcome.multiplier;
  const after = state.balance - bet + payout;
  const milestone = after >= 12000 && !state.milestones.includes(12000);
  const round = { id, time, bet, payout, before: state.balance, after, net: payout - bet, ...outcome, grid: makeGrid(outcome.symbols, Math.floor(roll * 1000) % 5), rules: 'kemet-preview-v2', milestone };
  return { round, state: { ...state, balance: after, history: [round, ...state.history].slice(0, 100), milestones: milestone ? [...state.milestones, 12000] : [...state.milestones] } };
}
export function readState(raw) {
  try {
    const state = JSON.parse(raw);
    if (state?.version !== 2 || !Number.isSafeInteger(state.balance) || state.balance < 0 || !Array.isArray(state.history) || !Array.isArray(state.milestones)) return freshState();
    if (state.history.length > 100 || state.history.some(r => !r || typeof r.id !== 'string' || !BETS.includes(r.bet) || !Number.isSafeInteger(r.payout) || r.payout < 0 || !Number.isSafeInteger(r.before) || r.before < r.bet || r.after !== r.before - r.bet + r.payout || r.net !== r.payout - r.bet || !Array.isArray(r.symbols) || r.symbols.length !== COLS || r.symbols.some(s => !SYMBOLS.includes(s)) || !Array.isArray(r.grid) || r.grid.length !== COLS || r.grid.some((col,i) => !Array.isArray(col) || col.length !== ROWS || col[1] !== r.symbols[i] || col.some(s => !SYMBOLS.includes(s))) || !Number.isFinite(Date.parse(r.time)))) return freshState();
    return state;
  } catch { return freshState(); }
}
