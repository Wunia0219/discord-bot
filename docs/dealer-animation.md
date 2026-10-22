# 命運荷官角色動畫

## 主遊戲接入（2026-10-22）

主遊戲透過 `images/dealer/v4/dealer.json` 播放目前完成的兩組 R6 動畫。待機 `idle` 持續循環；獲利且低於 BIG WIN 門檻的回合播放 `win`，播完回到待機。大獎沿用既有 WIN 演出。自動旋轉等候完整 3.6 秒致意返回中立後再開轉；手動開轉的鎖定時間維持原有規則。

| 動作 | 格數 | 時長 | 取樣率 | Runtime WebP 圖集 |
|---|---:|---:|---:|---:|
| idle | 96 | 3.2 秒 | 30fps | 24 頁 |
| win | 108 | 3.6 秒 | 30fps | 27 頁 |

`src/ui/scene.js` 使用 Vite 的 URL 匯入解析圖集，正式建置會產生帶雜湊的 WebP 路徑。`Dealer.prepare()` 在啟用動作前先完成解碼及 GPU 上傳；中獎素材在待機載入後與開轉準備時預載。減少動態效果時保持代表姿勢，到期回到靜止待機；頁面隱藏時隱藏人物，回來恢復待機。

Runtime 每格 576×832，原幀 1152×1664，共用 anchor `[0.5, 1600/1664]`。主遊戲以 256px 邏輯寬度換算角色比例。桌面畫布擴為 1320×700（裁切起點 x=-140），全身比例 1.65、站位 (40,680)；手機使用 1020×700（裁切起點 x=65），全身比例 0.85、站位 (156,660)。兩者皆完整顯示頭髮、披風、手臂與靴子，不逐格裁切、置中或變形；角色右側保持在第一軸 x=255 之前。桌面整組機台以 1160×740 等比例適配。HD 圖集每頁 2304×3328，runtime 每頁 1152×1664；動畫、畫布、時間與 runtime 圖集像素均沿用現有輸出。

## WebP 與原稿清理

依使用者要求，專案內所有 PNG 原稿、影格、HD 圖集及檢查截圖均改存 WebP，驗證後刪除 PNG。人物及參考素材使用 `lossless=True, exact=True`，完整解碼 RGBA（包含透明區隱藏 RGB）與原檔一致。既有 WebP 等價檔通過驗證後直接沿用，不重複編碼。遊戲背景沿用品質 90 的有損 WebP，其透明度與尺寸保持一致。

`npm run assets:webp` 可清理後續放入的 PNG，逐檔驗證後才刪除；清單、原始 PNG 雜湊、尺寸及大小寫入 `test-results/image-compression.json`。Git 及第三方套件目錄不在清理範圍。素材產生器、檢查器與本機預覽現已改用 WebP。

目前來源：

- `art/dealer/rebuild/host-master.webp`：共用人物原畫。
- `art/dealer/v4/source/`：去臂底圖、閉眼補件與來源記錄。
- `art/dealer/win-design/`：四張表情 key 與動作規格。
- `art/dealer/v4/frames/`、`sheets/`：無損 WebP 原幀與 HD 圖集。
- `images/dealer/v4/`：遊戲用無損 WebP 圖集；`previews/` 為獨立動態 WebP。

## 動作與既有審查

R6 沿用人物原畫、表情配準與連續空間映射。頭、頸、髮際及領口共同取樣；完整自由臂不切肘腕。上身峰值 +0.95°、自由臂相對上身峰值 +6.5°，以 body beta(3,5)／arm beta(3,4) 形成一次致意，手臂峰值較身體延後約 191ms。支撐手腕、平台與靴底保持固定。

108 格 win 有 107 張不同的解碼 RGBA，首尾共用中立姿勢；取樣格數不等於新增原畫。待機 96 格與勝利 108 格的內容及節奏未因本次格式整理改動。

R6 原有工程、指定區域靜態覆核與本機播放器審查記錄集中於 `test-results/dealer-win/r6/`。這些是歷史 PNG 輸出的證據，舊報告的路徑與雜湊不改寫；現在的格式遷移另有獨立報告。歷史 R5 的靜態通過不等於動作自然度通過。

## 驗證與重現

- `npm test`：玩法、觸發判斷、圖集契約、PNG 清理及現有回歸測試。
- `npm run build`：驗證正式產物包含兩組 WebP 圖集。
- `python scripts/assets/check-dealer-v4.py --allow-duplicates --require-manifest`：全部來源 WebP、rig、圖集及時間契約。
- `export-dealer-v4.py`：從完成的 RGBA WebP 原幀輸出無損 HD／runtime WebP 圖集。
- `.tools/dealer-game-check.html`：使用實際 SlotScene/WebGL 檢查 idle 前進、win 回待機、減少動態效果、隱藏／恢復及兩種畫面尺寸。

本次未推送或部署；瀏覽器尺寸檢查不代表手機實機驗收。
