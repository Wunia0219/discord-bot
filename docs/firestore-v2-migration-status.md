# Firestore v2 遷移進度

2026-10-23。**完整備份已驗證；雲端尚未匯入 v2，也尚未切換現有服務。** 遊戲版本仍為 0.2.6。

## 備份與保留資料

台灣時間 13:29 完成來源 Firestore 的一致性完整邏輯快照，SQLite 完整性檢查、帳本連續性、餘額、原回合／原請求與重建錢包比對通過。共 2 個錢包、774 筆帳本、758 局回合、772 筆原請求結果；帳本包含 6 筆簽到、5 筆發放、3 筆更正及 2 筆測試環境初始籌碼。

獨立保留目錄為 `backups/migrations/v2-20261023/`，不在自動備份清理範圍內，也不納入 Git：

- `source.sqlite` 與 `source.sqlite.meta.json`：完整資料及來源資訊。
- `original-v1-baseline.sqlite`：原 v1 遷移基準。
- `.env.server.v1-rollback.local`、`.env.firestore.v1-rollback.local`：原服務與管理工具設定。
- `.env.server.v2-prepared.local`、`.env.firestore.v2-prepared.local`：尚未啟用的 v2 設定，沿用原專案額度檔。
- `original-activity-server.json`、`manifest.json`：原服務身分、設定雜湊、讀寫估算與狀態。

`source.sqlite` SHA-256：`9a8af54b4876562bd35b5f22fec2ee365a6c47bb84a0f18ff76d58e36a933e0c`。

這是完整本機備份，尚非異地備份。原服務仍可接受新進度，所以這份快照是演練與保護用；真正切換前必須停止全部來源寫入，再取得當時最新快照。

## 暫緩切換的原因

目前限制是專案既有的 **24 小時滾動應用程式保護額度**，不是對 Google 帳單剩餘量的量測。完成本次備份時使用量為讀取 35,988／40,000、寫入 11,304／15,000；本次來源規模的 v2 匯入與完整驗證保守預留需要讀取 14,256、寫入 4,736，尚須另留最新備份、驗收與遊戲空間，因此不能安全啟動。

沒有提高上限、清空額度或替換額度檔。依當時記錄，若無其他新增用量，台灣時間 2026-10-24 11:57 後可釋出足夠空間；這只是估算，進場前仍需重新計算。

使用者已授權自動檢查與接續。此對話已建立 `Firestore v2 安全遷移與切換` 排程，每日台灣時間 12:10 檢查，首次為 2026-10-24。額度不足時維持原服務；足夠後取得最新完整快照、匯入新的空白 v2、逐筆驗證，再切換。完成後停用該排程；狀態未改變時不重複通知。

## 驗證與後續

實際備份演練使用官方本機模擬器及 `demo-jokers-circus`，不載入雲端憑證或雲端額度檔。重跑方式：

```powershell
$env:FIRESTORE_RESTORE_SNAPSHOT = (Resolve-Path backups/migrations/v2-20261023/source.sqlite).Path
npm run test:firestore
```

新增的 `tests/firestore-live-migration.integration.js` 逐項比對所有餘額、完整分頁紀錄、簽到與摘要，在 v2 及回退後的 v1 各重送全部原請求並要求零新增寫入；還會在隔離副本新增簽到與一局遊戲，備份後回退至新的 v1，檢查新進度與原去重均保留。早期 SQLite 精簡請求結果沿用原內容，不改寫成新版結果。

測試結果保存在 `test-results/firestore-live-migration-rehearsal.json`、`firestore-v2-live-rehearsal.log` 與 `firestore-v2-migration-unit.log`。最終切換仍需驗證真實目標的索引／IAM、實際 API、備份監控及 Discord 執行流程；模擬器不能替代真人 Discord 驗收。

本輪結果：302 項一般回歸及 40 項 Firestore 模擬器測試全部通過，無跳過。實際備份的 772 筆原請求在 v2／v1 各完整重送一次，共 1,544 次，均未新增寫入；回退後保留演練新增的簽到與回合，共 776 筆帳本、759 局、774 筆去重資料。這些新增進度只存在於模擬器。原服務 `/healthz` 與 `/readyz` 均回傳 200；原設定的 SHA-256 與封存副本一致。

使用者的整體收尾目標是功能完善且能在 Discord 實際運行後，做完整最終驗證與修復；每階段必要的資料安全與回歸檢查仍須先完成。功能範圍與未決項目依 [roadmap.md](roadmap.md) 持續更新。

## Discord 測試入口已啟用（後續更新）

2026-10-23 14:05 已啟用使用者指定的 #bot測試 Webhook、重啟原 v1 服務並完成新的公開通道／Portal 設定。28 項自動診斷通過，詳細操作見 [Discord 測試入口](discord-test-entry.md)。本輪完整備份在 `backups/discord-test-20261023`，仍為 2 個錢包、774 筆帳本、772 筆原操作、758 局，驗帳通過。

現行設定已新增公告憑證與群組，因此不再與最初封存設定具有相同 SHA-256；其餘後端設定經比對保持不變。原本 `v2-prepared` 檔案尚未包含此次公告設定，真正切換前必須從最新現行設定重新產生，不能直接用舊 prepared 檔覆蓋。自動接續已更新，會保留公告與派送額度並先停止遊戲／公告 writer，再取得最新含實測進度的快照。

## 回退條件

v2 尚未接受新寫入時，驗證保留的 v1 來源與設定後可恢復原服務。v2 已有新進度時，須先停止 v2 寫入、取得並驗證最新完整快照，匯入另一個新的 v1 命名空間並驗收後切回；**不能直接使用本目錄的舊快照或原 v1 namespace 接管新進度**。完整步驟見 [firestore-v2.md](firestore-v2.md)。
