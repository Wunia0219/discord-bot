import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { MODEL_VERSION, REEL_CODES, REEL_STRIPS, SYMBOLS, PAYTABLE, PAYLINES, evaluateLine, evaluateGrid, gridFromStops, drawStops } from '../src/slot-math.js';
// Independent prefix-based scorer: considers all 3/4/5-symbol prefixes, including
// an all-W prefix, instead of the runtime scorer's longest-run-per-symbol loop.
function oracle(a) {
  let best=0;
  for(let n=3;n<=5;n++) {
    const prefix=a.slice(0,n), ordinary=[...new Set(prefix.filter(s=>s!=='wild'))];
    if(ordinary.length===0)best=Math.max(best,PAYTABLE.wild[n-3]);
    else if(ordinary.length===1)best=Math.max(best,PAYTABLE[ordinary[0]][n-3]);
  }
  return best;
}
const counts=REEL_STRIPS.map(r=>SYMBOLS.map(s=>r.filter(x=>x===s).length));
const lut=new Uint16Array(9**5);let weighted=0n;
for(let key=0;key<lut.length;key++){
  let v=key, digits=Array(5);for(let i=4;i>=0;i--){digits[i]=v%9;v=Math.floor(v/9)}
  const symbols=digits.map(i=>SYMBOLS[i]);lut[key]=oracle(symbols);
  assert.equal(evaluateLine(symbols).multiplier,lut[key]);
  weighted+=BigInt(lut[key])*digits.reduce((w,d,i)=>w*BigInt(counts[i][d]),1n);
}
const combinations=REEL_STRIPS.reduce((n,r)=>n*r.length,1);
assert.equal(weighted*25n,BigInt(combinations)*24n,'RTP must be exactly 24/25');
const terms=PAYLINES.map(rows=>REEL_STRIPS.map((r,i)=>r.map((_,s)=>SYMBOLS.indexOf(r[(s+rows[i]-1+r.length)%r.length])*9**(4-i))));
function score(stops){let total=0;for(const t of terms)total+=lut[t[0][stops[0]]+t[1][stops[1]]+t[2][stops[2]]+t[3][stops[3]]+t[4][stops[4]]];return total;}
let sum=0,sumSquares=0,hits=0,profits=0,max=0,maxStops;
const distribution=new Map();
for(let a=0;a<REEL_STRIPS[0].length;a++)for(let b=0;b<REEL_STRIPS[1].length;b++)for(let c=0;c<REEL_STRIPS[2].length;c++)for(let d=0;d<REEL_STRIPS[3].length;d++)for(let e=0;e<REEL_STRIPS[4].length;e++){
  const stops=[a,b,c,d,e],p=score(stops);sum+=p;sumSquares+=p*p;if(p>0)hits++;if(p>20)profits++;
  distribution.set(p,(distribution.get(p)||0)+1);
  if(p>max){max=p;maxStops=stops;}
}
assert.equal(sum*25,combinations*20*24);
assert.equal(evaluateGrid(gridFromStops(maxStops),20).payout,max);
let seed=960020;
function next(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;}
const n=1000000;let simSum=0,simSquares=0;
for(let i=0;i<n;i++){
  const stops=drawStops(next),p=score(stops);simSum+=p;simSquares+=p*p;
  if(i<1000)assert.equal(evaluateGrid(gridFromStops(stops),20).payout,p);
}
const mean=simSum/n/20,se=Math.sqrt((simSquares/n/400-mean**2)*n/(n-1)/n);
const report={model:MODEL_VERSION,sha256:createHash('sha256').update(JSON.stringify({REEL_CODES,PAYTABLE,PAYLINES})).digest('hex'),
  lengths:REEL_STRIPS.map(r=>r.length),counts,exact:{stopCombinations:combinations,linePayoutSum:weighted.toString(),lineBet:1,totalPayoutSum:sum,totalBetSum:combinations*20,rtpFraction:'24/25',rtp:sum/combinations/20,hitRate:hits/combinations,profitableRate:profits/combinations,standardDeviationTotalBet:Math.sqrt(sumSquares/combinations/400-.96**2),maximumTotalBetMultiplier:max/20,maximumStops:maxStops},
  simulation:{generator:'xorshift32 (verification only; game uses crypto)',seed:960020,rounds:n,rtp:mean,standardError:se,approximate95PercentInterval:[mean-1.96*se,mean+1.96*se]},
  payoutDistributionInLineBets:Object.fromEntries([...distribution].sort((a,b)=>a[0]-b[0]))};
writeFileSync(new URL('../docs/math-report.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,payoutDistributionInLineBets:undefined},null,2));
