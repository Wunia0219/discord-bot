# Blaze 啟用後的費用限制

2026-10-26 使用者表示已完成 Blaze 設定，並明確要求實作與設定期間先避免消耗付費額度。可評估日後小額付費，不等於已授權提高用量上限或開通付費資源。

本次以 Google Cloud 控制台唯讀查核 `slot-game-203db`：專案連到「Firebase 付款」帳單帳戶，總覽標示「付費帳戶」，當月顯示總費用 $0.00。核發的抵免額頁顯示「沒有可顯示的抵免額」；不能假定存在 US$300。費用頁提示資料可能延遲數小時甚至超過 24 小時，畫面零費用不代表尚未入帳的用量一定為零。未變更帳戶、申請抵用金或設定任何付費服務。

## 實作約束

- 保留原全專案讀取 40,000、寫入 15,000、維護讀取 6,000、公告讀取 3,000 等原保護上限及其歷史計數。不得因升級 Blaze 重設、換檔或提高上限。
- 負載與破壞性情境使用本機模擬器；線上查核採必要的唯讀操作。不得為測試製造真實遊玩紀錄。
- 不啟用 Firestore 原生付費備份／PITR、額外付費運算或其他付費服務。既有自製 Cloudflare 備份沿用原設定。
- `CLOUD_PLAN=free` 指 Cloudflare 運行條件，不因 Firebase Blaze 改成 paid。
- 使用量保護是應用程式估算，不是 Google 帳單硬上限；其他工具、其他 writer、儲存與索引等仍須查官方用量。預算提醒不能當作停止扣費的保證。
- US$300 為符合資格者的 Google Cloud Free Trial 抵用金，通常有效 90 天，並非每次升級 Blaze 自動贈送。未看到實際核發、剩餘值與有效期限前，按沒有抵用金規劃。

參考：[Firebase 方案](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)、[Google Cloud 試用資格](https://cloud.google.com/signup-faqs)、[預算提醒](https://firebase.google.com/docs/projects/billing/budget-alerts)。
