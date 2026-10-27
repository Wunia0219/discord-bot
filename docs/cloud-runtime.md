# 零費用雲端執行與回退

2026-10-26 更新，已發布版本 **0.2.8**。**Cloudflare Workers Free 已確認，Secrets、原額度與同一 v2 帳本交接、Discord 固定入口切換及雲端備份下載還原均已完成。** 現行入口為 `https://jokers-circus.nini900219.workers.dev`，本機 writer 與舊通道已停止，服務與雲端排程不依賴個人電腦開機。

0.2.8 完整前後端已發布 `d8adb0d2-3d21-4252-8e3f-695946ba8205`，包括戲籌文案、有上限結算佇列、分塊備份與用量優化；沿用 [已驗收停輪基準](reel-timing-baseline.md)。相容回退版本為 `0c2885d3-9e3b-4912-902f-529fd65f393b`，**不要再直接使用下方歷史紀錄中的 format 1 舊版作為現行回退目標**。

跨日自動備份、最新進度還原、金鑰保管確認與獨立監控已完成。最新資料與測試、發布及回退細節見 [上線驗收](launch-readiness.md)；剩餘真人手機／雙裝置、自然大獎與小群持續用量觀察見 [收尾計畫](roadmap.md)。

2026-10-26 使用者將測試範圍收斂至「小丑俱樂部 → 工程師的專屬地」。現行 `ALLOWED_GUILD_IDS` 只保留 `760012177326997544`，Discord 原生權限只開放頻道 `1564243344857632818`，原群應用程式整合與遊戲公告已停用。這次 Cloudflare settings PATCH 不發布工作區週簽到程式；執行中的 `worker.js` 與前端資產雜湊均維持相同。Cloudflare 此次未在下載的模組清單保留非執行檔 `worker.js.map`，原 map 已隨變更前 multipart 備份保存，不影響執行程式。資料範圍、DO、額度與有效備份不變，細節見 [現行 Discord 範圍](discord-readiness.md)。

## 執行方式

`wrangler.jsonc` 使用 Workers 靜態資產與 SQLite Durable Object；沒有新增 R2、Cloudflare 付費方案或自動升級。使用者已啟用 Firebase Blaze；Firestore v2 仍是唯一遊戲帳本，保留原免費用量保護。遊戲結算、紀錄查詢、Discord 驗證及公告共用 Node 的核心，Worker 使用 REST 交易傳輸；不確定的 commit 不自動重送，沿用原 request ID 查回結果。

每個 Firestore 專案只使用一個 Durable Object（`idFromName(projectId)`），持久保存三組原額度、成長估算、加密登入狀態、登入限流、備份與排程進度。不能換 Worker／DO namespace 或重建物件來重置額度。**上線後本機遊戲、維護、管理 CLI 都不能繼續直接操作 Firestore**；它們無法與雲端同步預留同一份額度。

Durable Object alarm 取代常駐 interval：一般 10 分鐘檢查一次；大獎事件提示在 10 秒後喚醒，遺失提示可從 metadata 的公告 revision 恢復。派送使用原持久事件／租約，未知 POST 不盲目重貼。既有私密 Discord 指令、簽到、管理發放、更正、全歷史與原請求去重保持原契約。

## 免費限制與保護

目前帳戶已確認 **Workers Free / Active**、沒有付款方式；`CLOUD_PLAN=free` 仍只是程式門檻，不能代替帳單方案核對。免費額度耗盡時停止對應服務，不購買超額。Workers Free 每日 100,000 請求；Durable Objects Free 支援 SQLite，額度用盡後對應操作失敗。實際連線與既有發布檢查已通過，小群持續流量下的 CPU／用量仍須觀察；平台限制以 [Workers 文件](https://developers.cloudflare.com/workers/platform/limits/)及 [Durable Objects 計費與免費限制](https://developers.cloudflare.com/durable-objects/platform/pricing/)為準。

Firestore 的全專案及維護／公告上限沿用原檔，匯入時拒絕提高上限。沒有可用額度時拒絕結算，不能用新主機、新 namespace 或舊額度副本繞過。免費方案不提供無限容量或全天候可用性保證；此方案先保留完整資料，額度不足時維護暫停。

備份每 24 小時啟動，固定同一 Firestore `readTime`，每步最多處理 20 筆新增帳本及其原結果，再分頁讀錢包與公告。每步有加密 checkpoint；重啟可接續。50 分鐘未完成的候選會捨棄，再從最後有效快照重試。候選必須完整驗帳才發布，保留最近 3 份；未完成候選不取代有效備份。現行 archive format 2 採可共用的加密分塊與認證目錄，保留 format 1 還原相容；保護界線為 128 MiB／8,192 塊，接近八成通知，超限拒絕而不截短歷史。備份超過 48 小時未成功則暫停玩家 API。下載與 export 使用現行分頁工具；詳見 [分塊備份驗收](launch-readiness.md)。

AES-256-GCM 金鑰放 Cloudflare Secret，另有受控本機恢復金鑰；下載檔不含金鑰，使用者可取回的獨立私密恢復位置仍待確認。Cloudflare 保存的備份與 Google Firestore 分開，實際下載、解密還原及七表逐列比對已完成。首次跨日自動備份含新增進度仍待驗收，不能把手動觸發算成跨日成功。Google Drive 等額外獨立副本與外部維運告警尚未接入；不沿用得獎頻道發告警。RPO 目標約 24 小時加備份完成時間，故障時會更久；RTO 尚待實際演練記錄。

## 現行操作與待保管項目

Cloudflare 已登入且確認 Workers **Free / Active**、沒有付款方式；固定入口與 Discord 設定已完成。未開通付費方案或 R2。不要把帳戶密碼、API token、Webhook 或加密金鑰貼到對話。

後續也需要把加密恢復金鑰保存到使用者可取回的獨立私密位置。原有 `data/backup-keys` 金鑰與新雲端金鑰分開；不隨備份一起上傳。

平時使用 `npm run cloud:control -- status --env .env.cloud.local` 查詢私有狀態；下載有效加密備份使用下方 `archive`，不使用 `export`。公開／Discord 診斷使用 `npm run discord:check -- --cloud --discord --public-origin https://jokers-circus.nini900219.workers.dev`。不要為驗收重建本機通道或重新 seed／activate；原三個額度檔及本機 live 關閉設定保持不變。

0.2.7 新增 `cloud:control health`，唯讀核對版本及維運摘要；版本未發布時會明確回報不符。獨立監控使用新的 `CLOUD_MONITOR_TOKEN`，只允許遊戲 `GET /__ops/status`，不使用 admin token；通知位置依使用者選擇稍後設定，目前預設停用、未部署。完整設定與失敗處理見 [維運監控](operations-monitor.md)。

## 既有部署設定清單

建立被 Git 忽略的 `wrangler.cloud.local.jsonc`，從根設定複製，保留 `CircusProject` 類別、SQLite migration 與同一 Worker／DO identity，填入已確認的 account ID。變數使用**切換當時**現行設定，不複製早期封存設定：

| 類型 | 名稱 |
|---|---|
| 公開執行設定 | `CLOUD_PLAN=free`、`APP_ENV`、`FIRESTORE_PROJECT_ID`、`FIRESTORE_NAMESPACE` |
| Discord 範圍 | `DISCORD_CLIENT_ID`、`DISCORD_PUBLIC_KEY`、`ALLOWED_GUILD_IDS`、`ADMIN_ROLE_IDS`、`DISCORD_HIGHLIGHTS_GUILD_ID` |
| 遊戲限制 | `WEEKLY_CHECKIN_REWARDS`（預設 500,500,1000,1000,1000,2000,4000）、`ADMIN_GRANT_MAX`、`ADMIN_DAILY_MAX` |
| Wrangler Secrets | `DISCORD_CLIENT_SECRET`、`DISCORD_HIGHLIGHTS_WEBHOOK_URL`、`GOOGLE_SERVICE_ACCOUNT_JSON`、`CLOUD_ADMIN_TOKEN`、`CLOUD_ENCRYPTION_KEY` |

兩個 `CLOUD_*` secret 各使用不同的 32-byte 隨機值（64 位 hex）。Google service account 必須與現行專案相符，作為 secret JSON 上傳，不能把本機憑證路徑當作 Worker 檔案。前端只放公開的 `VITE_DISCORD_CLIENT_ID` 及既有 auth／wallet 開關；任何 secret 都不能有 `VITE_` 前綴。

操作工具的 `.env.cloud.local` 範本在 `deploy/cloud.env.example`，只需要固定 `CLOUD_ORIGIN` 與私密 admin token。命令不接受 token 參數，避免寫入 shell 歷史。所有匯出／seed 檔放在被 Git 忽略的私密 `backups/cloud-handoff/` 下。

## 首次上線順序（10/24 已完成，保留供追溯）

以下為首次交接流程，不是現行服務的日常更新方式；不要對已啟用的同一 DO 重做 seed。一般程式／靜態頁更新保留同一 Worker、DO、全部既有變數與 Secrets，不搬動帳本或重設額度；發布前完成建置及檢查，發布後核對公開版本、資產、政策頁及健康狀態。

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

## 0.2.7 工作區更新（尚未發布）

10/24 依使用者要求同步隱私頁、README、架構、部署、測試及收尾文件，產品版本更新至 0.2.7，`package.json` 與 lockfile 一致。原始 0.2.6 發布與驗收數字保留。一般回歸 339 項通過、1 項既有條件測試跳過；前端 build、Worker dry-run 及 91 個本機 Markdown 連結檢查通過，建置內的版本與隱私頁內容已核對。

首輪文件更新時，動畫、音效與結算核心六份來源檔的 SHA-256 均與已驗收基準相同，當時 `src/`、`server/`、`cloud/` 無程式修改。該輪記錄：`test-results/version-0.2.7-preserved.json`、`version-0.2.7-validation.json`、`version-0.2.7-tests.log`、`version-0.2.7-build.log`、`version-0.2.7-worker-build.log`。這些為文件更新當時的驗證，不取代下方新增維運功能的驗證。

後續依使用者要求補齊跨日驗收以外的小功能：私有維運摘要、整體／子額度提醒、唯讀監控 token、`health` 版本核對，以及獨立 Worker 的持久告警／恢復通知。遊戲 `/healthz` 改讀產品版本，停輪、音效與結算核心六份來源仍保留已驗收雜湊。一般回歸 352 項通過、1 項條件跳過，3 項 REST／workerd 整合及 1 項獨立監控 scheduled handler 整合通過；通知模組的 13 項單元測試包含在一般回歸內。

新增驗證記錄：`test-results/operations-0.2.7-tests.log`、`operations-0.2.7-cloud-tests.log`、`monitor-runtime-tests.log`。使用者已選擇先完成程式與測試、通知位置稍後設定；獨立監控維持預設停用，未設定真實 Webhook，也未發送訊息。上述 0.2.7 更新尚未部署；現行雲端仍使用上方最後已驗證的 0.2.6 發布。

## 本機驗證方式與初次移植歷史

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

## 10/24 實際部署與驗收歷史

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

10/24 手機 SPIN 修正已部署 f4079897-2ad0-4241-aef6-4566f61e521f：轉動及網路等待期間保留 SPIN 按鈕啟用，點擊與空白鍵共用快速停輪控制器；得獎演出、簽到及未就緒時仍停用。15 項點擊／快捷鍵／單局結算回歸與 build 通過，發布後 21 項雲端／Discord 檢查通過。只有前端變更，無資料或額度遷移。前版本 653861c9-396c-4906-96c7-43463707aa88 保留；純前端回退不得釋放 DO 或還原舊資料。手機需關閉舊 Activity 再開啟驗收。

首次跨日備份後驗收：已建立本對話本機 heartbeat（automation），台灣時間每日 17:40 檢查，首次預計 10/25；確認自動備份及手機新進度可完整還原後刪除。只在有問題時通知。此驗收需本機 Codex 可執行，雲端每日備份不依賴本機。不要先手動備份覆蓋自動執行證據。

10/24 台灣時間 18:16 更新已發布：`8edc2a27-b60a-4ec3-8b1f-baf3d62bdee0`，產品版本仍為 0.2.6。包含有上限的快速停輪、背景音樂、精簡工具列及手機 PORTRAIT 鎖定，已移除手機橫向側邊控制列。音樂以 stream copy 移除封面與標籤，4,342,331 → 4,317,696 bytes；封包與解碼 PCM SHA-256 一致，無額外音質損失，測試後依使用者要求刪除 Downloads 母檔及專案原始副本，保留 optimized MP3。

雲端 Static Assets 的 Range 回應實測為 200，因此只將 `/assets/*.mp3` 交給 `cloud/audio-asset.js` 補齊單一範圍 GET；HEAD 沿用平台原生處理，其餘靜態檔案與玩家 API 不改動。330 項一般測試通過、1 項既有條件測試跳過；REST／持久 workerd 整合回歸與新增真實 workerd 音樂傳輸測試通過。瀏覽器確認精簡音樂可解碼播放、預設不載入、音效互相獨立及桌面／觸控快停。

發布後公開 HTML、JS、CSS 與本機建置逐檔雜湊一致；MP3 完整下載與精簡檔相同，手機 Range probe 回傳 206。health／ready 均為 200，21 項雲端／Discord 診斷通過，原 namespace、active writer、備份、alarm 及額度保持正常。未啟動本機 writer、未 seed／release／搬動帳本、未下注或發訊息。驗收記錄：`test-results/discord-ui-music-portrait-verification.json`、`discord-ui-music-portrait-readiness.log`、`audio-lossless-optimization.json`、`audio-master-deletion.json`。回退可使用原 `f4079897-2ad0-4241-aef6-4566f61e521f`，不釋放 DO、不恢復過期帳本。真人 Discord 測試請關閉舊 Activity 再開啟。

10/24 台灣時間 18:45 已發布 `fa35fb6c-72ad-460a-b55c-0ce851c8757e`，產品版本保持 0.2.6。移除快停文字提示，正常與快停共用原本 160ms 減速、240ms 逐軸落地間隔、190ms 回彈及相同停輪音；快停只移除空轉，已開始減速後保留完整收尾。網路等待計入正常空轉；SPIN 先發出請求，再同步開始動畫，本局權威結果不等待較舊歷史補齊。背景歷史失敗可從紀錄入口重試，確認過的結算不因紀錄失敗而重播原請求；未收到回應仍保留原請求編號。

332 項一般測試通過、1 項既有條件測試跳過，前端建置及 Worker dry-run 成功。桌面／手機觸控模擬、慢回應、慢歷史與真實 Pixi 場景時序驗證通過；正常與快停的最後減速及回彈座標誤差小於 1e-7。公開建置逐檔雜湊、音樂下載、health／ready、21 項 Discord 診斷通過，原雲端 writer 與資料範圍維持 active，未下注或修改玩家資料。證據位於 `test-results/reel-landing/report.json`、`reel-landing-verification.json`、`reel-landing-readiness.log`；回退版本為 `8edc2a27-b60a-4ec3-8b1f-baf3d62bdee0`。

10/24 台灣時間 19:16 已驗證發布 `922c4caa-616c-46ac-a826-129d4f7048cd`，產品版本保持 0.2.6。正常空轉從 20 格縮為 10 格，正常與快停共用的逐軸間隔從 240ms 縮為 120ms，減速 160ms、回彈 190ms 及停輪音保持一致。結果及時回來時，正常最後一軸約 1.16 秒落地、1.35 秒完成回彈；快停在權威結果就緒後約 100–160ms 開始減速，約 0.93–0.99 秒完成五軸收尾。較慢的後端回應仍須等候確認，動畫時間不能當作完整雲端平均延遲。

結算交易將 meta／wallet／operation 合併為一次 getAll，通過重送、冷卻與餘額檢查後再讀 day，接受的新局仍為 4 份文件、6 份寫入，但讀取往返由 4 次減為 2 次；拒絕或重送仍只讀 3 份文件。回應的冷卻剩餘時間在提交完成後重算，扣除已消耗的交易時間，保留原 2 秒開轉規則。加入 Server-Timing 及私有 status 的最近 50 筆成功新局處理／結算耗時統計，僅存記憶體，重建 Worker 後歸零，不含用戶端網路／冷啟動等待。發布驗收時樣本為 0，因此沒有宣稱歷史或目前雲端平均數；未新增遊戲提示文字。

337 項一般測試通過、1 項既有條件測試跳過；50 項 Firestore 模擬器回歸通過、2 項快照條件測試跳過；3 項 REST／workerd 整合測試通過。前端 build、Worker dry-run、桌面／手機與慢回應／慢歷史的 Pixi 時序驗證通過，共用減速與回彈座標誤差小於 1e-7。瀏覽器快停在結果就緒後實測約 125–147ms 開始減速。公開 HTML／JS／CSS 雜湊與本機建置一致，音樂完整下載及 Range probe 正常，health／ready 為 200，21 項雲端／Discord 診斷通過。相同 namespace、active writer、備份、alarm 與額度正常，未下注、seed、release、遷移資料或啟動本機 writer。證據：`test-results/spin-latency/report.json`、`spin-latency-verification.json`、`spin-latency-readiness.log`。回退版本為 `fa35fb6c-72ad-460a-b55c-0ce851c8757e`；只回退程式，不釋放 DO 或恢復過期帳本。

10/24 台灣時間 19:34 已發布 `13fc95a4-d651-465a-af67-1a8b674da032`，產品版本保持 0.2.6。依使用者要求稍微拉長一般旋轉，正常空轉由 10 格改為 14 格，多 240ms；第一軸目標落地 920ms、完整停輪約 1.59 秒。快速停輪、共同的減速／回彈／音效及開轉規則維持原設定。立即提供模擬權威結果的本機瀏覽器各 20 次實測：正常從 SPIN 到停妥平均 1.593 秒；快停按下到停妥平均 0.951 秒，從最初 SPIN 到提早快停完成平均 1.114 秒。這些是動畫實測，不包含真實 Discord 網路或後端等待。

337 項一般測試通過、1 項既有條件測試跳過，前端 build 成功；桌機／手機觸控、慢結果、慢歷史及原減速／回彈時序回歸通過。發布後公開建置雜湊、MP3 下載與 Range、health／ready、21 項雲端／Discord 診斷均通過；相同 namespace 與 writer 保持 active，備份、alarm 及額度正常。證據：`test-results/normal-spin-average/report.json`、`normal-spin-pacing/report.json`、`normal-spin-verification.json`、`normal-spin-readiness.log`。回退版本為 `922c4caa-616c-46ac-a826-129d4f7048cd`，只回退程式，不釋放 DO 或恢復過期帳本。

10/24 台灣時間 19:38 已發布 `90fbfb5a-c2cc-4bea-b09e-8f203ab8e077`，產品版本保持 0.2.6。依使用者要求將一般旋轉再延長至約 1.8 秒，正常空轉由 14 格改為 18 格，多 240ms；第一軸目標落地 1160ms、五軸含回彈約 1.83 秒。快停的銜接、減速、逐軸間隔、回彈與音效維持既有設定。立即回傳模擬結果的瀏覽器回歸中，正常從動畫開始到停妥為 1.824 秒，減速後才要求快停的情境為 1.827 秒；這是本機單次情境實測，非真實 Discord 平均。

337 項一般測試通過、1 項既有條件測試跳過，前端 build 成功；桌機／手機觸控、慢結果、慢歷史與減速／回彈時序驗證通過。發布後公開建置雜湊、MP3 下載與 Range、health／ready、21 項雲端／Discord 診斷通過；原 namespace 與 writer 保持 active，備份、alarm 及額度正常。證據：`test-results/normal-spin-18-pacing/report.json`、`normal-spin-18-tests.log`、`normal-spin-18-verification.json`、`normal-spin-18-readiness.log`。回退版本為 `13fc95a4-d651-465a-af67-1a8b674da032`，只回退程式，不釋放 DO 或恢復過期帳本。

10/24 台灣時間 20:00 已發布 `7b740462-efaf-4bbe-9a96-2ef3fc5dfe85`，產品版本保持 0.2.6。處理使用者回報每局快停仍不明顯：正常約 1.83 秒及快停既有收尾設定保留，轉輪時鐘改用實際 elapsedMS，避免 ticker 限幅使慢幀拉長動畫。REST 首批讀取同時開啟 readWrite 交易，並合併每日摘要，正常新局從四次往返減為兩次，四份讀取與六份原子寫入不變。拒絕／重播也批次讀四份文件，較前版多讀每日摘要，仍零寫入；沿用保守額度與原上限。僅明確 ABORTED 可重試，提交回應遺失仍保留原請求解決，不推測未確認結果。

服務端最近 50 筆耗時改存原 DO SQLite，包含初始化耗時及時間範圍，休眠／重建不再清空。另由已授權用戶端將按 SPIN 至收到結果、冷卻等待、SPIN 至停妥、按快停至停妥及等結果時間，附於下一個既有錢包請求；不增加請求或 Firestore 讀寫，去重並與服務端統計分開，最多保存 50 筆，不保存玩家身分／下注／結果，不影響結算。發布驗收時真實新樣本仍為 0，未宣稱已取得雲端平均。後續查詢可使用相同私有 status 的 spinTiming.client；最後一局可能待下一個既有請求才送達。

344 項一般測試通過、1 項條件測試跳過；3 項 REST／真實 workerd 整合測試通過，含原請求互通、原子性及統計跨重啟保存。Firestore 52 項範圍分批覆蓋：核心 21 項重跑全通過，其餘 29 項通過、2 項快照條件跳過；冷卻拒絕的讀取額度斷言已由 18 調為 24，以反映四份文件各預留六次的既有保守計數。前端 build 及 Worker dry-run 通過。桌機／手機、慢結果／歷史、減速／回彈與每秒五幀模擬通過；慢幀快停在 930ms 規劃期限後的下一幀、實際 1000ms 完成。一般本機情境正常約 1.825 秒；快停結果就緒後 958ms，而模擬 1.5 秒回應時，從按快停至停妥為 2.361 秒（含 1.380 秒等結果），確認量測不再省略等待。這些是本機情境值，不能作為真人 Discord 平均或一秒內保證。

公開建置雜湊、MP3／Range、health／ready 與 21 項雲端／Discord 診斷通過；原 namespace、active writer、備份、alarm 與額度正常，未下注、重設資料或啟動本機 writer。證據：`test-results/quick-feel/report.json`、`quick-feel-tests.log`、`quick-feel-cloud.log`、`quick-feel-firestore.log`、`quick-feel-firestore-core.log`、`quick-feel-verification.json`、`quick-feel-readiness.log`。回退版本為 `90fbfb5a-c2cc-4bea-b09e-8f203ab8e077`，只回退程式，不釋放 DO 或恢復過期帳本。

10/24 台灣時間 20:21 已驗證發布 `b53b9835-9142-4305-9060-7d8b19a4d2f2`，產品版本仍為 0.2.6。原版真人紀錄共正常 5 局、快停 10 局，含等待的 SPIN 至停妥平均為 2.3584／1.9755 秒，收到結果後仍各需約 0.9772／0.9644 秒，證據 `test-results/quick-handoff-before.json`。本次保持每軸 160ms 減速與 190ms 回彈，兩種模式共用逐軸間隔從 120ms 縮為 60ms，正常空轉從 18 格改為 22 格以維持完整約 1.83 秒；快停含必要可見圖標銜接的收尾約 0.69–0.75 秒。仍須等後端確認，不能以理想動畫時間保證實際按下快停後的秒數。

唯讀資料庫資訊確認原 `(default)` 位於 `nam5`，Google 官方對應入口為 `https://firestore.us.rep.googleapis.com`。原子交易、文件、去重及配額流程均保留，僅配置 `FIRESTORE_ENDPOINT` 使用該入口；本機 emulator 禁止配置真實區域入口。既有私有 status 可用 `?database=info` 查詢官方資料庫中繼資料及兩入口可用性，不讀寫玩家文件。3 次暖機唯讀探測全球入口為 356／255／249ms、區域入口為 357／223／211ms，此為 metadata 耗時，不當作真實結算速度保證。未遷移資料庫，也未改動 DO 身分。先前診斷發布版本 `8b413d04-fb8c-48d8-bff2-97745f23de8b` 保留原前端資產。

新量測使用獨立 `quick-handoff-v2` 分組，舊數據仍保存在原鍵，新版不接受舊客戶端回報。346 項一般測試通過、1 項條件測試跳過，3 項 REST／workerd 整合測試通過（含官方區域主機路徑與唯讀 metadata 驗證）；前端 build 與 Worker dry-run 成功。桌機／手機、慢回應、可見圖標連續性、相同減速／回彈及慢幀計時驗證通過。本機立即回應情境：正常 1.820 秒、快停按下後 0.708 秒；模擬回應 1.5 秒時，快停仍從 SPIN 起共約 2.244 秒，顯示量測包含等待。發布後公開建置雜湊、音樂／Range、health／ready、21 項 Discord 診斷通過。驗收時新版真人樣本為 0，已通知使用者以原遊戲流程測正常約 5 局、快停約 10 局；完整真人成效待新分組資料確認。

自動審核拒絕了快取版本直接提交錢包的交易改寫，以及新增寫入型 QA 端點，分別因記帳一致性與雲端寫入介面風險；兩方案均未實作。使用既有遊玩紀錄驗證，不建立額外測試帳本。證據：`test-results/quick-handoff-tests.log`、`quick-handoff-cloud.log`、`quick-handoff/report.json`、`quick-handoff-database.json`、`quick-handoff-region-probes.json`、`quick-handoff-verification.json`、`quick-handoff-readiness.log`。回退至 `7b740462-efaf-4bbe-9a96-2ef3fc5dfe85` 時一併恢復原全球入口及 legacy 量測設定；不釋放 DO、不還原過期帳本或刪除統計資料。

10/24 台灣時間 20:40 已驗證發布 `c7ae9254-91eb-47bd-ac4d-bd3d95389d08`，產品版本仍為 0.2.6。使用者已接受目前體驗，要求清除臨時量測。最後真人驗收為正常 17 局、快停 11 局，含等待的 SPIN 至停妥平均 1.8284／1.6536 秒，按快停至停妥平均 1.3205 秒；這些為該批實測值，非硬性秒數保證。動畫、音效、兩次往返結算核心及官方美國區域入口均保留，相關六份來源檔 SHA-256 與清理前完全相同。

已移除前端計時 hooks、回報標頭、Server-Timing、雲端彙總與版本分組、私有區域探測，以及只用於量測的模組與測試。保留正常冷卻計時、原請求重送與背景歷史同步。先發布 `15522730-9999-4818-b0c5-4b7191fa9b69`，以綁定參數 SQL 僅清除原 DO cloud_state 的 `spin-timings-v1` 與 `spin-timings:quick-handoff-v2` 兩鍵；其他狀態不變，完成後最終版也移除該一次性清理程式。沒有刪除 Firestore 帳本、玩家歷史、備份、quota 或 sessions。

自動審核拒絕以 --keep-vars=false 更新整份設定清單，故改用保留設定的發布，再透過精準合併更新只刪除 `SPIN_MEASUREMENT_COHORT`；中間版本 `da65fc70-a36b-45b7-8bac-b6678d074f8d` 在發布前逐項核對，最終版本除該變數外的全部雲端綁定與清理前完全相同，五組密鑰與同一 DO 均保留。沒有新增管理寫入介面。

339 項一般測試通過、1 項條件測試跳過；3 項 REST／workerd 整合測試通過，前端 build、桌機／手機、慢結果／歷史、共用落地／音效及慢幀回歸通過；前端請求不再帶測速回報。最終公開建置雜湊、音樂／Range、health／ready 與 21 項 Discord 診斷通過，原資料範圍、active writer、備份與額度正常。證據：`test-results/measurement-cleanup-preserved.json`、`measurement-cleanup-sql-guard.json`、`measurement-cleanup-purge-verification.json`、`measurement-cleanup-variable-guard.json`、`measurement-cleanup-final-guard.json`、`measurement-cleanup-tests.log`、`measurement-cleanup-cloud.log`、`measurement-cleanup/report.json`、`measurement-cleanup-verification.json`、`measurement-cleanup-readiness.log`。本文件的舊量測敘述為歷史發布記錄，現行遊戲不持續收集停輪耗時。回退至 `b53b9835-9142-4305-9060-7d8b19a4d2f2` 會恢復量測程式，不能當作保留清理的回退；任何回退都不釋放 DO 或恢復過期帳本。

## 10/26 首次跨日自動備份還原驗收

台灣時間 10/25 17:23:14 完成的跨日備份（revision 1088）已於 10/26 下載至新的 first-daily-20261026.json 並解密還原至新的 SQLite。七表逐筆比對、AES-GCM 與 SHA-256 校驗、全帳本餘額／簽到／原結果及重送鍵驗帳全部通過。與 10/24 交接相比，原不可變歷史完整保留，新增 308 局與 1 筆簽到（309 筆帳本及原請求）；總計 2 錢包、1088 帳本、1086 原請求、1071 局。資料未記錄裝置種類，不能將全部新增局數單獨歸因於手機；本次完整涵蓋快照時間點內的新增進度，之後的進度由下一份備份涵蓋。

自動執行依據為最後手動基準後超過 24 小時的備份時間推進及健康 alarm；本次僅 status/archive，未手動觸發 backup，未暫停或釋放服務。檢查時 active、backup/alarm 正常，24 小時保護計數 reads 7500/40000、writes 0/15000，上限未改。證據與各檔雜湊：backups/cloud-handoff/20261024/first-daily-verification-20261026.json。原備份、獨立金鑰、原額度檔與回退流程保留。此次單次驗收目的完成，結束其 Codex 排程；雲端每日備份不受影響。未改動 0.2.7 來源、停輪基準或雲端部署。

## 10/26 維運監控接通

已發布後端 `6e2e5db1-b384-4627-bc30-c7063d412d1b`（0.2.7），接入獨立 `jokers-circus-monitor` 的唯讀 token；使用 keep_assets 保留線上既有前端、政策頁與停輪體驗。原 DO、全部原 Secrets／變數、v2 資料及原額度不變；前端分支中的 0.2.7 新內容尚未因此發布。

使用者指定並授權私人 #bot維護 專用 Webhook、Secrets 及一組明確標示的故障／恢復測試，通知已送達。352 項一般測試通過、1 項條件跳過，25 項隔離入口選定測試、3 項 Firestore／workerd 整合及 1 項監控 workerd 測試通過；線上 readonly 權限、前端雜湊、health/readiness 與雲端 Discord 診斷通過。維護子額度 94.7% 的提醒如實保留，未提高上限。

設定、Cron 執行證據及回退見 [維運監控](operations-monitor.md)。回退目標 `c7ae9254-91eb-47bd-ac4d-bd3d95389d08` 僅用於程式回退，保留最新 DO／Firestore 資料；不需要或允許恢復過期帳本。本次新增隔離測試入口見 [分支驗收環境](validation-environment.md)，本次未提交或推送分支。

同日 16:30:33 已確認首次雲端 Cron 實際探測，沒有手動觸發；讀到維護子額度提醒且按連續兩次規則等待確認。監控完全在雲端執行，不需要本機 Codex 排程或個人電腦常駐。

## 10/26 上線前優化完成

完整發布與最新資料還原驗證見 [本次發布驗收](launch-readiness.md)。最終快照 revision 1304，涵蓋台灣時間 20:33:51.855 前的進度；五錢包、1,281 局，1,291 筆原請求在本機重播後七表不變。備份改用 format 2，不變更 Firestore schema／namespace；回退僅使用 `0c2885d3-9e3b-4912-902f-529fd65f393b` 或更新的相容版本，保留最新資料與原額度。原始密鑰不與備份一起上傳。

## 10/26 版本更新至 0.2.8

依使用者要求更新版本並修正文案重字，線上遊戲與監控皆已核對為 0.2.8。保留既有資料、原額度及停輪設定；本次未做資料格式變更。發布與相容回退識別碼見 [最新驗收紀錄](launch-readiness.md#028-發布與文案複查)。
