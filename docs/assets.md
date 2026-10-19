# 素材與畫面維護

## 執行素材

- `images/main.webp`＋`main.json`：機台框、Logo、按鈕及大獎素材。圖集匯出 scale 為 0.5，程式直接使用 frame 像素座標。
- `images/symbols.webp`＋`symbols.json`：九種圖標；保留原始透明留白。穩定數學代碼與圖標名稱集中在 `src/game/symbols.js`。
- `images/fonts/circus-gold.webp`＋`.fnt`：HUD、大獎共用的金色數字，含逗號及正負號，DOM 保留可讀文字。
- `images/fx/circus-win-frame.webp`：紅金得獎外框。
- `images/jokers-circus/circus-background.webp`：背景。

同目錄 PNG 是可編修的母檔，保留供重新匯出。`npm run assets:webp` 以原尺寸編碼；圖集、字體與外框無損，背景品質 90。壓縮檢查資料輸出至被忽略的 `test-results/`。

`scripts/assets/build-circus-font.py` 用 Windows 的 Georgia Bold 產生數字圖集；字型檔不打包進專案。Python 素材工具需要 Pillow，遊戲建置與伺服器執行只需要 Node。

## 構圖與互動

桌面以 1160×824 的整組機台與單排控制列等比例縮放；手機依方向使用直向多排或橫向配置。Discord platform 優先於瀏覽器輸入裝置判斷，安全區與方向解鎖集中在 `responsive-layout.js`。

每輪向下移動且速度不受輪帶長度影響。`presentation.js` 管理減速、960ms 雙彈動及每 1.6 秒輪播的得獎圖標；`scene.js` 依結算資料中的 cells 標示所有有效格子，不再套用固定賠線。

`spin-controls.js` 集中處理空白鍵快停、自動開轉及取消佇列；錢包與算獎不依演出速度改變。AUTO SPIN 會等候跳分或大獎演出，開啟視窗或切離頁面時停止。減少動態效果時簡化演出；音效需手動啟用。

`game-rules.js`／`.css` 提供馬戲團風格的「遊戲規則」，分為圖標獎勵、得獎方式、操作說明三個分頁。共用既有圖集與實際倍率／WIN 門檻；圖標獎勵換算為當前下注的每組籌碼，`rules-example.js` 的 2×1×3 紅心示意交由正式算獎函式計算。手機採單欄圖標卡片，分頁支援左右方向鍵、Home／End，關閉後回到原入口。理論返還率與最高獎勵放於操作說明下方的「更多遊戲資訊」，頁尾顯示遊戲版本。

`player-bar.js`／`player-ui.css` 管理主畫面的 Discord 頭貼、名稱、完整 ID、簽到與遊玩紀錄入口；桌面帳號區、簽到及工具列共用高度，工具按鈕為等寬方形；手機分成帳號／簽到及工具兩列。頭貼沿用已授權的 `avatar`，以 `discord-avatar.js` 建立官方 CDN 圖片網址；缺少頭貼或載入失敗時保留本機圖示，同一張圖不會因開轉或餘額更新而重新載入。`player-copy.js` 統一簽到狀態與玩家提示，不直接顯示 SDK 或後端錯誤。`player-records.js` 提供可展開的遊玩紀錄，隱去停點、內部規則代碼和交易類型；玩家工具列不提供籌碼收支。簽到領取中會鎖住開轉，開轉中則不能簽到，避免餘額顯示互相覆蓋。

圖片替換後需跑 `npm test`、`npm run build`，並檢查透明邊界、圖集 frame、橫直向、鍵盤焦點、得分及長位數餘額。
