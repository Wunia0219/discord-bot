# Discord 功能與啟動驗收

## 2026-10-26 朋友群開放紀錄

使用者指定「小丑俱樂部」的「工程師施工中」頻道進行試玩；設定時該頻道已更名為「工程師的專屬地」。群 ID 為 `760012177326997544`，頻道 ID 為 `1564243344857632818`。Discord 安裝授權後，該群指令查詢由 `403 Missing Access` 變為 `200`。

已在同一現行 Worker 的 `ALLOWED_GUILD_IDS` 加入朋友群，保留原群 `1441097301685698703`，並註冊、重新讀取核對 `/簽到`、`/戲籌`、`/戲籌管理`。此白名單以群為範圍；指定頻道的成員可見性與應用程式使用權仍依 Discord 頻道設定，沒有宣稱後端僅開放單一頻道。管理指令沿用原權限保護，未新增戲籌管理角色。

設定後，公開 health 顯示 `0.2.7`／`circus-243-v2`，ready 通過、備份有效；線上程式模組、入口 HTML 與主要 JS/CSS 雜湊一致。除白名單外，所有 bindings（含 Secrets、同一 DO、Firestore 範圍與既有公告目的群）逐項一致；原額度上限及資料來源保留。本機操作設定同步新白名單，`FIRESTORE_LIVE_ENABLED=false` 維持關閉。此次僅更新雲端設定，未發布本機新介面或調整停輪。

朋友群目前沒有得獎公告；原公告仍只送至原群。未製造測試回合或代發頻道公告。朋友群的真人活動啟動、登入與頻道權限仍待實際操作驗收。私有設定備份、前後模組／前端雜湊及驗證結果保存在忽略 Git 的 `backups/friend-guild-20261026/`，其中 `.env` 副本須當憑證保管。

2026-10-24 更新，工作區版本 **0.2.7**。目前 Discord 入口已切換 Cloudflare Workers Free，沿用原 Firestore v2 帳本與專用得獎 Webhook；本機 writer 與舊通道已停用。雲端／Discord 21 項診斷、加密備份下載還原及背景音樂發布已完成；停輪維持 [已驗收基準](reel-timing-baseline.md)。現行操作與回退見 [雲端手冊](cloud-runtime.md)，v2 遷移記錄見 [遷移進度](firestore-v2-migration-status.md)。

## 已完成的公告流程

SQLite 與 Firestore 共用 Webhook 設定驗證及原生 Discord 卡片格式。Firestore v1／v2 都支援：

- 指定群的 SUPER／MEGA 事件跟餘額、回合及原請求結果在同一交易保存；程序在回覆前中斷，重啟仍能發現待處理事件。重送原請求不再建立事件。
- 名稱只取自經 Discord 驗證的 session。事件只含群／回合識別、名稱、級別、倍率、時間、狀態；不保存 Webhook 密鑰、OAuth 權杖、下注或餘額。
- 每批最多 5 筆，10 秒更新一次、10 分鐘合併同卡；卡片顯示最近 5 次及本視窗已處理總次數。跨程序以交易及 60 秒租約互斥。
- POST 成功後保存訊息 ID。429 依回應等待；PATCH 404 可重建。POST 回應不明或未完成的建立租約保留 `uncertain`，不自動重貼；PATCH 回應不明可用相同聚合內容重試，不重複累計。
- 超過 15 分鐘的待發公告標記 `expired`，不補貼舊戰報；事件與完整遊戲紀錄保留。空佇列處理完後不持續讀取 Firestore；新大獎才喚醒，普通局不喚醒。

建立訊息使用 `wait=true` 取得訊息 ID，建立／更新都限制 `allowed_mentions`；僅建立使用抑制通知旗標。欄位依 [Discord Webhook 文件](https://docs.discord.com/developers/resources/webhook#execute-webhook)。結算交易內沒有 Discord 網路呼叫，避免 [Firestore 交易重試](https://firebase.google.com/docs/firestore/manage-data/transactions)重複發送。

## 用量與設定

沿用 `DISCORD_HIGHLIGHTS_WEBHOOK_URL` 與 `DISCORD_HIGHLIGHTS_GUILD_ID`，設定方法見 [部署說明](deployment.md)。未設定即停用；本機假帳號 QA 不允許設定真實公告。

| 情境 | 既有玩家單局文件寫入 |
|---|---:|
| 未啟用公告，或普通局 | v1：10；v2：6 |
| 啟用公告、指定群的大獎 | v1：11；v2：7 |

上表不含背景派送與 SDK 重試。無重試時，一批 n 筆的領取與完成共寫入 `2 × (n + 1)` 份文件；每筆保存事件也有成本，不能把公告說成免費。派送讀寫同時受原專案額度與 `<FIRESTORE_QUOTA_PATH>.highlights.sqlite` 的持久子額度限制：

| 設定 | 預設 |
|---|---:|
| `FIRESTORE_HIGHLIGHTS_READ_BUDGET` | 3,000 個保守讀取預留單位／滾動 24 小時 |
| `FIRESTORE_HIGHLIGHTS_WRITE_BUDGET` | 1,000 個保守寫入預留單位／滾動 24 小時 |
| `FIRESTORE_HIGHLIGHTS_EGRESS_MB` | 8 MiB JSON 內容／滾動 24 小時 |

這些不是額外 Google 免費配額。子額度用盡會暫停派送、保留事件並寫入不含密鑰的告警，5 分鐘後再嘗試；不會重新結算遊戲。全專案額度不足仍會拒絕新結算。原額度檔、維護額度檔及公告額度檔都須在重啟／回退時保留。

## 備份與回退

首次保存公告會在既有 metadata 標記公告資料存在，不多寫一份 metadata。備份在與帳本及錢包相同的唯讀快照中讀取公告事件與訊息狀態，即使沒有新遊戲，也會取得改變後的派送狀態；資料放入完整 SQLite 快照的既有公告表。沒有公告資料的來源不增加這兩個集合的查詢。

備份保留原事件狀態、訊息 ID、卡片內容及等待時間；程序專用的短期租約不轉移。恢復時 `sending` 且有訊息 ID 的事件以 PATCH 恢復；沒有已知 ID 的建立請求保守標記不確定。v1／v2 匯入與 SQLite 還原均保存遊戲與公告資料；回退 Firestore v1 時仍需使用支援公告備份的目前程式，不能用忽略公告的新舊混合服務。

公告歷史目前不自動刪除；大量歷史會增加備份讀取成本，仍受維護額度限制。備份失敗保留上份有效副本並告警。來源切換時必須停止派送器與所有遊戲 writer，使用最新完整快照，避免兩個 namespace 同時發公告。

## 啟動前診斷

```powershell
# 只讀設定與建置檔，不連 Discord、不開資料庫、不消耗 Firestore 額度。
npm run discord:check -- --offline

# 現行雲端入口、政策頁及 API 存取保護，另唯讀比對 Discord 入口與群指令。
npm run discord:check -- --cloud --discord --public-origin https://jokers-circus.nini900219.workers.dev

# Node 本機診斷僅供隔離開發或完成回退交接後使用，不能用來重啟現行 Firestore writer。
# npm run discord:check
```

工具使用 `.env.server.local`，前端設定檢查 `.env.local`；`--cloud` 略過已停止的本機服務並核對雲端政策 canonical 路徑。此命令不啟動 Node writer，也不解除本機 live 關閉設定。建置檔存在不代表已用最新設定建置；會檢查 Application ID 一致、前端未放密鑰、群與角色格式、非假帳號模式、健康／就緒、遊戲與政策頁、未登入錢包及未簽章互動被拒絕。`--discord` 取得短期應用程式權杖後，只讀取遠端指令及可選的 Webhook 歸屬，不註冊指令、不 PATCH 設定、不發送訊息；報告不輸出原始權杖、Webhooks 或供應商錯誤內容。

`/readyz` 可能觸發既有的低頻 metadata 檢查；需要完全避免雲端讀取時用 `--offline`。缺少公開網址、未開啟遠端檢查或公告未設定會明確標記 `unverified`，不冒充已驗收。自動檢查失敗時命令以非零狀態結束。

## 實際進度與剩餘條件

10/24 已完成 Workers Free 帳戶確認、Secrets、原持久額度及唯一 writer 交接、固定公開入口、Portal Mapping、互動端點與政策網址切換。最近 0.2.6 發布的 21 項雲端／Discord 檢查通過，公開 health／ready 均為 200；記錄見 [雲端手冊](cloud-runtime.md)。0.2.7 的工作區升號與文件更新不等於已發布。

「記事小本本 → #bot測試」專用 Webhook 與測試卡片已由使用者確認；背景音樂、手機直向及目前正常／快停體驗已發布，停輪與量測清理已驗收。剩餘真人雙裝置、背景恢復／斷線與自然大獎端到端驗收，以及首次跨日自動備份、外部故障通知和小群容量觀察，統一依 [收尾計畫](roadmap.md)接續，未完成項目不因自動診斷通過就標為完成。

本機回歸依範圍使用 `npm test`、`npm run test:firestore`、`npm run test:cloud`、`npm run build` 及 `npm run cloud:build`。Firestore／workerd 使用官方本機模擬器與假 Discord 回應，不冒充真人驗收；文件與版本更新不重跑完整數學枚舉或真實資料遷移。

10/23 歷史證據保留於 `test-results/discord-completion-unit.log`、`discord-completion-firestore.log`、`discord-completion-build.log` 與 `discord-readiness-live.log`：當時 307 項一般回歸及 52 項模擬器測試通過，本機通道後續曾有 28 項診斷通過。這些數字描述當時環境；原每日 v2 遷移接續排程已於遷移完成後刪除，不作為目前服務的操作指引。

10/26 完整 0.2.7 已發布，25 項雲端／Discord 診斷通過。戲籌指令原 ID／預設權限保持一致；分塊備份、最新進度還原與監控均通過，剩餘真人驗收依 [本次發布](launch-readiness.md)。前述較早的待辦與版本為歷史狀態。
