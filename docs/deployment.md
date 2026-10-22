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

目前沿用 `backend` 分支，遊戲版本為 0.2.5。這一階段使用本機服務與獨立資料檔，先完成驗收再選擇正式主機。不要因開發分支存在就假設 Netlify 不會建置；後續如需推送或建立 PR，應先確認 Netlify 的 Branch deploys 與 Deploy Previews 設定。本機編輯、建置和自動測試本身不會觸發 Netlify 部署。

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
