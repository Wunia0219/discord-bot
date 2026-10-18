import { randomInt, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { MODEL_VERSION, REEL_CODES, REEL_STRIPS, PAYTABLE, PAYLINES, gridFromStops, evaluateGrid } from '../src/models/v2/slot-math.js';

// Run once to sample; --replay verifies and reanalyzes the recorded stops without rerolling.
const directory = new URL('../docs/session-study-2026-10-18/', import.meta.url);
mkdirSync(directory, { recursive: true });
const path = new URL('results.json', directory);
const replay = process.argv.includes('--replay');
const prior = replay ? JSON.parse(readFileSync(path, 'utf8')) : null;
if (!replay) {
  try { readFileSync(path); throw new Error('Results already exist; use --replay to avoid rerolling.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const sha256 = createHash('sha256').update(JSON.stringify({REEL_CODES,PAYTABLE,PAYLINES})).digest('hex');
const exact = JSON.parse(readFileSync(new URL('../docs/math-report-v2.json', import.meta.url), 'utf8'));
assert.equal(exact.sha256, sha256);
if (prior) assert.equal(prior.sha256, sha256);
const bet = 100, initial = 10000, rounds = 500;
const sessions = Array.from({length:3}, (_,s) => {
  let balance=initial, peak=initial, maxDrawdown=0, dry=0, maxDry=0, loss=0, maxLoss=0, underwater=0, maxUnderwater=0, firstUnaffordable=null;
  const records=[];
  for(let i=0;i<rounds;i++) {
    if(balance<bet && firstUnaffordable===null) firstUnaffordable=i+1;
    const stops=prior?.sessions[s].records[i].stops ?? REEL_STRIPS.map(strip=>randomInt(strip.length));
    const result=evaluateGrid(gridFromStops(stops),bet), before=balance;
    balance+=result.payout-bet;
    if(prior) assert.equal(result.payout,prior.sessions[s].records[i].payout);
    peak=Math.max(peak,balance); maxDrawdown=Math.max(maxDrawdown,peak-balance);
    dry=result.payout===0?dry+1:0; maxDry=Math.max(maxDry,dry);
    loss=result.payout<bet?loss+1:0; maxLoss=Math.max(maxLoss,loss);
    underwater=balance<peak?underwater+1:0; maxUnderwater=Math.max(maxUnderwater,underwater);
    records.push({round:i+1,stops,payout:result.payout,net:result.payout-bet,balanceBefore:before,balance,winningLines:result.wins.length});
  }
  const totalPayout=records.reduce((a,r)=>a+r.payout,0);
  const count=predicate=>records.filter(predicate).length;
  const top5=[...records].sort((a,b)=>b.payout-a.payout).slice(0,5).map(r=>({round:r.round,payout:r.payout}));
  return {session:s+1,totalBet:bet*rounds,totalPayout,rtp:totalPayout/(bet*rounds),net:balance-initial,finalBalance:balance,minimumBalance:Math.min(initial,...records.map(r=>r.balance)),peakBalance:peak,maxDrawdown,maxZeroPayoutStreak:maxDry,maxNetLossStreak:maxLoss,maxRoundsBelowPeak:maxUnderwater,firstUnaffordableRound:firstUnaffordable,zeroPayout:count(r=>r.payout===0),partialReturn:count(r=>r.payout>0&&r.payout<bet),breakEven:count(r=>r.payout===bet),profitable:count(r=>r.payout>bet),atLeast5x:count(r=>r.payout>=bet*5),atLeast20x:count(r=>r.payout>=bet*20),top5,top5Share:top5.reduce((a,r)=>a+r.payout,0)/totalPayout,blocks:Array.from({length:10},(_,b)=>{const rows=records.slice(b*50,(b+1)*50);return {from:b*50+1,to:(b+1)*50,rtp:rows.reduce((a,r)=>a+r.payout,0)/(50*bet),endBalance:rows.at(-1).balance};}),records};
});
const distribution=Object.entries(exact.payoutDistributionInLineBets).map(([p,n])=>[Number(p),n]);
const prob=fn=>distribution.reduce((a,[p,n])=>a+(fn(p)?n:0),0)/exact.exact.stopCombinations;
const theoretical={rtp:exact.exact.rtp,zero:prob(p=>p===0),partial:prob(p=>p>0&&p<20),breakEven:prob(p=>p===20),profit:prob(p=>p>20),atLeast5x:prob(p=>p>=100),atLeast20x:prob(p=>p>=400),no20xIn500:(1-prob(p=>p>=400))**500,expectedNet500:500*bet*(exact.exact.rtp-1),sessionRtpStandardDeviation:exact.exact.standardDeviationTotalBet/Math.sqrt(rounds)};
const output={createdAt:prior?.createdAt??new Date().toISOString(),model:MODEL_VERSION,sha256,method:'Three independent samples using node:crypto randomInt per reel, same scorer as server; recorded stops enable exact replay. No wallet or UI interaction.',bet,initial,rounds,theoretical,sessions};
if(!replay)writeFileSync(path,JSON.stringify(output,null,2)+'\n');
const csv=['session,round,stop1,stop2,stop3,stop4,stop5,bet,payout,net,balance,winningLines',...sessions.flatMap(s=>s.records.map(r=>[s.session,r.round,...r.stops,bet,r.payout,r.net,r.balance,r.winningLines].join(',')))].join('\n');
writeFileSync(new URL('rounds.csv',directory),csv+'\n');
console.log(JSON.stringify({replay,theoretical,sessions:sessions.map(({records,...s})=>s)},null,2));
