# Joker’s Circus — 5×3／243 路

Discord Activity 內部試玩遊戲。後端負責算獎、籌碼、每日簽到與請求去重；每個伺服器的玩家錢包獨立。

版本 **0.2.6**，`package.json` 為唯一版本來源。只有使用者明確指定時才更新版本；規則識別碼 `circus-243-v2` 獨立維護，歷史回合保留原規則及結果。

## 現況與下一步

- 已完成：243 路玩法、Discord 登入與管理指令、SQLite／Firestore 錢包、斷線重送、完整帳本與備份、荷官 idle／win、音效、快停及自動旋轉。
- 本機 4188 已接入 Firestore Spark；4189 保留隔離 SQLite 測試。既有雲端切換與電腦／手機驗收記錄見[部署說明](docs/deployment.md)。本次優化是工作區程式變更，尚未重啟正式使用的服務或做真實雲端驗收。
- 本輪改善：近期紀錄按需分頁、摘要只讀存在的日期、冷卻拒絕減少讀取、合併並發刷新與就緒檢查。資料格式與交易寫入不變，詳見[用量與驗證](docs/spark-optimization.md)。
- 下一步依序：降低每局寫入與傳輸 → 異地備份及還原演練 → Firestore 公告佇列 → 背景音樂與手機體驗 → 部署。需求、依賴及驗收條件集中在[實作計畫](docs/roadmap.md)。

此階段在本機修改與測試；推送、PR、合併或部署另行安排。分支不保證 Netlify 不建置，推送前須確認 Branch deploys／Deploy Previews 設定。

## 啟動與驗證

需要 Node.js 24。安裝依賴後開啟一般瀏覽器試玩：

```sh
npm ci
npm run dev
```

網址為 `http://127.0.0.1:4187/`；一般瀏覽器使用本機試玩帳本，Discord 使用登入後的伺服器錢包。

| 指令 | 用途 |
|---|---|
| `npm test` | 全部一般回歸測試 |
| `npm run test:bot` | Discord／HTTP／帳本／維運測試 |
| `npm run test:firestore` | 隔離的官方模擬器：交易、遷移、備份及還原 |
| `npm run build` | 建置 `dist/` |
| `npm run backend:init`／`backend:dev` | 初始化／啟動 4189 SQLite 開發服務 |
| `npm run backend:check` | 唯讀驗帳 |
| `npm run activity:serve` | 建置並依 `.env.server.local` 啟動 4188 |
| `npm run db:backup`／`db:status` | 目前後端的手動備份／維運狀態 |
| `npm run firestore:backup`／`firestore:operations` | 4188 Firestore 邏輯備份／維運狀態 |
| `npm run verify:math`／`verify:sessions` | 完整數學枚舉／固定 seed 回合驗算 |
| `npm run export:model`／`audio:preview` | 匯出模型／音效試聽 |

模擬器需 Java 21，首次執行 `npm run firestore:emulator:setup`。本機錢包 QA 使用獨立 `.env.backend.local` 與 `data/backend.sqlite`，設定 `LOCAL_WALLET_TEST=true`、`APP_ENV=test`、`HOST=127.0.0.1` 後，開啟 `http://127.0.0.1:4189/wallet-test`。完整設定、備份還原及隔離限制見[部署說明](docs/deployment.md)；驗收步驟見[測試說明](docs/bot-testing.md)。

## 文件導航

| 文件 | 單一責任 |
|---|---|
| [架構](docs/architecture.md) | 模組邊界、資料來源、讀寫流程與限制 |
| [實作計畫](docs/roadmap.md) | 尚未完成的工作、先後依賴與完成條件 |
| [Spark 優化](docs/spark-optimization.md) | 本輪變更、情境成本、測試證據與適用範圍 |
| [部署與維運](docs/deployment.md) | 環境設定、帳本、遷移、備份及歷史驗收 |
| [測試](docs/bot-testing.md) | 自動回歸及人工驗收操作 |
| [玩家體驗](docs/player-experience.md) | 文案、玩法操作、視聽與鍵盤契約 |
| [數學](docs/game-math.md) | 輪帶、RTP、獎勵與歷史模型 |
| [素材](docs/assets.md)／[荷官動畫](docs/dealer-animation.md) | 素材來源、匯出及動畫規格 |

憑證、資料庫、本機工具、備份與測試原始輸出均被 Git 忽略。原專案整理前的可回復快照保留於 `backups/project-before-243-20261019-001051.zip`。
