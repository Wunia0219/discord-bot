import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { MODEL_VERSION,REEL_CODES,SYMBOLS,SYMBOL_CODES,SYMBOL_NAMES,PAYTABLE,BET_DIVISOR } from '../../src/game/slot-math.js';
import { WIN_THRESHOLDS } from '../../src/game/win-tier.js';
const read=name=>JSON.parse(readFileSync(new URL('../../docs/data/'+name,import.meta.url)));
const report=read('math-report.json'),sessions=read('session-report.json'),reference=read('model-source.json');
assert.equal(report.sha256,createHash('sha256').update(JSON.stringify({MODEL_VERSION,REEL_CODES,PAYTABLE,BET_DIVISOR})).digest('hex'));
assert.equal(sessions.modelSha256,report.sha256);
assert.deepEqual(report.winThresholds,WIN_THRESHOLDS);
const pct=n=>(n*100).toFixed(4)+'%',e=report.exact,s=sessions.observed;
const symbols=SYMBOLS.slice(0,8).map(symbol=>`| ${SYMBOL_CODES[symbol]} ${SYMBOL_NAMES[symbol]} | ${pct(e.symbols[symbol].roundFrequency)} | ${pct(e.symbols[symbol].payoutShare)} |`).join('\n');
const payouts=SYMBOLS.map(symbol=>`| ${SYMBOL_CODES[symbol]} ${SYMBOL_NAMES[symbol]} | ${PAYTABLE[symbol].join(' | ')} |`).join('\n');
const document=`# 243 路規則與驗證

目前版本：\`${MODEL_VERSION}\`。維持原倍率與精確 96% RTP，固定 5 軸 × 3 列，243 路全部啟用；各軸獨立等機率抽停點。

## 算獎

- 從第一軸向右連續至少三軸有相同圖標，位置可在任意列。同一圖標只付最長連續得獎段，各軸份數相乘得到組合數；不同圖標相加。
- 得分＝原倍率 × 組合數 × 計價單位；計價單位保持為總下注÷${BET_DIVISOR}。下注額為 20／100／200／500。243 代表完整路徑數。
- 例如前三軸有 2、1、3 個紅心，第四軸沒有紅心或 WILD，得分為 6 × 5 × 計價單位。未參與的後方軸不重複放大三連獎。
- WILD 替代一般圖標，只出現在第三至第五軸。沒有 Scatter、免費旋轉或額外獎池。W 的獨立倍率保留，但前兩軸無 W，因此無法形成獨立 W 三連。
- 派彩包含得分，不另外返還本金；淨損益＝派彩−總下注。得分可小於下注。

| 圖標 | 3 連 | 4 連 | 5 連 |
|---|---:|---:|---:|
${payouts}

## 輪帶來源

原始資料為使用者提供的 243 路表，來源 SHA-256：\`${reference.sourceSha256}\`。以原表高低分結構為起點；N1～N4 對應四種低分，N5／SC 的空間先按原 N1:N2:N3:N4 比例分配，再依 96% 與均衡得分約束設計最終頻率。

整數輪帶長度為 ${report.lengths.join('／')}。參考原表的高低分結構，為同時滿足原倍率、96% RTP 與分散得獎，離線調整 WILD 及四種低分的比例，並以排列增加有派彩回合；不宣稱逐圖標完全複製原表。黑桃沒有特殊加權。原表計數、設計頻率與約束保存在 [model-source.json](data/model-source.json)。完整輪帶為 [jokers-circus-243.json](../output/jokers-circus-243.json)。

輪帶在開轉前固定，各停點獨立等機率；執行時不依玩家輸贏改變權重、補償或重抽。前三軸只調整排列，不改變單局期望值。

## 精確結果

| 指標 | 理論值 |
|---|---:|
| RTP | ${pct(e.rtp)} |
| 有派彩率 | ${pct(e.hitRate)} |
| 淨獲利率 | ${pct(e.profitableRate)} |
| 有派彩但淨損失 | ${pct(e.lossWithPayoutRate)} |
| 只有黑桃得分的回合率 | ${pct(e.spadeOnlyRate)} |
| 自然最高派彩／總下注 | ${e.maximumTotalBetMultiplier} 倍 |

| 圖標 | 參與得分的回合率 | 派彩金額占比 |
|---|---:|---:|
${symbols}

不同圖標可在同一回合得分，回合率不能相加成總中獎率。BIG／SUPER／MEGA 演出門檻為 ${Object.values(WIN_THRESHOLDS).join('／')} 倍總下注；只影響演出分級，派彩及圖標頻率保持原值。最高獎由可達盤面產生，沒有結算後截斷。

## 驗證與重現

\`npm run verify:math\` 以可見圖標份數及整數權重壓縮重複狀態，涵蓋全部 ${e.stopCombinations.toLocaleString('en-US')} 組停點，再以獨立期望公式交叉核對。RTP 精確分數為 \`${e.rtpFraction}\`。明細與派彩分布在 [math-report.json](data/math-report.json)。

\`npm run verify:sessions\` 執行 ${sessions.sessionCount} 組 × ${sessions.roundsPerSession} 回合，每組初始 10,000、下注 20，沒有補幣、重抽或刪除結果；逐局走正式結算函式，另以獨立路徑枚舉核對 ${sessions.oracleComparisons} 局。結果：RTP ${pct(s.rtp)}、有派彩率 ${pct(s.hitRate)}、淨獲利率 ${pct(s.profitableRate)}、黑桃派彩占比 ${pct(s.symbols.ace.payoutShare)}。這些是樣本值，理論值以上方完整枚舉為準。

每組 seed 與統計在 [session-report.json](data/session-report.json)，原始停點、派彩及餘額在 \`test-results/243-sessions.jsonl\`，可依 seed 重建。\`npm test\` 另涵蓋亂數拒絕採樣、歷史版本完整單線核對、錢包重送、快速停輪、自動旋轉與演出暫停。

模型指紋：\`${report.sha256}\`。\`npm run export:model\` 依這個指紋重建本文件與匯出 JSON。
`;
writeFileSync(new URL('../../docs/game-math.md',import.meta.url),document);
const out=new URL('../../output/',import.meta.url);mkdirSync(out,{recursive:true});
writeFileSync(new URL('jokers-circus-243.json',out),JSON.stringify({model:MODEL_VERSION,sha256:report.sha256,sourceSha256:reference.sourceSha256,winThresholds:WIN_THRESHOLDS,reels:REEL_CODES,paytable:Object.fromEntries(SYMBOLS.map(s=>[SYMBOL_CODES[s],PAYTABLE[s]])),betDivisor:BET_DIVISOR,scoring:'243 ways; left-to-right, longest award per symbol; no Scatter; W on reels 3..5',exact:e},null,2)+'\n');
console.log('Updated current game-math.md and output/jokers-circus-243.json');
