// Offline research only: exact distribution analysis and fixed-length session sampling.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const current=process.argv.includes('--current');
const {REEL_CODES,PAYTABLE,PAYLINES}=await import(current?'../src/slot-math.js':'../src/models/v2/slot-math.js');
const report=JSON.parse(readFileSync(new URL(current?'../docs/math-report.json':'../docs/math-report-v2.json',import.meta.url)));
assert.equal(report.sha256,createHash('sha256').update(JSON.stringify({REEL_CODES,PAYTABLE,PAYLINES})).digest('hex'));
const dist=Object.entries(report.payoutDistributionInLineBets).map(([p,n])=>({x:Number(p)/20,n}));
const total=report.exact.stopCombinations;
assert.equal(dist.reduce((a,r)=>a+r.n,0),total);
const bands=[[0,0],[0,1],[1,2],[2,5],[5,10],[10,20],[20,40],[40,80],[80,Infinity]].map(([lo,hi],index)=>{
  const rows=dist.filter(r=>index===0?r.x===0:index===1?r.x>0&&r.x<1:r.x>=lo&&r.x<hi);
  const probability=rows.reduce((a,r)=>a+r.n,0)/total;
  return {range:index===0?'0':index===1?'0 < x < 1':`${lo} <= x < ${hi}`,probability,meanInterval:probability?1/probability:null,rtpContribution:rows.reduce((a,r)=>a+r.x*r.n,0)/total};
});
const caps=[40,60,80,100].map(cap=>({cap,removedRtp:dist.reduce((a,r)=>a+Math.max(0,r.x-cap)*r.n,0)/total}));
assert.ok(Math.abs(bands.reduce((a,b)=>a+b.probability,0)-1)<1e-12);
assert.ok(Math.abs(bands.reduce((a,b)=>a+b.rtpContribution,0)-.96)<1e-12);
const tails=[5,10,20,30,40,50,80,100].map(threshold=>{const probability=dist.reduce((a,r)=>a+(r.x>=threshold?r.n:0),0)/total;return {threshold,probability,meanInterval:1/probability,rtpContribution:dist.reduce((a,r)=>a+(r.x>=threshold?r.x*r.n:0),0)/total};});
// Sample exact payout histogram. This preserves the full single-spin payout law;
// it does not generate artwork/stops or exercise server/API execution.
const cumulative=[];let sum=0;for(const r of dist){sum+=r.n;cumulative.push(sum);}
const initialSeed=20261018;let seed=initialSeed;
function next(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;}
const range=total>2**32?2**53:2**32,ceiling=Math.floor(range/total)*total;
function draw(){let v;do{v=total>2**32?next()*2**21+(next()>>>11):next();}while(v>=ceiling);v%=total;let lo=0,hi=dist.length-1;while(lo<hi){const mid=(lo+hi)>>>1;if(v<cumulative[mid])hi=mid;else lo=mid+1;}return dist[lo].x;}
const n=100000,rounds=500,rtps=[],drawdowns=[],lossStreaks=[];let unavailable=0,profit=0,within1=0,within5=0,payoutSum=0;
for(let s=0;s<n;s++){
  let balance=100,peak=100,dd=0,streak=0,longest=0,failed=false;
  for(let i=0;i<rounds;i++){
    if(balance<1-1e-9)failed=true;
    const x=draw();payoutSum+=x;balance+=x-1;peak=Math.max(peak,balance);dd=Math.max(dd,peak-balance);
    streak=x<1?streak+1:0;longest=Math.max(longest,streak);
  }
  const rtp=(balance-100+rounds)/rounds;
  rtps.push(rtp);drawdowns.push(dd);lossStreaks.push(longest);
  if(failed)unavailable++;if(balance>100+1e-9)profit++;if(Math.abs(rtp-.96)<=.01)within1++;if(Math.abs(rtp-.96)<=.05)within5++;
}
function quantiles(values){values.sort((a,b)=>a-b);return Object.fromEntries([.05,.25,.5,.75,.95].map(q=>[q,values[Math.floor((values.length-1)*q)]]));}
const output={model:report.model,sha256:report.sha256,bands,tails,caps,sessionStudy:{generator:'xorshift32 with rejection sampling of exact integer histogram; research only',seed:initialSeed,sessions:n,rounds,initialBalanceInBets:100,policy:'Always draw 500 outcomes; mark inability to fund a next bet before drawing it. Unfunded paths continue analytically with no added capital; not a real playable wallet.',aggregateRtp:payoutSum/(n*rounds),rtpQuantiles:quantiles(rtps),maxDrawdownInBetsQuantiles:quantiles(drawdowns),maxNetLossStreakQuantiles:quantiles(lossStreaks),unableToCompleteFraction:unavailable/n,endingAboveInitialFraction:profit/n,rtpWithin1PercentagePointOf96:within1/n,rtpWithin5PercentagePointsOf96:within5/n},convergenceApproximation:[500,10000,100000,1000000].map(n=>({rounds:n,normalApprox95HalfWidth:1.96*report.exact.standardDeviationTotalBet/Math.sqrt(n)}))};
writeFileSync(new URL(current?`../docs/payout-profile-${report.model.split('-').at(-1)}.json`:'../docs/payout-profile-research.json',import.meta.url),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(output,null,2));
