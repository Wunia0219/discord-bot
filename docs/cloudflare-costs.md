# Cloudflare 費用與 1.0.1 優化

核對日期：2026-10-31。以下為配合程式修改的 USD 情境估算，不是帳單；Firestore 另見[結算儲存](settlement-storage.md)。

## 方案

[Workers Paid](https://developers.cloudflare.com/workers/platform/pricing/) 每個帳戶每月 **US$5 起**，啟用後低用量仍有最低月費；超出內含量另計，US$5 不是總費用上限。它與網域網站 Pro 不同，同帳戶也不按 Worker 個數重收 US$5。

| 項目 | Paid 每月內含量 | 超額單價 |
| --- | ---: | ---: |
| Worker 動態請求 | 1,000 萬次 | US$0.30／100 萬次 |
| Worker CPU | 3,000 萬 ms | US$0.02／100 萬 ms |
| DO 請求（另外計數） | 100 萬次 | US$0.15／100 萬次 |
| DO 活躍時間 | 400,000 GB-s | US$12.50／100 萬 GB-s |
| SQLite 寫入列數 | 5,000 萬列 | US$1／100 萬列 |
| SQLite 讀取列數 | 250 億列 | US$0.001／100 萬列 |
| SQLite 儲存 | 5 GB-month | US$0.20／GB-month |

[DO 官方費率](https://developers.cloudflare.com/durable-objects/platform/pricing/) 包含索引維護、刪除與排程；Worker 靜態資源請求免費。Firestore 文件數不能代替 DO 列數。要超過 Free 每日用量仍服務，須由供應商實際啟用 Workers Paid；程式不能解除供應商硬限制。

1.0.1 支援遊戲與監控的 `CLOUD_PLAN=free|paid`，未知值仍拒絕。此部署標記不會建立訂閱，也不能證明帳戶已付款；移交／還原須核對實際方案，舊 Free 確認旗標不能啟用 Paid。Firestore notify-only、八成提醒及歷史用量保留。

目前 Wrangler 可操作 Workers，但訂閱查詢回覆 403；`default_usage_model=standard` 也不能證明 Paid 已啟用。本次沒有建立訂閱，付費切換仍待使用者決定，須由帳戶持有人確認 Workers Paid 狀態。

已在運作的 writer 升級帳戶方案，不需要 pause、seed 或重新 activate。只有移交／還原的 paused writer 啟用時，才使用 `activate --writers-stopped true --plan paid --plan-verified true`（另提供既有 `--env`），並保留原單一 writer 與備份核對。切換部署標記前須先確認供應商的實際方案。

## 實測與價格模型

相同登入內容不再重複加密／保存；內容更新不再重寫未改變的到期索引；相同 CloudState JSON 以 SQL 條件避開無效更新。請求次數仍先持久保存，120 次／分鐘限制、成員重驗、撤銷、過期與重啟保護保留。

隔離 workerd 比較 1.0.0 儲存方法與 1.0.1：

| 100 次操作 | 原 SQLite 寫入列數 | 優化後 |
| --- | ---: | ---: |
| 登入授權 | 400 | 100（減少 75%） |
| 授權＋精簡結算 | 1,412 | 1,112（減少約 21%） |

兩側持久 session、餘額、局數、Firestore 讀寫與預留相同；100 局均為實際 400 文件讀取、400 文件寫入。使用相同模擬時鐘／結果及合成 REST 回應，沒有下注真人帳戶；不含備份、公告、排程及正式 CPU 用量。

估算假設：30 天均勻遊玩、每局 2 次動態 API、15 列 SQLite 寫入（實測前景約 11.12，另留餘裕），每月再留 13,000 次 DO 請求／100,000 列背景寫入；一個主遊戲 DO、低頻監控、Worker 平均 1ms CPU、儲存未超過 5 GB-month。不含其他應用、稅金、匯差、Firestore 流量及儲存。

| 每天總局數 | Cloudflare Paid／月（約） | Firestore 文件讀寫／月 | 小計（約） |
| --- | ---: | ---: | ---: |
| 1,000 | US$5 | US$0 | US$5 |
| 10,000 | US$5 | US$0.73 | US$5.73 |
| 100,000 | US$6 | US$17.57 | US$24 |

10 萬局／日約為每月 4,510 萬列寫入，未超過 5,000 萬，但約 601 萬 DO 請求另有少量費用。若每局實際 25 列，每月約 7,510 萬列，Cloudflare 可到約 US$31～32，連同表列 Firestore 約 US$49～50。單一 DO 即使活躍整月，128 MB×30 天約 331,776 GB-s，低於內含量；其他 DO 仍共用該帳戶配額。

這是費用模型，沒有承諾該流量已完成長期容量驗收。完整備份有 128 MiB 邏輯容量保護及八成通知，6,000 局合成快照約 11.3 MB；高局數長期使用須另做分區／封存。Paid 解除免費每日用量限制，不會解除所有技術及付款限制。完整帳本、稽核、餘額與冷卻保護均保留。

## GitHub 驗證

[Modify #13](https://github.com/Wunia0219/discord-bot/actions/runs/41100176636) 三組指令約 1:43、1:36、2:15；browser 測試與 post steps 約 17:39 UTC 完成，job 回報 17:47，workflow 更新至 17:58，不能把 22:21 全算成測試執行。

- Chromium 快取鍵依安裝後的 Playwright `browsers.json`、OS、架構；產品版本更新不會無故丟棄相同瀏覽器。每次仍跑 installer 和 OS 相依檢查。
- Firestore JAR 快取依校驗腳本，每次仍檢查固定 SHA-256。
- 6,000 局合成來源先在記憶體建立，再以 `VACUUM INTO` 保存；後續真實 workerd、加密備份、還原與資料相等檢查保留。

三組隔離、最終 verify gate、負向案例、慢幀與延遲通知均保留。第一次快取會 miss，平台回報延遲也不受本地程式控制；實際遠端改善待新 CI 執行比較。
