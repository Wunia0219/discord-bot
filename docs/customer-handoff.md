# 正式服交付

正式遊戲與監控版本 **1.0.2**，發行分支 `main`。2026-10-31 已由本機驗證產物部署；使用者另行 commit／merge，遠端 CI 尚未驗證本次修改。CI 不會自動部署。

## 方案與發布

2026-10-31 使用者確認 Cloudflare **Workers Paid**；Firebase **Blaze** 已確認。Firestore 保留 `notify-only`、八成提醒、P/R 編號及一般每局 4 寫；動畫與冷卻沿用[停輪基準](reel-timing-baseline.md)。

本次整理包含共用設定、Cloudflare runtime／Firestore 歷史查詢分工、維運腳本分類與 Paid 監測文案。正式遊戲與監控皆已部署，100% 流量使用新版；`paid` 標記、原有 Secrets／DO 綁定與 Firestore 來源均核對通過。外部 GitHub 用量排程的修改待 merge 至預設分支後生效，以 Actions 執行結果為準。

本機 `verify:ci` **14／14 通過**；部署後 health／ready、備份、前端入口與引用資源雜湊及 Discord 20 項自動檢查通過。正式 writer 為 active，保留部署前已存在的 `QUOTA_HIGH` 提醒（Firestore 保守估算，非實際帳單）；`notify-only` 且 `blocked=false`，沒有 critical 告警。真人登入／遊玩驗收未包含在自動檢查內。

| 已記錄的發布 | 遊戲／監控版本 ID | 本機證據 |
|---|---|---|
| 2026-10-31：1.0.2（目前） | `f33dd347-7141-4df2-ae1a-ee3e1a18d76e`／`527f5b0d-ff15-4dc0-bf0d-a7bdab5b02ca` | `test-results/release-1.0.2/`：完整驗證、部署前後綁定與正式入口核對 |
| 本次部署前：1.0.1 | `a36d8e1c-aee3-4d63-80ea-5982f9abcd52`／`191111f2-7eb9-4a42-85c0-fca73592aa43` | 同目錄的 `*-version-before.json` 與 `status-before.json` |
| 精簡結算最早相容版 | `ed978184-955e-46fa-a231-98d29fa87cd6`／`89a2abdf-5e20-4459-a85c-f626563eb33e` | `test-results/db-write-optimization-20261031/`；啟用時 nextId 1555 |

本機驗證看 `test-results/release-1.0.2/verify-ci.json`，正式核對看同目錄 `verification.json`；這些證據不進版控。遠端 CI 須另外核對最終 commit。歷史版本不作為可直接回退清單；回退必須保留[新舊格式相容性](settlement-storage.md#啟用與回復)。

## 正式配置

| 項目 | 設定 |
|---|---|
| 入口／Worker | `https://jokers-circus-production.nini900219.workers.dev`／`jokers-circus-production` |
| Discord 群／頻道 | `1503958213454856252`／`1565731918107115690` |
| 指令 | `/戲籌`、`/戲籌管理`；管理操作限授權身分 |
| 資料庫 | `jokers-circus-production`，Standard Firestore `(default)`，台灣 `asia-east1` |
| namespace | `jokers-circus-v2-20261030-production`，schema v2 |
| writer | 雲端唯一 writer，本機 `FIRESTORE_LIVE_ENABLED=false` |
| 監控 | `jokers-circus-monitor` 每 10 分鐘；[外部用量設定](monitoring.md)；[維護頻道](https://discord.com/channels/1441097301685698703/1564187899019141140) |

Bot 用 REST 發送大獎與出入場公告，不維持 Gateway 綠燈；遊戲／管理指令走 HTTP interactions。詳見[公告](casino-announcements.md)。

## 資料與交付條件

- 正式帳本於 2026-10-30 以全新來源啟用，未帶入測試餘額／簽到／歷史；測試資源保留。更新不得重新 seed、重編帳本或重設用量。
- 服務帳號 `circus-wallet-production@jokers-circus-production.iam.gserviceaccount.com` 使用 `roles/datastore.user`；Firestore 規則拒絕用戶端直接存取。
- 金鑰保存在 Worker Secrets 與 `C:/Users/nini9/.config/jokers-circus-production/`，目錄限目前使用者及 SYSTEM；不得進版控。
- 初次空白帳本備份已做隔離還原，證據在 `backups/production-cutover-20261030/empty-baseline-restore-verified/`；這不等於正式玩家交易重播驗收。
- 隔離測試涵蓋單群、60 錢包與 5 人並行，不能當作連線容量或正式 RTO 保證；恢復以最後成功快照為準。

發布前完成 [verify:ci](testing.md)、檢查提交與部署版本一致、保留原綁定／Secrets，再核對 health／ready／備份。真人登入、跨裝置、新手只發一次、簽到、下注、出入場及手機音效仍需實機驗收。

日常操作見[部署](deployment.md)，事故處理見[恢復](recovery.md)，憑證與相依維護見[資料保護](security.md)。
