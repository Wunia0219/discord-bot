# 架構與程式邏輯

產品版本以 `package.json` 為準。正式服務由 Cloudflare Worker 接入 Discord、單一 Durable Object（DO）協調請求，Firestore v2 保存權威帳本；Node／SQLite 保留本機驗證與恢復用途。

## 程式責任

| 範圍 | 入口與責任 |
|---|---|
| 啟動 | `src/main.js`：登入與舞台並行準備、操作狀態及失敗清理 |
| 遊戲規則 | `src/game/`：輪帶、下注、算獎與歷史模型；前後端共用 |
| 平台與同步 | `src/platform/`：Discord 登入、原請求恢復、錢包與歷史分頁 |
| 轉輪與演出 | `src/ui/reels/`、`dealer/`、`audio/`、`wins/`：動畫、荷官、聲音、派彩 |
| 玩家介面 | `src/ui/player/`、`dialogs/`、`shared/`：資訊、視窗、共用元件 |
| HTTP／Discord | `server/http/`、`server/discord/`：路由、簽章、群／頻道／角色授權、指令與公告 |
| 共用錢包 | `server/wallet/`：下注／簽到／發獎／收回規則、session、結算佇列；`settings.js` 統一後端設定 |
| Firestore 結算 | `server/firestore/wallet-core.js`：交易、去重、近期狀態快取及讀寫預留 |
| Firestore 查詢 | `wallet-history.js`：新舊回合、帳本、每日摘要；`admin-wallets.js`：玩家列表與重設 |
| Firestore 格式 | `schema.js`、`documents.js`、`record-codes.js`：索引、壓縮歷史、文件解碼、P/R 編號 |
| Firestore 維護 | `backup.js`、`import.js`、`highlights-core.js`：備份、遷移與公告狀態 |
| Node 後端 | `server/index.js`、`config.js`、`sqlite/`：啟動、儲存選擇及 SQLite 維護；`testing/` 僅供 loopback QA |
| Cloudflare 入口 | `cloud/worker.js`：DO 生命週期、HTTP／管理操作、alarm；`config.js` 驗證身分 |
| Cloudflare 組裝 | `cloud/runtime.js`：Firestore REST、錢包、session、公告、備份及 HTTP handler；`fetch.js` 處理 Worker redirect 差異 |
| Cloudflare 持久資料 | `cloud/storage.js`、`quota.js`、`snapshot.js`、`backup.js`：登入、Firestore 預留、加密快照與增量備份 |
| 方案 | `cloud/plan.js`：Free／Paid 標記及 writer 啟用確認，與 Firestore 額度政策分離 |
| 監控 | `monitor/check.js`：健康／備份；`monitor/usage/`：官方用量查詢、方案判斷、通知去重；`monitor/discord.js` 共用發送 |
| 恢復與維運 | `server/recovery/`、`server/operations/`：驗帳、備份、writer 移交與狀態 |

## 一局的資料流程

1. 前端保留 request ID，先送結算請求，同步開始動畫；未確認時重用原 ID。
2. 後端從 session 取得群與玩家，驗證下注、冷卻與餘額。Firestore 在同一交易批次讀 meta、錢包、原請求及每日摘要。
3. 現行精簡模式一般一局原子寫入 **4 份**：meta、錢包、根帳本、含完整結果的請求收據。每日摘要暫存於錢包 `pendingDay`；跨日、新手入帳及公告另計。舊模式為 6 份；新舊歷史都可讀，見[結算儲存](settlement-storage.md)。
4. 本局結果與權威餘額回傳後才落地，歷史在背景補齊。較舊 revision 不覆蓋新狀態；重播原請求不新增寫入，未知 commit 結果不換 ID 或盲目重送。
5. 每玩家讀取合併；純讀快取雲端 30 秒、Node 5 秒，前景每 15～20 秒刷新。交易一律讀權威文件，成功後更新快取；錯誤、暫停、重新啟用及重建 runtime 使快取失效。命中不延長到期，慢回應不能覆蓋較新狀態。

結算佇列最多 32 筆（含執行中）；未開始的請求最多等 10 秒，逾時沿原 ID 重試，已開始交易不取消。動畫、實際 elapsedMS、兩秒冷卻與音效以[停輪基準](reel-timing-baseline.md)為準。

## 儲存與相容性

根路徑為 `circus_wallet_v1/<namespace>`，主體存 `json`、查詢鍵另存。SQLite schema 3、Firestore schema 2；`v1` 根集合名稱不是目前 schema 版本，不能重新命名現有帳本。

| 資料 | 內容 |
|---|---|
| `meta/state` | schema、環境、移入狀態、全域序號與 P/R 計數 |
| `wallets` | 餘額、週簽到、摘要、revision、重設標記、近期 100 局壓縮快取 |
| 根 `ledger`、`operations` | 完整流水、永久去重；精簡模式的回合結果保存在 operation 收據 |
| 玩家 `rounds`、`days` | 舊完整回合與已封存每日摘要；與新收據／`pendingDay` 合併讀取 |
| 根 `adminDays`、`reversals` | 管理額度與更正關聯 |
| `highlightEvents`、`highlightBoards` | 得獎公告及派送狀態 |

近期歷史用無損 DEFLATE／Base64，解壓上限 2 MiB。冷登入只讀錢包；`compact-v1` 回傳輕量狀態，`/api/rounds` 以固定 `through` 補齊。較早歷史每頁最多 50 局；舊 client／v1／SQLite 仍支援完整快照。

週簽到依群、玩家、台灣日期去重，連續七天循環、中斷回第 1 天；原收據保存實際獎勵。首次錢包與新手入帳原子提交。全群重設保留歷史，見[管理操作](discord-commands.md)。

`FIRESTORE_SCHEMA_VERSION` 必須符合 metadata；遷移先用 `scripts/firestore/import-firestore.js --from <快照> --dry-run` 規劃，只可匯入空白 namespace 並逐份驗證。v2 接受新進度後不能直接回到舊帳本；先停止 writer、備份驗帳，再依[恢復程序](recovery.md)移交。相容讀取與舊規則不可當成過時程式刪除。

## 檔案分類

| 位置 | 維護方式 |
|---|---|
| 根目錄、`.github/`、`deploy/` | 工具／部署設定、CI、公開環境範本及 Firestore 規則；CI 只驗證，不部署 |
| `scripts/cloud/`、`firestore/`、`database/`、`discord/` | 各平台操作 CLI；既有 npm 指令名稱保留 |
| `scripts/admin/` | 跨後端狀態、可攜備份與 wallet recovery |
| `scripts/setup/`、`qa/`、`qa/helpers/` | 安裝 Node／模擬器、隔離驗證、共用啟動流程 |
| `scripts/assets/`、`audio/`、`game/` | 素材工具、音效預覽、數學驗算與模型輸出 |
| `scripts/lib/`、`security/` | CLI runtime 與鎖定版本的安全修補，不進產品 bundle |
| `docs/`、`docs/data/`、`output/` | 主題文件、數學報告與可重建的模型交付 JSON；文件入口在 README |
| `images/`、`audio/`、`public/` | 執行素材；保留既有資源 URL |
| `art/` | 原畫、原幀、設計與來源證據，非前端 runtime |
| `tests/`、`tests/helpers/`、`tests/fixtures/` | 一般回歸、整合情境、獨立 oracle 與固定像素基準 |
| `node_modules/`、`dist/`、`.wrangler/` | 已忽略的相依、建置及 Worker 產物 |
| `.tools/`、`test-results/` | 已忽略的工具、一次性腳本與驗證證據，非正式來源 |
| `.env*.local`、`wrangler.*.local.jsonc`、`data/`、`backups/` | 私密設定、帳本與備份，不加入 Git、不批次清空 |
