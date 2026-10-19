import { readFileSync } from 'node:fs';
const report=JSON.parse(readFileSync(new URL('../../docs/data/math-report.json',import.meta.url)));
export const TEST_STOPS=Object.fromEntries(Object.entries(report.examples).map(([tier,p])=>[tier,p.stops]));
