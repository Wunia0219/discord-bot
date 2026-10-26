# 素材與畫面維護

## 執行素材

- `images/main.webp`＋`main.json`：機台框、Logo、按鈕及大獎素材。圖集匯出 scale 為 0.5，程式直接使用 frame 像素座標。
- `images/symbols.webp`＋`symbols.json`：九種圖標；保留原始透明留白。穩定數學代碼與圖標名稱集中在 `src/game/symbols.js`。
- `images/fonts/circus-gold.webp`＋`.fnt`：HUD、大獎共用的金色數字，含逗號及正負號，DOM 保留可讀文字。
- `images/fx/circus-win-frame.webp`：紅金得獎外框。
- `images/jokers-circus/circus-background.webp`：背景。
- `audio/circus-background-optimized.mp3`：使用者於 2026-10-24 提供的 `Untitled.mp3`（182.76 秒、48kHz 立體聲），以 stream copy 移除內嵌封面與標籤，未重編碼。4,342,331 → 4,317,696 bytes（減少 0.57%），音訊封包與解碼 PCM 的 SHA-256 均與母檔一致。按下音樂圖示才載入，獨立循環播放；本機與雲端入口使用 `audio/mpeg` 並支援單一位元組範圍請求。
- `images/dealer/v4/dealer.json` 與同目錄 WebP 圖集：主遊戲使用的 idle（96 格／3.2 秒）及 win（108 格／3.6 秒）人物動畫。idle 循環，小獎獲利時播放 win 並回待機；大獎沿用 WIN 演出。詳見 [角色動畫](dealer-animation.md)。

專案內 PNG 母檔已經驗證轉存並刪除。人物原畫、參考、原幀、HD 圖集及 QA 截圖改存 exact lossless WebP；現有遊戲圖集、字體與外框也為無損 WebP，背景沿用品質 90。`npm run assets:webp` 會驗證轉檔後的尺寸與透明度，無損項目另驗證完整 RGBA，再刪除 PNG；清單輸出至被忽略的 `test-results/image-compression.json`。第三方套件及 Git 內部不在清理範圍。

`scripts/assets/build-circus-font.py` 用 Windows Georgia Bold 產生 WebP 數字圖集；字型檔不打包進專案。素材產生器、人物圖集匯出器與檢查器均使用 WebP，Python 工具需要 Pillow；遊戲建置與伺服器執行只需要 Node。

程式及 JSON 內如 `spin-button.png`、`H1.png` 是沿用的圖集內部圖塊名稱，不代表載入 PNG 檔案。Discord 頭貼也使用官方 CDN WebP 路徑。

## 構圖與互動

桌面以 1160×740 的整組機台與單排控制列等比例縮放；手機固定直向多排配置，已移除橫向側邊控制列。Discord platform 優先於瀏覽器輸入裝置判斷，版面與安全區集中在 `responsive-layout.js`；`discord-activity.js` 在 SDK READY 後將手機的一般、子母畫面及網格模式都鎖定為 PORTRAIT，不增加轉向提示。

每輪向下移動且速度不受輪帶長度影響。`presentation.js` 的 `reelLandingAnimation` 統一正常與快停的收尾：160ms 減速、60ms 逐軸間隔與 190ms 回彈；一般旋轉的第一軸目標落地為 1400ms，五軸含回彈約 1.83 秒。快停只移除空轉，結果就緒後最多約 750ms 停妥，網路等待計入正常空轉時間。另管理 960ms 雙彈動及每 1.6 秒輪播的得獎圖標；`scene.js` 依結算資料中的 cells 標示所有有效格子，不再套用固定賠線。

`spin-controls.js` 集中處理空白鍵快停、自動開轉及取消佇列；錢包與算獎不依演出速度改變。AUTO SPIN 會等候跳分或大獎演出，開啟視窗或切離頁面時停止。減少動態效果時簡化演出；音效需手動啟用。

`game-rules.js`／`.css` 提供馬戲團風格的「遊戲規則」，分為圖標獎勵、得獎方式、操作說明三個分頁。共用既有圖集與實際倍率／WIN 門檻；圖標獎勵換算為當前下注的每組戲籌，`rules-example.js` 的 2×1×3 紅心示意交由正式算獎函式計算。手機採單欄圖標卡片，分頁支援左右方向鍵、Home／End，關閉後回到原入口。理論返還率與最高獎勵放於操作說明下方的「更多遊戲資訊」，頁尾顯示遊戲版本。

`player-bar.js`／`player-ui.css` 管理主畫面的 Discord 頭貼、名稱、完整 ID、簽到與遊玩紀錄入口；桌面帳號區、簽到及工具列共用高度，工具按鈕為等寬方形；手機分成帳號／簽到及工具兩列。頭貼沿用已授權的 `avatar`，以 `discord-avatar.js` 建立官方 CDN 圖片網址；缺少頭貼或載入失敗時保留本機圖示，同一張圖不會因開轉或餘額更新而重新載入。`player-copy.js` 統一簽到狀態與玩家提示，不直接顯示 SDK 或後端錯誤。`player-records.js` 提供可展開的遊玩紀錄，隱去停點、內部規則代碼和交易類型；玩家工具列不提供戲籌收支。簽到領取中會鎖住開轉，開轉中則不能簽到，避免餘額顯示互相覆蓋。

圖片替換後需跑 `npm test`、`npm run build`，並檢查透明邊界、圖集 frame、橫直向、鍵盤焦點、得分及長位數餘額。
