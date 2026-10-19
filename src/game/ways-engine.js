import { SYMBOLS } from './symbols.js';
import { winTier } from './win-tier.js';

export function evaluateWays(grid,bet,PAYTABLE,BET_DIVISOR=20) {
  if (!Number.isSafeInteger(bet) || bet <= 0 || bet % BET_DIVISOR !== 0) throw new Error('總下注須為 20 的正整數倍');
  if (!Array.isArray(grid) || grid.length !== 5 || grid.some(col => !Array.isArray(col) || col.length !== 3 || col.some(s => !SYMBOLS.includes(s)))) throw new Error('無效的盤面');
  // The source-derived strips have no W on reels 1/2. This also guarantees
  // that the same all-W way cannot be awarded as several different symbols.
  if (grid.slice(0,2).some(col=>col.includes('wild'))) throw new Error('此版前兩軸不含 WILD');
  const unitBet = bet / BET_DIVISOR;
  const wins = SYMBOLS.slice(0,8).flatMap(symbol => {
    const rows=grid.map(col=>col.flatMap((s,row)=>s===symbol||s==='wild'?[row]:[]));
    let count=0,ways=1;
    while(count<5&&rows[count].length)ways*=rows[count++].length;
    if(count<3)return [];
    const multiplier=PAYTABLE[symbol][count-3];
    const cells=rows.slice(0,count).flatMap((r,col)=>r.map(row=>[col,row]));
    return [{symbol,count,ways,multiplier,payout:multiplier*ways*unitBet,cells}];
  });
  const payout = wins.reduce((sum, win) => sum + win.payout, 0);
  const ways = wins.reduce((sum, win) => sum + win.ways, 0);
  const level = payout >= bet * 20 ? 'jackpot' : payout > bet ? 'medium' : payout > 0 ? 'small' : 'none';
  return { wins, unitBet, ways, payout, multiplier: payout / bet, level, tier:winTier(payout,bet), label: payout ? `${wins.length} 種圖標・${ways} 組得獎` : '寶藏仍在等待' };
}
