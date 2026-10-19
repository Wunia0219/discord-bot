// Fixed seeds, no rerolls. Each independent wallet can fund 500 losing spins
// at bet 20 from 10,000, so the study needs no topups or ignored insolvency.
import { mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { MODEL_VERSION,SYMBOLS,PAYTABLE,freshState,createRound,readState,drawStops,gridFromStops } from '../../src/game/index.js';
import { waysOracle } from '../../tests/helpers/ways-oracle.js';
const report=JSON.parse(readFileSync(new URL('../../docs/data/math-report.json',import.meta.url)));
assert.equal(report.model,MODEL_VERSION);
const sessionCount=100,roundsPerSession=500,seedBase=0x1a960000,bet=20;
const sessions=[],trace=[],symbols=Object.fromEntries(SYMBOLS.slice(0,8).map(s=>[s,{rounds:0,payout:0}]));
let sum=0,squares=0,hits=0,profits=0,lossWins=0,spadeOnly=0,oracleComparisons=0;
for(let session=0;session<sessionCount;session++){
  let seed=(seedBase+session+1)>>>0,state=freshState(),paid=0,sessionHits=0,dry=0,longestDry=0;
  const next=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
  for(let round=0;round<roundsPerSession;round++){
    const stops=drawStops(next),id=`session-${session}-${round}`,update=createRound(state,bet,stops,id,'2026-10-19T00:00:00.000+08:00'),r=update.round;
    state=update.state;paid+=r.payout;sum+=r.payout;squares+=r.payout**2;
    assert.equal(state.balance,10000-bet*(round+1)+paid);
    if(r.payout){hits++;sessionHits++;dry=0;}else longestDry=Math.max(longestDry,++dry);
    if(r.payout>bet)profits++;if(r.payout>0&&r.payout<bet)lossWins++;
    if(r.wins.length===1&&r.wins[0].symbol==='ace')spadeOnly++;
    for(const w of r.wins){symbols[w.symbol].rounds++;symbols[w.symbol].payout+=w.payout;}
    if(round<50){
      const oracle=waysOracle(gridFromStops(stops),SYMBOLS,PAYTABLE);
      assert.equal(r.payout,oracle.payout);assert.deepEqual(r.wins.map(({cells,...w})=>w),oracle.wins);oracleComparisons++;
    }
    if(round%100===0){const retry=createRound(state,bet,stops,id);assert.ok(retry.duplicate);assert.deepEqual(retry.state,state);}
    trace.push(JSON.stringify([session+1,round+1,stops,r.payout,state.balance]));
  }
  assert.deepEqual(readState(JSON.stringify(state)),state);
  sessions.push({session:session+1,seed:(seedBase+session+1)>>>0,rounds:500,rtp:paid/(500*bet),hitRate:sessionHits/500,endingBalance:state.balance,longestNoPayoutRun:longestDry});
}
const rounds=sessionCount*roundsPerSession,rtp=sum/(rounds*bet),standardError=Math.sqrt((squares/rounds/bet**2-rtp**2)/(rounds-1));
for(const s of Object.values(symbols)){s.roundFrequency=s.rounds/rounds;s.payoutShare=s.payout/sum;}
// Outcomes are not selected to make these checks pass. Exact RTP and hit rate
// already follow from complete enumeration; these are broad implementation checks.
assert.ok(Math.abs(rtp-report.exact.rtp)<6*report.exact.standardDeviationTotalBet/Math.sqrt(rounds));
assert.ok(Math.abs(hits/rounds-report.exact.hitRate)<.02);
assert.ok(symbols.ace.payoutShare<.25);
const path=new URL('../../test-results/243-sessions.jsonl',import.meta.url);mkdirSync(new URL('../../test-results/',import.meta.url),{recursive:true});
writeFileSync(path,trace.join('\n')+'\n');
const result={model:MODEL_VERSION,modelSha256:report.sha256,method:'100 independent fixed-seed wallets x 500 actual createRound settlements; no rerolls, topups or excluded outcomes',seedBase,sessionCount,roundsPerSession,rounds,bet,startingBalance:10000,oracleComparisons,trace:'test-results/243-sessions.jsonl',traceSha256:createHash('sha256').update(readFileSync(path)).digest('hex'),observed:{rtp,standardError,approximate95PercentInterval:[rtp-1.96*standardError,rtp+1.96*standardError],hitRate:hits/rounds,profitableRate:profits/rounds,lossWithPayoutRate:lossWins/rounds,spadeOnlyRate:spadeOnly/rounds,symbols},sessions};
writeFileSync(new URL('../../docs/data/session-report.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({model:MODEL_VERSION,sessionCount,roundsPerSession,rounds,rtp,hitRate:result.observed.hitRate,spadePayoutShare:symbols.ace.payoutShare,oracleComparisons,traceSha256:result.traceSha256},null,2));
