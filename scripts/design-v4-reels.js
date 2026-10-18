// Construct non-periodic 200-stop strips with an exactly specified symbol count.
import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const model=JSON.parse(readFileSync(new URL('../docs/model-v4-counts.json',import.meta.url)));
let seed=20261022;const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
const reels=model.counts.map((counts,index)=>{
 const remaining=[...counts],chunks=[],middle=[5,6,7,5,6][index];
 for(const symbol of [0,1,2,3,8]){
  if(index<2&&symbol===8){
   chunks.push(Array.from({length:remaining[symbol]},()=>[8,middle,4,middle]).flat());
   remaining[middle]-=remaining[symbol]*2;remaining[4]-=remaining[symbol];remaining[symbol]=0;continue;
  }
  if(index>=2&&(symbol===0||symbol===8)){
   chunks.push(Array(remaining[symbol]).fill(symbol));remaining[symbol]=0;continue;
  }
  const between=symbol===0||symbol===8?middle:4;
  chunks.push(Array.from({length:remaining[symbol]},()=>[symbol,between]).flat());
  remaining[between]-=remaining[symbol];remaining[symbol]=0;
 }
 const pairs=new Map();
 while(remaining.some(n=>n>0)){
  const order=remaining.map((n,s)=>({n,s})).filter(x=>x.n>0).sort((a,b)=>b.n-a.n);
  assert.ok(order.length>=2,'Cannot fill without adjacent repeats');
  const [a,b]=order.slice(0,2).map(x=>x.s).sort((a,b)=>a-b),key=a+','+b;
  pairs.set(key,(pairs.get(key)||0)+1);remaining[a]--;remaining[b]--;
 }
 for(const [pair,n] of pairs)chunks.push(Array.from({length:n},()=>pair.split(',').map(Number)).flat());
 let result;
 for(let attempt=0;attempt<100000&&!result;attempt++){
  const pieces=chunks.map(c=>random()%2?[...c].reverse():[...c]);
  for(let i=pieces.length-1;i>0;i--){const j=random()%(i+1);[pieces[i],pieces[j]]=[pieces[j],pieces[i]];}
  const r=pieces.flat();
  if(r.some((s,i)=>s===r[(i+1)%r.length]&&!(index>=2&&[0,8].includes(s))))continue;
  // Keep every H1/W sandwich's middle different on the first three reels.
  if(index<2&&r.some((s,i)=>[0,8].includes(s)&&[0,8].includes(r[(i+2)%r.length])&&r[(i+1)%r.length]!==middle))continue;
  if(index<2&&r.some((s,i)=>s===8&&[-2,-1,1,2].some(o=>[0,8].includes(r[(i+o+r.length)%r.length]))))continue;
  result=r;
 }
 assert.ok(result);assert.equal(result.length,200);
 assert.deepEqual(counts,counts.map((_,s)=>result.filter(x=>x===s).length));
 for(let period=1;period<200;period++)if(200%period===0)assert.ok(result.some((s,i)=>s!==result[i%period]),'Short repeated strip');
 return result;
});
const selected={...model,reels,reelSeed:20261022,model:'circus-20-v4',thresholds:{big:20,super:50,mega:200},requestedMaximum:200};
writeFileSync(new URL('../docs/model-v4-selected.json',import.meta.url),JSON.stringify(selected,null,2)+'\n');
const directory=new URL('../src/models/v4/',import.meta.url);mkdirSync(directory,{recursive:true});
copyFileSync(new URL('../src/slot-math.js',import.meta.url),new URL('slot-math.js',directory));
copyFileSync(new URL('../src/win-tier.js',import.meta.url),new URL('win-tier.js',directory));
const codes=['H1','H2','H3','H4','L1','L2','L3','L4','W'];
writeFileSync(new URL('reel-strips.js',directory),`// Fixed 200-stop non-periodic strips; no runtime compensation.\nexport const MODEL_VERSION='circus-20-v4';\nexport const REEL_CODES=Object.freeze(${JSON.stringify(reels.map(r=>r.map(s=>codes[s])))}.map(Object.freeze));\n`);
writeFileSync(new URL('model-config.js',directory),`// Staged candidate: verify-v4.js fills the verified maximum and preview stops.\nexport const PAYOUTS=Object.freeze(${JSON.stringify(model.paytable)}.map(Object.freeze));\nexport const MAXIMUM_MULTIPLIER=200;\nexport const BIG_WIN_MEAN_SPINS=0;\nexport const INITIAL_STOPS=Object.freeze([0,0,0,0,0]);\nexport const TIER_PREVIEW_STOPS=Object.freeze({big:[0,0,0,0,0],super:[0,0,0,0,0],mega:[0,0,0,0,0]});\n`);
console.log(reels.map(r=>new Set(r.map((_,s)=>[-1,0,1].map(o=>r[(s+o+200)%200]).join(','))).size));
