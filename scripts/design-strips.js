// Offline deterministic candidate search; does not change the active game.
import { readFileSync,writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { PAYLINES } from '../src/slot-math.js';
const model=JSON.parse(readFileSync(new URL('../docs/model-v2-candidate.json',import.meta.url)));
const {counts,paytable}=model;
let seed=20261018;
const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
const lut=new Uint16Array(9**5);
let weighted=0;
for(let k=0;k<lut.length;k++){
  let v=k;const line=Array(5);for(let i=4;i>=0;i--){line[i]=v%9;v=Math.floor(v/9);}
  let best=0;
  for(let s=0;s<9;s++){
    let n=0;while(n<5&&(line[n]===s||(s!==8&&line[n]===8)))n++;
    if(n>=3)best=Math.max(best,paytable[s][n-3]);
  }
  lut[k]=best;weighted+=best*line.reduce((p,s,i)=>p*counts[i][s],1);
}
assert.equal(weighted*25,4000000*24);
function strips(){return counts.map(c=>{
  const reel=c.flatMap((n,s)=>Array(n).fill(s));
  do{for(let i=reel.length-1;i>0;i--){const j=random()%(i+1);[reel[i],reel[j]]=[reel[j],reel[i]];}}
  while(reel.some((s,i)=>s===reel[(i+1)%reel.length]));
  return reel;
});}
function scorer(reels){
  const terms=PAYLINES.map(rows=>reels.map((r,i)=>r.map((_,s)=>r[(s+rows[i]-1+r.length)%r.length]*9**(4-i))));
  return (a,b,c,d,e)=>{let p=0;for(const t of terms)p+=lut[t[0][a]+t[1][b]+t[2][c]+t[3][d]+t[4][e]];return p;};
}
function exact(reels){
  const score=scorer(reels);let big=0,superWin=0,mega=0,sum=0,max=0,maxStops,hit=0,profit=0,squares=0;
  const previews={};
  for(let a=0;a<20;a++)for(let b=0;b<20;b++)for(let c=0;c<20;c++)for(let d=0;d<20;d++)for(let e=0;e<25;e++){
    const p=score(a,b,c,d,e);sum+=p;squares+=p*p;if(p>0)hit++;if(p>20)profit++;
    if(p>=400)big++;if(p>=1000)superWin++;if(p>=2000)mega++;
    const tier=p>=2000?'mega':p>=1000?'super':p>=400?'big':null;
    if(tier&&!previews[tier])previews[tier]={stops:[a,b,c,d,e],payout:p};
    if(p>max){max=p;maxStops=[a,b,c,d,e];}
  }
  assert.equal(sum*25,4000000*20*24);
  return {big,superWin,mega,bigMean:4000000/big,rtp:sum/4000000/20,max:max/20,maxStops,hitRate:hit/4000000,profitRate:profit/4000000,sd:Math.sqrt(squares/4000000/400-.96**2),previews};
}
let selected;
for(let attempt=1;attempt<=2000;attempt++){
  const reels=strips(),score=scorer(reels);let big=0;
  for(let n=0;n<100000;n++)if(score(random()%20,random()%20,random()%20,random()%20,random()%25)>=400)big++;
  if(big>=90)console.log(`candidate ${attempt}: sampled >=20x ${big}/100000`);
  if(big<90||big>185)continue;
  const stats=exact(reels);console.log(JSON.stringify(stats));
  if(stats.bigMean>=600&&stats.bigMean<=1000&&stats.previews.big&&stats.previews.super&&stats.previews.mega){selected={...model,reels,stats,searchSeed:20261018,attempt};break;}
}
if(!selected)throw new Error('No candidate met exact tail constraints; revise paytable/counts.');
writeFileSync(new URL('../docs/model-v2-selected.json',import.meta.url),JSON.stringify(selected,null,2)+'\n');
