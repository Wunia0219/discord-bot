# Discord 功能與啟動驗收

2026-10-23，版本仍為 0.2.6。Firestore 公告與啟動前診斷已完成，後續已依使用者授權啟用專用 Webhook 與公開測試通道、更新 Discord 設定並重啟 4188 服務。資料仍在原 v1 命名空間，遷移依 [目前進度](firestore-v2-migration-status.md)接續。實測及回退操作見 [Discord 測試入口](discord-test-entry.md)。

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

# 本機健康、就緒、頁面及未授權 API 存取檢查。
npm run discord:check

# 另以現有應用程式授權，唯讀比對 Activity 入口與群指令。
npm run discord:check -- --discord

# 使用當下有效的公開 HTTPS 主機；不要照抄舊通道網址。
npm run discord:check -- --discord --public-origin https://your-current-host.example
```

工具使用 `.env.server.local`，前端設定檢查 `.env.local`；建置檔存在不代表已用最新設定建置。會檢查 Application ID 一致、前端未放密鑰、群與角色格式、非假帳號模式、健康／就緒、遊戲與政策頁、未登入錢包及未簽章互動被拒絕。`--discord` 取得短期應用程式權杖後，只讀取遠端指令及可選的 Webhook 歸屬，不註冊指令、不 PATCH 設定、不發送訊息；報告不輸出原始權杖、Webhooks 或供應商錯誤內容。

`/readyz` 可能觸發既有的低頻 metadata 檢查；需要完全避免雲端讀取時用 `--offline`。缺少公開網址、未開啟遠端檢查或公告未設定會明確標記 `unverified`，不冒充已驗收。自動檢查失敗時命令以非零狀態結束。

## 實際進度與剩餘條件

本輪已唯讀驗證現有 Discord 應用授權有效、APP_HANDLER 啟動入口，以及簽到／籌碼／管理指令定義一致；本機遊戲、政策頁、健康及 API 存取保護通過，共 19 個自動檢查項目。原服務未重啟，測試沒有發公告或改玩家資料。

後續啟用已完成公開通道、Portal Mapping、互動端點、OAuth／支援平台核對，以及「記事小本本 → #bot測試」專用 Webhook。啟動後 28 項自動診斷通過，尚待使用者完成本輪 Discord 桌面／手機的登入、操作、跨裝置與自然大獎卡片呈現驗收。背景音樂仍缺曲目、異地備份仍缺目的地、常駐部署仍缺主機決定，保留於 [實作計畫](roadmap.md)，不以本機測試取代這些條件。

測試：`npm test`、`npm run test:firestore`、`npm run build`。輸出為 `test-results/discord-completion-unit.log`、`discord-completion-firestore.log`、`discord-completion-build.log`、`discord-readiness-live.log`。Firestore 測試使用官方本機模擬器與假 Discord 回應，另以已封存真實快照驗證原始去重資料的 v2 遷移及 v1 回退。

本輪結果：307 項一般回歸、52 項 Firestore 模擬器測試全數通過，無跳過；正式建置通過，既有大於 500 kB 的 bundle 提示仍存在。另驗證早期 SQLite 的公告訊息 ID 與帶小數的等待時間原值保留，缺少必要欄位或不安全的訊息 ID 拒絕匯入。現有服務設定與封存來源的 v2 遷移指紋均未改變，明日自動接續已納入公告派送器的停止、備份及回退規則。
