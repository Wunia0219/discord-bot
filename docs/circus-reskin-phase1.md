# 馬戲團換皮：背景、數字、符號

2026-10-18：接入 Joker's Circus 背景、獨立 Circus Gold 數字，以及使用者更新的 symbols.png / symbols.json。

- CSS 背景與場景預載共用 `images/jokers-circus/circus-background.webp`（1672×941）。保留 PNG 母圖。
- `scripts/build-circus-font.py` 以 Georgia Bold 烘焙象牙金字面、酒紅側面與描邊；輸出 `images/fonts/circus-gold.{png,webp,fnt}`。13 個字元涵蓋數字及逗號、正負號；餘額、得分與大獎跳分共用此字圖。舊字體已於後續清理移至備份。
- 新 symbols PNG 無損匯出 WebP，確認解碼像素完全一致；JSON 的尺寸、trim 與座標沿用使用者匯出，只同步 meta.image 到 symbols.webp。
- 圖像 WILD.png 對應內部 wild；數學代碼仍為 W。SYMBOL_CODES 明確固定，避免換美術檔名改變輪帶解碼。賠率、輪帶、模型版本與帳本資料不變。
- 顯示名稱改為小丑烏鴉、皇冠白兔、皇家蝴蝶、皇冠金魚、黑桃、紅心、方塊、梅花。

本階段僅上述三項；原本框體、Logo、角色與 WIN 演出圖維持現有版本。

驗證：建置成功；61 項測試全部通過（沙箱內 56 項，另 5 項 localhost HTTP 測試解除連線限制後通過）。瀏覽器確認背景、九種圖標與餘額數字顯示，並執行不扣籌碼的 MEGA WIN 預覽。
