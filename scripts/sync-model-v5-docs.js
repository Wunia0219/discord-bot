import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { SYMBOLS, SYMBOL_CODES, SYMBOL_NAMES, PAYTABLE, PAYLINES, REEL_CODES, MODEL_VERSION, TIER_PREVIEW_STOPS } from '../src/slot-math.js';
const report=JSON.parse(readFileSync(new URL('../docs/math-report.json',import.meta.url)));
const prior=JSON.parse(readFileSync(new URL('../docs/math-report-v4.json',import.meta.url)));
const reference=JSON.parse(readFileSync(new URL('../docs/reference-243-analysis.json',import.meta.url)));
const model=JSON.parse(readFileSync(new URL('../docs/model-v5-selected.json',import.meta.url)));
assert.equal(MODEL_VERSION,'circus-20-v5');assert.equal(report.model,MODEL_VERSION);
assert.equal(report.sha256,createHash('sha256').update(JSON.stringify({REEL_CODES,PAYTABLE,PAYLINES})).digest('hex'));
const e=report.exact,n=e.stopCombinations,fmt=n=>n.toLocaleString('en-US'),pct=n=>(n*100).toFixed(6)+'%',interval=n=>fmt(Number(n.toFixed(2)));
const sum=a=>a.reduce((x,y)=>x+y,0);
const shares=report.counts.map(c=>({high:sum(c.slice(0,4))/80,low:sum(c.slice(4,8))/80,wild:c[8]/80}));
const paytable='| 符號 | 圖標 | 3 連 | 4 連 | 5 連 |\n|---|---|---:|---:|---:|\n'+SYMBOLS.map(s=>`| ${SYMBOL_CODES[s]} | ${SYMBOL_NAMES[s]} | ${PAYTABLE[s].join(' | ')} |`).join('\n');
const counts='| 符號 | R1 | R2 | R3 | R4 | R5 |\n|---|---:|---:|---:|---:|---:|\n'+SYMBOLS.map((s,i)=>`| ${SYMBOL_CODES[s]} ${SYMBOL_NAMES[s]} | ${report.counts.map(c=>c[i]).join(' | ')} |`).join('\n')+'\n| 合計 | 80 | 80 | 80 | 80 | 80 |';
const comparisons='| 軸 | 參考長度 | 參考高分 | 新高分 | 參考 WILD | 新 WILD | 新低分 |\n|---|---:|---:|---:|---:|---:|---:|\n'+reference.reference.map((r,i)=>`| R${i+1} | ${r.length} | ${pct(r.shares.high)} | ${pct(shares[i].high)} | ${pct(r.shares.wild)} | ${pct(shares[i].wild)} | ${pct(shares[i].low)} |`).join('\n');
const tiers='| 演出 | 派彩／總下注 | 精確停點組數 | 長期平均間隔 |\n|---|---|---:|---:|\n'+Object.entries(e.tierCounts).map(([tier,count])=>`| ${tier.toUpperCase()} WIN | ${{big:'20～不足 50 倍',super:'50～不足 200 倍',mega:'恰好 200 倍'}[tier]} | ${fmt(count)} / ${fmt(n)} | ${interval(n/count)} 回 |`).join('\n');
const bands=[{label:'未中獎',test:p=>p===0},{label:'有派彩但不足下注',test:p=>p>0&&p<20},{label:'打平',test:p=>p===20},{label:'淨獲利',test:p=>p>20}].map(b=>({label:b.label,count:Object.entries(report.payoutDistributionInLineBets).reduce((a,[p,w])=>a+(b.test(Number(p))?w:0),0)}));
const proof=`## RTP 與完整盤面驗證

| 指標 | 精確結果 |
|---|---:|
| 理論 RTP | 24/25 = 96% |
| 有派彩率 | ${pct(e.hitRate)} |
| 淨獲利率 | ${pct(e.profitableRate)} |
| 單局標準差／總下注 | ${e.standardDeviationTotalBet.toFixed(6)} |
| 自然最高派彩 | 200 倍總下注 |
| 最高獎停點之一（0 起算） | ${e.maximumStops.join(' / ')} |

${tiers}

≥20 倍合計平均 ${interval(e.tails[20].meanSpins)} 回一次；上表三級互斥，平均間隔不是固定出獎週期。200 倍仍非常罕見，輪帶較短或高分圖標較多不代表會經常得到最高獎。

獨立算分器核對全部 59,049 種單線組合。相同三格窗口保留整數權重，再把前三軸會產生相同派彩算式的窗口組合合併，枚舉第四、五軸全部窗口。${report.enumeration.firstThreeExpressionGroups} 組派彩算式 × ${report.enumeration.tailWindowPairs} 組末兩軸窗口，精確涵蓋全部 ${fmt(n)} 組停點。總下注 ${fmt(e.totalBetSum)}、總派彩 ${fmt(e.totalPayoutSum)}，比值精確為 96%。這不是以模擬接近 96% 代替證明。

另以固定 seed 跑 100 萬局交叉核對，模擬 RTP ${pct(report.simulation.rtp)}；不拿這個短期數字當理論 RTP。

模型 SHA-256：\`${report.sha256}\`。

`;
const math=`## 20 線賠率表（已套用 ${MODEL_VERSION}）

設計狀態：v5 的 L1 與逐圖標頻率未符合使用者最新確認的參考要求；此處記錄已套用版本的數學資料，不代表新設計已完成。後續不預設 80 格，見 [頻率可行性校驗](docs/reference-frequency-feasibility.json)。

沿用 V1 賠率，WILD 與 H1 同為單線 20／100／500 倍。五軸各 80 格，高分圖標占 27.5%～40%，精確 RTP 96%，自然最高派彩 200 倍。BIG／SUPER／MEGA 為 20／50／200 倍。完整設計見 [v5 參考分布與 80 格輪帶](docs/model-v5.md)。

所有倍率乘以單線下注；單線下注＝總下注÷20。不另外返還本金。

${paytable}

20 條固定賠線從第一軸向右連續至少 3 格得獎；每線只付最高獎，各線相加。沒有 Scatter、免費旋轉或額外獎池。總下注 20／100／200／500，使用整數結算。

## 固定輪帶：${MODEL_VERSION}

每軸 80 格，共 ${fmt(n)} 種等機率停點，沒有較短的整段重複週期。原始碼在 src/reel-strips.js；可直接使用的五軸圖標陣列在 [reels.json](output/reel-design-v5/reels.json)。

${counts}

參考使用者提供的 243 路輪帶，將高分總占比提高到接近參考表。為了保留現有賠率與精確 96%，L1 仍占各軸 22.5%～40%，WILD 占 2.5%～6.25%；不是逐格複製參考比例。固定排列於開轉前就已決定，不依輸贏修改。

`;
const readmePath=new URL('../README.md',import.meta.url);let readme=readFileSync(readmePath,'utf8');
readme=readme.replace(/^- `npm run verify:math`：[^\r\n]*/m,`- \`npm run verify:math\`：獨立核對全部單線組合，透過保留權重的派彩算式合併涵蓋 ${fmt(n)} 種停點，再跑 100 萬局交叉核對。`);
readme=readme.slice(0,readme.indexOf('## 20 線賠率表'))+math+readme.slice(readme.indexOf('### 20 條線座標'));
readme=readme.slice(0,readme.indexOf('## RTP 與完整盤面驗證'))+proof+readme.slice(readme.indexOf('## 動畫、預覽與保存'));
readme=readme.replace('避免 200 格長輪帶在短時間跑完造成視覺跳格','避免依輪帶長度改變速度、在短時間跑完造成視覺跳格');
writeFileSync(readmePath,readme);
const detail=`# v5：參考 243 路分布、固定賠率的 80 格／20 線輪帶

> 設計狀態更正：使用者已指出 v5 的 L1 過多、逐圖標頻率不符合參考要求，此版不算完成需求。下方保留的是 v5 的數學驗證與重現紀錄。新設計不預設 80 格；可行性校驗見 [reference-frequency-feasibility.json](reference-frequency-feasibility.json)。目前尚未套用替代版本。

2026-10-18。版本 ${MODEL_VERSION}，取代 v4。使用者已選擇「目前賠率固定，分布比例可調整到能達成 96% RTP」。遊戲仍為 5 軸 × 3 列、20 條固定賠線，不改成 243 ways。

## 參考資料與轉換

來源為使用者提供的五軸輪帶，長度 79／87／83／80／84；來源指紋 \`${reference.sourceSha256}\`。逐軸計數在 [reference-243-analysis.json](reference-243-analysis.json)。

參考表有 H1～H4、N1～N5、SC，以及第三至第五軸的 W。此款只有四種低分圖標且沒有 SC 功能，所以 H1～H4 保留、N1～N4 對應 L1～L4，N5 與 SC 的空間在參考目標中按比例分配給四種低分圖標。這是轉換假設，不代表原表 N5 或 SC 的實際遊戲價值。

若只把此參考頻率映射成每軸 80 格、沿用現有賠率，精確 RTP 為 ${pct(reference.candidate.exactRtpWithExistingPaytable.value)}。這個數字是本款 20 線遊戲的映射基準；沒有原遊戲的賠率與 SC／免費遊戲規則，不能推算其 243 路遊戲 RTP。

單線結果的期望派彩由各軸符號數量決定。總下注平均分到 20 條線，因此總 RTP 等於單線的期望派彩／單線下注；只重排輪帶不會把此映射基準提高成 96%。排列會改變多線同中、命中率、波動與最高獎。

${comparisons}

新輪帶高分平均占 33.25%，v4 為 10.1%。為保持指定賠率，L1 仍需偏多；第一、二軸也加入 5%／2.5% WILD，第四、五軸為 5%／6.25%，高於參考的 2.5%／4.76%。這些是已列出的分布調整，不宣稱逐符號完全複製原表。

## 每軸數量與賠率

${counts}

L1 占比 40%／32.5%／40%／30%／22.5%；其餘低分圖標各軸至少 7.5%。高分與低分不會各自完全均等，這是固定賠率與 RTP 所需的取捨。

${paytable}

賠率與 v4 完全一致，含 WILD＝H1。每線只付最高獎，20 線派彩相加；最高獎由可達盤面產生，沒有截斷獎金。

## 排列原則

每軸固定 80 格，不是把短輪帶重複貼滿；每軸高分分散到四段，各 20 格中的高分數量接近該軸平均。相鄰重複為 6～8 次／80 格，接近參考表約 6%～11% 的重複頻率；沒有四格同圖標長堆疊。第一、二軸的 H1 夾心中間採不同低分圖標；後三軸保留短的 H1／WILD 混合窗口，以保留真實可達的 200 倍。

輪帶每軸有 ${report.enumeration.uniqueWindows.join('／')} 種不同三格窗口；v4 為 ${prior.enumeration.uniqueWindows.join('／')} 種。這反映可見相鄰圖案變化增加，不代表 RTP 增加。

${proof}

## 與 v4 的完整結果比較

| 指標 | v4 | v5 |
|---|---:|---:|
| 每軸長度 | 200 | 80 |
| 高分平均比例 | 10.1% | 33.25% |
| 精確 RTP | 96% | 96% |
| 有派彩率 | ${pct(prior.exact.hitRate)} | ${pct(e.hitRate)} |
| 淨獲利率 | ${pct(prior.exact.profitableRate)} | ${pct(e.profitableRate)} |
| 標準差／總下注 | ${prior.exact.standardDeviationTotalBet.toFixed(6)} | ${e.standardDeviationTotalBet.toFixed(6)} |
| ≥20 倍平均間隔 | ${interval(prior.exact.tails[20].meanSpins)} 回 | ${interval(e.tails[20].meanSpins)} 回 |
| 自然最高派彩 | 200 倍 | 200 倍 |

${bands.map(b=>`- ${b.label}：${pct(b.count/n)}`).join('\n')}

有派彩率包含不足下注的小獎；淨獲利率只計派彩高於下注，兩者不能混用。

## 相容性與重現

v1～v4 規則保留在 src/models/，舊回合依原版本驗證。即使 v4 停點超過 79，餘額、原始派彩、歷史紀錄與相同請求的重送仍保留；新局使用 v5。向下轉動動畫沿用統一速度。

三種免費預覽停點（0 起算）：\`${JSON.stringify(TIER_PREVIEW_STOPS)}\`。不扣籌碼、不寫紀錄。

1. \`node scripts/analyze-reference-reels.js <使用者原始 JSON 檔>\`：來源統計與映射基準。
2. \`node scripts/design-v5-counts.js 2000000\`：固定 seed 搜尋精確 96% 整數數量；只產生離線候選。
3. \`node scripts/design-v5-reels.js\`：固定 seed 排列 80 格輪帶。
4. \`node scripts/verify-v5.js\`：獨立算分、完整加權盤面、最高獎與三級可達性。
5. \`node scripts/promote-model-v5.js\`：檢查指紋、原賠率、96%、200 倍後套用。
6. \`npm test\`、\`npm run verify:math\`、\`npm run build\`。
7. \`node scripts/sync-model-docs.js\`：重建本文件與交付 JSON。

交付的 [reels.json](../output/reel-design-v5/reels.json) 為與使用者貼上內容相同的「五軸字串陣列」結構；[model.json](../output/reel-design-v5/model.json) 另含賠率、20 線座標、數量、預覽停點與精確結果。
`;
writeFileSync(new URL('../docs/model-v5.md',import.meta.url),detail);
const out=new URL('../output/reel-design-v5/',import.meta.url);mkdirSync(out,{recursive:true});
writeFileSync(new URL('reels.json',out),JSON.stringify(REEL_CODES,null,2)+'\n');
writeFileSync(new URL('model.json',out),JSON.stringify({model:MODEL_VERSION,sha256:report.sha256,sourceSha256:reference.sourceSha256,codes:reference.candidate.codes,reels:REEL_CODES,counts:report.counts,paytable:SYMBOLS.map(s=>PAYTABLE[s]),paylines:PAYLINES,totalBetDivisor:20,initialStops:model.initial,previews:TIER_PREVIEW_STOPS,exact:report.exact,enumeration:report.enumeration},null,2)+'\n');
console.log('Updated v5 math documentation and exported reels.json/model.json');
