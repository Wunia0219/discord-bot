# 素材與壓縮

## 執行資源

| 資源 | 用途 |
|---|---|
| `images/main.webp`＋JSON | 機台、Logo、按鈕；直接使用 frame 像素，匯出 scale 0.5 |
| `images/symbols.webp`＋JSON | 九種圖標，保留透明留白 |
| `images/fonts/circus-gold.webp`＋FNT | HUD／大獎共用金色數字，DOM 保留文字 |
| `images/fx/circus-win-frame.webp` | 得獎外框 |
| `images/jokers-circus/circus-background.webp` | 背景；歷史輸出為有損 quality 90 |
| `images/dealer/v4/` | 荷官 manifest 與 51 頁無損 WebP |
| `audio/circus-background-optimized.mp3` | 使用者原音樂，182.76 秒、48 kHz 立體聲 |

MP3 已用 stream copy 移除封面／標籤，4,342,331→4,317,696 bytes，未重編碼；原驗證封包及解碼 PCM 雜湊一致。音樂按開關才載入、音量 16%、循環播放，入口支援 Range。合成音效由 `src/ui/audio/` 共用 voice plan 產生，`npm run audio:preview` 可離線試聽。

## 無損檢查

`npm run assets:audit` 檢查 Git 追蹤的 `images/`、`art/` 圖片；`npm run assets:webp` 只寫入更小、尺寸及完整 RGBA 逐位元一致的候選。包含透明區 RGB，不縮尺寸、不更改畫面內容。報告在 `test-results/image-compression.json`，記錄檔案／像素雜湊、編碼及大小。

動畫 WebP 保留所有影格與原時序，不攤平成單張。已有有損背景及 MP3 不宣稱可還原成原始無損；本輪不再有損壓縮。圖集內 `spin-button.png` 等名稱是 frame key，不是待下載 PNG。

Python 工具需 Pillow；`build-circus-font.py` 使用 Windows Georgia Bold，字型檔不打包。Python 模組採底線，CLI 與 JS 檔採連字號；`__pycache__` 不進版控。

建置為帶內容雜湊的資源逐檔產生長期瀏覽器快取規則，減少再次開啟時的重複請求。內容更新會換檔名；HTML、固定網址與錢包 API 不套用長期快取。這不減少首次下載量，也不改變圖片、音效或遊戲流程。

## 荷官動畫

| 動作 | 格數／時長 | runtime 圖集 |
|---|---|---|
| idle | 96 格／3.2 秒／30fps | 24 頁 |
| win | 108 格／3.6 秒／30fps | 27 頁 |

idle 循環；獲利且低於 BIG WIN 播放 win，播完回待機。AUTO SPIN 等待完整致意；大獎使用原 WIN 演出。減少動態效果顯示代表姿勢，背景隱藏、前景恢復。

runtime 每格 576×832，原幀 1152×1664，anchor `[0.5,1600/1664]`。桌面畫布 1320×700、裁切 x=-140、角色 (40,680)／比例 1.65；手機 1020×700、裁切 x=65、角色 (156,660)／比例 0.85。保持全身及第一軸前方留白，不逐格裁切／置中。

`Dealer.prepare()` 先解碼、解析圖集並上傳 GPU 才播放。idle 與舞台素材並行準備；win 在可操作後預載，回合結果也可按需預載，不阻擋首次進入。圖集以 Vite 雜湊 URL 載入。

win 完整播放回待機後保留 30 秒，供短時間內的下一次得獎重用；到期若轉輪仍在運動則延後釋放。正在播放、準備播放及首次預載待用的動作保持可用；回背景會切回原 idle 並釋放可選動作，背景不另外預載 win。重新使用同一動作會取消待釋放計時，並行準備共用一份工作。載入、解析或 GPU 上傳失敗時等待同批頁面收尾，再清理成功載入的資源；離開時也等待進行中的準備與釋放完成。

上述策略保留原 51 頁圖集、完整像素與播放順序。兩組貼圖按 RGBA 尺寸估算的峰值仍為約 373 MiB，短期重用會延長 win 貼圖的駐留時間；這是圖集尺寸估算，不是裝置記憶體實測。

原畫在 `art/dealer/rebuild/host-master.webp`，補件／原幀／HD 圖集在 `art/dealer/v4/`，動作設計在 `art/dealer/win-design/`。R6 使用一次致意：上身峰值 +0.95°、自由臂 +6.5°，手臂較身體延後約 191ms；支撐手、平台與靴底固定。108 格含 107 張不同像素，首尾共用中立姿勢。

## 維護驗證

`npm test`、`npm run build` 與 `python scripts/assets/check-dealer-v4.py --allow-duplicates --require-manifest` 核對來源、圖集及時間契約。`export-dealer-v4.py` 由原幀輸出無損圖集。畫面另檢查透明邊緣、完整人物、手機／桌面、鍵盤焦點及長位數金額；停輪規格集中在[基準](reel-timing-baseline.md)。

`npm run test:dealer` 使用隔離 Edge 檢查短期重用、到期時的轉輪保護、背景釋放、併發準備與故障清理，並擷取桌機／手機全部 204 影格的渲染像素雜湊。修改前可先在同一裝置與瀏覽器執行 `npm run test:dealer -- --baseline` 保存本機基準；之後有該基準時會逐格比對像素、位置、縮放、時序與圖集峰值。報告在 `test-results/dealer-resources/`，不在正式遊戲加入測量 hooks。
