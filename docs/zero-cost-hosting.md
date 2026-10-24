# 零費用雲端運行與方案紀錄

> **2026-10-24 最新狀態：已切換 Cloudflare Workers Free。** 固定入口 https://jokers-circus.nini900219.workers.dev；Discord 根對應及互動端點已儲存。本機 writer 已停用，電腦不需持續開機。最新完整備份與雲端還原逐表比對通過。回退必須先釋放雲端 writer 並回傳原額度，詳見 [雲端手冊](cloud-runtime.md)。下方本機通道與早期規劃為歷史紀錄，以本段及雲端手冊為準。

2026-10-23 使用者決定不依賴持續開機的個人電腦，先維持零費用，接受必要的架構調整。10/24 已完成 Worker／REST、持久額度、加密 session、公告 alarm、可續跑備份、回退工具、實際部署與入口切換。工作區目前為 **0.2.7**，更新隱私頁與文件，並補齊唯讀維運摘要及獨立監控／通知模組；通知目的地依使用者選擇稍後設定，監控尚未部署。停輪沿用 [已驗收基準](reel-timing-baseline.md)，具體操作及發布狀態見 [雲端執行手冊](cloud-runtime.md)。

## 已採用方案與額外備份

已採用 **Cloudflare Workers Free＋SQLite-backed Durable Objects**，保留 Firestore Spark／v2 的玩家資料契約。帳戶已確認 Free／Active、沒有付款方式；免費額度不足時停止對應服務，不自動升級付費。實際用量及 CPU 容量仍需小群持續試玩觀察，限制以 [Workers 文件](https://developers.cloudflare.com/workers/platform/limits/)及 [Durable Objects 免費額度與行為](https://developers.cloudflare.com/durable-objects/platform/pricing/)為準。

Cloudflare 已保存與 Google Firestore 分開的加密備份，實際下載與隔離還原逐表比對通過。**Google Drive 的既有免費空間**可作額外獨立副本，尚未指定帳戶／資料夾或上傳資料；僅傳加密快照，金鑰另存，並受帳戶可用空間限制。[Google 儲存空間規則](https://support.google.com/drive/answer/6374270?hl=zh-Hant)

R2 雖有免費用量，開通仍需要訂閱 checkout，超額按月計費，因此不作為本次「零費用、超額停止」的預設選擇。[R2 開通與計費](https://developers.cloudflare.com/r2/get-started/)

Render Free 閒置 15 分鐘會停止，且不能使用持久磁碟；目前原樣部署會失去本機共用額度檔，不能視為可直接採用的方案。[Render Free 限制](https://render.com/docs/free)

## 已完成的移植對應

| 原本依賴 | 目前實作 |
|---|---|
| Node HTTP server、Discord OAuth／簽章 | 共用 `app-handler.js`，接入 Worker Request／Response，保留授權、限流、私密回覆與簽章驗證 |
| Google Node SDK 的 Firestore 交易 | Worker 使用 REST adapter，共用錢包核心；原子性、原請求互通及去重已有 workerd／emulator 回歸 |
| 本機 `node:sqlite` 額度檔及全域互斥 | 原三組額度已交接單一專案 DO，以持久狀態原子預留；不可重建物件重設預算 |
| 記憶體 session／登入限流／短快取 | 加密 session 及限流狀態持久保存，重啟驗證已覆蓋；快取不代替權威交易 |
| `setInterval` 公告派送與 maintenance worker | DO alarm 保留持久事件、租約及不確定 POST 規則，不依賴本機常駐程序 |
| SQLite 完整備份與離線驗帳 | 雲端固定 readTime 分批續跑，驗帳後加密發布；下載與隔離恢復已驗證，Node CLI 保留作恢復工具 |

Worker 僅相容部分 Node API，不能把存在匯出名稱當成可執行的完整實作；必須依官方 runtime 文件及真實隔離測試核對。[Node 相容性](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)

## 上線後仍需完成的驗收

1. 首次跨日自動備份含新增遊玩進度的下載、隔離還原及原請求去重驗收；先保留自動執行證據，不用手動備份代替。
2. 加密恢復金鑰存至使用者可取回的獨立私密位置，記錄備份可接受落後時間與實際恢復時間。
3. 真人手機／電腦雙向同步、背景切回、斷線恢復與自然大獎公告；已驗收的停輪體驗維持不變。
4. 接入不依賴個人電腦的外部故障通知，接收位置另行指定，不沿用精彩得獎頻道發維運資訊。Google Drive 副本可另作後續加強。
5. 小群持續試玩的 CPU、連線、首次載入、記憶體及免費用量觀察；不能把隔離資料庫並行測試當作真人容量驗收。

v2 遷移與雲端切換已於 10/24 完成，原每日遷移接續排程已刪除。現行服務使用同一 v2 權威資料、唯一雲端 writer 與原額度；回退仍須先 pause、完成最新備份、export/release、還原驗證及回傳原額度，不能直接重啟舊本機服務。完整收尾條件統一見 [收尾計畫](roadmap.md)。
