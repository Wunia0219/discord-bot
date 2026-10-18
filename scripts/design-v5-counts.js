// Historical v5 search: rejected after clarification because its per-symbol
// frequencies do not match the reference. Keep only for reproducing v5.
// New designs must not reuse its hard-coded length or L1 search range.
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const reference=JSON.parse(readFileSync(new URL('../docs/reference-243-analysis.json',import.meta.url)));
const targetCounts=reference.candidate.counts;
const paytable=reference.candidate.existingPaytable;
const searchSeed=20261018;let seed=searchSeed;
const next=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
const integer=(a,b)=>a+next()%(b-a+1);
const sum=a=>a.reduce((x,y)=>x+y,0);
const trials=Number(process.argv[2]||100000);
const target=40**4*80*24/25;
const gcd=(a,b)=>b?gcd(b,a%b):a;
let selected=null,bestLoss=Infinity,solutions=0,validFirst=0,inRange=0,validLast=0,gcdPassed=0;
// Exact coefficients for the fifth reel, including the highest-award rule when
// an all-WILD prefix can also substitute for a higher-paying ordinary symbol.
function coefficients(first) {
  const c=Array(9).fill(0);
  const allWild=first[0][8]*first[1][8]*first[2][8];
  for(let s=0;s<8;s++) {
    const three=(first[0][s]+first[0][8])*(first[1][s]+first[1][8])*(first[2][s]+first[2][8])-allWild;
    const four=first[3][s]+first[3][8];
    for(let last=0;last<9;last++) {
      c[last]+=three*((40-four)*paytable[s][0]+four*paytable[s][last===s||last===8?2:1]);
      c[last]+=allWild*first[3][s]*Math.max(paytable[8][0],paytable[s][last===s||last===8?2:1]);
    }
  }
  for(let last=0;last<9;last++)c[last]+=allWild*first[3][8]*(last===8?paytable[8][2]:Math.max(paytable[8][1],paytable[last][2]));
  return c;
}
function loss(counts) {
  let error=0;
  counts.forEach((c,r)=>{
    const high=sum(c.slice(0,4)),targetHigh=sum(targetCounts[r].slice(0,4));
    error+=4*((high-targetHigh)/80)**2;
    for(let s=0;s<9;s++)error+=((c[s]-targetCounts[r][s])/80)**2;
    // Keep all four low symbols useful, even when a common low is needed for RTP.
    error+=c.slice(4,8).reduce((a,n)=>a+(n<6?(6-n)**2/6400:0),0)*2;
  });
  return error;
}
for(let attempt=1;attempt<=trials;attempt++) {
  const first=Array.from({length:4},(_,r)=>{
    const high=targetCounts[r].slice(0,4).map(n=>Math.max(1,Math.round(n/2)+integer(-1,1)));
    const w=r<2?integer(0,2):integer(1,2);
    const remaining=40-sum(high)-w;
    if(remaining<22)return [...high,0,0,0,0,w];
    const a=integer(12,Math.min(17,remaining-9));
    const b=integer(3,Math.min(8,remaining-a-6));
    const c=integer(3,Math.min(7,remaining-a-b-3)),d=remaining-a-b-c;
    return [...high,a,b,c,d,w];
  });
  if(first.some(c=>sum(c)!==40||c[7]<3||c[7]>8||sum(c.slice(0,4))<10||sum(c.slice(0,4))>16))continue;
  validFirst++;const coeff=coefficients(first),den=coeff[4]-coeff[5];
  if(!den)continue;
  const minimum=80*Math.min(...coeff),maximum=80*Math.max(...coeff);
  if(target<minimum||target>maximum)continue;
  inRange++;
  for(let lastTrial=0;lastTrial<8;lastTrial++) {
    const last=targetCounts[4].map((n,s)=>s<4?Math.max(1,n+integer(-1,1)):s===8?integer(3,5):0);
    const remaining=80-sum(last),fixed=last.reduce((a,n,s)=>a+n*coeff[s],0);
    if(sum(last.slice(0,4))<24||sum(last.slice(0,4))>29)continue;
    validLast++;
    const common=target-fixed-remaining*coeff[5];
    const divisor=gcd(Math.abs(den),gcd(Math.abs(coeff[6]-coeff[5]),Math.abs(coeff[7]-coeff[5])));
    if(common%divisor)continue;
    gcdPassed++;
    for(let c=6;c<=16;c++)for(let d=6;d<=16;d++) {
      const value=common-c*(coeff[6]-coeff[5])-d*(coeff[7]-coeff[5]);
      if(value%den)continue;
      const a=value/den,b=remaining-c-d-a;
      if(a<12||a>34||b<6||b>22)continue;
      last[4]=a;last[5]=b;last[6]=c;last[7]=d;
      const counts=[...first.map(c=>c.map(n=>n*2)),[...last]],candidateLoss=loss(counts);
      solutions++;
      if(candidateLoss>=bestLoss)continue;
      assert.equal(sum(last),80);assert.equal(last.reduce((a,n,s)=>a+n*coeff[s],0),target);
      bestLoss=candidateLoss;
      selected={model:'circus-20-v5',status:'offline count candidate; reel order and full-grid metrics not yet verified',lengths:[80,80,80,80,80],codes:reference.candidate.codes,paytable,counts,referenceSourceSha256:reference.sourceSha256,referenceTargetCounts:targetCounts,exactLinePayoutSum:String(target*16),exactLineStopCombinations:80**5,rtp:.96,searchSeed,attempt,loss:candidateLoss,solutions};
      writeFileSync(new URL('../docs/model-v5-counts.json',import.meta.url),JSON.stringify(selected,null,2)+'\n');
      console.log('BEST',attempt,candidateLoss,JSON.stringify(counts));
    }
  }
  if(attempt%20000===0)console.log('Searched',attempt,'solutions',solutions);
}
console.log({validFirst,inRange,validLast,gcdPassed,solutions});
assert.ok(selected,'No exact 96% count solution within the stated ranges');
console.log('SELECTED',JSON.stringify(selected));
