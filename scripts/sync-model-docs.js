// Generate current math documentation from the active model and verified report.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {SYMBOLS,SYMBOL_CODES,SYMBOL_NAMES,PAYTABLE,REEL_CODES,PAYLINES,MODEL_VERSION,TIER_PREVIEW_STOPS} from '../src/slot-math.js';
if(MODEL_VERSION==='circus-20-v5'){await import('./sync-model-v5-docs.js');process.exit(0);}
if(MODEL_VERSION==='circus-20-v4'){await import('./sync-model-v4-docs.js');process.exit(0);}
const report=JSON.parse(readFileSync(new URL('../docs/math-report.json',import.meta.url)));
assert.equal(report.model,MODEL_VERSION);
assert.equal(report.sha256,createHash('sha256').update(JSON.stringify({REEL_CODES,PAYTABLE,PAYLINES})).digest('hex'));
const e=report.exact,n=e.stopCombinations,fmt=n=>n.toLocaleString('en-US'),pct=n=>(n*100).toFixed(6)+'%';
const table='| 符號 | 圖標 | 3 連 | 4 連 | 5 連 |\n|---|---|---:|---:|---:|\n'+SYMBOLS.map(s=>`| ${SYMBOL_CODES[s]} | ${SYMBOL_NAMES[s]} | ${PAYTABLE[s].join(' | ')} |`).join('\n');
const tierRows=Object.entries(e.tierCounts).map(([tier,count])=>`| ${tier.toUpperCase()} WIN | ${{big:'20～不足 50 倍',super:'50～不足 200 倍',mega:'恰好 200 倍'}[tier]} | ${fmt(count)} / ${fmt(n)} | ${fmt(Number((n/count).toFixed(2)))} 回 |`).join('\n');
const tiers='| 演出 | 派彩／總下注 | 精確盤面數 | 平均間隔 |\n|---|---|---:|---:|\n'+tierRows;
const low=report.counts.map((r,i)=>r.slice(4,8).reduce((a,b)=>a+b,0)/report.lengths[i]);
const math=`## 20 線賠率表（已套用 ${MODEL_VERSION}）

精確 96% RTP，最高派彩恰好 200 倍總下注。BIG／SUPER／MEGA 門檻為 20／50／200 倍。新版數學、三級頻率與驗證見 [新版數學與演出](docs/model-v3.md)。舊 v1／v2 規則及報告保留供歷史回合驗證。

所有倍率乘以單線下注，單線下注 = 總下注 ÷ 20；不另外返還本金。

${table}

每線由第一軸向右連續至少 3 格，只付最高獎；W 可替代一般符號或獨立派彩，取較高者。不同線相加，共用格子也可各自得獎。沒有 Scatter、免費旋轉或額外獎池；12,000 里程碑不額外發放籌碼。

總下注 20／100／200／500，對應單線下注 1／5／10／25，全程整數記帳。MAX BET 只選 500，不自動旋轉。200 倍上限來自實際可達盤面的最大值，沒有結算後截斷派彩。

## 固定輪帶：${MODEL_VERSION}

各軸停點獨立等機率，長度 ${report.lengths.join('／')}，共 ${fmt(n)} 種等機率停點。索引從 0 起，指中央格；上格 index−1、下格 index+1，首尾循環。動畫沿同一輪帶由上往下移動，遊玩時不洗牌、不依輸贏調權重。

\`\`\`text
${REEL_CODES.map((r,i)=>`R${i+1} [${r.join(', ')}]`).join('\n')}
\`\`\`

| 符號 | R1 | R2 | R3 | R4 | R5 |
|---|---:|---:|---:|---:|---:|
${SYMBOLS.map((s,i)=>`| ${SYMBOL_CODES[s]} | ${report.counts.map(r=>r[i]).join(' | ')} |`).join('\n')}
| 低分占比 | ${low.map(n=>Math.round(n*100)+'%').join(' | ')} |

相鄰位置不重複相同符號；R1、R3 各兩個 W，其餘各一個，任一可見三格窗口至多一個 W。輪帶順序影響同局多線結果的相關性，已完整枚舉驗證。

`;
const proof=`## RTP 與完整盤面驗證

| 指標 | 精確結果 |
|---|---:|
| RTP | 24/25 = 96% |
| 有派彩局率 | ${pct(e.hitRate)} |
| 淨獲利局率 | ${pct(e.profitableRate)} |
| 單局標準差／總下注 | ${e.standardDeviationTotalBet.toFixed(6)} |
| 最高可達派彩／總下注 | ${e.maximumTotalBetMultiplier} 倍 |
| 最高獎停點之一 | ${e.maximumStops.join(' / ')} |

${tiers}

上述三級互斥；每次只播放最高符合級別。平均間隔不是固定出獎週期。MEGA 僅對應最高獎，所以機率極低，可用不扣籌碼的預覽檢查演出。

完整枚舉每回下注 20，總下注 ${fmt(e.totalBetSum)}，總派彩 ${fmt(e.totalPayoutSum)}；精確比值為 96%。最高獎下注 20／100／200／500 分別派彩 4,000／20,000／40,000／100,000。

另以 seed ${report.simulation.seed} 模擬 ${fmt(report.simulation.rounds)} 回，RTP ${pct(report.simulation.rtp)}。正式抽樣採伺服器 crypto.randomInt，本機試玩採 Web Crypto rejection sampling。短期實測 RTP 仍會波動。

模型 SHA-256：\`${report.sha256}\`。修改數學須重新驗證及升版，不可依玩家餘額、輸贏或短期 RTP 調整機率。

`;
const path=new URL('../README.md',import.meta.url);let text=readFileSync(path,'utf8');
text=text.slice(0,text.indexOf('## 20 線賠率表'))+math+text.slice(text.indexOf('### 20 條線座標'));
text=text.slice(0,text.indexOf('## RTP 與完整盤面驗證'))+proof+text.slice(text.indexOf('## 動畫、預覽與保存'));
text=text.replace('派彩 20～不足 50 倍播放 BIG WIN，50～不足 100 倍播放 SUPER WIN，100 倍以上播放 MEGA WIN。','派彩 20～不足 50 倍播放 BIG WIN，50～不足 200 倍播放 SUPER WIN，恰好 200 倍播放 MEGA WIN。');
writeFileSync(path,text);
const profile=JSON.parse(readFileSync(new URL('../docs/payout-profile-v3.json',import.meta.url))).sessionStudy;
writeFileSync(new URL('../docs/model-v3.md',import.meta.url),`# 馬戲團 v3：20／50／200 倍三級 WIN

2026-10-18，版本 ${MODEL_VERSION}。使用者最終指定 BIG 20、SUPER 50、MEGA 200 倍，最高也為 200 倍；取代先前 10／20／40 與最高 60～80 倍的草案。

## 已完成數學驗證

${table}

上表為單線下注倍率；整局派彩為 20 線加總。WILD 3／4 連可能依替代符號得到更高的同長度獎；以最高賠付為準。WILD 五連 2,861 倍單線下注不等於 2,861 倍總下注。

${tiers}

最高派彩自然為 200 倍，沒有事後封頂或補償輸贏。MEGA 僅出現在 ${e.tierCounts.mega} 個最高獎停點組合，平均 ${fmt(n/e.tierCounts.mega)} 回一次；這不是所有五個 WILD 都會得到 200 倍，其他連線的加總也影響總派彩。BIG 與 SUPER 比舊版常見，MEGA 因只對應精確最高獎而更稀有。

| 指標 | v2 | v3 |
|---|---:|---:|
| 理論 RTP | 96% | 96% |
| 自然最高派彩 | 144.1 倍 | 200 倍 |
| 有派彩率 | 49.525% | ${pct(e.hitRate)} |
| 淨獲利率 | 27.157% | ${pct(e.profitableRate)} |
| 單局標準差／總下注 | 1.926832 | ${e.standardDeviationTotalBet.toFixed(6)} |
| ≥20 倍平均間隔 | 957.63 回 | ${(n/e.tails[20].count).toFixed(2)} 回 |
| SUPER 本級平均間隔 | 約 173,913 回（50～100 倍） | ${(n/e.tierCounts.super).toFixed(2)} 回（50～200 倍） |

新版將更多期望回報移到較大派彩，波動比 v2 高，不能宣稱每組 500 回都更貼近 96%。原先接受的小獎與部分返還維持正常派彩行為。

獨立前綴算分器核對 59,049 種單線組合，完整枚舉 ${fmt(n)} 種盤面，總下注 ${fmt(e.totalBetSum)}、總派彩 ${fmt(e.totalPayoutSum)}，精確等於 24/25。另以 seed ${report.simulation.seed} 跑 100 萬回交叉檢查，RTP ${pct(report.simulation.rtp)}。

## 500 回分布研究

固定 seed 20261018，10 萬組 × 500 回，依精確整局派彩分布抽樣，合計 RTP ${pct(profile.aggregateRtp)}。RTP 第 5／50／95 百分位為 ${[.05,.5,.95].map(q=>pct(profile.rtpQuantiles[q])).join('／')}；初始 100 次下注額，無法付足全部 500 回比例約 ${pct(profile.unableToCompleteFraction)}。資金不足後仍抽完作數學分析，並非真的允許負餘額遊玩。這是數學模擬，未操作 Discord 錢包。

## 歷史與試玩

v1、v2 的算分與 v2 的演出門檻完整保存在 src/models；本機舊餘額／歷史照原規則驗證。後端儲存的舊回合與重複請求沿用原結果，不重算；後端重啟後需重新開啟 Activity 登入。

三種預覽使用真實可達停點、不扣籌碼、不寫歷史：\`${JSON.stringify(TIER_PREVIEW_STOPS)}\`。可先依序預覽 BIG、SUPER、MEGA，再正式 SPIN。遊玩介紹顯示版本、賠率與 200 倍上限。

## 重現與保存

- 搜尋：node scripts/design-v3.js 50（離線重新搜尋，不改遊戲；會重寫候選檔）
- 隔離準備：node scripts/prepare-model-v3.js
- 升版前獨立驗證：node scripts/verify-math.js --candidate
- 明確套用已驗證候選：node scripts/promote-model-v3.js
- 現行驗證：npm run verify:math；npm test
- 分布研究：node scripts/research-payout-profile.js --current
- 文件同步：node scripts/sync-model-docs.js

原始輪帶／賠率在 model-v3-selected.json，精確結果在 math-report-v3.json，分布研究在 payout-profile-v3.json。指紋：\`${report.sha256}\`。
`);
