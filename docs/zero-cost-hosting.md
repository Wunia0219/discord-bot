# 零費用雲端運行規劃

2026-10-23 使用者決定：不依賴持續開機的個人電腦，先維持零費用，接受必要的架構調整。此文件是待驗證的移植計畫，尚未開通、部署或替換現行 Firestore。

## 建議方向

以 **Cloudflare Workers Free＋SQLite-backed Durable Objects** 作為後端移植驗證候選，先保留 Firestore Spark／v2 的玩家資料契約。Workers Free 目前每日 100,000 請求、每次 10 ms CPU；Durable Objects 免費方案可用 SQLite 儲存，超出免費額度會使後續對應操作失敗。[Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)、[Durable Objects 免費額度與行為](https://developers.cloudflare.com/durable-objects/platform/pricing/)

備份目的地優先評估 **Google Drive 的既有免費空間**：一般個人帳戶 15 GB 與 Gmail／相簿共用，滿額會停止新增；僅上傳加密快照，金鑰另存。使用者尚未指定帳戶／資料夾，未上傳任何玩家資料。[Google 儲存空間規則](https://support.google.com/drive/answer/6374270?hl=zh-Hant)

R2 雖有免費用量，開通仍需要訂閱 checkout，超額按月計費，因此不作為本次「零費用、超額停止」的預設選擇。[R2 開通與計費](https://developers.cloudflare.com/r2/get-started/)

Render Free 閒置 15 分鐘會停止，且不能使用持久磁碟；目前原樣部署會失去本機共用額度檔，不能視為可直接採用的方案。[Render Free 限制](https://render.com/docs/free)

## 現有程式不能直接搬移的部分

| 現有依賴 | 移植要求 |
|---|---|
| Node HTTP server、Discord OAuth／簽章 | 對應 Worker Request／Response；完整保留授權、限流、私密回覆與簽章驗證 |
| Google Node SDK 的 Firestore 交易 | 先驗證 Worker runtime 相容性；必要時實作 REST 交易 adapter，原子性、重試與去重全部重跑 |
| 本機 `node:sqlite` 額度檔及全域互斥 | 以單一專案 Durable Object 維持持久、原子預留；不可用每個 Worker 自己的記憶體計數 |
| 記憶體 session／登入限流／短快取 | 明確設計跨請求及重啟的身分驗證、撤銷與限流，不讓不同 isolate 互相漏算 |
| `setInterval` 公告派送與 maintenance worker | 改為可恢復的雲端觸發器／alarm，保留持久事件、租約及不確定 POST 規則，不依賴常駐程序 |
| SQLite 完整備份與離線驗帳 | 現有 Node CLI 保留作恢復工具；雲端須設計可分批續跑且一致的快照／驗證流程，不把 763 局深度驗帳塞入單次免費請求 |

Worker 僅相容部分 Node API，不能把存在匯出名稱當成可執行的完整實作；必須依官方 runtime 文件及真實隔離測試核對。[Node 相容性](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)

## 下一階段驗收順序

1. 在隔離 namespace 完成 Discord PING／簽章、OAuth 與一筆 Firestore 唯讀交易，量測 CPU、子請求與冷啟動，決定 adapter 邊界。
2. 完成持久共用額度與失敗拒絕；本機／雲端切換需停止全部 writer，遷移尚未過期的原額度、儲存成長及維護／公告子額度。不能藉搬主機重置額度。
3. 搬移結算、session、公告及排程，重跑跨裝置、全部歷史、簽到、同請求去重、交易中斷、公告重啟與遷移回退測試。免費限制不足時縮減服務量或暫停，不自動轉付費。
4. 指定私有備份資料夾與雲端授權後，接上加密上傳、下載比對、隔離還原及失敗去重通知；通知目的地需另外指定，不沿用精彩得獎頻道發維運資訊。
5. 驗證免費方案及實際流量預算後，才切換 Discord 正式入口。固定公開網址及排程在這一步取代本機通道。

v2 遷移仍依原計畫在額度足夠後接續，不為了雲端移植跳過完整備份、驗證或回退；也不在未驗證時把玩家資料換成另一套資料庫。現有 Codex 12:10 自動檢查與本機服務仍需要此電腦開機，尚不是雲端排程。
