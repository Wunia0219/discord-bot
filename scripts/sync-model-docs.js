// Refresh only the mathematical sections of the README from the verified model.
import {readFileSync,writeFileSync} from 'node:fs';
import {SYMBOLS,SYMBOL_CODES,SYMBOL_NAMES,PAYTABLE,REEL_CODES,MODEL_VERSION} from '../src/slot-math.js';
const path=new URL('../README.md',import.meta.url),report=JSON.parse(readFileSync(new URL('../docs/math-report.json',import.meta.url)));
let text=readFileSync(path,'utf8');
const math=`## 20 線賠率表（已套用 ${MODEL_VERSION}）

新版維持精確 96% RTP，各軸低分圖標占 64～65%，20 倍以上派彩平均約 958 局一次。詳細設計與舊版比較見 [新版數學與演出](docs/model-v2.md)。舊版資料保存在 src/models/v1 與 docs/math-report-v1.json。

所有倍率乘以單線下注，單線下注 = 總下注 ÷ 20；不另外返還本金。

| 符號 | 圖標 | 3 連 | 4 連 | 5 連 |
|---|---|---:|---:|---:|
${SYMBOLS.map(s=>`| ${SYMBOL_CODES[s]} | ${SYMBOL_NAMES[s]} | ${PAYTABLE[s].join(' | ')} |`).join('\n')}

每線由第一軸向右連續至少 3 格，只付最高獎；W 可替代一般符號或獨立派彩，取較高者。不同線相加，共用格子也可各自得獎。例如 W W W H1 H1 付 399 倍單線下注，W W W L4 L4 付 60 倍。沒有 Scatter、免費旋轉或額外獎池；12,000 里程碑不額外發放籌碼。

總下注 20／100／200／500，對應單線下注 1／5／10／25，全程整數記帳、不捨入。總下注 100 時，一條 H1 三連支付 250，一條 L1 四連支付 250，合計派彩 500、淨增 400。MAX BET 只選 500，不自動旋轉。

## 固定輪帶：${MODEL_VERSION}

各軸停點等機率且互相獨立，長度 20／20／20／20／25，共 4,000,000 種等機率停點。索引從 0 起，指中央格；上格 index−1、下格 index+1，首尾循環。動畫沿同一輪帶由上往下移動，遊玩時不洗牌、不依玩家輸贏調權重。

\`\`\`text
${REEL_CODES.map((r,i)=>`R${i+1} [${r.join(', ')}]`).join('\n')}
\`\`\`

| 符號 | R1 | R2 | R3 | R4 | R5 |
|---|---:|---:|---:|---:|---:|
${SYMBOLS.map((s,i)=>`| ${SYMBOL_CODES[s]} | ${report.counts.map(r=>r[i]).join(' | ')} |`).join('\n')}
| 低分占比 | 65% | 65% | 65% | 65% | 64% |

一般符號不相鄰重複，各軸只有一個 W。輪帶順序影響同局多線結果的相關性、命中率與波動，以下結果由全盤枚舉驗證。

`;
text=text.slice(0,text.indexOf('## 20 線賠率表'))+math+text.slice(text.indexOf('### 20 條線座標'));
const proof=`## RTP 與完整盤面驗證

| 指標 | 精確結果 |
|---|---:|
| RTP | 24/25 = 96% |
| 有派彩局率 | ${(report.exact.hitRate*100).toFixed(4)}% |
| 淨獲利局率 | ${(report.exact.profitableRate*100).toFixed(4)}% |
| 單局標準差／總下注 | ${report.exact.standardDeviationTotalBet.toFixed(6)} |
| 最高可達派彩／總下注 | ${report.exact.maximumTotalBetMultiplier} 倍 |
| 最高獎停點 | ${report.exact.maximumStops.join(' / ')} |
| ≥20 倍 | 4,177 / 4,000,000；平均 957.63 局一次 |
| ≥50 倍 | 43 / 4,000,000；平均 93,023.26 局一次 |
| ≥100 倍 | 20 / 4,000,000；平均 200,000 局一次 |

完整枚舉以總下注 20 計算，總下注 80,000,000，總派彩 76,800,000。單線符號加權驗證為 3,840,000 / 4,000,000 = 96%；不同線的期望可相加，不需假設互相獨立。最高獎 2,882／20 = 144.1 倍，總下注 500 時為 72,050。

另以 seed 960020 模擬 1,000,000 局，RTP 96.028775%，常態近似 95% 區間 95.651793%～96.405757%。模擬僅交叉檢查；正式抽樣採伺服器 crypto.randomInt，本機試玩採 Web Crypto rejection sampling。平均間隔不是保證週期，短期派彩不需等於 96%。

模型 SHA-256：\`${report.sha256}\`。變更輪帶、順序、賠率、線型或功能都須重新驗證並升版。不可依餘額、玩家輸贏或短期 RTP 調整機率。

`;
text=text.slice(0,text.indexOf('## RTP 與完整盤面驗證'))+proof+text.slice(text.indexOf('## 動畫、預覽與保存'));
text=text.replace('派彩至少總下注 20 倍播放 BIG WIN。','派彩 20～不足 50 倍播放 BIG WIN，50～不足 100 倍播放 SUPER WIN，100 倍以上播放 MEGA WIN。');
text=text.replace('「大獎預覽」使用真實可達的五個 W 中央停點','「大獎預覽」可選 BIG／SUPER／MEGA，分別使用真實可達的停點');
writeFileSync(path,text);
