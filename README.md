# Joker’s Circus — 5×3／243 路

Discord Activity 內部試玩遊戲。後端負責算獎、戲籌、週簽到與請求去重；每個伺服器的玩家錢包獨立。

Discord 保留 `/戲籌` 與 `/戲籌管理` 兩個入口；查詢、發放、紀錄與全群重設由私人管理面板操作，簽到只在遊戲內領取。詳見 [指令說明](docs/discord-commands.md)。

版本 **0.3.0**，`package.json` 為唯一版本來源。本次依使用者要求更新版本，沿用已發布的週簽到、私人管理面板、上次重設報表與已驗收停輪設定；只有使用者明確指定時才更新版本。規則識別碼 `circus-243-v2` 獨立維護，歷史回合保留原規則及結果。

## 現況與下一步

- 已完成：243 路玩法、Discord 登入與管理指令、SQLite／Firestore 錢包、斷線重送、完整帳本與備份、荷官 idle／win、音效、背景音樂、快停及自動旋轉。
- 10/24 使用者已驗收目前的正常／快速停輪及量測清理，之後維持 [已驗收停輪基準](docs/reel-timing-baseline.md)。
- 目前 Discord 試玩入口運行於 Cloudflare Worker／SQLite Durable Object，使用原 Firestore Blaze v2（保留原免費用量保護） 帳本。本機 4188 writer 已停用；4189 保留隔離 SQLite 測試。雲端維運與回退以 [雲端執行紀錄](docs/cloud-runtime.md) 為準；[原本機入口紀錄](docs/discord-test-entry.md) 僅供歷史參考。
- 本輪已完成 v2：每局 10→6 次寫入、無損近期快取、輕量狀態與增量同步、較舊紀錄載入、空白命名空間遷移及雙向還原測試。10/24 已安全切換現有服務至 v2，採用步驟與量測見 [Firestore v2](docs/firestore-v2.md)。第一輪讀取優化見[用量與驗證](docs/spark-optimization.md)。
- 已完成 [加密備份與離線還原](docs/portable-backup.md) 及雲端切換驗證，Worker、持久額度、加密登入、備份與公告 alarm 已上線。額外 Google Drive 副本尚未接入；備份進度與回退限制見 [雲端執行與回退](docs/cloud-runtime.md)。下一步、依賴與驗收條件集中在[實作計畫](docs/roadmap.md)。
- 10/26 已發布完整 0.2.8：戲籌文案、多玩家結算佇列、分塊加密備份與額度成本優化；最新五錢包／1,281 局備份已完整還原。測試、版本與相容回退方式見 [上線驗收](docs/launch-readiness.md)。
- 跨日備份與原請求還原、使用者金鑰保管確認、私人 #bot維護 的雲端監控均已完成。剩餘真人手機／雙裝置、背景恢復、自然大獎與小群持續運行觀察；不以模擬器代替真人驗收。

客戶交付準備以 `main` 作為正式程式來源，維持 0.3.0；部署前核對該分支已包含目前帳本與備份格式的相容變更。單群約 60 錢包／5 人並行、全新正式帳本與恢復程序見[客戶交付與恢復](docs/customer-handoff.md)。正式群 ID 尚未提供，實際群組切換與正式資源建立暫緩，現有測試帳本保留。

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
| `npm run cloud:control -- status --env .env.cloud.local` | 目前雲端服務的私有狀態，不重設額度 |
| `npm run cloud:control -- health --env .env.cloud.local` | 唯讀核對版本及維運摘要；異常／版本不同時非零結束 |
| `npm run cloud:control -- archive --env .env.cloud.local --to <新檔案.json>` | 下載最後有效加密備份，不停止服務或釋放 writer |
| `npm run discord:check -- --cloud --discord --public-origin https://jokers-circus.nini900219.workers.dev` | 目前雲端入口與 Discord 唯讀診斷 |
| `npm run activity:serve` | Node 本機／完成交接後的回退工具；雲端 active 時不可直連現行 Firestore |
| `npm run db:backup`／`db:status`、`firestore:backup`／`firestore:operations` | Node 備份／維運工具；雲端 active 時不對現行 Firestore 執行 |
| `npm run backup:portable -- ...` | 完整快照加密匯出、驗證及還原到新檔 |
| `npm run wallet:recovery -- backup/drill ...` | 下載既有有效加密備份或隔離恢復／原請求重播，可將摘要送往指定維護頻道；不切換服務 |
| `npm run test:recovery` | 單群 60 錢包／5 人並行及全新 workerd 恢復的隔離驗證 |
| `npm run monitor:build`／`test:monitor` | 獨立監控的 dry-run／真正 workerd 隔離測試，不部署或發真實通知 |
| `npm run verify:math`／`verify:sessions` | 完整數學枚舉／固定 seed 回合驗算 |
| `npm run export:model`／`audio:preview` | 匯出模型／音效試聽 |

模擬器需 Java 21，首次執行 `npm run firestore:emulator:setup`。本機錢包 QA 使用獨立 `.env.backend.local` 與 `data/backend.sqlite`，設定 `LOCAL_WALLET_TEST=true`、`APP_ENV=test`、`HOST=127.0.0.1` 後，開啟 `http://127.0.0.1:4189/wallet-test`。完整設定、備份還原及隔離限制見[部署說明](docs/deployment.md)；驗收步驟見[測試說明](docs/bot-testing.md)。

雲端目前為唯一現行 writer；不要為本機測試重開 4188、重建臨時通道或解除本機 `FIRESTORE_LIVE_ENABLED=false`。回退須完成雲端 pause、最新備份、export/release、還原驗證及原額度回傳，依 [雲端手冊](docs/cloud-runtime.md)執行。

## 文件導航

| 文件 | 單一責任 |
|---|---|
| [架構](docs/architecture.md) | 模組邊界、資料來源、讀寫流程與限制 |
| [實作計畫](docs/roadmap.md) | 尚未完成的工作、先後依賴與完成條件 |
| [Spark 優化](docs/spark-optimization.md) | 本輪變更、情境成本、測試證據與適用範圍 |
| [Firestore v2](docs/firestore-v2.md) | 六次寫入、壓縮與同步、資料格式切換及回退 |
| [部署與維運](docs/deployment.md) | 環境設定、帳本、遷移、備份及歷史驗收 |
| [維運監控](docs/operations-monitor.md) | 唯讀狀態、版本核對、獨立監控及通知設定／失敗處理 |
| [測試](docs/bot-testing.md) | 自動回歸及人工驗收操作 |
| [玩家體驗](docs/player-experience.md) | 文案、玩法操作、視聽與鍵盤契約 |
| [停輪基準](docs/reel-timing-baseline.md) | 已驗收的時間參數、快停回饋與後續維護限制 |
| [數學](docs/game-math.md) | 輪帶、RTP、獎勵與歷史模型 |
| [素材](docs/assets.md)／[荷官動畫](docs/dealer-animation.md) | 素材來源、匯出及動畫規格 |

憑證、資料庫、本機工具、備份與測試原始輸出均被 Git 忽略。原專案整理前的可回復快照保留於 `backups/project-before-243-20261019-001051.zip`。
