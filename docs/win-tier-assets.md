# SUPER／MEGA WIN 素材

使用內建 imagegen，非 CLI/API。以 `images/main.png` 的 BIG WIN 為字形與材質參考，未改原圖集。配色由原青綠延伸為 SUPER 紫晶金邊與 MEGA 紅寶石金邊；原蓮花保留為共同徽記，光環及粒子分別轉為紫色與暖紅色。數字沿用原金色 BMFont。

| 素材 | 生成母圖尺寸 | 遊戲輸出 | 格位 |
|---|---|---|---|
| images/fx/super-win-title-source.png | 2194×717 | super-win-title.webp | 1072×264 |
| images/fx/mega-win-title-source.png | 2025×776 | mega-win-title.webp | 1072×264 |

母圖保留真實 alpha。`python scripts/pack-win-titles.py` 只做確定性匯出與幾何規格化：以 alpha>8 的可見範圍加 8px 邊界，排除生成背景中極淡的透明雜點；等比例縮放到最大 1040×240，置入 1072×264 格位並對齊共同底線 y=252。左右至少 16px、上下至少 12px 安全留白，輸出 PNG 與無損 WebP，核對 alpha 一致。未修改原始母圖；不是多幀動畫，不會逐幀裁切。

相同格位中，SUPER／MEGA 因字數增加，字面會比原 BIG WIN 略小；以保持比例、完整單行字樣為優先。`win-titles.json` 記錄尺寸與實際邊界。運行時只換標題，不移動蓮花、得分或舞台錨點，並繼承減少動態效果與中斷清理。

## SUPER WIN 提示詞

> Use case: text-localization / game sprite. Reference image is the game's existing atlas: ONLY use its BIG WIN lettering as font/style master, ignore every other atlas item. Generate ONE separate transparent title sprite with exact text 'SUPER WIN' in a SINGLE HORIZONTAL LINE. Match the distinctive curved Egyptian fantasy serif letterforms, thick sculpted bevels, outline weight and glossy painted material of BIG WIN. Recolor: luminous amethyst-purple and rose-magenta enamel faces, warm champagne-gold bevel outlines, deep plum extrusion/shadow. No logo, no lotus, no characters, no panel, no backdrop, no extra words, no particles. Use a wide 4.06:1 canvas, target 1072 x 264, matching the existing title's rectangular slot. Center anchor, common baseline, all text including shadows inside 4% safe padding on all edges. Compress width of letterforms tastefully to fit longer word, keep comparable cap height. True alpha transparency, isolated complete title. Project asset, not a mockup.

## MEGA WIN 提示詞

> Use case: text-localization / game sprite. Reference image is the game's existing atlas: ONLY use its BIG WIN lettering as font/style master, ignore every other atlas item. Generate ONE separate transparent title sprite with exact text 'MEGA WIN' in a SINGLE HORIZONTAL LINE. Match the distinctive curved Egyptian fantasy serif letterforms, thick sculpted bevels, outline weight and glossy painted material of BIG WIN. New higher-tier color design: rich ruby-red/crimson enamel faces with warm orange inner highlights, bright pale-gold metallic bevel outlines, dark burgundy extrusion/shadow. Strong contrast from original turquoise BIG WIN and purple SUPER WIN. No logo, no lotus, no characters, no panel, no backdrop, no extra words, no particles. Use a wide 4.06:1 canvas, target 1072 x 264, matching the existing title's rectangular slot. Center anchor, common baseline, all text including shadows inside 4% safe padding on all edges. Fit text across width without clipping. True alpha transparency, isolated complete title. Project asset, not a mockup.

## 檢查

已檢視兩張生成母圖、核對字樣與透明邊界，並在實際瀏覽器播放 SUPER／MEGA 預覽，確認顏色、標題、光環與得分位置。預覽前後 COINS 均為 10,000。原 BIG WIN 未替換。
