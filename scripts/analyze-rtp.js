// Research only. Does not change runtime math, wallets, or command registration.
// Run npm run verify:math first to regenerate the exact full-grid distribution.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { MODEL_VERSION, REEL_CODES, PAYTABLE, PAYLINES, SYMBOLS, evaluateLine } from '../src/slot-math.js';

const source=JSON.parse(readFileSync(new URL('../docs/math-report.json',import.meta.url)));
const hash=createHash('sha256').update(JSON.stringify({REEL_CODES,PAYTABLE,PAYLINES})).digest('hex');
assert.equal(source.sha256,hash,'Run verify:math after changing the model');
const distribution=Object.entries(source.payoutDistributionInLineBets).map(([p,n])=>[Number(p)/20,n]);
const n=source.exact.stopCombinations;
assert.equal(distribution.reduce((sum,[,count])=>sum+count,0),n);
const bands=[['0',x=>x===0],['0<x<1',x=>x>0&&x<1],['1',x=>x===1],['1<x<5',x=>x>1&&x<5],['5<=x<20',x=>x>=5&&x<20],['20<=x<50',x=>x>=20&&x<50],['50<=x<100',x=>x>=50&&x<100],['x>=100',x=>x>=100]].map(([label,match])=>{
  const values=distribution.filter(([x])=>match(x));
  return {label,count:values.reduce((sum,[,count])=>sum+count,0),probability:values.reduce((sum,[,count])=>sum+count/n,0),rtpContribution:values.reduce((sum,[x,count])=>sum+x*count/n,0)};
});
const thresholds=[10,20,30,50,100,source.exact.maximumTotalBetMultiplier].map(multiplier=>{
  const count=distribution.filter(([x])=>x>=multiplier).reduce((sum,[,count])=>sum+count,0);
  return {multiplier,count,probability:count/n,meanSpins:n/count};
});
const p=thresholds.find(t=>t.multiplier===20).probability;
const sessionProbabilities=[20,30,50,100,200,500].map(spins=>({spins,atLeastTwoBigWins:1-(1-p)**spins-spins*p*(1-p)**(spins-1)}));
function lineAnalysis(counts){
  const denominator=counts.reduce((product,reel)=>product*reel.reduce((a,b)=>a+b,0),1);
  const symbolReturns=Object.fromEntries(SYMBOLS.map(s=>[s,0]));
  let wildAssistedReturn=0;
  for(let key=0;key<9**5;key++){
    let v=key,weight=1;const symbols=[];
    for(let i=0;i<5;i++){const digit=v%9;v=Math.floor(v/9);symbols.push(SYMBOLS[digit]);weight*=counts[i][digit];}
    const win=evaluateLine(symbols);
    if(win.multiplier){
      symbolReturns[win.symbol]+=weight*win.multiplier/denominator;
      if(symbols.slice(0,win.count).includes('wild'))wildAssistedReturn+=weight*win.multiplier/denominator;
    }
  }
  return {rtp:Object.values(symbolReturns).reduce((a,b)=>a+b,0),symbolReturns,wildAssistedReturn};
}
const baseline=lineAnalysis(source.counts);
assert.ok(Math.abs(baseline.rtp-.96)<1e-10);
const sensitivity=[
  {name:'low-counts-x1.5-others-unchanged',counts:source.counts.map(r=>r.map((v,i)=>v*(i>=4&&i<=7?3:2)))},
  {name:'low-counts-x2-others-unchanged',counts:source.counts.map(r=>r.map((v,i)=>v*(i>=4&&i<=7?2:1)))},
  {name:'balanced-50-stop-counts',counts:Array.from({length:5},()=>[3,3,3,3,9,9,9,9,2])},
].map(s=>({...s,...lineAnalysis(s.counts)}));
const reelMix=source.counts.map((r,i)=>({reel:i+1,low:r.slice(4,8).reduce((a,b)=>a+b,0)/source.lengths[i],high:r.slice(0,4).reduce((a,b)=>a+b,0)/source.lengths[i],wild:r[8]/source.lengths[i]}));
const result={model:MODEL_VERSION,sha256:hash,method:'Exact verified grid distribution; exact single-line expectations for hypothetical count-only models. Hypothetical models have no reel ordering and are not playable candidates.',reelMix,baseline,bands,thresholds,sessionProbabilities,sensitivity};
writeFileSync(new URL('../docs/rtp-audit.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
