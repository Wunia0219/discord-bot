// Frequency-first: choose the shortest integer representation meeting the
// stated per-symbol tolerance. Neither 80 stops nor 96% RTP is a target.
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const source=JSON.parse(readFileSync(new URL('../output/reference-frequency-study/probabilities-and-rtp.json',import.meta.url)));
const tolerance=.004;
const targets=source.probabilitiesByReel.map(r=>r.map(q=>q.value));
const lengths=[],counts=[],errors=[];
for(let reel=0;reel<5;reel++){
  let selected;
  for(let length=9;length<=512;length++){
    const exact=targets[reel].map(p=>p*length),c=exact.map(Math.floor);
    const ranked=exact.map((n,s)=>({s,remainder:n-c[s]})).sort((a,b)=>b.remainder-a.remainder||a.s-b.s);
    for(let left=length-c.reduce((a,b)=>a+b,0),j=0;j<left;j++)c[ranked[j].s]++;
    const error=c.map((n,s)=>n/length-targets[reel][s]);
    if(error.some(e=>Math.abs(e)>tolerance))continue;
    if(c.some((n,s)=>targets[reel][s]>0&&n===0))continue;
    if(reel<2&&c[0]<2)continue;
    if(reel>=2&&c[0]<2&&c[8]<2)continue;
    selected={length,c,error};break;
  }
  assert.ok(selected);lengths.push(selected.length);counts.push(selected.c);errors.push(selected.error);
}
const selected={model:'circus-20-v6',status:'frequency-first candidate; requires actual RTP and session verification',basis:'user accepts actual RTP with original paytable; redistribute scoring away from L1 using the reference frequencies',codes:source.codes,paytable:source.paytable,counts,lengths,referenceSourceSha256:source.sourceSha256,targetProbabilities:targets,frequencyErrors:errors,tolerance,selectionPolicy:'Hamilton apportionment; shortest length satisfying <=0.4 percentage point error for every symbol and reachable-top-award construction; no payout objective',referenceProbabilityRtp:source.exact.rtp.value};
writeFileSync(new URL('../docs/model-v6-counts.json',import.meta.url),JSON.stringify(selected,null,2)+'\n');
console.log(JSON.stringify(selected,null,2));
