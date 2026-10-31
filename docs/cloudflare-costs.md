# Cloudflare 方案與費用

2026-10-31 使用者確認已升級 **Workers Paid**。正式遊戲與監控已部署 **1.0.2** 並核對 `CLOUD_PLAN=paid`；同帳戶測試 Worker 的本機私密設定也已更新。部署證據見[正式服交付](customer-handoff.md)，線上遊戲標記可由 `/__ops/status.cloudPlan` 核對。Firestore Blaze 與 Cloudflare 分開計費。

## 方案與設定

[Workers Paid](https://developers.cloudflare.com/workers/platform/pricing/) 每帳戶每月 US$5 起，超出內含量另計；不是費用上限，也不是網站 Pro／Business 方案。下表核對於 2026-10-31。

| 項目 | Paid 每月內含量 | 超額單價（USD） |
|---|---:|---:|
| Worker 動態請求 | 1,000 萬次 | 0.30／100 萬次 |
| Worker CPU | 3,000 萬 ms | 0.02／100 萬 ms |
| DO 請求 | 100 萬次 | 0.15／100 萬次 |
| DO 活躍時間 | 400,000 GB-s | 12.50／100 萬 GB-s |
| SQLite 寫入／讀取 | 5,000 萬／250 億列 | 1／100 萬寫入；0.001／100 萬讀取 |
| SQLite 儲存 | 5 GB-month | 0.20／GB-month |

[DO 費率](https://developers.cloudflare.com/durable-objects/platform/pricing/) 另含索引、刪除與排程成本；Worker 靜態資源請求免費。Firestore 文件數與 DO 列數不能混算。

`cloud/plan.js` 統一接受 `free|paid`，未知值拒絕；標記不會建立訂閱，也不會變更 Firestore 持久額度政策。公開 Wrangler 範本同步為 Paid，遊戲仍為 test、監控預設停用；更新現有服務使用原私密設定，保留 Worker 名稱、DO、Secrets、namespace 及全部用量。

運作中的 writer 升級方案不需 pause、seed 或再次 activate。僅在移交／還原 paused writer 時使用 `activate --writers-stopped true --plan paid --plan-verified true --env <私密設定>`；舊 Free 確認旗標不能啟用 Paid。

## 儲存成本與容量

登入內容不變時不重複加密／保存，不重寫未變更的到期索引；Firestore 預留採批次記帳，文件大小新紀錄使用 `WITHOUT ROWID`。保留每請求限流、成員重驗、去重、未知提交保護與失敗預留，詳見[結算儲存](settlement-storage.md)。

隔離 workerd 的 100 局合成比較：前景 SQL 寫入由 1,112 降至 910 列、讀取由 2,008 降至 1,905 列，Firestore 各讀／寫 400 份。未包含登入建立、跨日、公告、備份或正式 CPU；不能作為可玩局數或長期容量保證。

| 全體每天局數 | Cloudflare Paid／月（約） | Firestore 文件讀寫／月（約） |
|---|---:|---:|
| 1,000 | US$5 | US$0 |
| 10,000 | US$5 | US$0.73 |
| 100,000 | US$6 | US$17.57 |

情境假設為 30 天均勻遊玩、每局 2 次 API／15 列 SQL 寫入、每月另加 13,000 次 DO 請求／100,000 列背景寫入、Worker 平均 1ms CPU、單一主 DO、儲存未超過 5 GB-month。不含其他應用、稅金、Firestore 流量／儲存；每局若實際 25 列寫入，10 萬局／日的 Cloudflare 費用可約 US$31～32。

Paid 不解除技術容量限制：完整加密快照仍限制 128 MiB／8,192 塊，八成提醒、超限拒絕且不截斷歷史；長期資料成長需規劃封存。備份與回退見[恢復](recovery.md)。

## 用量監測

外部排程依方案處理：Free 提供每日門檻與耗盡預估；Paid 保留每日觀測及 API 故障／恢復通知，不再把 Free 額度當作停服上限。每日查詢未涵蓋月累計、Worker CPU 與 GB-month，不能取代 Cloudflare Billing。Firestore 八成提醒與備份監控另行保留，見[監控](monitoring.md)。
