# 命運荷官角色動畫

## 目前狀態：R6 本機候選，保留兩個動作

目前只保留 `idle` 待機與全新 `win` 喜悅回饋。待機沿用使用者認可的原影格及圖集；新中獎動作以牛郎／Host 型荷官看向玩家、微側身、托骰臂致意、笑容及眨眼構成。舊 `weight-shift` 與 `small-win` 已退出目前素材及 manifest，不再作為可播放動作。

R5 曾通過指定區域的靜態審查與工程檢查，但這不等於動作自然度通過。2026-10-22 使用者指出中獎的整臂往返像復健、播放感受卡頓，因此退回節奏。R6 保留原畫及空間映射，只調整中獎幅度、連續曲線與身體帶手臂的相位；保留待機的影格、runtime、時間及 manifest entry 完全不動。

主遊戲仍使用 `images/dealer/dealer-standin.webp` 單張人物原畫。R6 只在本機 `/dealer-preview` 檢視，尚未接入主遊戲、推送或部署 Netlify，也沒有變更錢包或遊戲結算。大獎仍由既有 WIN 演出負責，不另製第三組人物動作。

## 尺寸與時間契約

人物母圖為 1024×1536 RGBA，原幀畫布為 1152×1664，共同留白 64px。所有影格保持相同站位、畫布與 anchor `[0.5, 1600/1664]`；不逐格裁切、縮放或自動置中。

| 動作 | 原始時間樣本 | 時長／取樣率 | HD／runtime 圖集 |
|---|---:|---|---|
| `idle` 待機 | 96 | 3.2 秒／30fps | 24／24 頁，保留原檔 |
| `win` 喜悅回饋 | 108 | 3.6 秒／30fps | 27／27 頁 |

每頁為 2×2 格：HD PNG 為 2304×3328，runtime lossless WebP 為 1152×1664。Runtime 每格只從完成的原幀縮一次至 576×832。Manifest 路徑沿用 `images/dealer/v4/dealer.json`，格式版本仍為 4；R6 動作修訂使用 `motionRevision: 6`，兩者用途不同。

R6 `win` 維持 108 個渲染時間樣本／3600ms，有 **107 張不同的解碼 RGBA**；樣本數表示時間取樣，並非新增原畫張數。獨立預覽 `images/dealer/v4/previews/win-r6.webp` 實際為 **108 個編碼影格／3600ms**，解碼樣本的可見 RGBA 與一次縮圖來源一致；不同圖像數與編碼影格數分開統計。第 0 與第 107 張同為中立，因此不同圖像數少一張。

## 原畫、表情與連續動作

- `art/dealer/references/`：使用者提供的人像及服裝參考。
- `art/dealer/rebuild/host-master.png`：共用人物母圖。去臂底圖只補自由臂原先遮擋的區域；原始參考及來源記錄保留。
- `art/dealer/v4/source/`：去臂底圖、閉眼補件及既有來源記錄，供保留待機重現。
- `art/dealer/win-design/`：新中獎設計及四張 imagegen 表情 key：`warm`、`joy`、`half-eye`、`wink`。來源與提示見同目錄 `expression-provenance.json`。
- `art/dealer/v4/frames/`、`sheets/`、`rig-source.json`：同尺寸原幀、HD 圖集與座標資料；`images/dealer/v4/` 為 runtime 衍生素材。
- `art/dealer/rebuild/motion-scene-background.png`、`motion-scene-foreground.png`：預覽用融合場景前後景。

待機由 `scripts/assets/build-dealer-v4.py` 與 `dealer_continuous_body.py` 保留既有節奏：連續上身支點 `(620,425)`，負向峰值約 −0.425°，完整托骰臂跟隨。這輪沒有重畫、覆寫或重新匯出待機影格及 runtime 圖集。

新中獎由 `build-dealer-win.py`、`dealer_win_body.py` 與 `dealer_expression_morph.py` 製作。四張表情 key 在共同臉部座標中處理，嘴唇輪廓先配準，再將表情合入來源臉內部；頭、頸、髮際、領口及上身一起從同一個連續來源表面取樣。沒有獨立固定的頸髮貼片，也不把兩張完整頭像交叉淡化。

新中獎連續場的支點為 `(920,650)`，上身正向峰值 +0.95°。支撐肩與上袖可隨身體移動；手腕、指定接觸點、平台核心及靴底維持固定。完整自由臂以原畫彎肘做一次剛性取樣，R6 相對上身峰值由 +15° 校準為 **+6.5°**，不切肘腕、不伸縮臂長。衣料過渡及來源不變，仍從 premultiplied RGBA 來源以共用頂點的 8px mesh 取樣一次。

R6 以 `u=t/(107/30)` 正規化 108 個來源時間點。上身採正規化 beta 曲線 `u³(1−u)⁵`，自由臂採 `u³(1−u)⁴`，各自除以曲線最大值後乘上述角度。首尾角度、角速度及角加速度均為 0；身體約 1.3375 秒達峰，手臂約 1.5286 秒達峰，延後約 **191ms**。一次連續致意後回復，移除原負向預備動作、高點定格及中立尾停，來源取樣率與總時長不變。

衣料座標場的奇異值門檻為 `0.97–1.03`，並檢查正向行列式、逆解及 mesh 接邊。腿部與支撐臂的 rig 座標是實際映射後的**畫面表面標記**，不是宣稱整條剛性骨架；其段長允許最多 3% 的量測變化。自由臂及保留待機仍採 `1e-6 px` 剛性長度門檻，所有 `boneError` 都與重算的實際長度差核對。

## 驗收範圍與證據

R6 座標及保留檢查見 `test-results/dealer-win/r6/engineering-review.json`：108 幀實際座標與本輪 production helper 完全一致；表面標記最大相對段長變化約 1.22051%，完整自由臂最大長度誤差約 `1.28e-13 px`。108 張的靴底、支撐手腕、接觸點及平台核心指定區域逐像素不變；第 0 與第 107 張的完整 RGBA 均與保留 `idle-000.png` 相同。265 個保留待機檔案雜湊與待機 manifest entry 皆維持原樣。本輪匯出後完整 checker 為 **0 error／0 review flag**，見同目錄 `integrity-report.json`。

下列數字由 30fps 實際 rig 座標差分計算。手掌測點是來源 `(480,610)` 經完整剛性臂映射後的幾何標記，**不是從圖片追蹤手掌像素**；runtime 採 0.5 倍尺寸。數字描述動作跨度及節奏，不能直接判定自然度。

| 手掌幾何標記量測 | R5 基準 | R6 實際輸出 | 保留待機 |
|---|---:|---:|---:|
| runtime 最大步距／幀 | 1.8278 px | 0.4288 px | 0.2040 px |
| runtime 最大速度 | 54.8348 px/s | 12.8648 px/s | 6.1195 px/s |
| runtime 最大加速度 | 252.1224 px/s² | 26.5982 px/s² | 17.9759 px/s² |

R5 高點及片尾各有一段跨 400ms 的完全靜止取樣；R6 來源序列內未見連續完全靜止段，臂角僅有一次正常轉向。高次緩動接近首尾仍可能看起來近乎靜止，數學上沒有停格不代表觀感自然。R5 基準使用本輪保存的 `r6/before-win-rig.json`，目前程式雜湊另記 R6，不將舊 R5 檢查報告當作現行輸出證據。

本機預覽另外在播放前先 `prepare` 所選動作，透過明確載入的 `pixi.js/prepare` 將整組 textures 上傳 GPU，再啟動播放，避免首次顯示各圖集時才上傳。這項準備流程只在 `.tools` 預覽使用；實際播放記錄須來自修正後重跑，不沿用先前未啟用 GPU prepare 時的量測。

| 檢查 | 實際涵蓋範圍 | 證據／目前狀態 |
|---|---|---|
| 頭、臉、頸、領口及穿頸頭髮 | R6 全 108 張原尺寸頭頸區（來源矩形 420,0–820,440）；另選 27 張雙眼／嘴部以 2 倍檢視，10 張原尺寸深／淺底複查。 | `test-results/dealer-win/r6/qa-face/review-coverage.json`；所列靜態區域未見 blocking finding，未承接 R5 通過判定。 |
| 身體、肩臂、持骰手、腰披風、支撐袖手／平台、腿靴 | 108 張全身顯示尺寸檢視及 108 張左肩／完整自由臂／腕掌骰子來源尺寸裁切覆核；腰披風、支撐袖手／平台、腿靴僅抽查第 0、24、46、64、88、107 張。 | `test-results/dealer-win/r6/qa-body/visual-review.json`；所列範圍未見新接合 blocker，未沿用 R5 通過判定，也未宣稱其餘身體區域全 108 張原尺寸覆核。 |
| 實際播放器 | 修正 GPU 準備流程後，R6 本機正常速度觀察 9 輪、半速再觀察 11 輪；單次停在 108／108，逐幀 35→36→35；獨立／細節／融合場景與待機 96 幀另 14 輪正常，console 無警告或錯誤。 | `test-results/dealer-win/r6/runtime-review.json`；通過所記錄的本機觀察範圍，未做手機實機。 |
| 工程、來源與固定接觸 | R6 108 張 metadata/helper、固定 ROI、首尾 RGBA 及待機 265 檔保護通過；本輪圖集大小、播放順序、時間與完整 manifest 契約亦通過，0 error／0 review flag。 | `test-results/dealer-win/r6/engineering-review.json`、`integrity-report.json`。 |
| 獨立 animated WebP | 108 個來源樣本、107 張不同解碼圖像、108 個實際編碼影格／3600ms；解碼樣本可見 RGBA 與一次縮圖來源一致。 | `test-results/dealer-win/r6/webp-preview-export.json`；只證明匯出忠實度，不代替視覺驗收。 |

實際播放器另在 600ms 暖機後記錄 1977 個可見播放 tick：平均 17.1ms、最大 34ms，超過 50ms 及單次跨多個來源幀皆為 0。這是一段本機 ticker 間隔觀察，不是 GPU／frame-pacing profiler、完整逐顯示幀錄影或各裝置流暢度保證；任意待機相位切入中獎仍屬主遊戲整合項目。

預覽控制的 14 項針對性回歸測試通過，包含實際 `selectClip` 的 GPU 準備順序、過期選擇及失敗後標籤；見 `test-results/dealer-win/r6/preview-tests.log`。這些控制測試不替代實際動作觀感。

靜態審查只涵蓋表格列明的區域及索引，不代表每一張 1152×1664 全圖的每個像素都以原尺寸審視。身體報告的 source-native 指裁切未重採樣；大型 contact 仍可能由檢視工具縮顯，不宣稱每個像素均以實體 1:1 顯示。工程、所列靜態範圍及本機播放通過，也不代表表情魅力或肢體動作自然度自動獲得使用者認可；正式接入前再確認使用者評價與遊戲／手機情境。

## 待機保留、無損轉存與清理

96 張待機原幀 PNG 與 24 張 HD PNG 圖集全部保留，另新增共 120 張 `exact=True` lossless WebP。逐檔解碼確認包含透明像素隱藏 RGB 在內的完整 RGBA 一致；這批 WebP 比原 PNG 合計縮小 **29.809%**。這是新增可逆衍生檔，沒有藉轉存刪掉原稿，也沒有改動原 runtime。轉存與保留證據見 `test-results/dealer-v4/idle-preservation/conversion-report.json`、`before.json`。

依使用者只保留待機的範圍，已移除舊 `weight-shift`／`small-win` 等 253 個淘汰圖檔，共 **402,432,480 bytes**；另移除 3 個未使用 legacy parts，共 **6,655,354 bytes**。R5 素材整理時再移除 62 個試作及過時 QA 檔案，共 **55,195,984 bytes**。刪除清單與雜湊依序見 `test-results/dealer-v4/idle-preservation/deletion-report.json`、`test-results/dealer-win/retired-unused-legacy-parts.json`、`test-results/dealer-win/cleanup-report.json`。母圖、表情來源及現用待機均保留；R6 輸出覆寫中獎原幀，歷史 R5 rig／manifest 基準另存於 `test-results/dealer-win/r6/`。

R6 本輪另清理 90 個 R5 QA、瀏覽器截圖及舊獨立預覽檔案，共 **169,406,942 bytes**，見 `test-results/dealer-win/r6/cleanup-report.json`。R6 當前 QA、來源及保留待機不在這份刪除清單內。清理後重核對 265 個待機檔案及 108 張現用中獎 PNG，結果通過，見同目錄 `post-cleanup-verification.json`。

## 重現流程與後續整合

1. 保留現用待機檔案，先審新動作關鍵姿勢、表情配準及接觸關係，再渲染同尺寸原幀；不要用逐格裁切縮放修站位。
2. 用 `scripts/assets/export-dealer-v4.py` 匯出 HD／runtime 圖集，再跑 `scripts/assets/check-dealer-v4.py --allow-duplicates --require-manifest`。來源幀、不同圖像及編碼影格分別記錄，不把時間取樣當作新增原畫。
3. 按完整索引審查所有來源時間點的指定原尺寸區域及選定深／淺底，另在 `/dealer-preview` 實測播放與控制；數值、靜態美術及播放器記錄各自保留。
4. 正式接入主遊戲前，確認使用者對新回饋的自然度評價、任意待機相位進出銜接、遊戲觸發與音效時間、最終站位及按鈕／轉輪安全區、手機實機與常駐用量。目前主遊戲仍為靜態人物。

歷史上細碎微動、分段 IK 及 R2／R3 固定覆蓋被否決；R3 的領髮接合通過判定已撤回，根因是固定貼片與移動上身的像素座標不同。R4 的連續表面方向保留，但舊中獎演出不再使用；R5 的靜態合格也未解決使用者指出的節奏問題，均不作為 R6 自然度通過的證據。
