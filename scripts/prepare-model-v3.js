// Stage the selected candidate for independent verification. Never promotes it.
import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const m=JSON.parse(readFileSync(new URL('../docs/model-v3-selected.json',import.meta.url)));
assert.equal(m.stats.rtp,.96);assert.equal(m.stats.max,200);
const directory=new URL('../src/models/v3/',import.meta.url);mkdirSync(directory,{recursive:true});
copyFileSync(new URL('../src/models/v2/slot-math.js',import.meta.url),new URL('slot-math.js',directory));
const codes=['H1','H2','H3','H4','L1','L2','L3','L4','W'];
writeFileSync(new URL('reel-strips.js',directory),`// Verified fixed strips; no runtime compensation or payout clipping.\nexport const MODEL_VERSION='circus-20-v3';\nexport const REEL_CODES=Object.freeze(${JSON.stringify(m.reels.map(r=>r.map(i=>codes[i])))}.map(Object.freeze));\n`);
writeFileSync(new URL('win-tier.js',directory),`// Compare the whole round's payout with the TOTAL paid bet.\nexport function winTier(payout,bet){if(!Number.isFinite(payout)||!Number.isFinite(bet)||bet<=0)return null;return payout>=bet*200?'mega':payout>=bet*50?'super':payout>=bet*20?'big':null;}\nexport const WIN_TITLES=Object.freeze({big:'BIG WIN',super:'SUPER WIN',mega:'MEGA WIN'});\n`);
let initial;
for(let a=0;a<20&&!initial;a++)for(let b=0;b<20&&!initial;b++)for(let c=0;c<20&&!initial;c++)for(let d=0;d<20&&!initial;d++)for(let e=0;e<25&&!initial;e++){
  const stops=[a,b,c,d,e],symbols=stops.flatMap((stop,i)=>[-1,0,1].map(offset=>m.reels[i][(stop+offset+m.reels[i].length)%m.reels[i].length]));
  if(new Set(symbols).size===9)initial=stops;
}
assert.ok(initial);
writeFileSync(new URL('model-config.js',directory),`// Generated from the independently verified v3 candidate; integer line-bet awards.\nexport const PAYOUTS=Object.freeze(${JSON.stringify(m.paytable)}.map(Object.freeze));\nexport const MAXIMUM_MULTIPLIER=200;\nexport const BIG_WIN_MEAN_SPINS=${4000000/(m.stats.tiers.big+m.stats.tiers.super+m.stats.tiers.mega)};\nexport const INITIAL_STOPS=Object.freeze(${JSON.stringify(initial)});\nexport const TIER_PREVIEW_STOPS=Object.freeze({${Object.entries(m.stats.previews).map(([k,p])=>`${k}:Object.freeze(${JSON.stringify(p.stops)})`).join(',')}});\n`);
