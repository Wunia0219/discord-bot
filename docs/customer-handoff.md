# 正式服交付

產品版本 **1.0.1**；發行分支為 `main`。Git 合併／推送與 Cloudflare 部署是分開的步驟，CI 不會自動部署。線上版本與來源以本頁發布紀錄及健康檢查為準。

## 2026-10-31：1.0.1 已部署

遊戲 Worker `edcc3d19-0c9c-4a35-9e1f-6fcb8674bf4c`、監控 Worker `ff5ecfe4-baf7-4df3-b1e0-bbda0623f6ea` 均已發布為 1.0.1 並立即更新 DO。正式 `/healthz`、`/readyz`、前端資源雜湊、原 namespace／綁定及監控通知設定核對通過；產品沿用停輪基準、P/R 編號與每局 4 寫策略，額度仍為 notify-only。

減少登入狀態重複加密／保存與到期索引更新，支援 Free／Paid 設定及對應的 writer 啟用確認；本次沒有建立 Paid 訂閱，部署標記維持 free。費率、實測及切換條件見[Cloudflare 費用與優化](cloudflare-costs.md)。

本機完整 `npm run verify:ci` 14／14 通過：一般測試 463 通過、1 份需人工提供來源的歷史快照測試略過；資料庫／workerd 76 通過、2 份真實來源遷移案例略過；獨立監控 1 通過。所有隔離資產、慢幀、安全與恢復檢查通過。本次新版遠端 CI 未執行，需提交／推送後驗證快取改善。改動留在 modify 工作目錄，未提交、推送或合併 main。

## 正式配置

| 項目 | 設定 |
|---|---|
| 入口／Worker | `https://jokers-circus-production.nini900219.workers.dev`／`jokers-circus-production` |
| Discord 群／遊戲與指令頻道 | `1503958213454856252`／`1565731918107115690` |
| 指令 | `/戲籌`、`/戲籌管理`；管理操作限授權身分 |
| 資料庫 | Firebase `jokers-circus-production`，Standard Firestore `(default)`，台灣 `asia-east1` |
| 帳本 namespace | `jokers-circus-v2-20261030-production`，schema v2 |
| 執行方式 | Cloudflare Free／SQLite DO，Firebase Blaze（2026-10-31 使用者確認）；雲端唯一 writer，本機 `FIRESTORE_LIVE_ENABLED=false` |
| 監控 | `jokers-circus-monitor`，每十分鐘；[維護頻道](https://discord.com/channels/1441097301685698703/1564187899019141140) |

Bot 使用 REST 發送 BIG／SUPER／MEGA 及出入場公告，正文僅標記對應玩家，不維持 Gateway 綠燈；遊戲與管理指令採 HTTP interactions。圖文、帳目口徑與用量限制見[賭場公告](casino-announcements.md)。

## 發布紀錄

### 2026-10-31 額度熱修

正式服因應用程式的 24 小時寫入估算達 15,000／15,000 而持續拒絕下注。使用者明確授權超過免費額度後繼續付費營運，並確認正式 Firebase 已啟用 Blaze。正式服務與公告／備份的額度已切換為 `notify-only`：以完整免費額度作告警參考，八成只通知、超過不攔截，保留全部既有用量、帳本與原 request ID。月流量持久累計，監控維持每十分鐘與原維護頻道，同一警示不重複發送。產品仍為 **1.0.0**，玩法與已驗收停輪不變。

| 項目 | 本次結果 |
|---|---|
| 遊戲版本 ID | `c33d471a-8f5b-4ba0-a174-9ccb864f8024`，100% 流量；以官方 immediate 更新策略確認 DO 已生效 |
| 監控版本 ID | `c3108c26-6d28-48fb-8686-af912a0d7007`，100% 流量；原十分鐘排程與綁定保留 |
| 本機驗證 | 基礎 `verify:ci` 14/14；最終一般回歸 457 通過、1 項原條件略過；追加服務 CI 組 5/5 通過 |
| 超額驗證 | 隔離 workerd 在寫入估算超過 20,000 後仍成功結算，重播、冷啟動與備份恢復通過；80% 至 150% 同一警示只通知一次 |
| 正式核對 | `/readyz` 200、`notify-only`／`blocked:false`、首頁及入口 JS/CSS 符合本次建置；遊戲與監控的原綁定保留 |
| 套用時用量 | 保留寫入估算 16,460，為免費參考線的 82.3%；維運呈提醒，沒有攔截遊戲 |
| 來源與遠端 CI | `modify` 基底 `4eabffb` 加本次工作目錄變更；尚未提交、合併、推送或執行本次遠端 CI |

本次證據位於 `test-results/hotfix-20261031/`，發布前程式／設定快照在 `backups/hotfix-quota-20261031/`。初次服務測試把整體維運級別誤當成額度級別，已改成精確比對 `QUOTA_*` 警示，仍會拒絕錯誤的額度耗盡告警；原失敗報告保留，修正後服務全組通過。未建立正式測試下注或發送公開測試通知。服務帳號未獲擴權，Blaze 狀態由使用者在後台確認；應用用量為保守估算，不能取代供應商帳單。操作與告警口徑見[部署與維運](deployment.md)。

### 先前同日整理版

2026-10-31 先前已發布整理版，當時來源為 `modify` 基底 `3622f50` 加工作目錄變更，尚未提交、合併或推送。該次玩法、停輪、帳本、額度與版本不變。

| 項目 | 本次結果 |
|---|---|
| 遊戲部署 ID | `1f31b888-c2b2-4a7c-815f-f6ace5d61748` |
| 監控部署 ID | `27fe8fe9-8956-4465-80ee-9338cad726f7`，維持十分鐘排程 |
| 完整本機驗證 | `verify:ci` 14/14 通過；既有需正式資料的兩項整合案例依原設定略過 |
| 相依稽核 | `npm audit --audit-level=high`：0 漏洞 |
| 公告相容性 | 19 組新舊輸出完全相同；兩項新增頁面返回競態測試可抓出舊版錯誤 |
| 正式檢查 | health／ready／維運、Discord 指令與頻道、監控目標正常；首頁、入口 JS/CSS、隱私頁與公告圖片雜湊符合本次建置 |
| 合併基礎 | 已 fetch 遠端 `main`（`0742798`）；它是目前 HEAD 的祖先，檢查時沒有分岔提交。合併前仍以最新遠端狀態為準 |

本機證據位於 `test-results/release-cleanup-*`：`verification.json`、`audit.json`、`payloads.json`、`negative.log`、`production-status.json`、`discord-readiness.json`、`monitor-live.json`、`frontend-live.json` 與 `assets-live.json`。先前中止的驗證另存 `superseded*`，不列入本次通過結果。沒有發送公開測試訊息或建立正式測試下注。

本機測試、遠端 CI 與真人驗收各自報告。不可因本機通過就宣稱 main 已合併或 GitHub CI 通過。

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
