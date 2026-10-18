// Offline deterministic integer-paytable/reel search. Never edits the live model.
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {PAYLINES} from '../src/slot-math.js';
const prior=JSON.parse(readFileSync(new URL('../docs/model-v2-selected.json',import.meta.url)));
const counts=structuredClone(prior.counts),total=4000000,target=3840000;
counts[0][7]--;counts[0][8]++;counts[2][5]--;counts[2][8]++;
const searchSeed=20261020;let seed=searchSeed;
const next=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
const integer=(a,b)=>a+next()%(b-a+1);
// Awards are monotone by symbol and length; all 5-kind >= all 4-kind >= all 3-kind.
const coeff=Array(27).fill(0),winner=new Int8Array(9**5).fill(-1);
for(let key=0;key<winner.length;key++){
  let v=key;const line=Array(5);for(let i=4;i>=0;i--){line[i]=v%9;v=Math.floor(v/9);}
  let best=-1,bestRank=-1;
  for(let s=0;s<9;s++){let n=0;while(n<5&&(line[n]===s||(s!==8&&line[n]===8)))n++;const rank=n>=3?n*10-s:-1;if(rank>bestRank){bestRank=rank;best=s*3+n-3;}}
  if(line.every(s=>s===8))best=26;
  winner[key]=best;if(best>=0)coeff[best]+=line.reduce((p,s,i)=>p*counts[i][s],1);
}
console.log('Coefficients',JSON.stringify(coeff));
function strips(){return counts.map(c=>{
  const r=c.flatMap((n,s)=>Array(n).fill(s));
  do{for(let i=r.length-1;i>0;i--){const j=integer(0,i);[r[i],r[j]]=[r[j],r[i]];}}
  while(r.some((s,i)=>s===r[(i+1)%r.length]||(s===8&&r[(i+2)%r.length]===8)));
  return r;
});}
function paytable(reels){
  // At most one visible WILD per reel. Solve RTP and the natural 200x maximum.
  const wildRows=[],choices=reels.map(r=>r.flatMap((s,i)=>s===8?[i]:[]));
  for(const line of PAYLINES)for(const w0 of choices[0])for(const w1 of choices[1])for(const w2 of choices[2])for(const w3 of choices[3])for(const w4 of choices[4]){
    const stops=[w0,w1,w2,w3,w4].map((w,i)=>(w-line[i]+1+reels[i].length)%reels[i].length),row=Array(27).fill(0);
    for(const rows of PAYLINES){const key=rows.reduce((key,r,i)=>key*9+reels[i][(stops[i]+r-1+reels[i].length)%reels[i].length],0);const win=winner[key];if(win>=0)row[win]++;}
    assert.equal(row[26],1);row[26]=0;wildRows.push(row);
  }
  for(let trial=0;trial<20000;trial++){
    const p=Array(27).fill(0);
    const threes=[integer(16,25),15,13,12,integer(6,10),integer(5,8),integer(4,7),integer(3,6)].sort((a,b)=>b-a);
    const fours=[integer(40,65),integer(35,55),integer(30,50),integer(28,45),integer(25,40),integer(22,35),integer(20,30),integer(18,28)].sort((a,b)=>b-a);
    const fives=[integer(700,1200),integer(450,800),integer(300,600),integer(200,450),integer(90,150),integer(80,130),integer(75,120),integer(65,110)].sort((a,b)=>b-a);
    if(fours[7]<threes[0]||fives[7]<fours[0])continue;
    for(let s=0;s<8;s++){p[s*3]=threes[s];p[s*3+1]=fours[s];p[s*3+2]=fives[s];}
    p[24]=p[0];p[25]=p[1];p[26]=0;p[2]=0;
    for(let low=p[15];low<=p[9];low++){
      p[12]=low;const base=coeff.reduce((a,c,i)=>a+c*p[i],0);
      for(const row of wildRows){
        const other=row.reduce((a,c,i)=>a+c*p[i],0),den=coeff[2]-coeff[26]*row[2];
        const value=(target-base-coeff[26]*(4000-other))/den;
        if(!Number.isInteger(value)||value<p[5]||value>1400)continue;
        const q=[...p];q[2]=value;
        const maxOther=Math.max(...wildRows.map(r=>r.reduce((a,c,i)=>a+c*q[i],0)));
        q[26]=4000-maxOther;
        if(q[26]<q[2]||coeff.reduce((a,c,i)=>a+c*q[i],0)!==target)continue;
        return Array.from({length:9},(_,s)=>q.slice(s*3,s*3+3));
      }
    }
  }
  return null;
}
function scorer(reels,pay){
  const flat=pay.flat(),lut=Uint16Array.from(winner,i=>i<0?0:flat[i]);
  const terms=PAYLINES.map(rows=>reels.map((r,i)=>r.map((_,s)=>r[(s+rows[i]-1+r.length)%r.length]*9**(4-i))));
  return (a,b,c,d,e)=>{let p=0;for(const t of terms)p+=lut[t[0][a]+t[1][b]+t[2][c]+t[3][d]+t[4][e]];return p;};
}
function exact(reels,pay){
  const score=scorer(reels,pay);let sum=0,squares=0,hit=0,profit=0,max=0,maxStops;const tiers={big:0,super:0,mega:0},previews={};
  for(let a=0;a<20;a++)for(let b=0;b<20;b++)for(let c=0;c<20;c++)for(let d=0;d<20;d++)for(let e=0;e<25;e++){
    const p=score(a,b,c,d,e);sum+=p;squares+=p*p;if(p)hit++;if(p>20)profit++;
    if(p>max){max=p;maxStops=[a,b,c,d,e];}
    const tier=p>=4000?'mega':p>=1000?'super':p>=400?'big':null;
    if(tier){tiers[tier]++;if(!previews[tier])previews[tier]={stops:[a,b,c,d,e],payout:p};}
  }
  assert.equal(sum*25,total*20*24);
  return {rtp:sum/total/20,max:max/20,maxStops,hitRate:hit/total,profitRate:profit/total,sd:Math.sqrt(squares/total/400-.96**2),tiers,tierMean:Object.fromEntries(Object.entries(tiers).map(([k,v])=>[k,total/v])),previews};
}
const attempts=Number(process.argv[2]||100);let best=null,bestLoss=Infinity;
for(let attempt=1;attempt<=attempts;attempt++){
  const reels=strips(),pay=paytable(reels);if(!pay){console.log('No exact paytable for layout',attempt);continue;}
  const stats=exact(reels,pay);if(stats.max!==200||!stats.tiers.big||!stats.tiers.super||!stats.tiers.mega)continue;
  const means=stats.tierMean;
  const loss=Math.abs(Math.log(means.big/400))+Math.abs(Math.log(means.super/5000))+.1*stats.sd+.4*Math.abs(Math.log(stats.tiers.mega/20));
  if(loss<bestLoss){bestLoss=loss;best={counts,paytable:pay,reels,stats,searchSeed,attempt,thresholds:{big:20,super:50,mega:200},maximum:200};writeFileSync(new URL('../docs/model-v3-selected.json',import.meta.url),JSON.stringify(best,null,2)+'\n');console.log('BEST',attempt,JSON.stringify(stats));}
  if(means.big>=250&&means.big<=650&&means.super>=2500&&means.super<=10000&&stats.tiers.mega>=8){console.log('Targets satisfied');break;}
}
if(!best)throw new Error('No fully enumerated 96% / naturally exactly 200x candidate');
