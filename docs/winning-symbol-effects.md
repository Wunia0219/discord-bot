# 得獎圖標與外框

- 每次得獎線亮出時，圖標播放一次雙脈衝：1 → 1.16 → 1 → 1.11 → 1，總長 960ms。同線輪播回來時也重新播放，不限制每局次數。
- 圖標使用獨立、未套用輪帶裁切的顯示層，以中心為縮放原點；原圖標暫時隱藏，避免重影。切線／新局清除複本並恢復原圖標。
- 圖層順序：未中獎格遮罩 → 得獎外框及凸縮圖標 → 連線，連線始終位於圖標上方。
- 大獎演出暫停線條與凸縮計時；減少動態效果設定直接顯示原尺寸。
- 生成外框：`images/fx/win-symbol-frame-thin.png`，1254 × 1254 RGBA，中央透明；原比例顯示為 148 × 148 場景單位，保留圖像邊緣空間。細金邊、縮小的青綠寶石與紫色琺瑯，無文字。第一版粗框保留為 win-symbol-frame.png，遊戲改用 thin 版本。
- 使用內建 imagegen 生成單張靜態框；圖標動畫由 PixiJS 執行，無需逐格 sprite sheet。

## 生成提示詞

Use case: stylized-concept. Generate one production game UI asset: a premium ancient Egyptian slot-machine winning-symbol square border, front-facing perfectly orthographic and symmetrical, on a genuinely transparent RGBA background. Canvas square 1024x1024. Outer frame occupies x64..960 and y64..960, with at least64px transparent margin. The entire central opening x145..879,y145..879 is EMPTY TRANSPARENT, no panel, no symbols, no background. Thin refined layered polished antique-gold bevels, small turquoise/lapis gemstone corner inlays, subtle engraved Egyptian geometric motifs, soft warm edge highlights. Four corners slightly ornamental but compact; border sides thin, so symbol remains unobstructed at 136px display size. Rounded square shape, no perspective, no large wings, no crown, no text, no letters, no numbers, no glow cloud, no shadows outside safe margins. Hand-painted polished 3D casino game asset finish matching richly shaded gold and purple Egyptian game art. Exactly one empty frame, no contact sheet.

輸出檢查：實際尺寸為 1254px；中央 alpha 為 0。框本體完整，邊緣帶少量低透明度像素，使用完整畫布而不裁切。

## 細框修改提示詞（內建 imagegen 編輯）

Edit this game UI frame to make it substantially more delicate and thin. Keep exactly the same square outer dimensions, front-facing alignment, gold/turquoise/purple Egyptian materials, true transparent center and background. Reduce the visible thickness of ALL four border sides by roughly 65%, opening up the central transparent area. Replace the large chunky corner ornaments with very small refined gold corners and tiny turquoise gems, reducing their occupied area by about 75%. The result must read as a narrow gold jewelry outline, about 2 to 3 screen pixels thick when shown at 136px square. No thick purple bands, no large corner medallions, no projections inward, no glow haze, no text. Maintain centered square silhouette and a fully transparent safety margin on every canvas edge. Preserve the original canvas size and frame outer position. This is a thin winning-cell border, not a decorative picture frame.
