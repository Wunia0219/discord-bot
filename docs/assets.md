# 素材與畫面維護

## 執行素材

- `images/main.webp`＋`main.json`：機台框、Logo、按鈕及大獎素材。圖集匯出 scale 為 0.5，程式直接使用 frame 像素座標。
- `images/symbols.webp`＋`symbols.json`：九種圖標；保留原始透明留白。穩定數學代碼與圖標名稱集中在 `src/game/symbols.js`。
- `images/fonts/circus-gold.webp`＋`.fnt`：HUD、大獎共用的金色數字，含逗號及正負號，DOM 保留可讀文字。
- `images/fx/circus-win-frame.webp`：紅金得獎外框。
- `images/jokers-circus/circus-background.webp`：背景。
- `images/dealer/dealer-standin.webp`：主遊戲目前使用的單張人物原畫，無動畫圖集依賴。本機 R6 候選只保留 `idle` 待機與 `win` 喜悅回饋，尚未接入主遊戲或部署；來源、尺寸及驗收範圍見 [角色動畫](dealer-animation.md)。

同目錄 PNG 是可編修的母檔，保留供重新匯出。`npm run assets:webp` 以原尺寸編碼；圖集、字體與外框無損，背景品質 90。壓縮檢查資料輸出至被忽略的 `test-results/`。

`scripts/assets/build-circus-font.py` 用 Windows 的 Georgia Bold 產生數字圖集；字型檔不打包進專案。Python 素材工具需要 Pillow，遊戲建置與伺服器執行只需要 Node。

## 荷官 R6 原幀與候選圖集

`art/dealer/v4/frames/idle/` 的 96 張 PNG 與 `art/dealer/v4/sheets/` 的 24 張待機 HD PNG 全部保留，另新增共 120 張 exact lossless WebP，完整解碼 RGBA（含透明像素隱藏 RGB）與原 PNG 一致，這批衍生檔比 PNG 小 29.809%。轉存不代表可以刪除原稿；原待機 runtime 也保持原檔。

R6 `win` 維持 108 個時間樣本／3.6 秒／30fps，HD PNG 與 runtime WebP 各 27 頁，有 107 張不同解碼 RGBA。共用原幀畫布 1152×1664，不逐格裁切縮放；每頁 2×2，HD 為 2304×3328，runtime 從原幀只縮一次至每格 576×832，分頁為 1152×1664 lossless WebP。Manifest 沿用 `images/dealer/v4/dealer.json`，格式版本 4、動作修訂 6，只含 `idle`／`win`。獨立 `previews/win-r6.webp` 為 108 個編碼影格／3600ms，解碼樣本可見 RGBA 與一次縮圖來源一致。

R6 沿用人物母圖、四張表情 key、嘴唇輪廓配準及連續空間映射，只將完整自由臂峰值由 15° 改為 6.5°，以 body beta(3,5)／arm beta(3,4) 消除定格，手臂峰值較身體延遲約 191ms。108 幀是渲染取樣，不能寫成 108 張新原畫。舊倚框／小獎 253 個淘汰圖檔及 3 個未使用 parts 已刪除，現用依賴與原始參考保留。

R5 的靜態及工程通過不代表自然度合格；使用者退回節奏後，R6 座標、固定接觸、首尾與待機保護已核對，本輪匯出 checker 為 0 error／0 review flag。頭頸、左肩完整臂及全身顯示覆核涵蓋 108 張，腰披風／支撐平台／腿靴另抽查 6 張；修正 GPU 準備後的本機正常／半速、逐幀、單次及融合場景檢查亦完成。本輪證據集中於 `test-results/dealer-win/r6/`；手掌步距／加速度是 rig 幾何標記差分，並非像素追蹤。詳細索引、來源尺寸裁切的顯示限制及後續使用者確認見 [角色動畫](dealer-animation.md)。本輪沒有改動錢包或部署 Netlify。

## 構圖與互動

桌面以 1160×824 的整組機台與單排控制列等比例縮放；手機依方向使用直向多排或橫向配置。Discord platform 優先於瀏覽器輸入裝置判斷，安全區與方向解鎖集中在 `responsive-layout.js`。

每輪向下移動且速度不受輪帶長度影響。`presentation.js` 管理減速、960ms 雙彈動及每 1.6 秒輪播的得獎圖標；`scene.js` 依結算資料中的 cells 標示所有有效格子，不再套用固定賠線。

`spin-controls.js` 集中處理空白鍵快停、自動開轉及取消佇列；錢包與算獎不依演出速度改變。AUTO SPIN 會等候跳分或大獎演出，開啟視窗或切離頁面時停止。減少動態效果時簡化演出；音效需手動啟用。

`game-rules.js`／`.css` 提供馬戲團風格的「遊戲規則」，分為圖標獎勵、得獎方式、操作說明三個分頁。共用既有圖集與實際倍率／WIN 門檻；圖標獎勵換算為當前下注的每組籌碼，`rules-example.js` 的 2×1×3 紅心示意交由正式算獎函式計算。手機採單欄圖標卡片，分頁支援左右方向鍵、Home／End，關閉後回到原入口。理論返還率與最高獎勵放於操作說明下方的「更多遊戲資訊」，頁尾顯示遊戲版本。

`player-bar.js`／`player-ui.css` 管理主畫面的 Discord 頭貼、名稱、完整 ID、簽到與遊玩紀錄入口；桌面帳號區、簽到及工具列共用高度，工具按鈕為等寬方形；手機分成帳號／簽到及工具兩列。頭貼沿用已授權的 `avatar`，以 `discord-avatar.js` 建立官方 CDN 圖片網址；缺少頭貼或載入失敗時保留本機圖示，同一張圖不會因開轉或餘額更新而重新載入。`player-copy.js` 統一簽到狀態與玩家提示，不直接顯示 SDK 或後端錯誤。`player-records.js` 提供可展開的遊玩紀錄，隱去停點、內部規則代碼和交易類型；玩家工具列不提供籌碼收支。簽到領取中會鎖住開轉，開轉中則不能簽到，避免餘額顯示互相覆蓋。

圖片替換後需跑 `npm test`、`npm run build`，並檢查透明邊界、圖集 frame、橫直向、鍵盤焦點、得分及長位數餘額。
