# 圖片 WebP 壓縮

遊戲實際建置的 8 張圖片由 17,218,473 bytes 變為 3,029,460 bytes，減少 82.4%。這是圖片檔案總量比較，不是完整載入時間測量；網路、Discord 握手與 JS 初始化仍影響等待時間。

- 所有 PNG 都產生對應 WebP，包含未上線的素材來源與舊版外框。原始 PNG 保留供重新匯出，但不被遊戲建置引用。
- 背景 quality 90、main 圖集 94、Spine 圖集 95，其餘靜態特效 96；method 6、透明度無損。
- 符號圖集、金色數字與粒子 sprite sheet 使用無損 WebP。既有的 big-win-aura.webp 不重複有損編碼。
- 全部保留原始寬高，轉換時重新解碼檢查尺寸與 alpha 完全一致。圖集 frame 名稱（如 H1.png）是索引鍵，保留原名；meta.image、Spine atlas page、BMFont page 更新為 WebP。
- `npm run assets:webp` 用 Pillow 從原始 PNG 重建，詳細大小及黑白背景的 RGB PSNR 比較存於 [image-compression.json](image-compression.json)。無損圖片 PSNR 為 null（RGB 零誤差）。
- 修改美術來源後重新跑此指令；若重新由 TexturePacker 匯出 JSON，要確認 meta.image 仍指向 .webp。

| 素材 | 原始 PNG | WebP |
|---|---:|---:|
| images/background.png | 11,037,586 | 1,068,124 |
| images/fonts/kemet-gold.png | 138,585 | 81,168 |
| images/fx/big-win-aura-source.png | 2,388,505 | 730,294 |
| images/fx/big-win-spark-sheet.png | 8,009 | 3,252 |
| images/fx/win-symbol-frame-thin.png | 381,795 | 130,830 |
| images/fx/win-symbol-frame.png | 924,108 | 279,210 |
| images/main.png | 2,445,719 | 493,270 |
| images/spine/anubis/character_anubis.png | 2,136,344 | 377,150 |
| images/symbols.png | 733,745 | 538,976 |
