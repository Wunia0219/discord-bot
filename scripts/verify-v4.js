// Exact window-compressed full-grid enumeration; equivalent to all 200^5 stops.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const current=process.argv.includes('--current');
const {MODEL_VERSION,REEL_CODES,REEL_STRIPS,SYMBOLS,PAYTABLE,PAYLINES,evaluateLine,evaluateGrid,gridFromStops,drawStops}=await import(current?'../src/slot-math.js':'../src/models/v4/slot-math.js');
const counts=REEL_STRIPS.map(r=>SYMBOLS.map(s=>r.filter(x=>x===s).length));
const windows=REEL_STRIPS.map(r=>{
 const unique=new Map();r.forEach((_,stop)=>{const values=[-1,0,1].map(o=>SYMBOLS.indexOf(r[(stop+o+r.length)%r.length])),key=values.join(',');const w=unique.get(key);if(w)w.weight++;else unique.set(key,{values,weight:1,stop});});return [...unique.values()];
});
const total=REEL_STRIPS.reduce((p,r)=>p*r.length,1),lut=new Uint16Array(9**5);let weighted=0n;
// Independent prefix scorer, including all-W substitution. Check every line.
for(let key=0;key<lut.length;key++){
 let v=key;const digits=Array(5);for(let i=4;i>=0;i--){digits[i]=v%9;v=Math.floor(v/9);}
 const line=digits.map(s=>SYMBOLS[s]);let best=0;
 for(let n=3;n<=5;n++){const ordinary=[...new Set(line.slice(0,n).filter(s=>s!=='wild'))];if(ordinary.length===0)best=Math.max(best,...SYMBOLS.map(s=>PAYTABLE[s][n-3]));else if(ordinary.length===1)best=Math.max(best,PAYTABLE[ordinary[0]][n-3]);}
 assert.equal(best,evaluateLine(line).multiplier);lut[key]=best;
 weighted+=BigInt(best)*digits.reduce((p,s,i)=>p*BigInt(counts[i][s]),1n);
}
assert.equal(weighted*25n,BigInt(total)*24n);
const terms=PAYLINES.map(rows=>windows.map((r,i)=>r.map(w=>w.values[rows[i]]*9**(4-i))));
const distribution=new Map(),previews={},tierCounts={big:0,super:0,mega:0};
let sum=0,squares=0,hits=0,profits=0,max=0,maxStops,covered=0;
console.log('Exact compressed combinations',windows.map(r=>r.length),windows.reduce((p,r)=>p*r.length,1),'representing',total);
for(let a=0;a<windows[0].length;a++){
 for(let b=0;b<windows[1].length;b++)for(let c=0;c<windows[2].length;c++)for(let d=0;d<windows[3].length;d++)for(let e=0;e<windows[4].length;e++){
  let p=0;for(const t of terms)p+=lut[t[0][a]+t[1][b]+t[2][c]+t[3][d]+t[4][e]];
  const selected=[a,b,c,d,e].map((j,i)=>windows[i][j]),weight=selected.reduce((p,w)=>p*w.weight,1);
  covered+=weight;sum+=p*weight;squares+=p*p*weight;if(p)hits+=weight;if(p>20)profits+=weight;
  distribution.set(p,(distribution.get(p)||0)+weight);
  if(p>max){max=p;maxStops=selected.map(w=>w.stop);}
  const tier=p>=4000?'mega':p>=1000?'super':p>=400?'big':null;
  if(tier){tierCounts[tier]+=weight;if(!previews[tier]||p<previews[tier].payout)previews[tier]={stops:selected.map(w=>w.stop),payout:p};}
 }
 if(a%10===0)console.log('First reel windows completed',a+1,'/',windows[0].length);
}
assert.equal(covered,total);assert.equal(sum*25,total*20*24);
assert.equal(evaluateGrid(gridFromStops(maxStops),20).payout,max);
assert.equal(max,4000,'Natural maximum must remain exactly 200x total bet');
for(const count of Object.values(tierCounts))assert.ok(count>0,'Each WIN tier must be reachable');
let seed=960020;function next(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;}
const rounds=1000000;let simSum=0,simSquares=0;
for(let i=0;i<rounds;i++){
 const stops=drawStops(next),grid=gridFromStops(stops);let p=0;
 for(const rows of PAYLINES){const key=rows.reduce((k,r,c)=>k*9+SYMBOLS.indexOf(grid[c][r]),0);p+=lut[key];}
 if(i<1000)assert.equal(p,evaluateGrid(grid,20).payout);
 simSum+=p;simSquares+=p*p;
}
const mean=simSum/rounds/20,se=Math.sqrt((simSquares/rounds/400-mean**2)/(rounds-1));
const tails=Object.fromEntries([20,50,100,200].map(t=>{const count=[...distribution].reduce((n,[p,w])=>n+(p>=t*20?w:0),0);return [t,{count,probability:count/total,meanSpins:count?total/count:null}];}));
let initial;
for(const a of windows[0]){if(initial)break;for(const b of windows[1]){if(initial)break;for(const c of windows[2]){if(initial)break;for(const d of windows[3]){if(initial)break;for(const e of windows[4])if(new Set([a,b,c,d,e].flatMap(w=>w.values)).size===9){initial=[a,b,c,d,e].map(w=>w.stop);break;}}}}}
assert.ok(initial);
const report={model:MODEL_VERSION,sha256:createHash('sha256').update(JSON.stringify({REEL_CODES,PAYTABLE,PAYLINES})).digest('hex'),lengths:REEL_STRIPS.map(r=>r.length),counts,enumeration:{method:'exact weighted unique three-row windows; no sampled outcomes',uniqueWindows:windows.map(r=>r.length),compressedCombinations:windows.reduce((p,r)=>p*r.length,1),coveredStopCombinations:covered},exact:{stopCombinations:total,linePayoutSum:String(weighted),lineBet:1,totalPayoutSum:sum,totalBetSum:total*20,rtpFraction:'24/25',rtp:sum/(total*20),hitRate:hits/total,profitableRate:profits/total,standardDeviationTotalBet:Math.sqrt(squares/total/400-.96**2),maximumTotalBetMultiplier:max/20,maximumStops:maxStops,tails,tierCounts},simulation:{generator:'xorshift32 verification only',seed:960020,rounds,rtp:mean,standardError:se,approximate95PercentInterval:[mean-1.96*se,mean+1.96*se]},payoutDistributionInLineBets:Object.fromEntries([...distribution].sort((a,b)=>a[0]-b[0]))};
writeFileSync(new URL('../docs/math-report-v4.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
if(current)writeFileSync(new URL('../docs/math-report.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
const model=JSON.parse(readFileSync(new URL('../docs/model-v4-selected.json',import.meta.url)));model.stats=report.exact;model.previews=previews;model.initial=initial;writeFileSync(new URL('../docs/model-v4-selected.json',import.meta.url),JSON.stringify(model,null,2)+'\n');
writeFileSync(new URL('../src/models/v4/model-config.js',import.meta.url),`// Exact 200-stop weighted enumeration; fixed V1 awards with WILD=H1.\nexport const PAYOUTS=Object.freeze(${JSON.stringify(model.paytable)}.map(Object.freeze));\nexport const MAXIMUM_MULTIPLIER=${max/20};\nexport const BIG_WIN_MEAN_SPINS=${tails[20].meanSpins};\nexport const INITIAL_STOPS=Object.freeze(${JSON.stringify(initial)});\nexport const TIER_PREVIEW_STOPS=Object.freeze({${Object.entries(previews).map(([tier,p])=>`${tier}:Object.freeze(${JSON.stringify(p.stops)})`).join(',')}});\n`);
console.log(JSON.stringify({...report,payoutDistributionInLineBets:undefined},null,2));
