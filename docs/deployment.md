# 部署與維運

本機版本以 `package.json` 為準，線上版本須另查 health。正式入口為 `https://jokers-circus-production.nini900219.workers.dev`；Cloudflare Workers Free／SQLite Durable Object 搭配獨立 Firebase Spark、台灣 `asia-east1` Firestore v2，保留原用量保護。已於 2026-10-30 切至正式群 `1503958213454856252`、頻道 `1565731918107115690`，並更新至 1.0.0、啟用 REST Bot 賭場公告。驗證、來源提交與真人驗收範圍見[客戶交付](customer-handoff.md)。

## 設定與資料範圍

Netlify 的建置預覽由根目錄 `netlify.toml` 指定 `NPM_VERSION=12.2.1`，在自動安裝依賴前切換 npm；Node 仍依 `.node-version`。`packageManager`／`engines` 不會替 Netlify 升級 npm，放在 build command 裡才升級也來不及。保留 `.npmrc` 的版本與安裝腳本限制。參考 [Netlify 相依管理](https://docs.netlify.com/build/configure-builds/manage-dependencies/#npm)。

| 項目 | 設定 |
|---|---|
| 正式 Firestore | 專案 `jokers-circus-production`，namespace `jokers-circus-v2-20261030-production`，`APP_ENV=production`，`asia-east1` |
| 正式 Worker | `jokers-circus-production`；忽略 Git 的 `wrangler.production.local.jsonc` |
| 正式維運設定 | `.env.cloud.production.local`；Discord CLI 使用 `.env.server.production.local`（本機 live writer 關閉） |
| 保留測試 Firestore | 專案 `slot-game-203db`，namespace `jokers-circus-v2-20261024-test`，`APP_ENV=test`；舊服務未刪除，Discord 共用應用程式入口已切正式 |
| 測試群／頻道 | 群 `760012177326997544`，頻道 `1564243344857632818` |
| 測試 Worker | `wrangler.jsonc`；私密覆寫為忽略 Git 的 `wrangler.cloud.local.jsonc`，不要用於正式更新 |
| 執行設定 | `CLOUD_PLAN=free`、`APP_ENV`、`FIRESTORE_PROJECT_ID`、`FIRESTORE_NAMESPACE`、`FIRESTORE_ENDPOINT` |
| Discord 範圍 | `DISCORD_CLIENT_ID`、`DISCORD_PUBLIC_KEY`、`ALLOWED_GUILD_IDS`、`DISCORD_COMMAND_CHANNEL_IDS`、`ADMIN_ROLE_IDS` |
| 遊戲限制 | `WEEKLY_CHECKIN_REWARDS`、`ADMIN_GRANT_MAX`、`ADMIN_DAILY_MAX` |
| Secrets | `DISCORD_CLIENT_SECRET`、`GOOGLE_SERVICE_ACCOUNT_JSON`、`CLOUD_ADMIN_TOKEN`、`CLOUD_ENCRYPTION_KEY`、`CLOUD_MONITOR_TOKEN`；正式公告使用 `DISCORD_BOT_TOKEN`，舊 Webhook 模式使用 `DISCORD_HIGHLIGHTS_WEBHOOK_URL` |

前端只放公開 client ID 與 auth／wallet 開關；私密值不得使用 `VITE_` 前綴。環境範本在 `deploy/`；既有服務更新保留同一 Worker、DO identity、全部變數、Secrets 及額度，不能重做 seed。程式發布不等於資料遷移。

雲端是唯一 writer；本機 `.env.server.local` 的 `FIRESTORE_LIVE_ENABLED=false` 保留。不可為本機測試重開 4188 直連現行帳本，也不能由本機維護工具額外消費另一份額度。writer 轉移見[恢復程序](recovery.md)。

## 用量與容量

原保護上限為全專案讀取 40,000、寫入 15,000、維護讀取 6,000、公告讀取 3,000；保留持久歷史計數及滾動視窗。Blaze 不表示已授權提高上限、重設額度、啟用原生付費備份／PITR 或其他付費資源。

額度不足時拒絕新操作；不得用新 namespace、主機或 DO 繞過。這些是保守應用程式預算，不是供應商帳單硬上限，其他服務及儲存／索引仍須核對。平台方案與限制以供應商當下設定為準，不假設有試用抵用金。

## 日常操作

```powershell
npm run cloud:control -- health --env .env.cloud.production.local
npm run cloud:control -- status --env .env.cloud.production.local
node --env-file=.env.server.production.local scripts/admin/check-discord.js --cloud --discord --public-origin https://jokers-circus-production.nini900219.workers.dev
```

`status`／`health` 只讀 DO 摘要，不查玩家文件、不觸發備份。`health` 會核對本機版本；未發布分支的版本差異不等於遊戲故障。下載與還原見[備份](recovery.md)。

## Discord

新增的同身分大獎逐筆公告與玩家出入場公告見[賭場機器人公告](casino-announcements.md)。這是可選的 Bot REST 功能，預設停用；不需要 Gateway 常駐綠燈，也不更改既有 HTTP 指令。啟用前必須完成 bot 安裝、私密 Bot Token 與指定頻道的核對。

Activity `/` URL Mapping 指向固定 HTTPS 主機；Interactions Endpoint 為該網址加 `/api/interactions`。OAuth scope 為 `identify`、`guilds.members.read`，前後端 Application ID 一致。只有調整指令定義或新群安裝時才執行 `commands:register`；定義及權限見[指令](discord-commands.md)。

公開 `/healthz` 代表 HTTP 程序存活，`/readyz` 檢查錢包與維運是否可服務；都不輸出玩家或憑證。政策頁為 `/privacy.html`、`/terms.html`；資料查詢、更正或刪除須先核對本人及帳本關聯，不能只刪錢包而留下不一致流水。

## 獨立監控

`jokers-circus-monitor` 已接通[維護頻道](https://discord.com/channels/1441097301685698703/1564187899019141140)，每 10 分鐘 Cron 查正式遊戲私有狀態，已使用新的正式唯讀 token；私密本機監控設定也已同步正式入口。它只有 `MONITORED_TOKEN`、`MONITOR_WEBHOOK_URL`，沒有 Google、遊戲管理或備份金鑰；遊戲的 `CLOUD_MONITOR_TOKEN` 僅允許 GET status。

| 條件 | 告警 |
|---|---|
| 連線／授權失敗、服務未 active | 嚴重 |
| 備份缺失／失敗或超過 48 小時 | 嚴重，玩家 API 保護 |
| 備份超過 26 小時 | 提醒 |
| alarm 缺失／失敗或超過 30 分鐘 | 嚴重 |
| 任一額度／備份容量達八成 | 提醒 |
| 額度耗盡或狀態不明 | 嚴重 |

相同告警或恢復連續兩次才通知，正常啟動不發訊息。POST 前保存意圖，429 依重試時間等待；結果不明保留 uncertain，不盲目重貼。內容只含摘要，停用 mentions。監控與遊戲仍共用 Cloudflare，無法保證整個平台故障時告警可送達。

設定範本 `deploy/monitor.env.example`、`wrangler.monitor.jsonc` 預設停用；不要拿範本覆蓋已啟用服務。撤回通知只改監控 `MONITOR_ENABLED=false`，保留遊戲與資料。

## 本機 Node／SQLite

`npm run dev` 提供 4187 瀏覽器 localStorage 試玩。完整隔離入口與 4192 QA 見[測試](testing.md)。4189 開發使用 `deploy/backend.env.example`、`APP_ENV=test`、`HOST=127.0.0.1`、`DATABASE_PATH=data/backend.sqlite`。

```powershell
npm run backend:init
npm run backend:dev
npm run backend:check
npm run backend:backup
npm run backend:restore -- --from <已驗帳快照> --to <新SQLite檔>
```

檢查為唯讀一致快照；備份使用 VACUUM INTO 包含已提交 WAL；還原只建立新檔。確認原 writer 停止並驗帳後才切換 DATABASE_PATH。`server/index.js` 與 Docker 入口保留，啟動前驗證環境及 Discord 憑證；Node session 重啟失效，雲端 session 加密持久保存。
