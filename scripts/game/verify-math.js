// Exact 243-way distribution: compress identical visible copy counts with
// integer weights, then merge identical first-three-reel award expressions.
import { readFileSync,writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { MODEL_VERSION,REEL_CODES,REEL_STRIPS,SYMBOLS,PAYTABLE,BET_DIVISOR,evaluateGrid,gridFromStops,drawStops } from '../../src/game/slot-math.js';
const lengths=REEL_STRIPS.map(r=>r.length),product=a=>a.reduce((p,n)=>p*n,1),total=product(lengths);
const source=JSON.parse(readFileSync(new URL('../../docs/data/model-source.json',import.meta.url)));
REEL_STRIPS.forEach((r,i)=>SYMBOLS.forEach((s,j)=>assert.ok(Math.abs(r.filter(x=>x===s).length/r.length-source.targetProbabilities[i][j])<=source.frequencyTolerance,'Fixed design symbol frequency differs from audited counts')));
assert.ok(REEL_STRIPS.slice(0,2).every(r=>!r.includes('wild')));
const windows=REEL_STRIPS.map(strip=>{
  const unique=new Map();
  strip.forEach((_,stop)=>{
    const counts=SYMBOLS.map(s=>[-1,0,1].filter(d=>strip[(stop+d+strip.length)%strip.length]===s).length),key=counts.join(',');
    if(unique.has(key))unique.get(key).weight++;
    else unique.set(key,{copies:counts.slice(0,8).map(n=>n+counts[8]),weight:1,stop});
  });return [...unique.values()];
});
const groups=new Map();
for(const a of windows[0])for(const b of windows[1])for(const c of windows[2]){
  const copies=a.copies.map((n,s)=>n*b.copies[s]*c.copies[s]),key=copies.join(','),weight=a.weight*b.weight*c.weight;
  if(groups.has(key))groups.get(key).weight+=weight;else groups.set(key,{copies,weight,stops:[a.stop,b.stop,c.stop]});
}
assert.equal([...groups.values()].reduce((n,g)=>n+g.weight,0),product(lengths.slice(0,3)));
const pairs=[];
for(const d of windows[3])for(const e of windows[4])pairs.push({d,e,weight:d.weight*e.weight,awards:SYMBOLS.slice(0,8).map((s,i)=>!d.copies[i]?PAYTABLE[s][0]:!e.copies[i]?d.copies[i]*PAYTABLE[s][1]:d.copies[i]*e.copies[i]*PAYTABLE[s][2])});
const histogram=new Map(),symbolRounds=Array(8).fill(0),symbolPayout=Array(8).fill(0n),previews={},tierCounts={big:0,super:0,mega:0};
let covered=0,hits=0,profits=0,spadeOnly=0,max=0,maxStops,sum=0n,squares=0n,none,small;
for(const group of groups.values()){
  const active=group.copies.flatMap((n,s)=>n?[s]:[]),groupRounds=group.weight*product(lengths.slice(3));
  for(const s of active)symbolRounds[s]+=groupRounds;
  if(active.length===1&&active[0]===4)spadeOnly+=groupRounds;
  if(!active.length){histogram.set(0,(histogram.get(0)||0)+groupRounds);covered+=groupRounds;none||={stops:[...group.stops,pairs[0].d.stop,pairs[0].e.stop],payout:0};continue;}
  hits+=groupRounds;
  for(const pair of pairs){
    const p=active.reduce((n,s)=>n+group.copies[s]*pair.awards[s],0),weight=group.weight*pair.weight;
    covered+=weight;histogram.set(p,(histogram.get(p)||0)+weight);
    sum+=BigInt(p)*BigInt(weight);squares+=BigInt(p*p)*BigInt(weight);
    for(const s of active)symbolPayout[s]+=BigInt(group.copies[s]*pair.awards[s])*BigInt(weight);
    if(p>BET_DIVISOR)profits+=weight;
    const stops=[...group.stops,pair.d.stop,pair.e.stop];
    if(!small&&p<BET_DIVISOR)small={stops,payout:p};
    if(p>max){max=p;maxStops=stops;}
    const tier=p>=BET_DIVISOR*200?'mega':p>=BET_DIVISOR*50?'super':p>=BET_DIVISOR*20?'big':null;
    if(tier){tierCounts[tier]+=weight;if(!previews[tier]||p<previews[tier].payout)previews[tier]={stops,payout:p};}
  }
}
assert.equal(covered,total);
assert.equal(evaluateGrid(gridFromStops(maxStops),BET_DIVISOR).payout,max);
for(const [tier,p] of Object.entries(previews))assert.equal(evaluateGrid(gridFromStops(p.stops),BET_DIVISOR).tier,tier);
assert.equal(Object.keys(previews).length,3);
// A separate closed-form expectation, including zero-copy extension windows.
let expected=0n;
for(let s=0;s<8;s++){
  const sums=windows.map(r=>BigInt(r.reduce((n,w)=>n+w.copies[s]*w.weight,0)));
  const zeros=windows.map(r=>BigInt(r.reduce((n,w)=>n+(w.copies[s]?0:w.weight),0)));
  const p=PAYTABLE[SYMBOLS[s]];
  const n=sums[0]*sums[1]*sums[2]*(BigInt(p[0])*zeros[3]*BigInt(lengths[4])+BigInt(p[1])*sums[3]*zeros[4]+BigInt(p[2])*sums[3]*sums[4]);
  assert.equal(n,symbolPayout[s]);expected+=n;
}
assert.equal(expected,sum);
assert.equal(sum*25n,BigInt(total*BET_DIVISOR)*24n,'RTP must be exactly 24/25');
const gcd=(a,b)=>b?gcd(b,a%b):a,denominator=BigInt(total*BET_DIVISOR),divisor=gcd(sum,denominator),rtp=Number(sum)/Number(denominator);
const tails=Object.fromEntries([20,50,200].map(t=>{const count=[...histogram].reduce((n,[p,w])=>n+(p>=t*BET_DIVISOR?w:0),0);return [t,{count,probability:count/total,meanSpins:total/count}];}));
const sha256=createHash('sha256').update(JSON.stringify({MODEL_VERSION,REEL_CODES,PAYTABLE,BET_DIVISOR})).digest('hex');
const report={model:MODEL_VERSION,sha256,lengths,counts:REEL_STRIPS.map(r=>SYMBOLS.map(s=>r.filter(x=>x===s).length)),enumeration:{method:'exact weighted visible-copy counts and first-three award expressions; complete last-two window enumeration',uniqueCountWindows:windows.map(r=>r.length),firstThreeExpressionGroups:groups.size,tailPairs:pairs.length,coveredStopCombinations:covered},exact:{stopCombinations:total,totalPayoutSum:String(sum),totalBetSum:String(denominator),rtpFraction:String(sum/divisor)+'/'+String(denominator/divisor),rtp,hitRate:hits/total,profitableRate:profits/total,lossWithPayoutRate:[...histogram].reduce((n,[p,w])=>n+(p>0&&p<BET_DIVISOR?w:0),0)/total,spadeOnlyRate:spadeOnly/total,maximumTotalBetMultiplier:max/BET_DIVISOR,maximumStops:maxStops,standardDeviationTotalBet:Math.sqrt(Number(squares)/total/BET_DIVISOR**2-rtp**2),tails,tierCounts,symbols:Object.fromEntries(SYMBOLS.slice(0,8).map((s,i)=>[s,{roundFrequency:symbolRounds[i]/total,rtpContribution:Number(symbolPayout[i])/Number(denominator),payoutShare:Number(symbolPayout[i])/Number(sum)}]))},examples:{...previews,none,small},payoutDistributionInUnits:Object.fromEntries([...histogram].sort((a,b)=>a[0]-b[0]))};
writeFileSync(new URL('../../docs/data/math-report.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
let seed=0x96243001,initial;
const next=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
for(let i=0;i<10000&&!initial;i++){const stops=drawStops(next);if(new Set(gridFromStops(stops).flat()).size===9)initial=stops;}
assert.ok(initial);
writeFileSync(new URL('../../src/game/model-config.js',import.meta.url),`// Generated by verify:math from the fixed 243-way strips.\nexport const PAYOUTS=Object.freeze(${JSON.stringify(SYMBOLS.map(s=>PAYTABLE[s]))}.map(Object.freeze));\nexport const THEORETICAL_RTP=${rtp};\nexport const MAXIMUM_MULTIPLIER=${max/BET_DIVISOR};\nexport const BIG_WIN_MEAN_SPINS=${tails[20].meanSpins};\nexport const INITIAL_STOPS=Object.freeze(${JSON.stringify(initial)});\n`);
console.log(JSON.stringify({model:MODEL_VERSION,coveredStopCombinations:covered,rtpFraction:report.exact.rtpFraction,rtp,hitRate:report.exact.hitRate,spadePayoutShare:report.exact.symbols.ace.payoutShare,maximumMultiplier:max/BET_DIVISOR,sha256},null,2));
