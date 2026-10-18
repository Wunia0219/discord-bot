export const INITIAL_BALANCE = 10000;
export const BETS = [50, 100, 250, 500];
export const SYMBOLS = ['moon', 'gem', 'star', 'seven', 'cherry', 'crown'];
export const SYMBOL_NAMES = { moon: '月亮', gem: '寶石', star: '星星', seven: '幸運 7', cherry: '櫻桃', crown: '皇冠' };
// Illustrative preview distribution, NOT approved production odds.
export const OUTCOMES = [
  { limit: .50, symbols: ['gem', 'moon', 'cherry'], multiplier: 0, label: '星光稍歇', level: 'none' },
  { limit: .80, symbols: ['cherry', 'cherry', 'cherry'], multiplier: 2, label: '小小幸運', level: 'small' },
  { limit: .95, symbols: ['gem', 'gem', 'gem'], multiplier: 5, label: '璀璨時刻', level: 'medium' },
  { limit: 1, symbols: ['seven', 'seven', 'seven'], multiplier: 20, label: '月光大獎', level: 'jackpot' },
];
export const freshState = () => ({ version: 1, balance: INITIAL_BALANCE, history: [], milestones: [] });
export function createRound(state, bet, roll, id, time = new Date().toISOString()) {
  if (state.history.some(r => r.id === id)) return { state, round: state.history.find(r => r.id === id), duplicate: true };
  if (!BETS.includes(bet)) throw new Error('請選擇有效的下注額');
  if (!Number.isSafeInteger(state.balance) || state.balance < bet) throw new Error('測試籌碼不足，請重設試玩');
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) throw new Error('無效的測試亂數');
  const outcome = OUTCOMES.find(o => roll < o.limit);
  const payout = bet * outcome.multiplier;
  const after = state.balance - bet + payout;
  const milestone = after >= 12000 && !state.milestones.includes(12000);
  const round = { id, time, bet, payout, before: state.balance, after, net: payout - bet, ...outcome, rules: 'preview-v1', milestone };
  return { round, state: { ...state, balance: after, history: [round, ...state.history].slice(0, 100), milestones: milestone ? [...state.milestones, 12000] : [...state.milestones] } };
}
export function readState(raw) {
  try {
    const state = JSON.parse(raw);
    if (state?.version !== 1 || !Number.isSafeInteger(state.balance) || state.balance < 0 || !Array.isArray(state.history) || !Array.isArray(state.milestones)) return freshState();
    if (state.history.length > 100 || state.history.some(r => !r || typeof r.id !== 'string' || !BETS.includes(r.bet) || !Number.isSafeInteger(r.payout) || r.payout < 0 || !Number.isSafeInteger(r.before) || r.before < r.bet || r.after !== r.before - r.bet + r.payout || r.net !== r.payout - r.bet || !Array.isArray(r.symbols) || r.symbols.length !== 3 || r.symbols.some(s => !SYMBOLS.includes(s)) || !Number.isFinite(Date.parse(r.time)))) return freshState();
    return state;
  } catch { return freshState(); }
}
