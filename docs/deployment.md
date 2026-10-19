# 啟動、Discord 與錢包維護

## 本機

Node.js 24。執行 `npm ci` 後，`npm run dev` 在 127.0.0.1:4187 提供瀏覽器試玩；此模式只使用 localStorage，不更動 Discord 帳號錢包。

Discord 測試使用 `npm run activity:serve`：建置後，由 4188 的 Node 服務一起供應前端與 API。後端環境檔為 `.env.server.local`；前端公開設定為 `.env.local`，範本見根目錄 `.env.example` 及 `deploy/server.env.example`。Client Secret 只放後端，不能使用 `VITE_` 前綴。

前端啟用 `VITE_DISCORD_AUTH_ENABLED=true`、`VITE_DISCORD_WALLET_ENABLED=true`。後端需設定 Application ID、Client Secret、Public Key、`WALLET_ENABLED=true`、明確的 `ALLOWED_GUILD_IDS`、`APP_ENV=test` 與測試資料庫路徑。日誌與憑證不要提交版本庫。

## Discord 與測試通道

- 已有本機通道時，網址與程序資料位於被忽略的 `.tools/activity-tunnel.json`、`.tools/activity-server.json`，不要沿用舊文件中的臨時網址。
- 新建本機通道：`.\.tools\cloudflared.exe tunnel --url http://127.0.0.1:4188 --http-host-header localhost:4188`。執行檔需來自 Cloudflare 官方來源。
- Portal 的 Activities `/` URL Mapping Target 使用目前 HTTPS 主機名稱，不含 `https://`；開啟 Activities，並設定需要的桌面／手機平台。
- OAuth Redirect 使用 `https://127.0.0.1`；授權 scope 為 `identify`、`guilds.members.read`。Application 必須對應相同的前後端 ID。
- Interactions Endpoint 使用目前 HTTPS 網址加 `/api/interactions`，與 Activity Mapping 是不同欄位。
- `npm run commands:register` 只更新本應用程式的具名群指令，不覆蓋其他入口；只在調整指令定義或安裝新群時執行。
- 修改前端或重啟後端後，關閉並重新開啟 Activity。Session 最長一小時，重啟後需重新登入；SQLite 餘額及紀錄保留。

健康檢查為 `/healthz`。本機及公開通道應回報相同模型 `circus-243-v2`。載入失敗先檢查 4188 程序與通道，再檢查 Mapping；登入失敗檢查 Application ID、後端設定及群成員資格。不同瀏覽器來源的 localStorage 不會匯入伺服器錢包。

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

## 部署與備份

Dockerfile 提供 Node 24 建置與執行環境，執行期保留目前及歷史驗證所需的完整模組。建置只傳公開 Application ID；密鑰由執行環境注入。

使用單一服務實例及持久磁碟 `/app/data`。正式設定 `APP_ENV=production`、獨立 `DATABASE_PATH`、正式群 allowlist，使用固定 HTTPS 網址更新兩個 Discord 端點；不要複製測試 DB 作為正式錢包。SQLite 不能讓多個獨立容器各持有不同副本。固定主機與 Docker 雲端部署需在實際環境驗收。

本機執行 `npm run db:backup`；主機使用 `node scripts/admin/backup-db.js`，可設定 `BACKUP_DIRECTORY`。腳本使用 `VACUUM INTO` 保存含已提交 WAL 的一致快照，不應只複製運作中的主檔。

還原前停止服務並保留現有資料庫及 WAL／SHM 副本；驗證快照後放入新的資料庫路徑，再啟動並重新登入。不得把 test 快照作為 production。備份腳本不會自動刪除或上傳備份。

驗收：登入／取消授權、重開及跨裝置餘額、同日重複簽到、舊回合重送、管理發放與更正、一般成員拒絕、快速停輪及 AUTO SPIN 停止、背景切換、手機方向與音效。自動測試及本機模擬不能取代 Discord 真機與實際主機驗收。
