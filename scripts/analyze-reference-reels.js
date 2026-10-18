// Local-only reference analysis. Pass the supplied JSON file as the first argument.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { REEL_CODES, SYMBOLS, PAYTABLE, evaluateLine } from '../src/slot-math.js';

const source = readFileSync(process.argv[2]);
const reels = JSON.parse(source.toString('utf8').replace(/^\uFEFF/, ''));
const codes = ['H1','H2','H3','H4','L1','L2','L3','L4','W'];
assert.equal(reels.length, 5);
const tally = reel => Object.fromEntries([...new Set(reel)].sort().map(s => [s, reel.filter(x => x === s).length]));
const groups = counts => {
  const n = Object.values(counts).reduce((a,b) => a+b, 0);
  const sum = prefix => Object.entries(counts).reduce((a,[s,v]) => a+(s.startsWith(prefix)?v:0), 0);
  return { high:sum('H')/n, low:(sum('N')+sum('L'))/n, wild:(counts.W||0)/n, scatter:(counts.SC||0)/n };
};
const summary = reel => {
  const counts = tally(reel);
  const runs = [];
  for(let i=0;i<reel.length;i++)if(reel[i]!==reel[(i-1+reel.length)%reel.length]) {
    let n=1;while(n<reel.length && reel[(i+n)%reel.length]===reel[i])n++;
    runs.push(n);
  }
  return { length:reel.length, counts, shares:groups(counts), adjacentRepeatRate:reel.filter((s,i)=>s===reel[(i+1)%reel.length]).length/reel.length, longestRun:Math.max(...runs), uniqueThreeRowWindows:new Set(reel.map((_,i)=>[-1,0,1].map(d=>reel[(i+d+reel.length)%reel.length]).join(','))).size };
};
// Largest-remainder allocation preserves the requested group total exactly.
function allocate(weights, total) {
  const sum=weights.reduce((a,b)=>a+b,0), raw=weights.map(n=>n/sum*total), result=raw.map(Math.floor);
  const order=raw.map((n,i)=>({i,remainder:n-result[i]})).sort((a,b)=>b.remainder-a.remainder||a.i-b.i);
  for(let n=total-result.reduce((a,b)=>a+b,0),i=0;i<n;i++)result[order[i].i]++;
  return result;
}
const reference=reels.map(summary);
const candidateCounts=reference.map(({length,counts})=>{
  const high=Array.from({length:4},(_,i)=>counts['H'+(i+1)]||0);
  const highTotal=Math.round(high.reduce((a,b)=>a+b,0)/length*80);
  const wild=Math.round((counts.W||0)/length*80);
  // N5 and Scatter have no matching symbol/feature here; redistribute their
  // space proportionally among L1..L4 rather than adding a fifth low symbol.
  return [...allocate(high,highTotal),...allocate(Array.from({length:4},(_,i)=>counts['N'+(i+1)]||0),80-highTotal-wild),wild];
});
const total=candidateCounts.reduce((p,c)=>p*c.reduce((a,b)=>a+b,0),1);
let weighted=0n;
for(let key=0;key<9**5;key++) {
  let v=key;const line=Array(5);for(let i=4;i>=0;i--){line[i]=v%9;v=Math.floor(v/9);}
  const payout=evaluateLine(line.map(i=>SYMBOLS[i])).multiplier;
  weighted+=BigInt(payout)*line.reduce((p,s,i)=>p*BigInt(candidateCounts[i][s]),1n);
}
const gcd=(a,b)=>b?gcd(b,a%b):a, divisor=gcd(weighted,BigInt(total));
const output={sourceSha256:createHash('sha256').update(source).digest('hex'),reference,current:REEL_CODES.map(summary),candidate:{status:'frequency proposal only; not approved or installed',lengths:[80,80,80,80,80],codes,counts:candidateCounts,shares:candidateCounts.map(c=>groups(Object.fromEntries(codes.map((s,i)=>[s,c[i]])))),mapping:'H1..H4 retained; W retained on reels 3..5 only. N1..N4 map to L1..L4; N5 and SC space redistributed proportionally among the four low symbols.',existingPaytable:SYMBOLS.map(s=>PAYTABLE[s]),exactRtpWithExistingPaytable:{numerator:String(weighted/divisor),denominator:String(BigInt(total)/divisor),value:Number(weighted)/total},method:'Exact independent single-payline enumeration of 9^5 symbol combinations with integer weights. In a fixed 20-line game with total bet/20 per line, linearity of expectation makes this the whole-game RTP, independent of reel ordering.'}};
writeFileSync(new URL('../docs/reference-243-analysis.json',import.meta.url),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(output,null,2));
