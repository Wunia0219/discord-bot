import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {SYMBOLS,SYMBOL_CODES,SYMBOL_NAMES,PAYTABLE,PAYLINES,REEL_CODES,MODEL_VERSION,TIER_PREVIEW_STOPS} from '../src/slot-math.js';
const report=JSON.parse(readFileSync(new URL('../docs/math-report.json',import.meta.url))),e=report.exact,n=e.stopCombinations;
assert.equal(report.model,MODEL_VERSION);assert.equal(report.sha256,createHash('sha256').update(JSON.stringify({REEL_CODES,PAYTABLE,PAYLINES})).digest('hex'));
const fmt=n=>n.toLocaleString('en-US'),pct=n=>(n*100).toFixed(6)+'%';
const table='| 符號 | 目前圖標 | 3 連 | 4 連 | 5 連 |\n|---|---|---:|---:|---:|\n'+SYMBOLS.map(s=>`| ${SYMBOL_CODES[s]} | ${SYMBOL_NAMES[s]} | ${PAYTABLE[s].join(' | ')} |`).join('\n');
const countTable='| 符號 | R1 | R2 | R3 | R4 | R5 |\n|---|---:|---:|---:|---:|---:|\n'+SYMBOLS.map((s,i)=>`| ${SYMBOL_CODES[s]} ${SYMBOL_NAMES[s]} | ${report.counts.map(r=>r[i]).join(' | ')} |`).join('\n');
const tiers='| 演出 | 派彩／總下注 | 精確盤面數 | 平均間隔 |\n|---|---|---:|---:|\n'+Object.entries(e.tierCounts).map(([tier,count])=>`| ${tier.toUpperCase()} WIN | ${{big:'20～不足 50 倍',super:'50～不足 200 倍',mega:'恰好 200 倍'}[tier]} | ${fmt(count)} / ${fmt(n)} | ${fmt(Number((n/count).toFixed(2)))} 回 |`).join('\n');
const math=`## 20 線賠率表（已套用 ${MODEL_VERSION}）

採 V1 賠率，WILD 改為與 H1 相同的 20／100／500 倍單線下注。五軸各 200 格，精確 RTP 96%，自然最高派彩 200 倍。三級演出維持 BIG 20／SUPER 50／MEGA 200 倍。完整驗證見 [v4 長輪帶與固定賠率](docs/model-v4.md)。

所有倍率乘以單線下注，單線下注 = 總下注 ÷ 20；不另外返還本金。

${table}

由第一軸向右連續至少 3 格，每線只付最高獎；WILD 可替代一般符號，不同線相加。例如總下注 100，單線下注 5；單條 H1 或 WILD 五連派彩 2,500，相當於總下注 25 倍。沒有免費旋轉、額外獎池或動態補償。

總下注 20／100／200／500，全程整數結算；MAX BET 只選 500，不自動旋轉。200 倍上限由固定輪帶與多線加總自然產生，不截掉超額獎金。

## 固定輪帶：${MODEL_VERSION}

五軸各 200 格，共 ${fmt(n)} 種等機率停點。每軸獨立均勻抽樣；不是將舊短輪帶重複貼成長輪帶，已檢查不存在較短的整段重複週期。完整順序在 src/reel-strips.js 及 docs/model-v4-selected.json。

${countTable}

WILD 比例為 2.5%／2.5%／2.5%／2.5%／2%；高分 H1–H4 合計為 10%／10%／10%／10%／10.5%；低分圖標各軸皆為 87.5%。這是單一格位機率，不是三格窗口至少出現一次的機率。

R1、R2 的 WILD 與 H1/WILD 保持至少三格位置距離；R3–R5 有固定 H1／WILD 堆疊，用於保留極稀有但真實可達的最高獎。排列是固定內容，不會依輸贏臨時插入圖標。動畫仍沿同一輪帶向下移動。

`;
const proof=`## RTP 與完整盤面驗證

| 指標 | 精確結果 |
|---|---:|
| 理論 RTP | 24/25 = 96% |
| 有派彩率 | ${pct(e.hitRate)} |
| 淨獲利率 | ${pct(e.profitableRate)} |
| 單局標準差／總下注 | ${e.standardDeviationTotalBet.toFixed(6)} |
| 自然最高派彩 | 200 倍總下注 |
| 最高獎停點之一 | ${e.maximumStops.join(' / ')} |

${tiers}

三級互斥，每次只顯示最高符合級別。平均間隔不是固定出獎週期。SUPER／MEGA 非常稀有，可用不扣籌碼的真實盤面預覽觀看。

先獨立核對全部 59,049 種單線組合，再將相同三格窗口合併並保留權重。${report.enumeration.uniqueWindows.join('／')} 種各軸窗口，共 ${fmt(report.enumeration.compressedCombinations)} 組加權盤面，精確涵蓋 ${fmt(n)} 組原始停點，沒有省略稀有結果。每回下注 20，總下注 ${fmt(e.totalBetSum)}、總派彩 ${fmt(e.totalPayoutSum)}，比值精確為 96%。

另跑 100 萬回交叉模擬，RTP ${pct(report.simulation.rtp)}；此模擬不是 RTP 或最高獎證明。正式遊戲使用 crypto.randomInt，瀏覽器獨立試玩採 rejection sampling。

模型 SHA-256：\`${report.sha256}\`。

`;
const path=new URL('../README.md',import.meta.url);let readme=readFileSync(path,'utf8');
readme=readme.replace(/^- `npm run verify:math`：[^\r\n]*/m,`- \`npm run verify:math\`：獨立算分器核對 59,049 種單線組合，以 ${fmt(report.enumeration.compressedCombinations)} 組加權窗口完整涵蓋 ${fmt(n)} 種停點，再跑 100 萬局模擬，產生 [數學報告](docs/math-report.json)。`);
readme=readme.slice(0,readme.indexOf('## 20 線賠率表'))+math+readme.slice(readme.indexOf('### 20 條線座標'));
readme=readme.slice(0,readme.indexOf('## RTP 與完整盤面驗證'))+proof+readme.slice(readme.indexOf('## 動畫、預覽與保存'));writeFileSync(path,readme);
const profile=JSON.parse(readFileSync(new URL('../docs/payout-profile-v4.json',import.meta.url))).sessionStudy;
writeFileSync(new URL('../docs/model-v4.md',import.meta.url),`# v4：V1 賠率、WILD 同 H1、五軸各 200 格

2026-10-18。版本 ${MODEL_VERSION}。此版依使用者最新指示完成，取代 v3。

## 固定賠率

${table}

上表為單線下注倍數；單線下注＝總下注÷20。WILD 三／四／五連改成 20／100／500，其餘完全套用 V1。沒有為湊 RTP 改動任何指定賠率。

## 輪帶與比例

${countTable}

每軸總長 200，不是重複舊 20／25 格輪帶。高分合計各軸 10%～10.5%，WILD 2%～2.5%，低分合計 87.5%。v3 的高分為 30%～32%，WILD 4%～10%；新比例均降低。低分內部比例不同，尤其黑桃／紅心較常見，讓指定較低的賠率仍能達到 96%。

輪帶包含低分交錯段與少量稀有符號段；R3–R5 的 H1／WILD 有固定堆疊，R1–R2 對 WILD 間距設限，以保留自然 200 倍最高獎並避免額外派彩使上限超標。堆疊未提高整軸稀有符號占比；所有盤面仍由實際停點決定。長度本身不改 RTP，真正改變頻率的是比例與排列。

## 完整驗證

${proof.replace('## RTP 與完整盤面驗證\n','')}

## 與上一版比較

| 指標 | v3 | v4 |
|---|---:|---:|
| 輪帶長度 | 20／20／20／20／25 | 200／200／200／200／200 |
| 理論 RTP | 96% | 96% |
| ≥20 倍平均間隔 | 305.60 回 | ${(n/e.tails[20].count).toFixed(2)} 回 |
| 單局標準差／總下注 | 2.622135 | ${e.standardDeviationTotalBet.toFixed(6)} |
| 自然最高派彩 | 200 倍 | 200 倍 |

依固定 seed 20261018，從精確整局分布抽樣 10 萬組 × 500 回，合計 RTP ${pct(profile.aggregateRtp)}，500 回 RTP 第 5／50／95 百分位為 ${[.05,.5,.95].map(q=>pct(profile.rtpQuantiles[q])).join('／')}。本金為 100 次下注額，途中無法支付下一回的比例 ${pct(profile.unableToCompleteFraction)}；資金不足之後仍抽樣至 500 回作數學分析，不是允許負餘額遊玩。超過 32 位元的停點總數使用 53 位元組合亂數與拒絕取樣，避免取樣範圍不足。

## 相容性與預覽

v1／v2／v3 原始規則已封存；舊紀錄、餘額及後端重送結果保留原值。三種預覽的真實停點：\`${JSON.stringify(TIER_PREVIEW_STOPS)}\`，不扣款、不寫入紀錄。關閉並重新開啟 Discord Activity 後，在遊玩介紹確認 ${MODEL_VERSION}。

## 重現

1. node scripts/design-v4-counts.js：指定賠率下求精確符號數量。
2. node scripts/design-v4-reels.js：離線建立固定長輪帶與隔離候選。
3. node scripts/verify-v4.js：加權完整枚舉、最高獎與三級可達性驗證。
4. node scripts/promote-model-v4.js：檢查指紋、96%、200 倍上限後明確套用。
5. npm test；npm run verify:math；npm run build。
6. node scripts/research-payout-profile.js --current；node scripts/sync-model-docs.js。

模型在 model-v4-selected.json，精確結果在 math-report-v4.json，session 分布在 payout-profile-v4.json。以上設計命令會重寫離線候選，不會自行更新運行中的後端。
`);
