# 測試與驗收

所有負載、故障及資料清理演練使用隔離資料；不拿真實玩家下注測效能。

## 自動測試

| 指令 | 範圍 |
|---|---|
| `npm run verify` | 固定順序：一般回歸、前端／Worker dry-run、啟動／荷官／數字／停輪／CSP 瀏覽器驗證 |
| `npm run verify:full` | 上述全部，再跑官方 emulator、REST／workerd、備份恢復、重設與監控 |
| `npm test` | 算獎、介面契約、Discord 權限、SQLite、備份、同步與防重送 |
| `npm run test:bot` | 指令、HTTP、帳本與維運 |
| `npm run test:firestore` | 官方 emulator：交易、索引、遷移、完整／增量備份 |
| `npm run test:cloud` | 官方 emulator＋真正 workerd：REST、額度、登入、分塊備份 |
| `npm run test:recovery` | 60 錢包／5 人並行、全新 DO 恢復、原請求及重設重播 |
| `npm run test:reset` | 測試帳本清除、未知提交結果、重啟續作、舊登入拒絕 |
| `npm run test:experience` | Edge：正常／快停、慢結果、慢歷史、慢幀與手機觸控 |
| `npm run test:dealer` | Edge：荷官完整影格、短期重用、背景／到期釋放及故障清理 |
| `npm run test:startup` | Edge：六種啟動失敗、立即停止渲染、晚到素材回收與重試畫面 |
| `npm run test:numbers` | 數字、符號、空值與後備文字的像素／尺寸／無障礙基準，以及 Canvas 重設次數 |
| `npm run test:security` | 先 build；Edge：CSP、腳本注入阻擋、SQLite 結算 |
| `npm run test:discord-sdk` | 隔離父頁／iframe：真實 SDK 握手、OAuth、方向鎖定及大型非法集合拒絕 |
| `npm run test:monitor` | scheduled handler、持久去重、故障與恢復通知 |
| `npm run build`、`cloud:build`、`monitor:build` | 前端與 Worker dry-run，不部署 |
| `npm run verify:math`、`verify:sessions` | 完整枚舉與固定 seed 回合驗算 |

需要 `.node-version` 指定的 Node 24 安全版本、npm 12.2.1 與 Java 21；Windows 先 dot-source `scripts/admin/setup-toolchain.ps1`。首次以 `npm run firestore:emulator:setup` 準備模擬器。Windows 還原測試使用 NTFS 硬連結，沙箱禁止時須允許隔離測試的檔案操作，不能改成覆寫目的檔。

`npm ci` 會執行 Discord SDK 的相容安全修補；不可略過專案 `postinstall`。使用 `--ignore-scripts` 安裝時，必須另執行 `node scripts/security/patch-discord-sdk.js`，再以 `--check` 核對。完整驗證與正式建置會拒絕未修補或未知的 SDK 內容；細節見[資料保護](security.md#discord-sdkzod-修補)。

瀏覽器測試使用鎖定的 Playwright 開發相依；Windows 預設 Edge，Linux 預設 Chromium（先執行 `npx playwright install --with-deps chromium`）。可用 `PLAYWRIGHT_MODULE_PATH` 指定既有模組目錄、`PLAYWRIGHT_BROWSER_CHANNEL` 指定測試通道。數字的固定像素基準位於 `tests/fixtures/number-rendering.json`；僅在有意更改字型／外觀時用 `npm run test:numbers -- --baseline` 更新。

`node scripts/qa/verify.js --full --list` 只列出步驟；驗證結果保存在 `test-results/verification.json`，第一個失敗即停止，不執行部署。Windows ARM 的 workerd 步驟使用 `.tools/node-x64/` 中與 `.node-version` 一致的 Node；其他步驟使用啟動驗證的 Node。

### 從零重驗

使用儲存庫外的新目錄，複製目前來源或從待驗證提交建立 checkout。不要帶入 `.env*.local`、`data/`、`backups/`、`node_modules/`、`dist/`、`.wrangler/` 或舊測試結果，也不要放在已有 `node_modules` 的父目錄下，以免 Node 向上尋找舊套件。

```sh
npm ci
npm run firestore:emulator:setup
npm run verify:full
npm run verify:math
npm run verify:sessions
```

Windows ARM 建議在 **Node 24 x64 環境**內完成以上全部步驟，確保 npm 安裝的原生套件與 workerd 執行架構一致；只在最後切換 Node 不足以補齊 x64 套件。Java 21 可由 `JAVA_HOME`／`FIRESTORE_JAVA_PATH` 指定；官方 emulator 會核對 SHA-256。數學驗算會重建 `docs/data/` 報告及 `src/game/model-config.js`，應與來源比對；未調整玩法時內容須一致。

單獨執行 `test:security` 前需先 build；`verify` 已按此順序執行。全新目錄沒有荷官的本機影格基準時，`test:dealer` 仍檢查格數、時長及資源生命週期；要比較修改前後像素，先依[素材文件](assets.md)保存同機基準。

`.github/workflows/verify.yml` 在 pull request、main 推送或手動觸發時使用相同完整入口；依 `.node-version`、`packageManager` 對齊 Node／npm，搭配 Java 21、Chromium 與經雜湊核對的官方 emulator。安裝後先稽核，high／critical 漏洞會阻止驗證通過。workflow 只有讀取程式碼權限，不注入正式憑證、不部署、不執行正式資料清理。Actions 提交已鎖定；遠端結果以實際 workflow 執行為準。設定參考 [Playwright CI 文件](https://playwright.dev/docs/ci-intro)。

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
