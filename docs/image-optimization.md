# 圖片 WebP 壓縮

五組遊戲圖片由 7.15 MB 壓縮至 4.10 MB，減少 42.7%。這是 PNG 母圖與 WebP 的比較，不是本次下載速度實測。

圖集、數字及中獎外框使用無損 WebP；背景 quality 90。所有圖片維持原始尺寸與 alpha。無損圖片另外逐位元組比對解碼像素。PNG 保留供重建，正式程式只引用 WebP。

`npm run assets:webp` 只處理五組現用素材；明細見 [image-compression.json](image-compression.json)。重新匯出圖集時，meta.image 應指向 WebP，frame 名稱保留原有 PNG 索引鍵。

| 圖片 | PNG bytes | WebP bytes | 模式 |
|---|---:|---:|---|
| images/main.png | 3,811,175 | 2,971,958 | 無損 |
| images/symbols.png | 635,087 | 449,354 | 無損 |
| images/fonts/circus-gold.png | 136,214 | 80,504 | 無損 |
| images/fx/circus-win-frame.png | 599,552 | 399,734 | 無損 |
| images/jokers-circus/circus-background.png | 1,966,659 | 196,428 | 品質 90 |

已移除 52 個不用的檔案（39.02 MB 未壓縮），並解除安裝 41 個角色相依套件。清理前備份及逐檔清單見 [circus-cleanup.json](circus-cleanup.json)。備份以 SHA-256 核對後才移除工作檔；備份 ZIP 仍占磁碟空間，因此清理數量不等同淨磁碟節省量。
