# BIG WIN 演出與金色數字

2026-10-18 起另支援 SUPER／MEGA WIN：新增標題、配色與分級規格見 [大獎素材](win-tier-assets.md)，原 BIG WIN 與金色數字保留。

依使用者提供的參考圖，保留原圖集的 `big_win.png` 與 `big_win_decor.png`，重新安排成上方蓮花、中間標題、下方得分。全畫面壓暗後，光環擴張、蓮花浮起、標題彈入、得分由 0 計至本局派彩，再短暫放大收尾。演出共 4.5 秒；下一次 SPIN 會取消舊演出與跳分。一般贏線與 96% RTP 計分不變。

## 素材

- `images/fx/big-win-aura-source.png`：內建 imagegen 產生的透明 RGBA 母圖，1254×1254。
- `images/fx/big-win-aura.webp`：遊戲使用的 1024×1024 版本，統一中心錨點，64px 安全邊界。
- `images/fx/big-win-spark-sheet.png`：1024×128，8 幀由左至右，每幀 128×128，中心錨點 (64,64)、18px 安全邊界；8 FPS、1 秒循環。由腳本產生光點明暗循環，所有粒子共用同一圖集。
- `images/fx/big-win-spark-sheet.json`：格位、尺寸、錨點與播放資訊。
- `images/fonts/kemet-gold.fnt` / `kemet-gold.png`：AngelCode BMFont 文字格式與透明 PNG 字圖，768×1024、單頁；包含 `0123456789,+−` 共 13 字。使用目前 Georgia Bold 的字形，烘焙金色漸層、描邊、亮邊及立體側面。未複製系統 TTF 字型檔。

數字圖集用於 BIG WIN、COINS 與機台下方的得分。`src/bitmap-number.js` 讀取 `.fnt` 的字距及位置，使用同一 PNG 繪製 DOM 中的數字 Canvas，並保留螢幕閱讀器文字。原有計數與清空時機不變。字型保留 Georgia 原本的高低數字造型。

## 重建

需要 Python Pillow。於專案根目錄執行：

```powershell
python scripts/build-big-win-fx.py
python scripts/build-gold-font.py
```

字型重建使用 Windows 既有的 `C:/Windows/Fonts/georgiab.ttf`。FX 腳本保留母圖並輸出統一留白的執行版本；sprite sheet 每格獨立驗證透明邊界。`tests/bitmap-font.test.js` 驗證字元完整、頁面大小、glyph bounds 與行高。

## Imagegen 母圖提示詞

使用內建 imagegen（非 CLI）並開啟透明背景，提示詞如下。輸出實際為 1254×1254，因此另以腳本做固定留白與縮放，不假設生成尺寸完全符合要求。

> Create ONE transparent game VFX overlay sprite, square 1024x1024. Intended use: behind existing BIG WIN gold lettering and lotus emblem in a polished Egyptian slot game. Only the magical aura frame, no text, no numbers, no lotus, no characters, no scenery, no solid background. Front-facing symmetrical circular Egyptian turquoise energy seal: large thin luminous cyan rings with fine segmented radial markings, wispy translucent teal/emerald spectral smoke licking around the outer sides, and elegant outstretched stylized Egyptian feather wings curving upward from a small circular sun medallion at the BOTTOM of the circle. Feather wings are luminous thin cyan contour lines, not solid gold wings. Center must be almost completely transparent and clear (the central 60% is for titles and numbers), with only very faint atmospheric haze. Delicate cyan sparks sparse around the edge. Bright cyan rim, soft restrained teal halo, readable fine details, premium painterly fantasy game VFX, matching polished gold/turquoise Egyptian icon art. Center anchor at (512,512); whole aura and wings inside x80..944 y80..944, at least 80px fully transparent safe border. Entire silhouette fully contained. This is a single clean master sprite, NOT a sprite sheet, NOT a screenshot or mockup. True transparent RGBA background with translucent light and smoke.
