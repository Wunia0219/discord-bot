# Joker’s Circus — 5×3／243 路

Discord Activity 內部試玩。固定輪帶、後端結算與伺服器獨立錢包；目前版本 `circus-243-v2`。

## 啟動與驗證

需要 Node.js 24。`npm ci` 後執行 `npm run dev`，開啟 http://127.0.0.1:4187/ 。一般瀏覽器使用本機試玩帳本；Discord 使用已登入的伺服器錢包。

| 指令 | 用途 |
|---|---|
| `npm test` | 算獎、亂數、歷史相容、錢包、快停、自動旋轉及演出回歸 |
| `npm run test:bot` | Discord 指令 HTTP 整合、簽章、簽到、管理發放／更正／紀錄與錢包回歸 |
| `npm run verify:math` | 完整加權枚舉 1,296,000,000 組停點並交叉核對期望值 |
| `npm run verify:sessions` | 100 組 × 500 回合的固定 seed 結算驗證 |
| `npm run export:model` | 更新當前數學文件與可匯入 JSON |
| `npm run build` | 建置 `dist/` |
| `npm run activity:serve` | 建置並啟動 4188 整合服務 |
| `npm run db:backup` | SQLite 一致快照 |

## 遊戲與操作

- 243 路：從第一軸開始，連續至少三軸同圖標即得獎，各軸份數相乘。同圖標只付最長獎，不同圖標相加。
- 倍率表保持原值，計價單位仍為總下注÷20；下注額 20／100／200／500。
- 理論 RTP **96%**，有派彩率 **56.2046%**；黑桃占派彩 **15.9115%**。自然最高派彩 **2,700 倍總下注**，BIG／SUPER／MEGA 門檻為 20／50／200 倍。
- 空白鍵第一次開轉，再按一次縮短轉動，以短程減速依序停輪；不改變本局結果、不重複扣款。中獎亮框、彈動與跳分完成後才接受下一局。
- 連續開轉遇到後端兩秒間隔時會自動稍候，保留同一筆請求；正常等待不跳出錯誤視窗。
- AUTO SPIN 開啟連續旋轉，再按停止後續開轉。保留跳分、亮框與彈動；開啟視窗、切到背景或籌碼不足時停止自動。
- 淨損益＝派彩−下注，有得分仍可能減少籌碼。測試籌碼不能購買、轉讓或兌現。

完整規則、賠率與驗證見 [數學說明](docs/game-math.md)，可匯入的輪帶及模型在 [jokers-circus-243.json](output/jokers-circus-243.json)。

## 專案入口

```text
src/game/       算獎、輪帶、結算、舊版相容；入口 index.js
src/ui/         畫面、動畫、快停、自動旋轉與音效
src/platform/   Discord 登入及錢包連線
src/main.js     頁面與互動組合入口
server/         HTTP、帳號驗證、SQLite 錢包與管理指令
scripts/game/   數學、回合驗證與模型匯出
scripts/assets/ 素材產生與壓縮
scripts/admin/  備份與指令註冊
docs/           規則、部署、素材說明；data/ 放原始數據
tests/          依功能命名的回歸測試
```

[部署與錢包維護](docs/deployment.md)包含 Discord 端點、設定、簽到／管理指令、Docker 與備份；[素材維護](docs/assets.md)包含圖集、母檔與畫面規格。

[Bot 功能測試](docs/bot-testing.md)包含自動測試範圍與 Discord 手動驗收步驟。

憑證、資料庫、本機工具、備份與測試原始輸出均被 Git 忽略。專案整理前的可回復快照保存在本機 `backups/project-before-243-20261019-001051.zip`；舊搜尋工具、歷史研究文件與舊美術匯出包不再放在目前專案內容中。
