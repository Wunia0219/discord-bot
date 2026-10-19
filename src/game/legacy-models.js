// Compatibility only: immutable historical data and one 20-line evaluator.
// New rounds always use slot-math.js. Historical settlements are never rewritten.
import definitions from './legacy-models.json' with {type:'json'};
import { SYMBOLS } from './symbols.js';
import { makeReels,validateReelStops,gridFromReels,uniformStop } from './reel-utils.js';
import { evaluateWays } from './ways-engine.js';
const PAYLINES=Object.freeze([[1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2],[0,1,2,1,0],[2,1,0,1,2],[0,0,1,0,0],[1,2,1,2,1],[0,0,1,2,2],[2,2,1,0,0],[1,2,1,0,1],[1,0,1,2,1],[1,1,0,1,1],[2,1,1,1,2],[0,1,0,1,0],[2,1,2,1,2],[0,1,1,1,0],[1,1,2,1,1],[0,0,2,0,0],[2,2,0,2,2],[0,2,2,2,0]].map(Object.freeze));
function legacyModel(definition){
  const REEL_CODES=Object.freeze(definition.reels.map(Object.freeze)),REEL_STRIPS=makeReels(REEL_CODES);
  const PAYTABLE=Object.freeze(Object.fromEntries(SYMBOLS.map((s,i)=>[s,Object.freeze(definition.payouts[i])])));
  if(definition.scoring==='ways'){
    const evaluateGrid=(grid,bet)=>{
      const result=evaluateWays(grid,bet,PAYTABLE,definition.betDivisor);
      // Preserve archived presentation metadata when current WIN thresholds change.
      return {...result,tier:result.payout>=bet*200?'mega':result.payout>=bet*50?'super':result.payout>=bet*20?'big':null};
    };
    return Object.freeze({MODEL_VERSION:definition.version,REEL_CODES,REEL_STRIPS,SYMBOLS,PAYTABLE,verification:Object.freeze(definition.verification),validateStops:stops=>validateReelStops(REEL_STRIPS,stops),gridFromStops:stops=>gridFromReels(REEL_STRIPS,stops),drawStops:next=>REEL_STRIPS.map(r=>uniformStop(r.length,next)),evaluateGrid});
  }
  function evaluateLine(symbols){
    let best={symbol:null,count:0,multiplier:0};
    for(const symbol of SYMBOLS){
      let count=0;while(count<5&&(symbols[count]===symbol||(symbol!=='wild'&&symbols[count]==='wild')))count++;
      const multiplier=count>=3?PAYTABLE[symbol][count-3]:0;
      if(multiplier>best.multiplier)best={symbol,count,multiplier};
    }return best;
  }
  function evaluateGrid(grid,bet){
    if(!Number.isSafeInteger(bet)||bet<=0||bet%20)throw new Error('總下注須為 20 的正整數倍');
    if(!Array.isArray(grid)||grid.length!==5||grid.some(col=>!Array.isArray(col)||col.length!==3||col.some(s=>!SYMBOLS.includes(s))))throw new Error('無效的盤面');
    const lineBet=bet/20;
    const wins=PAYLINES.flatMap((rows,index)=>{const win=evaluateLine(rows.map((row,col)=>grid[col][row]));return win.multiplier?[{line:index+1,...win,payout:win.multiplier*lineBet}]:[];});
    const payout=wins.reduce((n,w)=>n+w.payout,0),level=payout>=bet*20?'jackpot':payout>bet?'medium':payout>0?'small':'none';
    const tier=definition.megaAt===null?{}:{tier:payout>=bet*definition.megaAt?'mega':payout>=bet*50?'super':payout>=bet*20?'big':null};
    return {wins,lineBet,payout,multiplier:payout/bet,level,...tier,label:payout?`${wins.length} 條連線得獎`:'寶藏仍在等待'};
  }
  return Object.freeze({MODEL_VERSION:definition.version,REEL_CODES,REEL_STRIPS,SYMBOLS,PAYTABLE,PAYLINES,verification:Object.freeze(definition.verification),validateStops:stops=>validateReelStops(REEL_STRIPS,stops),gridFromStops:stops=>gridFromReels(REEL_STRIPS,stops),drawStops:next=>REEL_STRIPS.map(r=>uniformStop(r.length,next)),evaluateLine,evaluateGrid});
}
export const LEGACY_MODELS=Object.freeze(Object.fromEntries(definitions.map(d=>[d.version,legacyModel(d)])));
