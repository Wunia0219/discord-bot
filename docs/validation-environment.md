# 分支隔離驗收環境

2026-10-26，產品版本 0.2.7。目前於 `validation` 分支開發，未由本次工作提交或推送。

```powershell
npm run validation:start
```

啟動後開啟 <http://127.0.0.1:4192/wallet-test>，從驗收頁選擇測試玩家。遊戲直達網址為 <http://127.0.0.1:4192/?wallet=local&player=qa-a>。

| 帳號 | 初始戲籌 | 用途 |
|---|---:|---|
| qa-a | 10000 | 簽到、下注、重新整理與快停 |
| qa-b | 10000 | 第二帳號資料隔離 |
| qa-low | 50 | 餘額不足 |
| qa-zero | 0 | 無戲籌及簽到恢復 |

初始值只設定一次，重啟不重設餘額、簽到或遊玩紀錄。進度保存在忽略 Git 的 `data/validation/wallet.sqlite`；要保存測試進度，先正常停止服務後連同 SQLite sidecar 檔保存。這些是虛構帳號，不是正式資料的恢復副本。

啟動器不載入 `.env`；建置前移除繼承的 `VITE_*`，明確關閉 Discord 驗證與雲端錢包選項。後端只接收明確建立的本機錢包設定，外部 fetch 直接拒絕；不配置 Discord、Firestore、Webhook 或雲端管理憑證。只監聽 127.0.0.1:4192，拒絕轉送標頭與外站 Origin。4192 被使用時會失敗，不關閉其他服務或換成公開入口。

前端輸出至 `test-results/validation-dist`，不覆蓋正式部署用的 `dist`。請在專案根目錄執行，使用 Ctrl+C 正常停止。本機測試需要電腦開機；既有雲端遊戲、備份與監控不依賴此程序。

## 測試範圍

```powershell
npm run validation:test
npm test
npm run test:cloud
npm run test:monitor
```

本機入口使用實際 SQLite 結算、帳本、原請求去重及遊玩紀錄。Firestore／workerd 相容性由官方模擬器獨立驗證，不建立新的線上 namespace 或重設額度。

10/26 驗證：25 項選定測試通過；一般測試 352 通過、1 項條件跳過；3 項 Firestore REST／workerd 整合測試與 1 項監控 workerd 測試通過。實際新啟動器 readiness、四帳號概覽、同請求原結果／餘額／revision 不重複、第二帳號隔離、Discord endpoint 關閉及轉送拒絕通過。證據：`test-results/validation-launcher-smoke.json`、`test-results/validation-full-tests.log`。

這不代替真人 Discord OAuth、手機雙裝置同步、自然大獎派送或完整服務災難恢復演練；剩餘事項見 [收尾計畫](roadmap.md)。已驗收停輪設定不變。

本次實際入口 smoke test 已替 qa-a 留下 1 局虛構測試紀錄，qa-b／低餘額／零餘額帳號未遊玩。原測試進度保留，未為讓 W01 看起來全新而清空資料；需要全新一輪時另建測試資料目錄。
