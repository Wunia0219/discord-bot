# 伺服器錢包與正式交付

## 已實作

- 伺服器 ID + 經 Discord 驗證的使用者 ID 是錢包主鍵；不同群分開，同群跨裝置同步。
- 本機 `APP_ENV=test`，只允許測試伺服器 `1441097301685698703`。每個測試錢包首次建立獲得 10,000；舊 localStorage 餘額不匯入。
- `APP_ENV=production` 新錢包從 0 起，來源為每日簽到、管理員發放及遊戲派彩。正式與測試資料庫分開，程式拒絕用不同環境開啟同一個 DB。
- Node 24 的 SQLite（WAL、FULL synchronous）保存餘額、完整回合、操作去重與不可修改的收支帳本；扣注與派彩在同一筆交易中完成。隨機停點由伺服器產生，沿用原固定輪帶與精確 96% 理論 RTP。
- 同一 SPIN 請求永久去重；網路重試沿用原請求 ID、原下注及停點。前端不在儲存空間保存登入權杖，只保存待確認的請求編號／下注。
- OAuth 增加 `guilds.members.read`，後端向 Discord 確認帳號與指定群的成員資格；不信任前端提交的 user ID、餘額、派彩或停點。成員資格最多每 5 分鐘重新驗證一次；Session 最長 1 小時，到期／後端重啟需重新開啟 Activity。
- 伺服器每個錢包至少間隔 2 秒才能開始新局；同局重試不受冷卻影響。餘額上限 1,000,000,000,000，所有籌碼使用整數。
- 遊戲「遊玩介紹」含簽到及最近 50 筆收支；遊玩紀錄顯示最近 100 局，後端完整保留。每 15 秒及回到頁面時更新餘額；轉輪演出中不打斷數字。

## Discord 指令

| 指令 | 功能 |
|---|---|
| `/簽到` | 每日 500，Asia/Taipei 00:00 換日；同日／多裝置只能入帳一次 |
| `/籌碼` | 本伺服器餘額 |
| `/籌碼管理 發放 成員 數量 原因` | 管理員發放，原因必填；單次最多 100,000，每位管理員每日最多 1,000,000 |
| `/籌碼管理 紀錄 成員` | 最近十筆收支、操作人、原因、時間、前後餘額 |
| `/籌碼管理 更正 紀錄編號 原因` | 全額撤銷一筆誤發，新增補償紀錄；已花掉而餘額不足時拒絕，不產生負數；同一筆只能更正一次 |

指令只註冊至允許的群，不在 DM 使用；回覆僅操作者可見且不產生 @ 通知。HTTP 入口驗證 Discord Ed25519 簽章、Application ID 與 5 分鐘時間窗，無簽章拒絕；重送同一 interaction ID 不重複發放。採同步短交易直接回覆，沒有背景工作丟失問題。

管理指令預設僅 Discord Administrator 可見；後端另外允許 `CHIP_ADMIN_ROLE_IDS` 中的角色。若要開放指定非 Administrator 角色，需同時設定環境變數與伺服器「整合 → slot-game → 指令權限」。不需賦予此應用程式／Bot Administrator。

## 測試啟動

1. 本機 `.env.server.local` 保留 `DISCORD_CLIENT_ID`、`DISCORD_CLIENT_SECRET`，新增公開驗證金鑰與錢包設定。密鑰檔、資料庫、備份均被 Git 排除。
2. `.env.local`：`VITE_DISCORD_AUTH_ENABLED=true`、`VITE_DISCORD_WALLET_ENABLED=true`。
3. `npm run activity:serve`：建置前端並在 4188 啟動整合服務；隧道沿用此埠。
4. `npm run commands:register`：使用 Application 的 Client Credentials 註冊三個具名指令；不覆蓋其他指令或預設 Launch。應用程式必須先以 `applications.commands` 安裝到該群。
5. Portal → General Information → Interactions Endpoint URL：`https://stanford-glance-imposed-server.trycloudflare.com/api/interactions`。與 Activities URL Mapping、OAuth Redirects 是不同欄位。

本次指令已註冊成功，使用者已儲存互動端點並提供實機截圖：/籌碼 初始 10,000，首次 /簽到 10,500，第二次 /簽到 維持 10,500。Activity 餘額同步、管理員發放與跨裝置仍待實機驗收。測試頻道可隨後刪除，錢包不以頻道作為主鍵。

## 驗收順序

1. 在測試群重新開啟 Activity，同意新增成員資格授權；首次 COINS 是 10,000。
2. `/簽到` 後是 10,500；再簽到仍是 10,500（未先遊玩時）。Activity 可等最多 15 秒同步或切回畫面觸發刷新。
3. 玩一局，關閉再開；餘額與最近一局一致。用同帳號手機開啟，資料仍相同。
4. 管理員向測試成員發放 500 並填原因；查看 `/籌碼管理 紀錄`，以回覆編號測試更正。一般成員不能發放。
5. 第二個測試帳號的錢包獨立。測試網路中斷後重試，不會重複扣款。
6. 手機／桌面、重登、服務重啟、備份還原完成後，再切換正式部署。

自動測試包含 SQLite 重開、測試／正式隔離、台灣換日、去重、權限、簽章、Session 失效、偽造身分拒絕，以及本機 HTTP 並行 40 次簽到／20 次同局請求僅入帳一次。這不是大型伺服器容量認證，正式主機仍需依預期同時在線人數壓測。

## 雲端部署

不需要使用者電腦常駐，也不必單獨部署前端：同一個 Node 服務供應前端靜態檔、登入 API、錢包 API 與指令端點。專案提供 Dockerfile；環境範本見 `deploy/server.env.example`。Docker 的 build 階段只傳公開 Application ID，不傳密鑰。

1. 選擇支援常駐 Node 24／Docker、固定 HTTPS 網址與持久磁碟的雲端服務。
2. 目前架構使用 **單一應用實例**，SQLite 檔案放持久 volume；不能放臨時磁碟、不能讓多個容器各持有一份 DB。若需要多實例／更高吞吐量，先遷移集中式資料庫再擴容。
3. 設定 `APP_ENV=production`、`WALLET_ENABLED=true`、朋友伺服器的 `ALLOWED_GUILD_IDS`、`DATABASE_PATH=/app/data/production.sqlite`、密鑰及公開金鑰。正式資料庫全新建立，不複製測試 DB。
4. 將 `/app/data` 掛載持久磁碟，提供 `PORT`、`HOST=0.0.0.0`，HTTPS 由主機平台反向代理提供。健康檢查 `/healthz`。
5. 更新 Activities `/` Mapping 為固定主機；Interactions Endpoint 為固定網址 `/api/interactions`。將 App 安裝至朋友群並執行指令註冊。
6. 確認 Discord Activity 的發佈／可使用對象設定：私人開發測試可啟動不代表朋友所有成員已可啟動。公開發佈資格與平台要求需依 Portal 當時狀態完成，再以一般成員帳號驗收。
7. 設定備份保留、離機備份、服務監測，驗證還原後再交付。主機尚未購買／部署，Docker 映像尚未在實際雲端建置；目前只有本機 Node 路徑驗證。

## 備份／還原

本機 `npm run db:backup`；雲端使用 `node scripts/backup-db.js`（憑證由主機環境提供）。使用 SQLite `VACUUM INTO` 產生含已提交 WAL 資料的一致快照，不可只複製運作中的 `.sqlite` 主檔。

`BACKUP_DIRECTORY` 可指定持久備份目錄；雲端排程每日快照並另存至不同儲存位置，依實際容量設定保留政策。現有腳本只建立快照，不自動上傳或刪除舊備份。

還原時先停止服務，保留現有 DB 與 `-wal`／`-shm` 檔的復原副本，再將驗證過的快照放到新的 DB 路徑；更新 `DATABASE_PATH` 後啟動。不得把 test 快照還原為 production。重啟後 Session 失效，玩家重新開啟 Activity 即可，帳本不受影響。

參考：[Discord 指令](https://docs.discord.com/developers/interactions/application-commands)、[互動簽章與回覆](https://docs.discord.com/developers/interactions/receiving-and-responding)、[OAuth scope](https://docs.discord.com/developers/topics/oauth2)。
