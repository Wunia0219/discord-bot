# 啟動、Discord 與錢包維護

## 本機

Node.js 24。執行 `npm ci` 後，`npm run dev` 在 127.0.0.1:4187 提供瀏覽器試玩；此模式只使用 localStorage，不更動 Discord 帳號錢包。

Discord 測試使用 `npm run activity:serve`：建置後，由 4188 的 Node 服務一起供應前端與 API。後端環境檔為 `.env.server.local`；前端公開設定為 `.env.local`，範本見根目錄 `.env.example` 及 `deploy/server.env.example`。Client Secret 只放後端，不能使用 `VITE_` 前綴。

前端啟用 `VITE_DISCORD_AUTH_ENABLED=true`、`VITE_DISCORD_WALLET_ENABLED=true`。後端需設定 Application ID、Client Secret、Public Key、`WALLET_ENABLED=true`、明確的 `ALLOWED_GUILD_IDS`、`APP_ENV=test` 與測試資料庫路徑。日誌與憑證不要提交版本庫。

Discord 錢包啟動時必須明確填入 `APP_ENV=test` 或 `production`，不再預設為測試環境。Application ID、Client Secret 及 64 位十六進位 Public Key 會在建立資料夾、開啟資料庫與監聽 HTTP 前檢查；缺漏或格式錯誤即拒絕啟動。這是本機設定檢查，不表示已向 Discord 驗證憑證的有效性。明確啟用的 loopback 假帳號模式保留原本的獨立限制，不需要 Discord 憑證。

`/api/token` 每個服務程序最多同時交換 8 筆登入；滾動 60 秒視窗最多 120 次嘗試，10 次失敗後暫停新交換，直到有失敗離開視窗。成功登入不計入失敗，也不清除既有失敗。限流回傳 429 及 `Retry-After` 秒數；Discord 回傳 429 時也會暂停交換，依其有效的 1 小時以內重試秒數等待，缺漏或異常值則等待 60 秒。預算由所有登入共用，避免將 Discord／通道的共用代理誤認為個別玩家，不信任 `X-Forwarded-For` 或 `CF-Connecting-IP` 來分配額度。計數只留在記憶體，服務重啟會重置；可能讓其他新登入一併等待，不影響已建立的錢包 session。

## Discord 與測試通道

開發期間先保留本機後端與臨時通道，固定網址及 Netlify 部署等正式上架前再安排。每次測試先確認既有通道可用，可用時沿用；若通道失效，再重建並更新 Discord 後台的 Activity Mapping 與 Interactions Endpoint。

- 已有本機通道時，網址與程序資料位於被忽略的 `.tools/activity-tunnel.json`、`.tools/activity-server.json`，不要沿用舊文件中的臨時網址。
- 新建本機通道：`.\.tools\cloudflared.exe tunnel --url http://127.0.0.1:4188 --http-host-header localhost:4188`。執行檔需來自 Cloudflare 官方來源。
- Portal 的 Activities `/` URL Mapping Target 使用目前 HTTPS 主機名稱，不含 `https://`；開啟 Activities，並設定需要的桌面／手機平台。
- OAuth Redirect 使用 `https://127.0.0.1`；授權 scope 為 `identify`、`guilds.members.read`。Application 必須對應相同的前後端 ID。
- Interactions Endpoint 使用目前 HTTPS 網址加 `/api/interactions`，與 Activity Mapping 是不同欄位。
- `npm run commands:register` 只更新本應用程式的具名群指令，不覆蓋其他入口；只在調整指令定義或安裝新群時執行。
- 修改前端或重啟後端後，關閉並重新開啟 Activity。Session 最長一小時，重啟後需重新登入；SQLite 餘額及紀錄保留。

健康檢查為 `/healthz`。本機及公開通道應回報相同模型 `circus-243-v2`。載入失敗先檢查 4188 程序與通道，再檢查 Mapping；登入失敗檢查 Application ID、後端設定及群成員資格。不同瀏覽器來源的 localStorage 不會匯入伺服器錢包。

## 錢包後端本機開發

目前沿用 `backend` 分支，遊戲版本為 0.2.6。這一階段使用本機服務與獨立資料檔，先完成驗收再選擇正式主機。不要因開發分支存在就假設 Netlify 不會建置；後續如需推送或建立 PR，應先確認 Netlify 的 Branch deploys 與 Deploy Previews 設定。本機編輯、建置和自動測試本身不會觸發 Netlify 部署。

1. 以 `deploy/backend.env.example` 建立被 Git 忽略的 `.env.backend.local`。填入同一 Discord 應用程式的後端憑證及明確的 `ALLOWED_GUILD_IDS`，不能把 Client Secret 放到任何 `VITE_` 設定。
2. 開發環境固定使用 `APP_ENV=test`、`DATABASE_PATH=data/backend.sqlite`、`BACKUP_DIRECTORY=backups/backend`、`HOST=127.0.0.1`、`PORT=4189`，與既有 `.env.server.local`／4188 服務分開。得獎公告 Webhook 預設留空；只有要測試公告時才設定專用頻道。
3. `npm run backend:init` 建立或升級開發資料庫，沒有初始化任何玩家、簽到或籌碼。`npm run backend:dev` 啟動並監看程式變更；`npm run backend:start` 則為一般啟動。
4. `http://127.0.0.1:4189/healthz` 只檢查 HTTP 程序存活；`/readyz` 會實際讀取錢包資料庫，資料庫停用、關閉或版本／環境不符時回傳 503。Discord 模式也要通過登入／簽章憑證的格式檢查；本機假帳號模式則依其獨立設定判斷。公開健康回覆不包含帳號、餘額、連線路徑或憑證。
5. `npm run backend:check` 使用唯讀連線與同一份讀取快照，檢查 SQLite 完整性、關聯、帳本前後餘額連續性、錢包餘額與帳本是否相符、JSON 格式及帳本保護，並交叉核對回合、流水與重送紀錄。輸出僅有環境、結構版本、各表筆數及彙總異常，不會自動修復、升級或建立不存在的資料庫；檢查失敗以非零狀態結束。

資料結構由 `server/database.js` 以 `PRAGMA user_version` 管理：第 1 版為錢包、流水、回合與去重資料，第 2 版為得獎公告佇列。舊版已有資料但尚未標示結構版本的本專案資料庫，會在確認 `settings.environment` 相符後，以單一交易升級，不重建玩家、不重算已結算回合，也不重發測試籌碼。升級失敗會回復結構變更；環境不符、不是本專案的資料檔或結構版本比程式更新時，拒絕開啟。正式資料升級前仍需先備份並停止使用舊版程式的寫入。

### 回合與重送紀錄交叉驗帳

`backend:check` 會依每局儲存的 `rules` 唯讀重播目前及受支援歷史版本，確認停點、盤面、得獎組合、下注、派彩及前後餘額一致。這是比對原結算，不套用新規則重算舊局，也不改寫原回合。未知規則或內容異常會以彙總錯誤回報。

同時檢查 spin 請求的下注指紋、快取結果與原回合，以及每局對應的流水；缺漏、重複與損益為零的重複連結都會被偵測。簽到、管理發放、更正及本機情境的快取入帳結果需符合對應流水，更正也必須指向同群同玩家的原發放。帳本日期須符合記錄時間的台灣日期。診斷只輸出異常類別與筆數，不輸出玩家 ID、下注或餘額明細。

新回合的流水時間、回合 `time`、排序 `created` 及開轉間隔時間共用同一個結算時間；簽到的台灣日期去重鍵也與入帳時間一致，避免交易途中跨午夜而記到不同日。驗帳交叉檢查回合、排序及流水時間，保留最多 1 秒的相容差，以容納舊程式分別讀取時鐘的微小間隔；不重寫舊回合或帳本，只改回合日期、排序時間或流水時間而金額不變的異常也會被拒絕。

所有檢查在同一個唯讀快照內完成，逐筆串流處理回合與操作紀錄；大型資料庫的完整驗帳會比健康檢查耗時。這些深度檢查用於管理工具，不加入每次玩家請求或 `/readyz`。備份與還原沿用同一套驗帳，異常來源不建立目的檔。發現問題時保留原檔與報告供調查，工具不會自動修復、清空或重建帳本。

### 開發資料庫備份與還原

`npm run backend:backup` 先檢查來源，再以 `VACUUM INTO` 建立包含已提交 WAL 內容的一致快照，最後對備份重新驗帳。即使正在執行服務，也不應直接複製單一 `.sqlite` 檔案來代替此操作。[SQLite 的 VACUUM INTO 說明](https://www.sqlite.org/lang_vacuum.html#vacuum_with_an_into_clause)

還原指令範例：

```powershell
npm run backend:restore -- --from backups/backend/test-某次備份.sqlite --to data/backend-restored.sqlite
```

還原只會建立全新的檔案，任何已存在的目的檔案都會被拒絕，不會覆蓋原本或執行中的資料庫；測試與正式環境也不能互相還原。確認還原檔驗帳通過後，停止 4189 開發服務，將 `.env.backend.local` 的 `DATABASE_PATH` 改為還原檔路徑，再重新啟動。原資料庫保留到驗收完成後再依資料保存政策處理，且不會自動合併兩邊的新舊回合。

這些管理工具都要求明確的 `APP_ENV=test` 或 `production`。在正式主機可以直接使用環境變數配合 `node scripts/admin/init-db.js`、`check-db.js`、`backup-db.js`、`restore-db.js`，不需要複製本機憑證檔。

### 自動備份與監控

SQLite 模式下，`WALLET_ENABLED=true` 時，服務預設啟用 `OPERATIONS_ENABLED=true`。啟動立即檢查，之後每 5 分鐘在獨立 worker 唯讀驗帳、檢查資料庫及備份磁碟剩餘空間、驗證最近備份的 SHA-256；沒有有效備份或距上次成功已滿 6 小時時，建立包含 WAL 的一致快照並重新驗帳。排程不依賴玩家流量，同一程序不重疊執行，重啟會沿用未到期且校驗正確的備份。需要單一實例及持久磁碟；SQLite 維護不支援多程序同時操作同一個來源。Firestore 的排程及額度另見下方專節。

自動副本放在 `BACKUP_DIRECTORY/automatic/<來源識別碼>/`，依環境及資料庫絕對路徑隔離。只有剛建立並驗證新備份成功後，才清理此來源具有有效管理清單的舊副本；不刪手動備份、其他來源或無法辨識的檔案。預設保留 7 天、至少 3 份、最多 28 份。最低份數優先於天數，所以低流量或長期停機可能保留較舊副本。

| 設定 | 預設 | 用途 |
|---|---|---|
| `BACKUP_INTERVAL_MINUTES` | `360` | 成功備份之間的最短間隔 |
| `BACKUP_RETENTION_DAYS`／`BACKUP_KEEP_MIN`／`BACKUP_MAX_COUNT` | `7`／`3`／`28` | 自動副本天數及份數 |
| `BACKUP_MAX_TOTAL_MB` | `256` | 此來源自動目錄中 SQLite 副本的容量上限，單位 MiB |
| `MONITOR_INTERVAL_SECONDS` | `300` | 背景檢查間隔 |
| `DISK_MIN_FREE_MB` | `256` | 資料庫及備份磁碟的最低可用空間，單位 MiB |

容量上限會為新副本保留空間；若現有副本加上預估新副本將超標，停止建立並回報 `BACKUP_BUDGET_EXCEEDED`，不為騰出空間先刪除最後良好備份。副本意外超標也只移除該次新檔。操作人員需另存並確認可還原後整理容量，或調整上限。手動備份、主資料庫、WAL、清單與日誌不包含在這個副本上限內；這不是雲端用量或帳單限制。

`operations/status.json` 保存最近驗帳、備份時間、容量、告警及 HTTP 計數。`operations/events.jsonl` 記錄異常、恢復、備份完成及 HTTP 5xx；日誌約 1 MiB 輪替，另保留 2 個舊檔。HTTP 錯誤以伺服器產生的 `X-Request-Id` 關聯，不記權杖、授權碼、請求內容、查詢參數或玩家 ID，不寫出原始例外文字。這些檔案留在被 Git 忽略的備份目錄，不能由靜態網站讀取。

4188 使用 `npm run db:status`，4189 使用 `npm run backend:status`；主機可直接執行 `node scripts/admin/operations-status.js`。指令同時檢查狀態檔是否過期及本機 `/readyz` 是否可連線，異常以非零狀態結束，不把程序停止前留下的綠色檔案當作健康。啟動後首次背景驗帳完成前、資料庫異常、磁碟不足或監控過期時，`/readyz` 回傳 503，公開內容仍僅為 `{ok:false}`；備份失敗會讓管理狀態報警，但不單獨阻止正常錢包結算。`/healthz` 仍只表示 HTTP 程序存活。

目前只提供本機狀態與日誌，沒有向 Email／Discord 發送通知。程式停止、電腦關機或磁碟整個損壞時，程序內排程無法繼續工作；這些同機副本也不能代替異地備份。正式部署後須另外安排外部可用性監控及異地還原驗收，尚未建立任何外部監控或排程。

目前 Firebase 為 Spark 免費方案，使用本機 Node＋Firestore；部署平台尚未定案。UptimeRobot 為可選的公開可用性監控，本輪不接入。Spark 的免費讀寫配額不包含 Firestore 原生備份／PITR，也不能將本機容量上限視為雲端費用保障。[Firestore 配額](https://firebase.google.com/docs/firestore/quotas)、[Firebase 方案](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)

### Firestore Spark 接入

目前遊戲版本為 0.2.6。伺服器可明確選擇 `WALLET_BACKEND=sqlite`（預設）或 `firestore`。Firestore 模式目前限 `HOST=127.0.0.1`；只使用 Firestore Standard 的 `(default)` 資料庫，不需要新增 Firebase 網頁應用程式、Authentication、Cloud Storage 或 UptimeRobot。Discord 身分與伺服器權限仍由原本的 Node 後端驗證，瀏覽器不持有 Google 伺服器憑證，也不能直接修改錢包。

設定流程：

1. 沿用 Spark 專案 `slot-game-203db`。Firestore 資料庫已建立為 Standard、`(default)`，實際區域為美國多區域 `nam5`。區域建立後不能直接修改；如需台灣區域，須另外規劃資料庫及遷移，不能直接更改現有資料庫。
2. 專案設定 → 服務帳戶 → Firebase Admin SDK → Node.js，產生私密金鑰；JSON 放在版本庫外的私密位置。應使用具 Firestore 所需 IAM 權限的服務身分，不將金鑰貼到聊天、前端、日誌或 Git。
3. 以 `deploy/firestore.env.example` 建立被忽略的 `.env.firestore.local`，填入後端 Discord 設定、群 allowlist、專案 ID 及 `GOOGLE_APPLICATION_CREDENTIALS` 檔案路徑。憑證的專案 ID 必須與 `FIRESTORE_PROJECT_ID` 完全一致。雲端存取還必須明確設 `FIRESTORE_LIVE_ENABLED=true`；模擬器則只能使用 `demo-` 專案及 `127.0.0.1`。
4. `npm run firestore:start` 預設使用獨立 4192 連接埠，供本機驗證（4190 屬於 [Fetch 標準封鎖的埠](https://fetch.spec.whatwg.org/#port-blocking)，瀏覽器無法使用）。命名空間預設 `jokers-circus-test`，資料內同時驗證環境與結構版本；正式與測試資料不能混用。預設不更動既有 4188／4189 服務或 SQLite 資料。
5. `npm run firestore:status` 讀取私有管理狀態、應用額度及雲端中繼資料。它不初始化錢包，也不建立測試籌碼；不健康時以非零狀態結束。管理狀態不透過公開 API 提供。

2026-10-23 已使用專案外的服務帳戶憑證連上真實資料庫，並從 Firebase 控制台確認 Spark。獨立 QA 命名空間的 10 項驗收通過：兩個工作階段、同時簽到只加一次、同請求旋轉只結算一次、新連線讀回資料、管理發放與更正、額度不足完整回滾、未登入讀取拒絕、額度檔重開保留，以及版本和資料隔離。報告為本機 `test-results/firestore-0.2.5-live-acceptance.json`。

同日另依使用者指示完成玩家遷移：來源為 `.env.server.local` 原本的 SQLite，包含 2 位玩家、764 筆帳本、762 筆去重操作及 749 局。遷移前建立並驗證一致快照，5,344 份 Firestore 文件逐份比對成功；玩家餘額、最近回合、帳本、統計及舊旋轉請求的原結果一致，重送未再次扣款。來源 SQLite 內容指紋保持不變，4 個本機假帳號的獨立 SQLite 不併入真人命名空間。

`.env.server.local` 已改為 `WALLET_BACKEND=firestore`，`npm run activity:server` 仍使用 `127.0.0.1:4188`。原設定保留在被 Git 忽略的 `.env.server.sqlite-rollback.local`，一致快照與詳細驗收紀錄見本機 `test-results/firestore-0.2.5-cutover.json`。另通過 6 項使用真實 Firestore、模擬 Discord 傳輸的 HTTP 驗收，以及實際 4188 入口的 7 項就緒／存取保護檢查。使用者已授權本次臨時 HTTPS 通道，Discord Portal 的活動根路徑與互動端點均已儲存，互動端點通過 Discord 簽章連線驗證。

真帳號尾碼 `183232` 的電腦／手機由使用者回報重開後一致：餘額 37,890、最新一局約 12:08／下注 100／派彩 0、今日已領取且不能再次領取。Firestore 核對遷移後 4 局與一筆 500 簽到入帳，餘額由 37,740 成為 37,890，逐局帳本一致；兩張不同餘額的截圖對應不同時間的回合。

追加修正 SPIN 先等後端才開轉的停頓後，使用者以自己的尾碼 `435138` 帳號確認按下即開始動畫。12:23 的下注 100／派彩 0，在 Firestore 只有一筆對應結算，餘額由 10,575 成為 10,475。此動畫修正有使用者桌面截圖確認，未另收到手機專項複測回報；不得與前述雙裝置資料同步驗收混為一談。273 項回歸、7 項瀏覽器動畫檢查及組建皆通過，臨時通道已關閉且外網確認不能再存取，本機 4188 Firestore 後端保留。本輪維持 0.2.5，未部署。切換後如有 Firestore 新紀錄，回退前須先規劃同步，不能只改回舊 SQLite 設定而遺失後續進度。

正式版安全規則須拒絕瀏覽器對錢包資料的讀寫；Node SDK 經 IAM 存取，不依賴客戶端安全規則。`deploy/firestore.rules` 是官方模擬器測試使用的拒絕存取範本，不會自動發布。既有專案如有其他應用，必須檢查現有規則的廣泛允許條件，不能直接覆蓋其他應用規則。此階段不升級 Blaze、不啟用帳單、不執行 Firebase／網站部署。

#### 額度保護

Firestore 免費配額目前為每日讀取 50,000、寫入 20,000、刪除 20,000、儲存 1 GiB 及每月對外傳輸 10 GiB；每日配額約在美國太平洋時間午夜重置，與遊戲簽到的台灣午夜不同。[官方配額](https://firebase.google.com/docs/firestore/quotas)

後端使用本機 SQLite 額度檔，所有連到同一專案的程序都必須共用 `FIRESTORE_QUOTA_PATH`，不能刪除或改名來重置。預設為 `data/firestore-usage-<專案 ID>.sqlite`。保護採滾動 24 小時加一分鐘緩衝，重啟不清零；同一檔案的多個連線以本機交易合併計數。讀取每次按文件數的 6 倍預留，寫入每次按 2 倍預留，Firestore 交易重試會重新預留；失敗、逾時與結果不明不退還。SDK 內部傳輸重試與 Google 的實際計量可能不同，因此管理狀態明確標示為保守估算，不能當作 Google 的即時帳單或全專案用量。

| 設定 | 預設上限 | 範圍 |
|---|---|---|
| `FIRESTORE_READ_BUDGET` | `40000` | 每滾動 24 小時的讀取預留單位 |
| `FIRESTORE_WRITE_BUDGET` | `15000` | 每滾動 24 小時的寫入預留單位 |
| `FIRESTORE_EGRESS_MB` | `128` | 每滾動 24 小時取得的 JSON 內容大小，MiB |
| `FIRESTORE_STORAGE_MB` | `128` | 此後端記錄的文件成長估算，MiB，不隨日期重置 |

額度檔也記錄每個文件內容大小的最高估算；更新同一錢包只預留新增的大小，不把每次覆寫當成永久新增整份文件。估算以 JSON 大小的 4 倍加固定文件空間預留，包含保守索引緩衝，但不等同 Google 的儲存統計。讀取的內容大小在收到回應後累計，單次回應可能跨越門檻；後續網路操作即停止。這不包含 HTTP／gRPC 協定開銷或其他應用程式的流量。

到達額度或無法讀寫額度檔時，拒絕新的遠端操作並回傳自然提示，不排入離線扣款佇列，不換新請求重試，也不顯示假成功。籌碼相關寫入全部在 Firestore 交易內，額度不足而中止不會只扣款未記帳。已提交但回應遺失的操作以原請求編號查回，避免重複扣款。管理查詢使用有上限的分頁及每日分類集合；不做沒有上限的歷史全表查詢、即時訂閱或每次健康檢查的深度驗帳。

玩家錢包文件內只保留最近 100 局快取，輪詢讀取單一文件；5 秒短快取及相同玩家的並發請求合併可降低重複查詢，交易完成立即更新本程序快取。其他程序最多可能看到約 5 秒的快取延遲，簽到與扣款始終經過交易重新確認。完整歷史、帳本、原請求結果與每日摘要分開保存。

Firestore 的 Discord 籌碼指令先回覆僅本人可見的延遲確認，再將完成結果 PATCH 回原回覆，避免雲端交易超過 Discord 的 3 秒初次回應限制。回覆傳送失敗只重試相同結果，不重新執行簽到、發放或扣款；活動啟動入口仍直接回傳啟動回應。互動權杖只留在記憶體，關閉服務會等待已接收指令處理完畢。[Discord 回覆時限](https://github.com/discord/discord-api-docs/blob/main/developers/interactions/receiving-and-responding.mdx)

以上限制只涵蓋這個後端經過額度閘門的操作。控制台、其他伺服器、其他應用及直接使用 IAM 憑證的程式仍會消耗同專案額度；初次接入前要確認現有用量，並留意 Google 控制台。即使未到達本機估算，也可能因 Google 配額、IAM 或網路失敗而拒絕操作。Spark 不自動升級 Blaze。

#### SQLite 資料移入與驗證

`npm run firestore:migrate -- --from <已驗證的 SQLite 快照>` 只讀取來源，在相同環境的空白命名空間建立資料。它保留餘額、原回合及其數學版本、帳本編號、簽到去重、原請求結果、管理額度與更正關聯，不重新結算歷史或重新發放籌碼。先估算整份匯入與完整驗證能否放進應用額度；不足則在開始前拒絕。

每一批文件與進度指標一起交易提交。中斷時目標維持 `importing`，不能啟動玩家服務；以同一來源重跑可接續，不能用不同快照覆蓋。全部建立後逐份讀回比對 JSON，驗證成功才改為可用；已存在玩家資料的命名空間不會覆蓋。匯入僅在明確執行該命令時發生，不由服務啟動自動觸發。切換遊戲前仍須停止來源寫入、保留一致快照並完成實際雲端驗收，兩邊資料不會自動雙向合併。

得獎公告的 SQLite 佇列尚未移植，因此 Firestore 模式若設定公告 Webhook 會明確拒絕啟動，避免靜默遺失公告；目前未設定公告的遊戲不受影響。

#### Firestore 自動備份與監控

Firestore 原生排程備份及還原需要 Blaze。本機 Node 在 Spark 使用唯讀 API 建立遊戲邏輯備份，沒有啟用原生備份、PITR、Cloud Storage、Cloud Scheduler、外部監控或雲端部署。[原生備份條件](https://firebase.google.com/docs/firestore/backups)

`OPERATIONS_ENABLED` 預設開啟（本機假帳號 QA 預設關閉）。服務啟動立即檢查，之後每 10 分鐘由獨立 worker 檢查一份雲端 metadata、專案／維護額度、磁碟、最近備份 SHA-256 及備份時效；到期才讀取玩家資料。每 24 小時建立一份完整可還原的 SQLite 邏輯快照：以上一份校驗正確的快照為底，僅補讀新增帳本及對應的去重操作與原回合，再在同一個 Firestore 唯讀交易內讀取完整錢包集合，取得一致狀態。備份作業不寫入或刪除任何雲端文件，也不重新算獎或發放籌碼。每份快照包含全部歷史，還原不需串接多份增量檔；這是遊戲資料備份，不是整個 Firebase 專案或 IAM／安全規則的匯出。

初次備份可設定 `FIRESTORE_BACKUP_BASELINE`，只接受環境正確、驗帳成功且內容指紋符合雲端原遷移指紋的 SQLite 快照。本機已使用 2026-10-23 的已驗證遷移快照，保留其後的新帳本。歷史旋轉與簽到可推導原請求鍵；新版在既有全域帳本文件附帶管理請求鍵，不增加寫入文件數。若舊管理操作缺少連結且沒有相符基底，備份會明確失敗，避免產生無法去重的副本。來源快照與原 SQLite 不會修改。

所有遠端讀取同時受專案共用額度檔及維護專用持久額度檔 `<FIRESTORE_QUOTA_PATH>.maintenance.sqlite` 限制；重啟不清零。預設維護額度為每滾動 24 小時 **6,000 個保守讀取預留單位**，包含備份及健康檢查，並非額外的 Google 免費配額。每份文件預留 6 單位；正常 10 分鐘一次的監控約預留 864 單位／天，另加啟動或手動操作。遊戲和維護合計仍受原本 40,000 讀取、15,000 寫入等上限保護。維護另有每日 JSON 內容 32 MiB 上限。頁面查詢按最多 20 份文件預留，空頁也保守計數。維護額度用盡就停止額外遠端工作，標記 `FIRESTORE_MAINTENANCE_BUDGET`／未重新驗證遠端，保留上份有效副本。大量新增資料超出維護預算時，會報告延後或過期，須在總額度內調整維護配額及遊戲流量；不承諾任何流量下都能每天成功。Google 控制台與其他程式的用量無法由此本機檔案限制。

| 設定 | 預設 | 說明 |
|---|---|---|
| `FIRESTORE_BACKUP_INTERVAL_MINUTES` | `1440` | 距上次成功的備份間隔，最短 60 分鐘 |
| `FIRESTORE_MONITOR_INTERVAL_SECONDS` | `600` | 輕量監控間隔，最短 60 秒 |
| `FIRESTORE_MAINTENANCE_READ_BUDGET` | `6000` | 維護讀取預留上限，不得高於專案總上限 |
| `FIRESTORE_MAINTENANCE_EGRESS_MB` | `32` | 維護取得的 JSON 內容上限，MiB |
| `BACKUP_RETENTION_DAYS`／`BACKUP_KEEP_MIN`／`BACKUP_MAX_COUNT` | `7`／`3`／`7` | 最低份數優先於天數；新副本驗證後才清理 |
| `BACKUP_MAX_TOTAL_MB`／`DISK_MIN_FREE_MB` | `256`／`256` | 副本總量上限／磁碟最低餘裕，MiB |

副本與其管理清單存於 `BACKUP_DIRECTORY/firestore/<專案＋命名空間＋環境識別碼>/`。只在此來源完成新快照、SHA-256、SQLite 完整性、餘額連續性、回合算獎、操作去重與完整錢包重建比對後發布及清理舊檔；失敗不刪先前有效備份。新檔先寫入有歸屬標記的 `.partial`，中斷後下次僅清除此來源的未完成檔，保留未知檔案。跨 worker 使用本機 SQLite 互斥鎖，逾時 120 秒終止 worker，鎖會釋放；不跨主機協調。

同目錄下 `operations/status.json` 記錄最近檢查、備份時間、容量與配額估算；`events.jsonl` 記錄異常、恢復與 HTTP 5xx，沿用 1 MiB／2 份舊檔輪替。80% 以上回報 `FIRESTORE_QUOTA_HIGH`，額度耗盡、連線中斷、備份缺失／過期／校驗失敗、磁碟不足會告警。公開 `/readyz` 只回傳 `{ok:true/false}`，不透露玩家、憑證、路徑或配額細節；備份警告不阻止正常結算，資料庫無法連線或總額度不足仍會停止就緒。`npm run firestore:operations`（亦可 `db:status`）同時檢查私有狀態和 4188 `/readyz`；有警告會非零結束。這是本機記錄，尚未發送任何 Email／Discord 通知。

`npm run firestore:backup`（亦可 `db:backup`）使用目前 `.env.server.local` 手動立即嘗試備份；仍須遵守同一額度、磁碟與互斥鎖，頻繁手動執行也會消耗預算。`npm run firestore:status` 沿用 `.env.firestore.local`，查詢雲端與原專案額度；不要把兩者的連接埠／來源混用。

還原時先保留並停止舊入口的新寫入，核對清單 SHA-256 與環境，再以 `npm run firestore:migrate -- --from <快照.sqlite>` 匯入**另一個空白、同環境的命名空間**，先在隔離環境驗收餘額、簽到、紀錄及舊請求去重，完成後才人工切換入口。工具會拒絕覆蓋現有玩家，也不會自動切換入口。新入口須共用原專案額度檔，並將 FIRESTORE_BACKUP_BASELINE 指向本次還原來源，讓新命名空間的首次備份沿用正確基底。完整還原及逐份讀回驗證也有讀寫成本，開始前檢查整份作業能否容納於免費額度；本輪還原演練只在官方本機模擬器，未寫入真實雲端。

電腦關機或 Node 停止期間沒有排程，也無法自行回報整個主機停機；重新啟動後會補做過期的備份。同機副本不能承受整個磁碟遺失，尚未設置異地副本。UptimeRobot 仍是可選的外部可用性監控，沒有接入。原本總額度檔及維護額度檔都應保留，不隨回退或還原快照重置。

2026-10-23 已在真實 Spark 專案建立並校驗 2 份本機快照，涵蓋 2 位玩家、774 筆帳本、772 筆原請求及 758 局；首次增量擷取預留 306 個讀取單位，雲端寫入為 0。備份前後逐份比對玩家及 metadata，原遷移基底 SHA-256 也相同。完整玩家快照另在官方模擬器還原、逐份驗證並重送舊旋轉請求；真實雲端未執行還原。283 項一般回歸、備份／還原與並行結算的模擬器驗收、本機 4188 的 11 項啟動／就緒／存取保護檢查及組建通過。本機已啟用每天備份及每 10 分鐘監控，重啟沿用有效副本；先前遷移及驗收累積的讀取預留約占應用上限 90%，私有狀態如實保留 `FIRESTORE_QUOTA_HIGH` 提醒，服務仍就緒。版本維持 0.2.5，臨時通道保持關閉，未部署。

#### 模擬器驗收

`npm run firestore:emulator:setup` 下載固定版本的 Firebase 官方模擬器並驗證 SHA-256，檔案留在被忽略的 `.tools`。準備 Java 21（或設定 `FIRESTORE_JAVA_PATH`），再執行 `npm run test:firestore`。測試程序只監聽 `127.0.0.1:8787`，使用 `demo-jokers-circus` 及獨立命名空間；結束關閉模擬器，不使用雲端專案憑證、部署或消耗 Firestore 配額。模型驗算、既有 SQLite 與 Discord 回歸仍由 `npm test` 驗證。

### 手機試玩

在 Developer Portal 的本應用程式中，進入 **Activities → Settings → Supported Platforms**，勾選 **iOS** 與 **Android** 並儲存，保留原本的桌面平台。若手機顯示「This Activity is not currently available on this OS」，先確認此設定；Discord 會在載入遊戲前檢查支援平台。[Discord 官方說明](https://github.com/discord/discord-api-docs/blob/main/developers/activities/development-guides/local-development.mdx#launch-your-application-from-the-discord-client)

手機與桌面共用目前的 Activity URL Mapping、Interactions Endpoint 及本群帳號錢包，不需另建手機網址。儲存平台設定後，在手機 Discord 關閉原 Activity，再從應用程式入口重新啟動；測試直向、橫向、音效、自動旋轉，以及切到背景後返回。

本機瀏覽器可用 `http://127.0.0.1:4188/?platform=mobile` 搭配手機尺寸預覽版面；此預覽使用瀏覽器本機籌碼，並非 Discord 登入驗收。真正的手機登入、觸控和裝置效能仍須在 iOS／Android Discord 驗收。

## 錢包與指令

錢包主鍵為伺服器 ID＋經 Discord 驗證的帳號 ID。同群跨裝置同步，不同群分開。停點與派彩由後端產生；扣注、派彩、紀錄及操作去重在同一 SQLite 交易中完成。

測試新錢包首次 10,000；正式新錢包從 0 起。環境資料庫不能混用。每日簽到 500，Asia/Taipei 00:00 換日，同日只能入帳一次。單錢包開轉間隔至少 2 秒；同局重送沿用原請求及結算，不重複扣款。

| 指令 | 功能 |
|---|---|
| `/簽到`、`/籌碼` | 每日領取與查詢本群餘額 |
| `/籌碼管理 發放` | 指定成員、數量、原因；預設單次上限 100,000、管理員每日上限 1,000,000 |
| `/籌碼管理 更正` | 用流水編號新增全額補償紀錄；只能更正一次，餘額不足時拒絕 |
| `/籌碼管理 紀錄` | 分類、台灣日曆期間、十筆分頁；摘要統計完整期間 |

管理操作需 Administrator 或明確設定的 `CHIP_ADMIN_ROLE_IDS`，並符合 Discord 指令權限。回覆僅操作者可見；互動入口驗證 Ed25519 簽章、Application ID 與時間窗。帳本禁止修改與刪除，餘額全程為非負整數。

## Discord 啟動與精彩得獎公告

啟動入口使用 `APP_HANDLER`，後端對已開放群的真人成員回覆 `LAUNCH_ACTIVITY`（12），不額外貼遊戲邀請卡。完成後端更新並確認 Interactions Endpoint 正常，再執行 `npm run activity:configure-launch`。腳本只 PATCH 現有全域 Activity 入口的 `handler:1` 並重新讀取確認，不覆蓋名稱、平台或其他指令；重複執行安全。既有 Discord 邀請訊息不會自動刪除。參考 [Discord Entry Point handlers](https://docs.discord.com/developers/interactions/application-commands#entry-point-handlers)。

中獎公告集中在專用文字頻道，沿用遊戲 30／100 倍總下注的 SUPER／MEGA 門檻；同局只公告最高級別，BIG 不公告。卡片顯示群內暱稱（其次為 Discord 顯示名稱）、得獎級別及「本局總獎勵 ÷ 總下注」倍率，不顯示下注、派彩金額、餘額、帳號 ID。公告不提及成員、角色或 everyone，建立訊息時抑制推送通知。

設定方式：

1. 在已開放的 Discord 伺服器建立專用**文字頻道**，例如 `🎪・精彩得獎`。
2. 頻道設定 → 整合 → Webhook → 新增 Webhook，選定此頻道並複製網址。此網址包含發訊密鑰，只放在本機／主機秘密設定，不貼到聊天或 Git。
3. 在 `.env.server.local` 填入 `DISCORD_HIGHLIGHTS_WEBHOOK_URL`。目前只有一個 allowed guild 時可省略 `DISCORD_HIGHLIGHTS_GUILD_ID`；有多個時必須明確指定。每個服務目前支援一個公告目的地，只接收指定群結果。
4. 重啟後端並重新開啟 Activity。沒有設定 Webhook 時公告維持關閉，遊戲照常運作。首次發送前會向 Discord 核對 Webhook 確實屬於指定群；不符時拒絕發送。僅有 client secret／指令授權無法用來發送這類背景公告。

同一頻道固定 10 分鐘視窗內更新同一則訊息，最多每 10 秒更新一次，保留最近 5 次及視窗內總次數；視窗結束後的下一次得獎才建立新卡。SUPER 香檳金、MEGA 玫瑰紅，保留原生 Discord 卡片結構，無須玩家另開外部頁面。

公告只讀取後端已提交的回合，名稱來自經 Discord 驗證的 session，忽略客戶端聲稱的名稱及得分。佇列與訊息 ID 存在同一個 SQLite 檔案內的獨立表，依群與回合 ID 去重；公告發送不等待在開轉請求內，失敗不影響已結算的籌碼。429 依重試時間稍候、已刪除卡片可重建。重啟後續用原訊息 ID；超過 15 分鐘的待發事件過期，不補貼舊戰報。若建立訊息的網路回應不明，保守跳過該批並暫停本視窗的新卡，避免重新發送造成洗版；這類少量公告可能略過，遊戲紀錄仍完整。Webhooks 的建立與編輯欄位參考 [Discord 官方文件](https://docs.discord.com/developers/resources/webhook#execute-webhook)。

## Discord 驗證使用的政策網頁

Discord 應用程式顯示名稱為「🎲命運荷官」，營運團隊為 Wunia Studio，公開客服與個人資料要求信箱為 `nini900219@gmail.com`。Joker’s Circus 是目前的遊戲名稱。應用程式名稱在「一般資訊」設定；群內機器人帳號名稱另在「機器人 → 使用者名稱」設定，兩者需分別確認並儲存。若伺服器另設機器人暱稱，也需核對該群的顯示設定。

`public/terms.html` 與 `public/privacy.html` 為 Wunia Studio 的服務條款、隱私權政策，共用 `public/legal.css`，生效及更新日期為 2026-10-20。Vite 建置會複製到 `dist/`，現有 Node 靜態服務及 Docker 建置可一起供應 `/terms.html`、`/privacy.html`，不需要 Discord 登入即可閱讀。遊戲「遊戲規則」底部提供連結，政策頁亦可返回遊戲。

公開網站為 `https://jokers-circus.netlify.app/`，連接 GitHub `Wunia0219/discord-bot` 的 `main` 分支。發布政策使用現有網站，不另建專案。網站靜態檔由 Netlify 提供，Discord 測試後端仍是 Wunia Studio 管理的設備，經 Cloudflare 通道提供服務；不可僅因前端上 Netlify 就將 `/api/interactions` 改指向靜態網站。後端、供應商或保存方式變更時，要同步更新政策。

目前錢包資料及手動備份未設固定天數的自動清除排程。公開政策如實描述保存目的、停止營運及有效刪除要求的處理條件，不宣稱已有自動刪除工具。維運人員須檢視保存必要性，不再必要的資料應清除。

發布後將 `https://jokers-circus.netlify.app/terms.html`、`https://jokers-circus.netlify.app/privacy.html` 分別填入 Developer Portal → 一般資訊的服務條款與隱私權政策欄位並儲存，再回到應用程式驗證查看資格及進行驗證。應用程式是否通過以 Discord 後台狀態為準。請用未登入 Discord 的瀏覽器確認兩頁 HTTP 200 且能直接閱讀；本機網址及臨時測試通道不適合作為正式政策網址。

### 人工處理資料要求

1. 由公開信箱受理查詢、更正及刪除要求，核對要求人確實控制對應 Discord 帳號；不能只根據 Email 內聲稱的帳號 ID 就刪除。確認伺服器、要求範圍及相關公告訊息連結，不索取密碼或權杖。
2. 查詢目前資料庫與團隊控制的備份。刪除需安排後端停機維護，停止新請求並清除記憶體中的登入工作階段；僅能處理身分與範圍已核對的要求。
3. 普通 API 的帳本禁止修改與刪除。由具資料庫維護權限的人員，在受控離線維護中處理該帳號的錢包、回合、帳本、操作去重資料及得獎公告佇列；若其帳號作為其他成員紀錄的操作者出現，移除可識別該操作者的內容，同時保留其他成員所需的餘額與結算完整性。維護完成後必須保留正常帳本的禁止竄改保護，並檢查關聯、資料庫完整性及其他成員餘額。
4. 同時處理可控備份及本服務發布的相關 Discord 公告。不要把含待刪除資料的舊資料庫或維護副本無限期保留下來；備份還原前亦須重新套用已確認的刪除要求。若依法必須保留部分資料，記錄範圍與理由。
5. 恢復服務並回覆要求人處理範圍及結果。上述流程由維運人員人工執行，不應宣稱有自助刪除或一鍵清除功能，也不要在一般執行中的服務直接解除帳本保護。

## 部署與備份

後續部署可使用現有的 Netlify 與 Firebase 帳號；實際部署時再依後端執行環境及資料持久化需求選擇配置。

Dockerfile 提供 Node 24 建置與執行環境，執行期保留目前及歷史驗證所需的完整模組。建置只傳公開 Application ID；密鑰由執行環境注入。

使用單一服務實例及持久磁碟 `/app/data`。正式設定 `APP_ENV=production`、獨立 `DATABASE_PATH`、正式群 allowlist，使用固定 HTTPS 網址更新兩個 Discord 端點；不要複製測試 DB 作為正式錢包。SQLite 不能讓多個獨立容器各持有不同副本。固定主機與 Docker 雲端部署需在實際環境驗收。

本機執行 `npm run db:backup`；主機使用 `node scripts/admin/backup-db.js`，可設定 `BACKUP_DIRECTORY`。腳本使用 `VACUUM INTO` 保存含已提交 WAL 的一致快照，不應只複製運作中的主檔。

管理腳本先驗證來源及環境，再檢查備份內容；指令需設定明確的 `APP_ENV`。`restore-db.js --from <備份> --to <新檔案>` 永遠不覆蓋既有目的檔，驗收通過後由維運人員停機切換資料庫路徑。

還原前停止服務並保留現有資料庫及 WAL／SHM 副本；驗證快照後放入新的資料庫路徑，再啟動並重新登入。不得把 test 快照作為 production。備份腳本不會自動刪除或上傳備份。

驗收：登入／取消授權、重開及跨裝置餘額、同日重複簽到、舊回合重送、管理發放與更正、一般成員拒絕、快速停輪及 AUTO SPIN 停止、背景切換、手機方向與音效。自動測試及本機模擬不能取代 Discord 真機與實際主機驗收。
