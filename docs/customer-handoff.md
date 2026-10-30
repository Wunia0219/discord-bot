# 客戶交付

正式來源為 `main`，版本以 `package.json` 為準。交付前須完成驗證及發布授權。

使用者於 2026-10-30 要求來源版本升至 **1.0.0**，並準備自行推送至 `main`。本次版本更新不變更玩法或停輪參數；以下 0.4.0 記錄描述已完成的正式部署，1.0.0 尚未部署。GitHub 推送與 Cloudflare 正式部署為不同步驟，現有 CI 不自動部署。

1.0.0 本機合併前 `verify:ci` 已通過全部 14 項，`npm audit --audit-level=high` 回報 0 漏洞；證據為 `test-results/release-1.0.0-verification.json` 及 `test-results/release-1.0.0-audit.json`。GitHub 已確認推送權限、main 未受保護且無有效 ruleset，推送預演通過；實際提交及推送仍由使用者執行，1.0.0 遠端 CI 尚未執行。

- 一個客戶群，約 60 份錢包，以 5 人並行驗證；不把第 6 人擋掉，也不保證所有網路具有相同延遲。
- 使用者於 2026-10-30 指定正式群 `1503958213454856252`、遊戲／指令頻道 `1565731918107115690`，並確認切正式營運、使用全新帳本。維護頻道不是遊戲群。
- 切換狀態：正式後端已 active，版本 0.4.0。入口 `https://jokers-circus-production.nini900219.workers.dev`；獨立 Firebase 專案 `jokers-circus-production`（Spark）、Standard Firestore `(default)`，`asia-east1`（台灣），namespace `jokers-circus-v2-20261030-production`。規則拒絕所有用戶端直接讀寫。Cloudflare Dashboard 已確認目前方案為 Free。
- Discord 新群已安裝並註冊 `/戲籌`、`/戲籌管理`；管理指令預設限管理員，指令頻道限制為指定正式頻道。Activity URL Mapping、互動端點及政策連結已切正式入口；OAuth 原設定保留，網頁／iOS／Android 已啟用。線上就緒、未授權請求拒絕與指令定義檢查通過，證據為 `test-results/production-discord-readiness.json`。真人登入、手機、音效及跨裝置仍須實際驗收。
- 正式服務身分 `circus-wallet-production@jokers-circus-production.iam.gserviceaccount.com` 僅授予已核准的 `roles/datastore.user`。使用者下載的 `55cac611…` 金鑰已移入 `C:/Users/nini9/.config/jokers-circus-production/service-account.json`，目錄 ACL 限目前使用者及 SYSTEM，並存入正式 Worker Secret；獨立管理、監控與備份金鑰另存同一私密目錄。先前未取得下載、從未部署的 `901fe60b…` 舊金鑰已取得明確授權並刪除，Google Console 已確認僅保留正式有效金鑰。
- 正式執行程式與 `main` 提交 `2b40de3` 一致；該提交的 [GitHub Actions](https://github.com/Wunia0219/discord-bot/actions/runs/40829129807) 已通過。本機工作分支另有既存 QA 修改，本次未提交或合併，不將本機結果視為遠端 CI 或真人驗收。
- 本機 `verify:ci` 的 14 項範圍已通過（2026-10-30）：沙箱連線限制解除後，帳本與服務整合通過；瀏覽器另以既有 `.tools/playwright` 快取補驗，10/10 通過。合併摘要為忽略版控的 `test-results/production-preflight-summary.json`，保留初次失敗與補驗報告。產品版本與停輪設定未變更。
- 客戶使用全新帳本，不移入測試餘額、簽到或歷史。另有明確清理需求時，依[測試資料清理程序](recovery.md#一次性清除測試玩家)先備份、停止 writer 並核對環境；餘額重設不等於清除資料。
- 首次交接為 revision 0、0 錢包，初始化消耗已隨持久額度交接；本機正式 `FIRESTORE_LIVE_ENABLED=false`。正式加密備份已下載、解密、驗帳，空白七表成功還原至隔離 SQLite 且來源不變，證據位於 `backups/production-cutover-20261030/empty-baseline-restore-verified/report.json`。原通用重播工具因零錢包無法建立 guild allowlist 而停止，保留失敗報告；這次空白基準驗證不宣稱已驗證玩家交易重播。
- 遊戲與監控已部署 0.4.0；監控目標已切正式服務，保留十分鐘排程與原維護通知目的地。首輪 Cron 已於 2026-10-30 23:00（台灣）實際執行，無告警；正常啟動不送通知。切換證據及監控檢查結果存於 `backups/production-cutover-20261030/`。舊測試 Worker、帳本與憑證保留，不會移入正式帳本。
- 正式與測試資源、憑證、金鑰分開。同一 Firebase 專案仍共用供應商額度；共用專案前須完成共用持久管控，不能複製 DO 計數器各自消費。
- 維運摘要送至[指定維護頻道](https://discord.com/channels/1441097301685698703/1564187899019141140)，不附玩家明細、帳本、金鑰或解密備份。

## 交付前驗收

1. 核對正式群、指令頻道、管理身分組及新帳本設定。
2. 從首次登入建立錢包開始，驗證新手戲籌只發一次、簽到、下注、重連與跨裝置同步。
3. 完成[自動與人工測試](testing.md)，確認[停輪基準](reel-timing-baseline.md)。
4. 驗證最新備份可解密、驗帳及重播；金鑰與備份各自可取回，確認告警通知。
5. 說明恢復範圍：以最後成功快照時間為準，隔離模擬器耗時不是實際雲端 RTO。

日常維護見[部署](deployment.md)，事故處理見[恢復](recovery.md)，資料保護見[資安](security.md)。測試清理工具不支援正式資料刪除；一般歷史清理／封存須另行設計。
