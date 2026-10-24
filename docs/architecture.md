# 現行架構

2026-10-24 更新，工作區版本 **0.2.7**。目前 Discord 服務使用 Cloudflare Workers Free／SQLite Durable Object 與原 Firestore Spark v2；版本更新僅涉及隱私頁與文件，停輪依 [已驗收基準](reel-timing-baseline.md)維持。收尾條件見 [實作計畫](roadmap.md)，現行雲端操作見 [雲端手冊](cloud-runtime.md)，Node／SQLite 設定見 [部署說明](deployment.md)。

## 模組與邊界

| 層次 | 入口 | 責任 |
|---|---|---|
| 頁面組合 | `src/main.js` | 登入、操作狀態、視窗、背景切換、15 秒前景刷新 |
| 玩家介面 | `src/ui/` | Pixi 場景、荷官動畫、規則、紀錄、音效；不決定伺服器餘額 |
| 平台連線 | `src/platform/` | Discord 驗證、錢包 HTTP、保留未確認旋轉的原請求編號 |
| 遊戲模型 | `src/game/` | 當前規則、輪帶、算獎、歷史規則重播 |
| HTTP／指令 | `server/app.js`、`commands.js` | 簽章、登入、權限、私密回覆、錢包 API |
| 身分與錢包 | `wallet-service.js`、`config.js` | 驗證玩家與群、選擇後端、建立 session |
| SQLite | `wallet.js`、`database*.js` | 本機開發／可回退的帳本實作、驗帳 |
| Firestore | `firestore-wallet.js`、`firestore-history.js` | 雲端權威結算、按需分頁、既有資料相容 |
| 得獎公告 | `highlights.js`、`firestore-highlights.js`、`highlight-card.js` | 共用設定與卡片格式；SQLite／Firestore 各自持久化、去重及發送恢復 |
| 額度／維運 | `firestore-quota.js`、`operations.js`、`maintenance-worker.js` | 持久預算、worker 排程、就緒及私有告警 |
| 備份／移入 | `firestore-backup.js`、`firestore-import.js` | 一致快照、完整驗證、空白命名空間還原 |
| 可攜式備份 | `portable-backup.js` | 已驗帳快照加密、驗證及離線還原到新檔，不存取雲端 |
| 雲端入口／傳輸 | `cloud/worker.js`、`cloud/firestore-rest.js`、`server/app-handler.js` | Worker HTTP、共用授權與結算核心、受 namespace 限制的 REST 原子交易 |
| 雲端狀態／備份 | `cloud/storage.js`、`quota.js`、`backup.js`、`snapshot.js` | 單一 DO 持久額度、加密 session、alarm、可接續一致快照及還原驗證 |

## 一次旋轉如何保存

1. 前端建立請求編號並暫存；回應不明時沿用同一編號。
2. 後端驗證 session、群及下注，產生權威結果。
3. Firestore 交易以同一次 `getAll` 批次讀取 metadata、錢包、原請求及每日摘要；已完成的請求回傳原結果，新請求檢查冷卻與餘額後再寫入。REST 透過 `batchGet.newTransaction.readWrite` 在首批讀取時開啟交易，正常新局共兩次往返（開啟並讀取、提交），仍讀四份文件並原子寫入六份；拒絕或重播也先讀四份，較前版多讀每日摘要，但不寫入，且沿用原每份文件的保守重試額度與總額度上限。
4. 在同一交易內更新餘額、帳本、回合、去重結果及摘要。任何錯誤中止整筆交易。
5. 提交成功後更新本程序的 5 秒短快取。v1 回傳完整快照；v2 新 client 回傳本局及輕量狀態。前端的結果請求與空轉動畫並行，取得本局及權威餘額後即可停輪、呈現得獎；較舊歷史在背景補齊，開啟紀錄時等待同步或重試，不阻擋本局演出。

快取只減少讀取，不代替交易。跨程序或跨裝置的扣款與簽到仍讀取權威狀態；前景刷新維持 15 秒，其他程序的短快取可能再增加約 5 秒可見延遲。前端重疊刷新及後端相同玩家讀取會合併，但不延長快取時間。

## Firestore 資料契約

根路徑為 `circus_wallet_v1/<namespace>`。文件主體以 `json` 保存，查詢欄位另外存放。目前服務已採用結構版本 2；Node 範本預設仍為 1 以保留相容性，不能直接套到現行服務。新遷移仍須完整快照與空白命名空間驗證，見 [Firestore v2](firestore-v2.md)。

| 資料 | 用途與保留範圍 |
|---|---|
| `meta/state` | 環境、結構版本、移入狀態、全域遞增帳本編號 |
| `wallets/<guild>_<user>` | 餘額、簽到日期、revision、完整累計摘要；v1 是原始 100 局快取，v2 是帶序號的無損壓縮快取及 historyRevision |
| 根 `ledger/<id>` | 完整權威流水及原請求連結；v2 同文件另存四個查詢鍵，提供玩家／分類／日期索引 |
| 玩家 `ledger`、`entries-<category>`、兩種每日分類集合 | v1 保留四份查詢副本；v2 不建立這些副本 |
| 玩家 `rounds` | 全部原始回合，包含規則、停點與得獎明細；v2 另有 sequence 欄位供穩定分頁 |
| `operations` | 全部請求指紋及原結果，供重送去重 |
| 玩家 `days` | 每日簽到及遊戲統計；以台灣日期作文件 ID |
| `adminDays`、`reversals` | 管理員每日限額與更正連結 |
| `highlightEvents`、`highlightBoards` | 啟用公告後的持久事件、訊息 ID、合併卡片、等待時間與短期派送鎖；事件跟大獎結算原子保存 |

最近 100 局是畫面與錢包的快取上限，並非完整歷史的保存上限。v2 玩家可載入更早的回合；v1／SQLite 維持原本畫面範圍。管理查帳已有分頁。完整歷史、請求去重及摘要不會因這次優化被截短或清除。

既有玩家的一般新旋轉仍為 4 次文件讀取；v1 寫 10 份文件，v2 寫 6 份，SDK／交易重試另計。啟用公告時，指定群的 SUPER／MEGA 每局額外寫入 1 份事件，背景派送另計且有獨立子額度；普通局與未啟用公告者成本不變。所有玩家更新同一份 metadata，流量成長後可能出現競爭。v2 的 100 局快取在後端無損壓縮，HTTP 依版本增量同步；冷登入及近期歷史仍只需一份錢包讀取，舊紀錄分頁才額外讀取回合文件。

## 運作與恢復界線

- 目前唯一現行 writer 在固定 Worker 入口；4188 Node writer 與舊通道已停用，4189 僅供獨立 SQLite QA。實際運行狀態以雲端私有 status 為準，文件不代表服務此刻在線。
- 原全專案、維護及公告三組持久額度已交接同一 DO；本機保留原檔與 `FIRESTORE_LIVE_ENABLED=false`。雲端 active 時不能另開 Node 或管理 CLI 直連同一 Firestore；多主機不能複製預算後各自消費。
- 雲端 alarm 一般每 10 分鐘檢查，每 24 小時嘗試一致備份。固定 Firestore readTime，分批取得增量與可變資料，驗帳後發布可獨立還原的加密完整快照，保留最近三份有效副本；超過 48 小時未成功會暫停玩家 API。
- Cloudflare 保存與 Google Firestore 分開的加密備份，已完成下載、隔離還原與七表逐列比對。首次跨日自動備份含新增進度的驗收、恢復金鑰獨立保管及外部故障通知仍待收尾；額外 Google Drive 副本尚未接入。雲端排程不依賴個人電腦開機。
- SQLite／Firestore 公告佇列均已實作；Firestore 空佇列不持續輪詢雲端，公告狀態納入完整備份與 v1／v2 還原。現有服務已啟用專用 Webhook，使用者確認明確標示的測試公告正常；細節見 [Discord 啟動驗收](discord-readiness.md)。
- 主遊戲荷官 idle／win 與背景音樂均已接入並發布；`MUSIC_SOURCE` 指向精簡 MP3，音樂預設關閉、手動開啟才載入，與音效獨立控制。手機固定 PORTRAIT。

資料保存完整不等於任何故障下都零損失：尚未備份的新進度仍有恢復落差，金鑰也須獨立保管。達到額度時會拒絕新的操作，保留已提交資料與原請求，不提供假成功或離線扣款。

## Worker 執行路徑（已上線）

`firestore-wallet-core.js` 與 `firestore-highlights-core.js` 共用結算／公告邏輯；Node wrapper 使用 Google SDK，`cloud/firestore-rest.js` 使用受 namespace 限制的 REST 交易。`app-handler.js` 共用 OAuth／簽章／API，Node HTTP 與 Worker Request/Response 分別接入。

`cloud/worker.js` 每個專案綁定唯一 SQLite Durable Object，持久保存原全域及子額度、加密 session／限流、公告提示與備份 checkpoint。Firestore v2 仍是權威帳本；未 seed／paused／released 一律拒絕玩家寫入。`cloud/backup.js` 固定 readTime 分批取得全歷史增量與可變表，驗帳後加密發布；不確定公告 POST 與原去重資料一起保留。詳細部署門檻及額度回傳見 [cloud-runtime.md](cloud-runtime.md)。
