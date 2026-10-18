import {readFileSync,copyFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {REEL_CODES,REEL_STRIPS,PAYTABLE,PAYLINES,SYMBOLS,MODEL_VERSION,TIER_PREVIEW_STOPS,evaluateGrid,gridFromStops} from '../src/models/v4/slot-math.js';
const report=JSON.parse(readFileSync(new URL('../docs/math-report-v4.json',import.meta.url)));
assert.equal(MODEL_VERSION,'circus-20-v4');assert.equal(report.model,MODEL_VERSION);
assert.equal(report.sha256,createHash('sha256').update(JSON.stringify({REEL_CODES,PAYTABLE,PAYLINES})).digest('hex'));
assert.equal(report.exact.totalPayoutSum*25,report.exact.totalBetSum*24);
assert.equal(report.exact.maximumTotalBetMultiplier,200);
assert.equal(report.enumeration.coveredStopCombinations,200**5);
assert.deepEqual(SYMBOLS.map(s=>PAYTABLE[s]),[[20,100,500],[15,75,250],[10,50,150],[8,40,100],[5,15,40],[5,12,30],[4,10,25],[3,8,20],[20,100,500]]);
for(const r of REEL_STRIPS){assert.equal(r.length,200);assert.ok(r.filter(s=>s==='wild').length<=5);assert.ok(r.filter(s=>['scarab','eye','ankh','necklace'].includes(s)).length<=21);}
for(const tier of ['big','super','mega'])for(const bet of [20,100,200,500])assert.equal(evaluateGrid(gridFromStops(TIER_PREVIEW_STOPS[tier]),bet).tier,tier);
for(const file of ['reel-strips.js','model-config.js','win-tier.js'])copyFileSync(new URL('../src/models/v4/'+file,import.meta.url),new URL('../src/'+file,import.meta.url));
copyFileSync(new URL('../docs/math-report-v4.json',import.meta.url),new URL('../docs/math-report.json',import.meta.url));
console.log('Promoted verified '+MODEL_VERSION);
