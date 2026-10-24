# 零費用雲端執行與回退

2026-10-24，版本 **0.2.6**。程式與隔離測試已實作，**已確認 Workers Free 並部署未啟用版本；尚未上傳後端秘密、交接玩家資料或切換 Discord**。現有 v2 服務仍需本機開機。正式帳戶的免費方案、實際 CPU／網路、固定網址及真人雙裝置驗收，必須在上線時確認。

## 執行方式

`wrangler.jsonc` 使用 Workers 靜態資產與 SQLite Durable Object；沒有 R2、付費方案、計費開通或自動升級。Firestore Spark v2 仍是唯一遊戲帳本。遊戲結算、紀錄查詢、Discord 驗證及公告共用 Node 的核心，Worker 使用 REST 交易傳輸；不確定的 commit 不自動重送，沿用原 request ID 查回結果。

每個 Firestore 專案只使用一個 Durable Object（`idFromName(projectId)`），持久保存三組原額度、成長估算、加密登入狀態、登入限流、備份與排程進度。不能換 Worker／DO namespace 或重建物件來重置額度。**上線後本機遊戲、維護、管理 CLI 都不能繼續直接操作 Firestore**；它們無法與雲端同步預留同一份額度。

Durable Object alarm 取代常駐 interval：一般 10 分鐘檢查一次；大獎事件提示在 10 秒後喚醒，遺失提示可從 metadata 的公告 revision 恢復。派送使用原持久事件／租約，未知 POST 不盲目重貼。既有私密 Discord 指令、簽到、管理發放、更正、全歷史與原請求去重保持原契約。

## 免費限制與保護

必須選用帳戶實際的 **Workers Free**；`CLOUD_PLAN=free` 只是程式門檻，不能證明帳單方案。免費額度耗盡時停止對應服務，不購買超額。Workers Free 每日 100,000 請求；Durable Objects Free 支援 SQLite，額度用盡後對應操作失敗。實際免費帳戶的用量與 CPU 上限仍需部署驗證。[Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)、[Durable Objects 計費與免費限制](https://developers.cloudflare.com/durable-objects/platform/pricing/)

Firestore 的全專案及維護／公告上限沿用原檔，匯入時拒絕提高上限。沒有可用額度時拒絕結算，不能用新主機、新 namespace 或舊額度副本繞過。免費方案不提供無限容量或全天候可用性保證；此方案先保留完整資料，額度不足時維護暫停。

備份每 24 小時啟動，固定同一 Firestore `readTime`，每步最多處理 20 筆新增帳本及其原結果，再分頁讀錢包與公告。每步有加密 checkpoint；重啟可接續。50 分鐘未完成的候選會捨棄，再從最後有效快照重試。候選必須完整驗帳才發布，保留最近 3 份；未完成候選不取代有效備份。JSON 上限 8 MiB，超限拒絕而不截短歷史；備份超過 48 小時未成功則暫停玩家 API。容量接近限制時需另行安排分片／更頻繁增量，不能刪歷史換空間。

AES-256-GCM 金鑰放 Cloudflare Secret，另存獨立私密恢復位置；下載檔不含金鑰。部署後 Cloudflare 保存的備份與 Google Firestore 分開，但還沒實際上傳／下載驗證前不能稱異地備份完成。Google Drive 等額外獨立副本與外部維運告警尚未接入；不沿用得獎頻道發告警。RPO 目標約 24 小時加備份完成時間，故障時會更久；RTO 尚未在真實雲端量測。

## 現在需要的使用者操作

Cloudflare 已登入且確認 Workers **Free / Active**、沒有付款方式；固定入口與 Discord 設定已完成。未開通付費方案或 R2。不要把帳戶密碼、API token、Webhook 或加密金鑰貼到對話。

後續也需要把加密恢復金鑰保存到使用者可取回的獨立私密位置。原有 `data/backup-keys` 金鑰與新雲端金鑰分開；不隨備份一起上傳。

## 設定清單

建立被 Git 忽略的 `wrangler.cloud.local.jsonc`，從根設定複製，保留 `CircusProject` 類別、SQLite migration 與同一 Worker／DO identity，填入已確認的 account ID。變數使用**切換當時**現行設定，不複製早期封存設定：

| 類型 | 名稱 |
|---|---|
| 公開執行設定 | `CLOUD_PLAN=free`、`APP_ENV`、`FIRESTORE_PROJECT_ID`、`FIRESTORE_NAMESPACE` |
| Discord 範圍 | `DISCORD_CLIENT_ID`、`DISCORD_PUBLIC_KEY`、`ALLOWED_GUILD_IDS`、`ADMIN_ROLE_IDS`、`DISCORD_HIGHLIGHTS_GUILD_ID` |
| 遊戲限制 | 原 `DAILY_CHIPS`、`ADMIN_GRANT_MAX`、`ADMIN_DAILY_MAX` |
| Wrangler Secrets | `DISCORD_CLIENT_SECRET`、`DISCORD_HIGHLIGHTS_WEBHOOK_URL`、`GOOGLE_SERVICE_ACCOUNT_JSON`、`CLOUD_ADMIN_TOKEN`、`CLOUD_ENCRYPTION_KEY` |

兩個 `CLOUD_*` secret 各使用不同的 32-byte 隨機值（64 位 hex）。Google service account 必須與現行專案相符，作為 secret JSON 上傳，不能把本機憑證路徑當作 Worker 檔案。前端只放公開的 `VITE_DISCORD_CLIENT_ID` 及既有 auth／wallet 開關；任何 secret 都不能有 `VITE_` 前綴。

操作工具的 `.env.cloud.local` 範本在 `deploy/cloud.env.example`，只需要固定 `CLOUD_ORIGIN` 與私密 admin token。命令不接受 token 參數，避免寫入 shell 歷史。所有匯出／seed 檔放在被 Git 忽略的私密 `backups/cloud-handoff/` 下。

## 上線順序

1. 驗證 Cloudflare Free、現有 Worker／DO 資源及帳戶範圍，保留程式、目前環境設定與回退記錄。先完成 `npm run build`、`npm run cloud:build`；後者只有 dry-run，不發布。
2. 在 Free 帳戶發布初始 **unseeded** Worker 與 secrets，取得固定 `workers.dev` URL。未匯入時 API 一律維護拒絕，不建立空遊戲 namespace。部署實際 CPU／資產與服務相容性驗證前，不切 Discord 入口。
3. 盤點並停止本機所有 writer、維護及公告派送，等待進行中結算完成。保留原 `FIRESTORE_QUOTA_PATH` 和兩個子額度檔，不能重設。按既有 Firestore 備份流程取得當下最新完整 v2 快照與 metadata，驗帳、SHA-256、加密還原比對。額度必須容納備份、驗收及服務餘裕。
4. 在新快照產生後 5 分鐘內準備並 seed（超時重新取得新快照／額度，不能修改時間繞過）：

   ```powershell
   npm run cloud:handoff -- prepare --env .env.server.local --from backups/cloud-handoff/latest.sqlite --to backups/cloud-handoff/handoff.json --writers-stopped true
   npm run cloud:control -- seed --env .env.cloud.local --from backups/cloud-handoff/handoff.json
   npm run cloud:control -- status --env .env.cloud.local
   ```

   `prepare` 在 Windows 額外檢查常用 Node writer 程序，不能取代完整程序／工作排程盤點。seed 只接受一次，保存原三組額度與完整快照，保持 paused。這不是重新匯入 Firestore，仍使用目前同一 v2 namespace。
5. 再次確認本機 writer 停止、實際 Free 方案與 namespace 正確，再執行：

   ```powershell
   npm run cloud:control -- activate --env .env.cloud.local --writers-stopped true --free-plan-verified true
   ```

   啟用前比對 metadata revision／原匯入指紋及每個錢包餘額。來源新增進度會拒絕。驗證 readiness、實際 API、舊請求唯讀重送、全歷史／簽到摘要與當前服務成本。
6. 核對更新後的隱私頁及既有公開政策入口，依原政策處理上線告知（未授權前不代發公告）。用私有 backup／archive 下載加密檔並驗證可恢復（archive 不釋放 writer；此時不能執行 export）；切換 Discord Activity 根 URL Mapping、互動端點到已確認的固定網址。保留原 Webhook 與群權限。完成 Discord 桌面／手機、新增一局後重送、背景恢復與自然公告驗收，再關閉本機通道。不能用隔離測試冒充真人驗收。

可隨時下載最後一份已驗證備份，不停止服務：

```powershell
npm run cloud:control -- archive --env .env.cloud.local --to backups/cloud-handoff/archive.json
```

## 回退到 Node，保留雲端新增資料

同一 v2 Firestore 仍是權威來源，因此此回退不需要把資料搬回過期 v1。先停止雲端 writer，再帶回它消耗的額度與最新備份；不能只啟動舊 Node 程序。

```powershell
npm run cloud:control -- pause --env .env.cloud.local
npm run cloud:control -- backup --env .env.cloud.local
# 重複 backup，每次執行一個 checkpoint，直到 complete=true；失敗先檢查額度。
npm run cloud:control -- export --env .env.cloud.local --to backups/cloud-handoff/released.json
npm run cloud:handoff -- restore --from backups/cloud-handoff/released.json --key-file data/backup-keys/cloud-key.txt --environment test --to backups/cloud-handoff/returned.sqlite
npm run cloud:handoff -- return-quota --from backups/cloud-handoff/released.json --handoff backups/cloud-handoff/handoff.json --env .env.server.local
```

`pause` 拒絕新請求並等待遊戲／指令／派送結束；backup 使用最後進度並含公告訊息狀態。`export` 必須在 paused、無進行中工作、完整快照與遠端 revision 一致時執行，會永久設為 **released**。重複 export 得到同一 receipt，不再消耗遠端讀取；遺失回應仍可重取。released 物件不能再次 activate，也不能重新 seed。

`return-quota` 將雲端相對原 handoff 新增的用量加回**原三個檔案**，保留意外的本機新增用量、儲存成長及更高的文件估算；每個檔案都有 receipt，重做不重複累加。原檔缺失時拒絕，不建立替代檔。完整解密／驗帳及三組額度回傳成功後，再以原 v2 設定執行 `npm run firestore:backup` 取得新驗證快照，確認七張表與 returned.sqlite 一致，將新的 metadata 配對作為 Node backup baseline，恢復 Node 遊戲、維護與唯一公告派送器。重新確認公開網址與 Discord 入口。

若雲端完全無法匯出／釋放，不能假定它已停止或用舊額度開啟 Node；先恢復雲端控制／隔離寫入，再取回資料。此限制避免雙 writer 與額度重置。未來再次移至雲端需要新的完整交接設計，不能刪除已釋放 DO 來重開。

## 本機驗證

```powershell
npm test
npm run test:firestore
npm run test:cloud
npm run build
npm run cloud:build
```

`test:cloud` 只使用 `demo-jokers-circus` 官方 Firestore emulator、真正 workerd／Miniflare、持久本機 DO SQLite；所有 Google OAuth、Discord、Webhook 網路由測試替身隔離，未知外部呼叫直接失敗。覆蓋 REST／SDK 互通、全部分頁、同時重送、簽到、授權、重啟 session、private command、公告 alarm、固定 readTime 備份、checkpoint 重啟、過期匯出拒絕、釋放 writer，以及新增遊戲／公告狀態還原。另可用 `CLOUD_RESTORE_SNAPSHOT`、`FIRESTORE_RESTORE_SNAPSHOT` 指向已驗證本機快照，做逐表加密還原與完整重送回歸；不指向正式服務。

這台 Windows ARM64 的 workerd 使用官方 Node x64，路徑 `.tools/node-x64/node-v24.21.0-win-x64/node.exe`，由 `cloud-local.js` 選取。重新安裝工具時使用同版官方 Node x64 執行 npm；ARM 前端需保留同版 Rollup／esbuild ARM64 optional 套件。這些平台執行檔只留在忽略目錄，不進 Git。其他支援平台使用目前 Node。依賴鎖定；Miniflare 是與當前 Wrangler 配套的 beta 版本，升級需重跑 workerd 回歸。

測試記錄：`test-results/cloud-all-unit.log`、`cloud-integration.log`、`cloud-runtime-report.json`、`cloud-firestore-regression.log`、`cloud-frontend-build.log`。測試通過不能代替實際雲端 CPU／免費帳戶確認，也不能證明手機音效或真人自然大獎流程。

本輪結果：323 項單元測試（含既有 763 局快照逐表加密還原）、52 項 Firestore 模擬器回歸、2 項 REST／workerd 整合測試全部通過；前端 build 與 Worker dry-run 成功。另確認現有本機 writer 會使 handoff 拒絕且不產生交接檔，原 4188 healthz 為 200。版本保持 0.2.6；未推送、未部署、未重啟或切換原後端，未發送真實 Discord 測試訊息。

## 10/24 實際部署進度

Wrangler OAuth 已確認帳戶 `0cc2ddf634f75c1e30853778399ab3fe`。Cloudflare Billing → Subscriptions 顯示 Workers Free／Active、No payment method on file；OAuth 無帳單讀取權限，方案依後台可見資訊確認，不以 workers/standard 回應冒充方案。初始帳戶沒有 Worker 或 Durable Object。

已部署 `https://jokers-circus.nini900219.workers.dev` 的未啟用版本，6 項公開唯讀檢查通過（頁面／health 200、玩家 API 503、未授權管理 403）。Worker 程式啟動回報 9 ms，尚不是實際結算 CPU 驗收。新增 paused-only、禁止任何寫入的私有 verify 功能，已通過真實 workerd 隔離測試。

使用者明確授權後，5 項 Secrets 已成功存入此 Worker。已正常停止本機 writer，取得 2026-10-24T09:03:09.652Z 最新完整快照，包含 2 個錢包、779 筆帳本、777 筆原請求、763 局及完整公告表。來源 SHA-256 為 84d7877c9bdfd0345e1bac1e5c0f4e20255a4b929d733d56d97e9536ad353666。本機加密還原、雲端 baseline 與實際增量備份下載還原的 7 張表完整逐筆一致（忽略列順序）。

雲端唯讀驗收通過餘額、簽到、摘要、每人最新 50 筆帳本及 5 局、全部 14 筆非 spin 原結果、8 次原請求重送，writes 未增加；完整歷史由上述七表比對及先前模擬器全請求回歸覆蓋，不宣稱逐筆重讀全部遠端歷史。首次 verify 用戶端 30 秒超時，調整為 180 秒後成功；用量均持續累計，沒有重設。

已切換 Discord 根對應、互動端點與政策網址；21 項公開／Discord 診斷通過。新增 cloud 檢查模式，略過已停止的本機服務並檢查靜態政策 canonical 路徑。健康回應保留 model 欄位。5 項診斷測試及 2 項 REST/workerd 整合測試重跑通過。部署版本 653861c9-396c-4906-96c7-43463707aa88，產品版本維持 0.2.6。

證據：test-results/cloud-live-verification.json、cloud-discord-readiness.json、cloud-final-integration.log、cloud-active-status.json；私密交接與還原證據位於 backups/cloud-handoff/20261024。金鑰單獨放在 data/backup-keys，未放入加密備份。原全專案與 maintenance/highlights 額度已移交同一 DO，原三檔保留。Cloudflare 保存的加密副本已下載還原驗證，額外 Google Drive 副本尚未接入。

### 此次切換後的回退注意

本機 .env.server.local、.env.firestore.local 的 FIRESTORE_LIVE_ENABLED 已設為 false，防止誤啟動本機 writer 或額度消費者。不要直接改回 true。先按上方 pause → backup 完成 → export/release → restore 完成；return-quota 使用 --handoff backups/cloud-handoff/20261024/handoff.json 與 --env backups/cloud-handoff/20261024/.env.server.local（原設定備份，唯讀取得額度路徑）。三組額度回傳成功且全資料驗證後，才恢復本機 live 開關、取得最新備份與更新 baseline，再啟動唯一 Node writer 及重新配置 Discord 公開入口。舊臨時通道不能視為永久可用回退網址。

雲端已啟用的狀態下，不執行本機 firestore:backup/status 或其他 Firestore CLI；讀取雲端 cloud:control status 不重設額度。新的診斷命令：npm run discord:check -- --cloud --discord --public-origin https://jokers-circus.nini900219.workers.dev。實際手機／雙裝置、音效及自然大獎仍需真人確認。

Discord 網頁實際驗收：以既有帳號啟動雲端 Activity，登入成功，餘額 10,035 與最終備份一致；遊玩紀錄顯示 10/23 14:13–14:14 使用者新增的 5 局及可載入更早紀錄。未按 spin、簽到或發送公告。本機 Node 與舊 tunnel 均已退出；雲端保持 active。手機／雙裝置、新局及自然大獎仍待使用者實測。

10/24 追加運行確認：服務 active、最近 alarm 成功；不中斷服務觸發同一備份流程成功，下載 cloud-monitor-1712.json 並還原 cloud-monitor-1712.sqlite，7 表與交接資料完整一致（revision 779）。額度保護及回退隔離測試記錄見 test-results/cloud-monitor-protection-tests.log。24 小時自動備份尚未到期，不能把本次手動觸發當作跨日自動驗收；目前備份與 alarm 狀態正常。額度原值不變，沒有暫停、釋放雲端或啟動本機 writer。
