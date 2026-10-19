import { SYMBOLS, COLS, ROWS, MODEL_VERSION, INITIAL_STOPS, gridFromStops, evaluateGrid, validateStops } from './slot-math.js';
import { LEGACY_MODELS } from './legacy-models.js';
export { LEGACY_MODELS };
export * from './slot-math.js';
export const INITIAL_BALANCE = 10000;
export const BETS = [20, 100, 200, 500];
export const freshState = () => ({ version: 3, balance: INITIAL_BALANCE, history: [], milestones: [] });
export function roundFromStops(bet, stops) {
  const grid = gridFromStops(stops);
  return { ...evaluateGrid(grid, bet), grid, stops: [...stops], symbols: grid.map(col => col[1]), rules: MODEL_VERSION };
}
export function createRound(state, bet, stops, id, time = new Date().toISOString()) {
  if (state.history.some(r => r.id === id)) return { state, round: state.history.find(r => r.id === id), duplicate: true };
  if (!BETS.includes(bet)) throw new Error('請選擇有效的下注額');
  if (!Number.isSafeInteger(state.balance) || state.balance < bet) throw new Error('測試籌碼不足，請重設試玩');
  if (typeof id !== 'string' || !id || !Number.isFinite(Date.parse(time))) throw new Error('無效的局號或時間');
  const outcome = roundFromStops(bet, stops);
  const after = state.balance - bet + outcome.payout;
  if (!Number.isSafeInteger(after)) throw new Error('籌碼超過可記帳範圍');
  const milestone = after >= 12000 && !state.milestones.includes(12000);
  const round = { id, time, bet, before: state.balance, after, net: outcome.payout - bet, ...outcome, milestone };
  return { round, state: { ...state, version: 3, balance: after, history: [round, ...state.history].slice(0, 100), milestones: milestone ? [...state.milestones, 12000] : [...state.milestones] } };
}
export function readState(raw) {
  try {
    const state = JSON.parse(raw);
    if (![2, 3].includes(state?.version) || !Number.isSafeInteger(state.balance) || state.balance < 0 || !Array.isArray(state.history) || !Array.isArray(state.milestones) || state.milestones.some(x => x !== 12000)) return freshState();
    if (state.history.length > 100 || new Set(state.history.map(r => r?.id)).size !== state.history.length) return freshState();
    for (const r of state.history) {
      const legacy = r?.rules === 'kemet-preview-v2';
      if (!r || typeof r.id !== 'string' || !(legacy ? [50,100,250,500] : BETS).includes(r.bet) || !Number.isSafeInteger(r.payout) || r.payout < 0 || !Number.isSafeInteger(r.before) || r.before < r.bet || !Number.isSafeInteger(r.after) || r.after !== r.before - r.bet + r.payout || r.net !== r.payout - r.bet || !Number.isFinite(Date.parse(r.time))) return freshState();
      if (!Array.isArray(r.symbols) || r.symbols.length !== COLS || !Array.isArray(r.grid) || r.grid.length !== COLS || r.grid.some((col, i) => !Array.isArray(col) || col.length !== ROWS || col[1] !== r.symbols[i] || col.some(s => !SYMBOLS.includes(s)))) return freshState();
      if (!legacy) {
        const math=r.rules===MODEL_VERSION?{validateStops,gridFromStops,evaluateGrid}:LEGACY_MODELS[r.rules];
        if(!math)return freshState();
        math.validateStops(r.stops);
        const grid=math.gridFromStops(r.stops);
        const expected = {...math.evaluateGrid(grid,r.bet),grid};
        if (JSON.stringify(r.grid) !== JSON.stringify(expected.grid) || r.payout !== expected.payout || r.lineBet !== expected.lineBet || r.unitBet !== expected.unitBet || JSON.stringify(r.wins) !== JSON.stringify(expected.wins)) return freshState();
      }
    }
    if (state.history.length && state.history[0].after !== state.balance) return freshState();
    return { ...state, version: 3 };
  } catch { return freshState(); }
}
export const restoredStops = state => state.history[0]?.rules === MODEL_VERSION ? state.history[0].stops : INITIAL_STOPS;
