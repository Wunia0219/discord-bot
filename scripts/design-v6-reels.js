// Reference-frequency candidate with counts fixed before calculating RTP.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { evaluateLine, SYMBOLS } from '../src/slot-math.js';
const model=JSON.parse(readFileSync(new URL('../docs/model-v6-counts.json',import.meta.url)));
const reelSeed=Number(process.argv[2]||20261019);let seed=reelSeed;
const next=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=next()%(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;};
// Check the closed-form count search with the independent production scorer.
let weighted=0n;
for(let key=0;key<9**5;key++) {
  let v=key;const a=Array(5);for(let i=4;i>=0;i--){a[i]=v%9;v=Math.floor(v/9);}
  weighted+=BigInt(evaluateLine(a.map(s=>SYMBOLS[s])).multiplier)*a.reduce((p,s,i)=>p*BigInt(model.counts[i][s]),1n);
}
const stopCombinations=model.lengths.reduce((a,n)=>a*BigInt(n),1n);
model.actualRtp=Number(weighted)/Number(stopCombinations);
const reels=model.counts.map((counts,reel)=>{
  const length=model.lengths[reel];
  const remaining=[...counts],chunks=[];
  const add=chunk=>{chunk.forEach(s=>{assert.ok(remaining[s]>0,`R${reel+1} exhausted symbol ${s}`);remaining[s]--;});chunks.push(chunk);};
  if(reel<2) {
    // H1 sandwiches have different low symbols on the two left reels. They
    // permit a real 200x outcome without an extra simultaneous low-symbol win.
    const middle=reel===0?5:6;
    while(remaining[0]>=2)add([4,0,middle,0,4]);
    if(remaining[0])add([4,0,middle]);
    // Any first/second-reel WILD window contains only ordinary low neighbors.
    // WILD cannot merge with a second high-symbol path near the top prize.
    while(remaining[8])add([4,7,8,4,4]);
  } else {
    // A short mixed H1/WILD window makes 200x attainable without long stacks.
    if(remaining[0]>=2)add([4,0,8,0,5]);
    else add([4,8,0,8,5]);
  }
  const singles=remaining.flatMap((n,s)=>Array(n).fill(s));
  let result,best=null,bestLoss=Infinity;
  for(let attempt=0;attempt<100000;attempt++) {
    const pieces=shuffle([...chunks.map(c=>next()%2?[...c].reverse():[...c]),...shuffle([...singles]).map(s=>[s])]);
    const r=pieces.flat(),at=i=>r[(i+length)%length];
    if(r.some((s,i)=>s===at(i+1)&&s===at(i+2)&&s===at(i+3)))continue;
    if(reel<2) {
      if(r.some((s,i)=>s===8&&[-2,-1,1,2].some(d=>at(i+d)<4||at(i+d)===8)))continue;
      if(r.some((s,i)=>s===0&&at(i+2)===0&&at(i+1)!==(reel===0?5:6)))continue;
      if(r.some((s,i)=>s<4&&s===at(i+1)&&s===at(i+2)))continue;
    } else if(r.some((_,i)=>[0,8].includes(at(i))&&[0,8].includes(at(i+1))&&[0,8].includes(at(i+2))&&[0,8].includes(at(i+3))))continue;
    const repeats=r.filter((s,i)=>s===at(i+1)).length;
    const unique=new Set(r.map((_,i)=>[at(i-1),at(i),at(i+1)].join(','))).size;
    if(unique<length*.65||repeats>length*.14)continue;
    // Spread high symbols across four equal parts instead of grouping all highs.
    const quarters=Array.from({length:4},(_,q)=>r.slice(Math.floor(q*r.length/4),Math.floor((q+1)*r.length/4)).filter(s=>s<4).length);
    const average=counts.slice(0,4).reduce((a,b)=>a+b,0)/4;
    const loss=quarters.reduce((a,n)=>a+(n-average)**2,0)+Math.abs(repeats-6)+.15*(length-unique);
    if(loss<bestLoss){bestLoss=loss;best=r;}
    if(loss<4){result=r;break;}
  }
  result||=best;assert.ok(result,`No acceptable arrangement for reel ${reel+1}`);
  assert.equal(result.length,length);
  assert.deepEqual(counts,counts.map((_,s)=>result.filter(x=>x===s).length));
  for(let p=1;p<length;p++)if(length%p===0)assert.ok(result.some((s,i)=>s!==result[i%p]));
  return result;
});
const codes=['H1','H2','H3','H4','L1','L2','L3','L4','W'];
const selected={...model,status:'offline reel candidate; complete grid verification required',reels,reelSeed,thresholds:{big:20,super:50,mega:200},requestedMaximum:200};
writeFileSync(new URL('../docs/model-v6-selected.json',import.meta.url),JSON.stringify(selected,null,2)+'\n');
const dir=new URL('../src/models/v6/',import.meta.url);mkdirSync(dir,{recursive:true});
copyFileSync(new URL('../src/slot-math.js',import.meta.url),new URL('slot-math.js',dir));
copyFileSync(new URL('../src/win-tier.js',import.meta.url),new URL('win-tier.js',dir));
writeFileSync(new URL('reel-strips.js',dir),`// Fixed frequency-derived strips; exact counts, no runtime compensation.\nexport const MODEL_VERSION='circus-20-v6';\nexport const REEL_CODES=Object.freeze(${JSON.stringify(reels.map(r=>r.map(s=>codes[s])))}.map(Object.freeze));\n`);
writeFileSync(new URL('model-config.js',dir),`// Offline candidate; verify-v6 fills exact metrics and reachable previews.\nexport const PAYOUTS=Object.freeze(${JSON.stringify(model.paytable)}.map(Object.freeze));\nexport const THEORETICAL_RTP=${model.actualRtp};\nexport const MAXIMUM_MULTIPLIER=200;\nexport const BIG_WIN_MEAN_SPINS=0;\nexport const INITIAL_STOPS=Object.freeze([0,0,0,0,0]);\nexport const TIER_PREVIEW_STOPS=Object.freeze({});\n`);
console.log(JSON.stringify(reels.map((r,i)=>({reel:i+1,length:r.length,uniqueWindows:new Set(r.map((_,j)=>[-1,0,1].map(d=>r[(j+d+r.length)%r.length]).join(','))).size,adjacentRepeats:r.filter((s,j)=>s===r[(j+1)%r.length]).length,highPerQuarter:Array.from({length:4},(_,q)=>r.slice(Math.floor(q*r.length/4),Math.floor((q+1)*r.length/4)).filter(s=>s<4).length)})),null,2));
