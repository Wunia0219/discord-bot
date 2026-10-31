# 正式服交付

產品版本 **1.0.1**；發行分支為 `main`。Git 合併／推送與 Cloudflare 部署是分開的步驟，CI 不會自動部署。線上版本與來源以本頁發布紀錄及健康檢查為準。

## 2026-10-31：1.0.1 已部署

遊戲 Worker `edcc3d19-0c9c-4a35-9e1f-6fcb8674bf4c`、監控 Worker `ff5ecfe4-baf7-4df3-b1e0-bbda0623f6ea` 均已發布為 1.0.1 並立即更新 DO。正式 `/healthz`、`/readyz`、前端資源雜湊、原 namespace／綁定及監控通知設定核對通過；產品沿用停輪基準、P/R 編號與每局 4 寫策略，額度仍為 notify-only。

減少登入狀態重複加密／保存與到期索引更新，支援 Free／Paid 設定及對應的 writer 啟用確認；本次沒有建立 Paid 訂閱，部署標記維持 free。費率、實測及切換條件見[Cloudflare 費用與優化](cloudflare-costs.md)。

上述發布的本機 `verify:ci` 14／14 通過；證據在 `test-results/cloudflare-101/`。來源已由使用者提交至 `modify` 的 `5103b4a`。新增外部預警與精簡整理屬後續工作目錄變更，不能將舊發布視為已包含本次修改；本機、遠端 CI 與真人驗收分別記錄。

## 合併準備：用量預警與整理

新增 GitHub 外部 Cloudflare 用量預警，共用安全的 Discord 發送處理；精簡重複註解、部署紀錄及費用說明。版本維持 1.0.1，玩法、帳本與已部署策略不變。合併前完整驗證結果以 `test-results/verification.json` 為準；設定與啟用步驟見[用量預警](monitoring.md)。排程需 main 與專用 Secrets，CI 不會自動部署 Cloudflare。

Firestore 舊相依支線已移除造成六項中度警示的間接套件，全新 `npm ci` 稽核為零漏洞；版本選擇與維護方式見[相依修正](security.md#firestore-相依修正)。GitHub／Netlify 的最終結果以同一提交的 PR 檢查為準。

2026-10-31 已由 GitHub API 核對兩項 Secrets 名稱存在，`CF_ACCOUNT_ID` 與正式帳戶一致；Secret 內容無法讀回，權限須於合併後實際執行 workflow 驗證。預設分支目前尚無此 workflow，因此尚未啟用外部排程。

## 正式配置

| 項目 | 設定 |
|---|---|
| 入口／Worker | `https://jokers-circus-production.nini900219.workers.dev`／`jokers-circus-production` |
| Discord 群／遊戲與指令頻道 | `1503958213454856252`／`1565731918107115690` |
| 指令 | `/戲籌`、`/戲籌管理`；管理操作限授權身分 |
| 資料庫 | Firebase `jokers-circus-production`，Standard Firestore `(default)`，台灣 `asia-east1` |
| 帳本 namespace | `jokers-circus-v2-20261030-production`，schema v2 |
| 執行方式 | Cloudflare Free／SQLite DO，Firebase Blaze（2026-10-31 使用者確認）；雲端唯一 writer，本機 `FIRESTORE_LIVE_ENABLED=false` |
| 監控 | `jokers-circus-monitor` 每十分鐘；外部用量預警設定項目已核對，待 main 啟用；[維護頻道](https://discord.com/channels/1441097301685698703/1564187899019141140) |

Bot 使用 REST 發送 BIG／SUPER／MEGA 及出入場公告，正文僅標記對應玩家，不維持 Gateway 綠燈；遊戲與管理指令採 HTTP interactions。圖文、帳目口徑與用量限制見[賭場公告](casino-announcements.md)。

## 發布紀錄

| 2026-10-31 發布 | 遊戲／監控版本 ID | 證據 |
| --- | --- | --- |
| 精簡結算／P-R 編號，啟用於原 nextId 1555 | `ed978184-955e-46fa-a231-98d29fa87cd6`／`89a2abdf-5e20-4459-a85c-f626563eb33e` | `test-results/db-write-optimization-20261031/` |
| Firestore notify-only 熱修 | `c33d471a-8f5b-4ba0-a174-9ccb864f8024`／`c3108c26-6d28-48fb-8686-af912a0d7007` | `test-results/hotfix-20261031/`、`backups/hotfix-quota-20261031/` |
| 先前整理版 | `1f31b888-c2b2-4a7c-815f-f6ace5d61748`／`27fe8fe9-8956-4465-80ee-9338cad726f7` | `test-results/release-cleanup-*` |

舊記錄保留於 Git 與上述本機證據；不是可直接回復的安全版本清單。啟用過精簡結算後，必須使用[相容版本與回復程序](settlement-storage.md#啟用與回復)，不得重新 seed、重編帳本或重設用量。Firestore 只告警已在隔離 workerd 驗證超額、重送、重啟與還原；沒有使用真實玩家下注測試。

## 帳本與憑證

- 2026-10-30 依使用者授權，以全新正式帳本切換營運；測試餘額、簽到及歷史未移入。正式與測試資源、憑證分離，舊測試環境保留。
- 正式服務帳號 `circus-wallet-production@jokers-circus-production.iam.gserviceaccount.com` 使用已核准的 `roles/datastore.user`；Firestore 規則拒絕用戶端直接讀寫。
- 金鑰存入 Worker Secrets 與 `C:/Users/nini9/.config/jokers-circus-production/`，目錄限目前使用者及 SYSTEM；不得加入版控。帳本更新不能重新 seed 或重設持久額度。
- 初次空白帳本的加密備份已解密、驗帳並還原至隔離 SQLite，證據在 `backups/production-cutover-20261030/empty-baseline-restore-verified/`；這不等於已驗證正式玩家交易重播。
- 以一個客戶群、60 錢包及 5 人並行做隔離驗證；不是連線上限或實際雲端延遲保證。恢復範圍以最後成功快照為準，模擬器耗時不是正式 RTO。

## 合併與使用前確認

1. 完成[自動測試](testing.md)，保留[停輪基準](reel-timing-baseline.md)。提交須包含程式、測試、文件及公告素材，不包含憑證或本機資料。
2. 核對最新 `main` 的差異與合併結果，合併後以該提交的 GitHub CI 為準。
3. 正式環境確認真人登入、新手戲籌只發一次、簽到、下注、重連、跨裝置與入離場；手機音效及通知仍需真人驗收。
4. 確認備份與金鑰可取回、最新備份可解密驗帳，並確認監控目標與告警目的地。

日常操作見[部署](deployment.md)，事故處理見[恢復](recovery.md)，資料保護見[資安](security.md)。歷史發布細節保留於 Git 紀錄及本機驗證／切換證據，不在此重複列出過期部署狀態。
