// Offline comparison: keep the existing numeric awards AND bet unit (bet/20).
// 243 is the maximum count of full-length symbol paths, not a bet divisor.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import * as baseline from '../src/models/v5/slot-math.js';
import * as reference from '../src/models/v6/slot-math.js';
const { SYMBOLS, PAYTABLE, REEL_STRIPS, REEL_CODES }=reference;
const codes=['H1','H2','H3','H4','L1','L2','L3','L4','W'];
assert.ok(REEL_STRIPS.slice(0,2).every(r=>!r.includes('wild')),'Reference has no W on left reels: no overlapping all-W awards');
assert.deepEqual(PAYTABLE,baseline.PAYTABLE);
function scoreWays(grid){
  const wins=[];
  for(const s of SYMBOLS.slice(0,8)){
    const copies=grid.map(col=>col.filter(x=>x===s||x==='wild').length);
    let count=0,ways=1;while(count<5&&copies[count])ways*=copies[count++];
    if(count>=3)wins.push({symbol:s,count,ways,awardUnits:ways*PAYTABLE[s][count-3]});
  }
  return {wins,payout:wins.reduce((a,w)=>a+w.awardUnits,0)};
}
// Independent path enumeration, paying only the longest eligible length for
// each symbol; a three-reel win is not multiplied by unused reels 4 and 5.
function oracle(grid){
  const wins=[];
  for(const s of SYMBOLS.slice(0,8)){
    let count=0;while(count<5&&grid[count].some(x=>x===s||x==='wild'))count++;
    if(count<3)continue;
    let ways=0;
    for(let key=0;key<3**count;key++){
      let k=key,valid=true;for(let r=0;r<count;r++){const x=grid[r][k%3];k=Math.floor(k/3);if(x!==s&&x!=='wild'){valid=false;break;}}
      if(valid)ways++;
    }
    wins.push({symbol:s,count,ways,awardUnits:ways*PAYTABLE[s][count-3]});
  }
  return {wins,payout:wins.reduce((a,w)=>a+w.awardUnits,0)};
}
const sample=[['ace','ace','eye'],['ace','queen','eye'],['ace','ace','ace'],['queen','jack','eye'],['eye','jack','queen']];
assert.equal(scoreWays(sample).payout,6*5);
assert.equal(scoreWays(sample).wins[0].ways,6);
const extended=structuredClone(sample);extended[3]=['ace','ace','eye'];
assert.equal(scoreWays(extended).payout,12*15,'Pay 4-reel award once, without adding the shorter 3-reel award');
const lengths=REEL_STRIPS.map(r=>r.length),total=lengths.reduce((a,n)=>a*BigInt(n),1n);
const counts=REEL_STRIPS.map(r=>SYMBOLS.map(s=>r.filter(x=>x===s).length));
const numeratorBySymbol=SYMBOLS.slice(0,8).map((s,index)=>{
  const q=REEL_STRIPS.map(r=>r.map((_,stop)=>[-1,0,1].reduce((n,d)=>n+([s,'wild'].includes(r[(stop+d+r.length)%r.length])?1:0),0)));
  const sums=q.map(a=>BigInt(a.reduce((a,b)=>a+b,0))),zeros=q.map(a=>BigInt(a.filter(n=>!n).length));
  // Expected product across independent reels, including zero-window extension
  // probabilities. This is exact integer arithmetic for the chosen ordering.
  return sums[0]*sums[1]*sums[2]*(BigInt(PAYTABLE[s][0])*zeros[3]*BigInt(lengths[4])+BigInt(PAYTABLE[s][1])*sums[3]*zeros[4]+BigInt(PAYTABLE[s][2])*sums[3]*sums[4]);
});
const numerator=numeratorBySymbol.reduce((a,b)=>a+b,0n),gcd=(a,b)=>b?gcd(b,a%b):a;
const divisor=gcd(numerator,total*20n);
const exactRtp=Number(numerator)/Number(total*20n);
const summaries={},trace=[];
const sessionCount=100,roundsPerSession=500,seedBase=0xa54f0000;
for(const mode of ['baseline20','reference20','reference243'])summaries[mode]={rounds:0,payout:0,hits:0,profits:0,lossesWithPayout:0,ties:0,spadeOnly:0,bySymbol:Object.fromEntries(codes.slice(0,8).map(s=>[s,{payout:0,rounds:0}])),sessions:[]};
function record(mode,outcome,stops,session,round){
  const m=summaries[mode];m.rounds++;m.payout+=outcome.payout;
  if(outcome.payout)m.hits++;if(outcome.payout>20)m.profits++;if(outcome.payout>0&&outcome.payout<20)m.lossesWithPayout++;if(outcome.payout===20)m.ties++;
  const winners=new Set(outcome.wins.map(w=>w.symbol));if(winners.size===1&&winners.has('ace'))m.spadeOnly++;
  for(const s of winners)m.bySymbol[codes[SYMBOLS.indexOf(s)]].rounds++;
  for(const w of outcome.wins)m.bySymbol[codes[SYMBOLS.indexOf(w.symbol)]].payout+=w.awardUnits??w.payout;
  trace.push(JSON.stringify({mode,session:session+1,round:round+1,stops,bet:20,payout:outcome.payout,wins:outcome.wins}));
}
let oracleComparisons=0;
for(let session=0;session<sessionCount;session++){
  for(const math of [baseline,reference]){
    let seed=(seedBase+session+1)>>>0;
    const next=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
    const start=Object.fromEntries(Object.entries(summaries).map(([k,m])=>[k,{payout:m.payout,hits:m.hits}]));
    for(let round=0;round<roundsPerSession;round++){
      const stops=math.drawStops(next),grid=math.gridFromStops(stops);
      const mode=math===baseline?'baseline20':'reference20';
      record(mode,math.evaluateGrid(grid,20),stops,session,round);
      if(math===reference){const outcome=scoreWays(grid);if(round<50){assert.deepEqual(outcome,oracle(grid));oracleComparisons++;}record('reference243',outcome,stops,session,round);}
    }
    for(const mode of math===baseline?['baseline20']:['reference20','reference243']){
      const m=summaries[mode];m.sessions.push({session:session+1,seed:(seedBase+session+1)>>>0,rtp:(m.payout-start[mode].payout)/(500*20),hitRate:(m.hits-start[mode].hits)/500});
    }
  }
}
for(const m of Object.values(summaries)){
  m.rtp=m.payout/(m.rounds*20);m.hitRate=m.hits/m.rounds;m.profitableRate=m.profits/m.rounds;m.lossWithPayoutRate=m.lossesWithPayout/m.rounds;
  for(const s of Object.values(m.bySymbol)){s.payoutShare=s.payout/m.payout;s.roundFrequency=s.rounds/m.rounds;}
}
const traceFile=new URL('../test-results/243-ways-study.jsonl',import.meta.url);mkdirSync(new URL('../test-results/',import.meta.url),{recursive:true});
writeFileSync(traceFile,trace.join('\n')+'\n');
const result={status:'offline feasibility comparison; current game remains circus-20-v5',sourceSha256:'55fa1a06e1800ab44ebdbc9a09a8ac92298776321798431c852857cfdb0dcec5',referenceCandidateSha256:createHash('sha256').update(JSON.stringify({REEL_CODES,PAYTABLE})).digest('hex'),assumptions:{grid:'5 reels x 3 rows',ways:'adjacent reels from left, longest eligible award per symbol; count products of copies; add different symbols',paytable:PAYTABLE,betUnit:'total bet / 20, same as the current 20-line game; 243 is not a price divisor',frequencyMapping:'four low symbols; N5 and SC mass redistributed across N1..N4 in their original relative proportions; no Scatter or bonus award',lengths,counts,frequencyTolerancePercentagePoints:.4,firstTwoReelsWild:false},exact:{method:'weighted products of three-row copy counts and zero-window extension counts; BigInt arithmetic',rtpFraction:String(numerator/divisor)+'/'+String(total*20n/divisor),rtp:exactRtp,rtpByBetDivisor:{'20':exactRtp,'243':Number(numerator)/Number(total*243n)},symbols:Object.fromEntries(numeratorBySymbol.map((n,s)=>[codes[s],{rtpContribution:Number(n)/Number(total*20n),payoutShare:Number(n)/Number(numerator)}]))},verification:{sessionCount,roundsPerSession,seedBase,oracleComparisons,tracePath:traceFile.pathname,traceSha256:createHash('sha256').update(readFileSync(traceFile)).digest('hex')},summaries};
assert.ok(result.exact.symbols.L1.payoutShare<.25,'Spades must not dominate');
writeFileSync(new URL('../docs/243-ways-feasibility.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({...result,summaries:Object.fromEntries(Object.entries(summaries).map(([k,m])=>[k,{...m,sessions:undefined}]))},null,2));
