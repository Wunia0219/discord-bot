# WIN 彈動與馬戲團中獎框

三種 WIN 以裁切後字標高度統一視覺尺度，BIG／SUPER／MEGA 分別為 22／23／24 cqw，寬度按 main.json 的各自長寬比等比例計算，避免較短的 BIG 因等寬縮放而顯得較高。彈出峰值統一為 1.06，第二次為 1.035。最寬 MEGA 峰值占舞台 93.28%，保留左右留白。字標位於 33%，得分位於 64%，得分字級依層級為 18／18.5／19 cqw。

字標在 0.95 秒入場完成兩次強弱彈動，之後以 1.3 秒週期做放大、回縮、較輕放大；跳分完成時以 0.65 秒收尾彈動落定。既有 show/hide 重啟與減少動態效果設定保留，總演出時長不變。

新框：images/fx/circus-win-frame.png 及無損 WebP，1254×1254。中央透明，香檳金邊、酒紅內線、深藍細邊、四角紅寶石菱形；仍以 148×148 顯示於中獎圖標後方。沒有改動使用者打包的 main 圖集。

使用內建 imagegen。生成提示詞：

> Create ONE premium circus slot game winning-symbol highlight frame, square 1024x1024, truly transparent background including the entire inner opening. Match Joker's Circus style: sculpted polished champagne gold, ruby red enamel, midnight navy trim, charming luxurious 3D illustration. Frame is a THIN rounded square outline occupying x80..944 y80..944, inner opening x120..904 y120..904 completely clear transparent. Gold outer bevel 12px, ruby inner stripe 8px, tiny ivory highlight. Four restrained small diamond ruby corner studs with gold setting, no large flourishes, no curtain, no crown, no text, no symbols, no objects inside. Readable at 148x148px. All frame decoration contained with 7 percent transparent margin; no background color, no haze, no broad glow, no floor shadow. Center must remain completely transparent for existing game symbols. Only a slim elegant complete border with small matching corner gems.

實際尺寸以輸出為準。中央 alpha 0–1；PNG 與 WebP 解碼像素完全相同。建置及 7 項演出、圖集、字體測試通過。瀏覽器確認新框與中獎輪播，預覽餘額不變。
