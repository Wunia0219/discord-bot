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

`game-rules.js`／`.css` 提供馬戲團風格的「遊戲規則」，分為圖標賠率、得獎方式、操作與演出、試玩資訊四個分頁。共用既有圖集與實際倍率／WIN 門檻；`rules-example.js` 的 2×1×3 紅心示意交由正式算獎函式計算，依目前下注額顯示。手機採單欄圖標卡片，分頁支援左右方向鍵、Home／End，關閉後回到原入口。帳號簽到、收支與本機重設集中於試玩資訊。

圖片替換後需跑 `npm test`、`npm run build`，並檢查透明邊界、圖集 frame、橫直向、鍵盤焦點、得分及長位數餘額。
