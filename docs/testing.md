# 測試與驗收

所有負載、故障及資料清理演練使用隔離資料；不拿真實玩家下注測效能。

## 自動測試

| 指令 | 範圍 |
|---|---|
| `npm test` | 算獎、介面契約、Discord 權限、SQLite、備份、同步與防重送 |
| `npm run test:bot` | 指令、HTTP、帳本與維運 |
| `npm run test:firestore` | 官方 emulator：交易、索引、遷移、完整／增量備份 |
| `npm run test:cloud` | 官方 emulator＋真正 workerd：REST、額度、登入、分塊備份 |
| `npm run test:recovery` | 60 錢包／5 人並行、全新 DO 恢復、原請求及重設重播 |
| `npm run test:reset` | 測試帳本清除、未知提交結果、重啟續作、舊登入拒絕 |
| `npm run test:experience` | Edge：正常／快停、慢結果、慢歷史、慢幀與手機觸控 |
| `npm run test:dealer` | Edge：荷官完整影格、短期重用、背景／到期釋放及故障清理 |
| `npm run test:security` | 先 build；Edge：CSP、腳本注入阻擋、SQLite 結算 |
| `npm run test:monitor` | scheduled handler、持久去重、故障與恢復通知 |
| `npm run build`、`cloud:build`、`monitor:build` | 前端與 Worker dry-run，不部署 |
| `npm run verify:math`、`verify:sessions` | 完整枚舉與固定 seed 回合驗算 |

需要 Node.js 24、Java 21；首次以 `npm run firestore:emulator:setup` 準備模擬器。Windows 還原測試使用 NTFS 硬連結，沙箱禁止時須允許隔離測試的檔案操作，不能改成覆寫目的檔。

瀏覽器測試需 Edge 與 Playwright；可用 `PLAYWRIGHT_MODULE_PATH` 指定既有 Playwright 模組目錄。

## 本機完整錢包

`npm run validation:start` 只監聽 `127.0.0.1:4192`，入口 `/wallet-test`。不載入 `.env`，明確關閉 Discord／雲端連線，外部 fetch 拒絕；轉送標頭、外站 Origin 也拒絕。連接埠被占用時直接失敗。

| 帳號 | 初始戲籌 | 情境 |
|---|---:|---|
| qa-a、qa-b | 10,000 | 下注、簽到、資料隔離 |
| qa-low | 50 | 餘額不足 |
| qa-zero | 0 | 零餘額與簽到恢復 |

首次選擇帳號登入才建立錢包，開啟測試總覽不建立資料。資料為虛構帳號，保存於 `data/validation/wallet.sqlite`，重啟不重設。建置輸出 `test-results/validation-dist`，不覆蓋 `dist`。Ctrl+C 正常停止後才能清理；不得只刪運行中的 SQLite 主檔而留下 WAL。一般瀏覽器的 localStorage 與這份帳本分開。

## 人工驗收

- 全新玩家：首次建立、新手戲籌、重開不重發；簽到領取與明日獎勵。
- 桌機／手機：版面、觸控、空白鍵、Enter、Esc、焦點及減少動態效果。
- 正常／快停：結果先送、連點僅一局、慢結果仍等待、歷史變慢不阻擋停輪、慢幀不延長時鐘、停輪音順序。
- 斷線／雙裝置：未確認請求原 ID 重送、餘額及紀錄一致、舊回應不覆蓋新狀態。
- 自動旋轉：開視窗、切背景、餘額不足時停止；回前景不補播音效。
- 管理員：他人／跨群／跨頻道／失去角色後拒絕；發放、更正及重設確認卡重複點擊不再次入帳。
- 備份：錯誤金鑰、損壞、錯誤環境及已有目的地拒絕；完整七表及原請求重播一致。
- 客戶實測：Discord OAuth、真機手機、自然大獎、持續用量及通知送達仍需真人確認。

報告保存在忽略版控的 `test-results/`；私密備份及恢復證據在 `backups/`。歷史測試數量不作為目前通過證明，應以本次執行結果為準。
