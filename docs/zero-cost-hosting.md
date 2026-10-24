# 零費用雲端運行規劃

2026-10-23 使用者決定：不依賴持續開機的個人電腦，先維持零費用，接受必要的架構調整。10/24 已完成 Worker／REST、持久額度、加密 session、公告 alarm、可續跑備份與回退工具的本機實作及隔離測試。尚未開通 Cloudflare、部署或替換現行服務；具體設定與安全切換見 [雲端執行手冊](cloud-runtime.md)。

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

## 雲端上線仍需完成的驗收

1. 隔離 workerd／Firestore emulator 已通過；登入 Free 帳戶後，驗證實際 Google／Discord 連線、CPU、子請求、資產與冷啟動。
2. 持久共用額度與失敗拒絕已實作；本機／雲端切換需停止全部 writer，遷移尚未過期的原額度、儲存成長及維護／公告子額度。不能藉搬主機重置額度。
3. 結算、session、公告、alarm 及隔離回退測試已完成；上線時再驗實際服務及真人跨裝置。免費限制不足時縮減服務量或暫停，不自動轉付費。
4. Durable Object 加密快照、下載與本機還原已實作；部署後實際驗證 Cloudflare 與 Firestore 分開保存的備份。額外 Google Drive 副本與外部故障通知仍需指定帳戶／位置；通知目的地需另外指定，不沿用精彩得獎頻道發維運資訊。
5. 驗證免費方案及實際流量預算後，才切換 Discord 正式入口。固定公開網址及排程在這一步取代本機通道。

v2 已於 10/24 完成最新快照、完整驗證與切換，原每日接續排程已刪除。現有 v2 入口仍需此電腦開機；雲端尚未部署。新方案保留同一 v2 權威資料，不能跳過停止 writer、最新備份、原額度交接與回退檢查。
