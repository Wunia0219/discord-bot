// Explicit promotion only after the isolated candidate passes verify-math --candidate.
import {readFileSync,copyFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {REEL_CODES,PAYTABLE,PAYLINES,MODEL_VERSION} from '../src/models/v3/slot-math.js';
const report=JSON.parse(readFileSync(new URL('../docs/math-report-v3.json',import.meta.url)));
assert.equal(MODEL_VERSION,'circus-20-v3');assert.equal(report.model,MODEL_VERSION);
assert.equal(report.sha256,createHash('sha256').update(JSON.stringify({REEL_CODES,PAYTABLE,PAYLINES})).digest('hex'));
assert.equal(report.exact.totalPayoutSum*25,report.exact.totalBetSum*24);
assert.equal(report.exact.maximumTotalBetMultiplier,200);
for(const count of Object.values(report.exact.tierCounts))assert.ok(count>0);
for(const file of ['reel-strips.js','model-config.js','win-tier.js'])copyFileSync(new URL('../src/models/v3/'+file,import.meta.url),new URL('../src/'+file,import.meta.url));
copyFileSync(new URL('../docs/math-report-v3.json',import.meta.url),new URL('../docs/math-report.json',import.meta.url));
console.log('Promoted independently verified '+MODEL_VERSION);
