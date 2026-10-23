# Discord 實測入口與回退

2026-10-23，0.2.6。已啟用本機 4188 服務、臨時 HTTPS 通道及「記事小本本 → #bot測試」專用精彩得獎 Webhook。資料仍使用 `slot-game-203db / jokers-circus-test` 的 Firestore v1；尚未切換 v2。

## 開始測試

1. 在 Discord 開啟「記事小本本 → #bot測試」。關閉舊 Activity，再從應用程式啟動器選擇「🎲命運荷官」重新開啟。
2. 先確認餘額、最近紀錄及今日簽到狀態；可比對 `/籌碼`，並測試 `/簽到` 與遊戲簽到是否一致、同一天不能重複入帳。
3. 小量操作後，關閉重開並在手機／電腦比對同一帳號的進度；接著驗收音效、AUTO 與背景切回。真實測試會正常保存遊戲進度。
4. 自然出現 SUPER（至少總下注 30 倍）／MEGA（至少 100 倍）時，在 #bot測試 查看公告：10 秒內嘗試更新，10 分鐘合併一張卡，顯示最近 5 次。沒有大獎就沒有公告，不必為驗收大量刷局。

公開測試依賴這台電腦、4188 程序及 cloudflared 持續運行；休眠、關機或關閉通道會中斷入口。最新網址與程序身分以 `.tools/activity-tunnel.json`、`.tools/activity-server.json` 為準，不把臨時網址當固定正式部署。

## 已核對

- Activity 根對應及 Interactions Endpoint 已儲存為目前通道；端點儲存通過 Discord 的連線驗證。
- Activity 啟用，網頁／iOS／Android 均勾選，OAuth redirect 為 `https://127.0.0.1`。
- APP_HANDLER 入口及三個群指令定義正確；無需重新註冊或安裝。
- 使用者提供的 Webhook 已經 GET 核對為指定群與 #bot測試，名稱「Joker’s Circus 精彩得獎」。只存在後端 `.env.server.local`、`.env.firestore.local` 及私密設定備份中，未放入前端或版本庫；沒有另建第二個 Webhook。
- 重啟後 `discord:check -- --discord --public-origin <目前網址>` 的 28 項檢查全部通過。這不代表真人雙裝置及實際大獎卡片已驗收；未製造假回合或發測試公告。

## 額外的公告傳輸與呈現驗收

使用者另行授權後，已直接透過專用 Webhook 發送一張「測試公告｜非真實得獎」卡片，含 SUPER 30×／MEGA 100× 兩筆虛構排版範例。Discord 接受訊息且 GET 讀回的頻道、內容、標題及欄位均一致；沒有提及任何玩家或推播通知。本測試不載入錢包、Firestore 或公告佇列，不建立回合、不改餘額／簽到，也不計入真實公告統計。

測試訊息 ID 為 `1563073591967354941`，結果保存在 `test-results/discord-marked-webhook-test.json`。一次性腳本遇到已有紀錄會拒絕重送；回應不明也不盲目重送。此項驗收只涵蓋 Webhook 傳輸與卡片，不取代自然大獎到持久佇列的真人端到端驗收。

瀏覽器已確認卡片完整顯示，截圖為 `test-results/discord-marked-webhook-test.png`。

## 備份

本輪啟用前完整備份與驗帳通過：2 個錢包、774 筆帳本、772 筆原請求結果、758 局、0 筆公告。封存在 `backups/discord-test-20261023/source.sqlite`，SHA-256：`54c3b7c361df9fc6f7ff4d6e073bd22a56b1b9e87091bc6cbe6c4dc32bd18e78`。這份備份是 14:01 的一致快照，後續測試進度必須另取最新備份，不能覆寫回此舊快照。

同資料夾保留修改前環境檔、程序資料、`portal-before.json`、修改後 `portal-after.json` 與目前設定／程式副本。內含密鑰，整個資料夾受 Git ignore 保護，不上傳或分享。

## 回退方式

以下兩個本機腳本預設只顯示預覽，加 `-Apply` 才執行：

```powershell
# 暫停公告：備份當前設定，只清空公告 Webhook 並重啟已核對身分的 4188 服務。
# 保留目前 namespace、所有遊戲／公告資料及所有額度檔，不接回舊資料庫。
.tools/disable-discord-highlights.ps1 -Apply

# 關閉公開測試：核對程序路徑、啟動時間及目標後，只停止本專案通道。
# 本機服務與資料仍保留，Discord 暫時無法連入。
.tools/close-discord-public-test.ps1 -Apply
```

恢復公告時，從此次停用所產生的私密設定備份取回 Webhook 欄位，核對群與頻道後重啟；不要整份覆蓋可能已完成 v2 遷移的新設定。恢復公開測試時，先確認舊通道是否仍在運作；若已停止，執行 `.tools/start-discord-public-test.ps1`，取得新網址後更新 Portal 的根對應與互動端點並重新檢查。舊網址已關閉，單純貼回 `portal-before.json` 的舊網址不能恢復服務。

## v2 接續

10/24 12:10 的自動檢查仍保留。原專案與維護額度檔不變，新增公告派送子額度 `.highlights.sqlite` 也須保留。測試會繼續消耗剩餘保護額度；目前可測試，但尚不足以完整遷移。到達上限時，服務會拒絕新操作並提示稍後重試，不能提高上限或清零繞過。

真正切換前，先停止遊戲寫入及公告派送器、取得最新含公告的完整快照。封存的 v2 prepared 設定早於本輪 Webhook 啟用，必須從最新設定重新準備，保留 Webhook、共用額度、維護及公開入口設定。v2 產生新進度後要回退，依 [遷移流程](firestore-v2.md)將最新快照匯入新的 v1 namespace，不能回到此處封存的舊資料。
