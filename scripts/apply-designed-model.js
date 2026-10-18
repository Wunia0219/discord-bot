// Explicit offline promotion of the fully enumerated, saved v2 candidate.
import { readFileSync,writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const m=JSON.parse(readFileSync(new URL('../docs/model-v2-selected.json',import.meta.url)));
assert.equal(m.stats.rtp,.96);assert.ok(m.stats.bigMean>=600&&m.stats.bigMean<=1000);
const codes=['H1','H2','H3','H4','L1','L2','L3','L4','W'];
writeFileSync(new URL('../src/reel-strips.js',import.meta.url),`// Fixed v2 strips, selected by complete 4,000,000-outcome enumeration.\n// Changes require new model version, exact RTP and tail validation.\nexport const MODEL_VERSION = 'kemet-20-v2';\nexport const REEL_CODES = Object.freeze([\n${m.reels.map(r=>'  Object.freeze('+JSON.stringify(r.map(i=>codes[i]))+'),').join('\n')}\n]);\n`);
// Find an initial showcase containing all symbols, with no effect on outcome RNG.
let initial;
for(let a=0;a<20&&!initial;a++)for(let b=0;b<20&&!initial;b++)for(let c=0;c<20&&!initial;c++)for(let d=0;d<20&&!initial;d++)for(let e=0;e<25&&!initial;e++){
 const stops=[a,b,c,d,e],symbols=stops.flatMap((stop,i)=>[-1,0,1].map(offset=>m.reels[i][(stop+offset+m.reels[i].length)%m.reels[i].length]));
 if(new Set(symbols).size===9)initial=stops;
}
writeFileSync(new URL('../src/model-config.js',import.meta.url),`// Generated from docs/model-v2-selected.json; all payouts are integer line-bet multipliers.\nexport const PAYOUTS = Object.freeze(${JSON.stringify(m.paytable)}.map(Object.freeze));\nexport const MAXIMUM_MULTIPLIER = ${m.stats.max};\nexport const BIG_WIN_MEAN_SPINS = ${m.stats.bigMean};\nexport const INITIAL_STOPS = Object.freeze(${JSON.stringify(initial)});\nexport const TIER_PREVIEW_STOPS = Object.freeze({\n${Object.entries(m.stats.previews).map(([tier,p])=>`  ${tier}:Object.freeze(${JSON.stringify(p.stops)}),`).join('\n')}\n});\n`);
