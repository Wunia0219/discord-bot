// Exact whole-game distribution. Merge only mathematically identical payout
// expressions; retain integer multiplicities for all 80^5 original stop tuples.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const current=process.argv.includes('--current');
const { MODEL_VERSION, REEL_CODES, REEL_STRIPS, SYMBOLS, PAYTABLE, PAYLINES, evaluateLine, evaluateGrid, gridFromStops, drawStops }=await import(current?'../src/slot-math.js':'../src/models/v5/slot-math.js');
assert.equal(MODEL_VERSION,'circus-20-v5');assert.ok(REEL_STRIPS.every(r=>r.length===80));
const counts=REEL_STRIPS.map(r=>SYMBOLS.map(s=>r.filter(x=>x===s).length));
const windows=REEL_STRIPS.map(r=>{
  const unique=new Map();
  r.forEach((_,stop)=>{
    const values=[-1,0,1].map(d=>SYMBOLS.indexOf(r[(stop+d+r.length)%r.length]));
    const key=values.join(',');
    if(unique.has(key))unique.get(key).weight++;else unique.set(key,{values,weight:1,stop});
  });
  return [...unique.values()];
});
const lut=new Uint16Array(9**5),tripleWins=new Uint8Array(9**3);
let weighted=0n;
for(let key=0;key<lut.length;key++) {
  let v=key;const digits=Array(5);for(let i=4;i>=0;i--){digits[i]=v%9;v=Math.floor(v/9);}
  const line=digits.map(s=>SYMBOLS[s]);let best=0;
  // Independent prefix oracle, including the highest-paying all-WILD substitute.
  for(let n=3;n<=5;n++) {
    const ordinary=[...new Set(line.slice(0,n).filter(s=>s!=='wild'))];
    if(ordinary.length===0)best=Math.max(best,...SYMBOLS.map(s=>PAYTABLE[s][n-3]));
    else if(ordinary.length===1)best=Math.max(best,PAYTABLE[ordinary[0]][n-3]);
  }
  assert.equal(evaluateLine(line).multiplier,best);lut[key]=best;
  if(best)tripleWins[Math.floor(key/81)]=1;
  weighted+=BigInt(best)*digits.reduce((p,s,i)=>p*BigInt(counts[i][s]),1n);
}
const total=REEL_STRIPS.reduce((a,r)=>a*r.length,1);
assert.equal(weighted*25n,BigInt(total)*24n);
const groups=new Map();
let firstThreeCovered=0;
for(const a of windows[0])for(const b of windows[1])for(const c of windows[2]) {
  const ids=[];
  for(const rows of PAYLINES) {
    const triple=a.values[rows[0]]*81+b.values[rows[1]]*9+c.values[rows[2]];
    if(tripleWins[triple])ids.push(triple*9+rows[3]*3+rows[4]);
  }
  ids.sort((a,b)=>a-b);
  const key=ids.join(','),weight=a.weight*b.weight*c.weight;
  firstThreeCovered+=weight;
  if(groups.has(key))groups.get(key).weight+=weight;
  else groups.set(key,{ids,weight,stops:[a.stop,b.stop,c.stop]});
}
assert.equal(firstThreeCovered,80**3);
const tailPairs=[];
for(const d of windows[3])for(const e of windows[4])tailPairs.push({d,e,weight:d.weight*e.weight});
assert.equal(tailPairs.reduce((a,p)=>a+p.weight,0),80**2);
const tableCache=new Map();
function tableFor(id) {
  if(tableCache.has(id))return tableCache.get(id);
  const triple=Math.floor(id/9),row4=Math.floor(id%9/3),row5=id%3;
  const result=Uint16Array.from(tailPairs,({d,e})=>lut[triple*81+d.values[row4]*9+e.values[row5]]);
  tableCache.set(id,result);return result;
}
console.log('Exact states:',windows.map(r=>r.length),'first-three payout expression groups:',groups.size,'tail windows:',tailPairs.length,'original stops:',total);
const distribution=new Float64Array(10001),previews={},tierCounts={big:0,super:0,mega:0};
let sum=0,squares=0,hits=0,profits=0,max=0,maxStops,covered=0,processed=0;
for(const group of groups.values()) {
  if(!group.ids.length) {
    const weight=group.weight*80**2;distribution[0]+=weight;covered+=weight;continue;
  }
  const tables=group.ids.map(tableFor);
  for(let j=0;j<tailPairs.length;j++) {
    let p=0;for(let k=0;k<tables.length;k++)p+=tables[k][j];
    const pair=tailPairs[j],weight=group.weight*pair.weight;
    distribution[p]+=weight;covered+=weight;sum+=p*weight;squares+=p*p*weight;
    if(p)hits+=weight;if(p>20)profits+=weight;
    if(p>max){max=p;maxStops=[...group.stops,pair.d.stop,pair.e.stop];}
    const tier=p>=4000?'mega':p>=1000?'super':p>=400?'big':null;
    if(tier) {
      tierCounts[tier]+=weight;
      if(!previews[tier]||p<previews[tier].payout)previews[tier]={stops:[...group.stops,pair.d.stop,pair.e.stop],payout:p};
    }
  }
  if(++processed%10000===0)console.log('Verified groups',processed,'/',groups.size);
}
assert.equal(covered,total);assert.ok(Number.isSafeInteger(sum));assert.ok(Number.isSafeInteger(squares));
assert.equal(sum*25,total*20*24);
assert.equal(evaluateGrid(gridFromStops(maxStops),20).payout,max);
assert.equal(max,4000,'Natural maximum must be exactly 200x total bet');
for(const count of Object.values(tierCounts))assert.ok(count>0,'All three WIN tiers must be reachable');
const tails=Object.fromEntries([20,50,100,200].map(t=>{
  const count=distribution.reduce((a,n,p)=>a+(p>=t*20?n:0),0);
  return [t,{count,probability:count/total,meanSpins:count?total/count:null}];
}));
let seed=960020;
const next=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
const rounds=1000000;let simSum=0,simSquares=0,initial;
for(let i=0;i<rounds;i++) {
  const stops=drawStops(next),grid=gridFromStops(stops);let p=0;
  for(const rows of PAYLINES)p+=lut[rows.reduce((k,r,c)=>k*9+SYMBOLS.indexOf(grid[c][r]),0)];
  if(i<1000)assert.equal(p,evaluateGrid(grid,20).payout);
  if(!initial&&new Set(grid.flat()).size===9)initial=stops;
  simSum+=p;simSquares+=p*p;
}
assert.ok(initial);
const mean=simSum/rounds/20,se=Math.sqrt((simSquares/rounds/400-mean**2)/(rounds-1));
const report={model:MODEL_VERSION,sha256:createHash('sha256').update(JSON.stringify({REEL_CODES,PAYTABLE,PAYLINES})).digest('hex'),lengths:REEL_STRIPS.map(r=>r.length),counts,enumeration:{method:'exact weighted unique three-row windows; identical first-three payout expressions grouped with multiplicities; full last-two enumeration; no sampled outcomes',uniqueWindows:windows.map(r=>r.length),compressedCombinations:windows.reduce((a,r)=>a*r.length,1),firstThreeExpressionGroups:groups.size,tailWindowPairs:tailPairs.length,evaluatedPayoutStates:groups.size*tailPairs.length,coveredStopCombinations:covered},exact:{stopCombinations:total,linePayoutSum:String(weighted),lineBet:1,totalPayoutSum:sum,totalBetSum:total*20,rtpFraction:'24/25',rtp:sum/(total*20),hitRate:hits/total,profitableRate:profits/total,standardDeviationTotalBet:Math.sqrt(squares/total/400-.96**2),maximumTotalBetMultiplier:max/20,maximumStops:maxStops,tails,tierCounts},simulation:{generator:'xorshift32 verification only; runtime uses crypto',seed:960020,rounds,rtp:mean,standardError:se,approximate95PercentInterval:[mean-1.96*se,mean+1.96*se]},payoutDistributionInLineBets:Object.fromEntries([...distribution].flatMap((n,p)=>n?[[p,n]]:[]))};
writeFileSync(new URL('../docs/math-report-v5.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
if(current)writeFileSync(new URL('../docs/math-report.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
const modelPath=new URL('../docs/model-v5-selected.json',import.meta.url),model=JSON.parse(readFileSync(modelPath));
model.status=current?'fully verified active model':'fully verified offline model';model.stats=report.exact;model.previews=previews;model.initial=initial;
writeFileSync(modelPath,JSON.stringify(model,null,2)+'\n');
writeFileSync(new URL('../src/models/v5/model-config.js',import.meta.url),`// Fully enumerated 80-stop model; fixed V1 awards with WILD=H1.\nexport const PAYOUTS=Object.freeze(${JSON.stringify(model.paytable)}.map(Object.freeze));\nexport const MAXIMUM_MULTIPLIER=200;\nexport const BIG_WIN_MEAN_SPINS=${tails[20].meanSpins};\nexport const INITIAL_STOPS=Object.freeze(${JSON.stringify(initial)});\nexport const TIER_PREVIEW_STOPS=Object.freeze({${Object.entries(previews).map(([tier,p])=>`${tier}:Object.freeze(${JSON.stringify(p.stops)})`).join(',')}});\n`);
console.log(JSON.stringify({...report,payoutDistributionInLineBets:undefined},null,2));
