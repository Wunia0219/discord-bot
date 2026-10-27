# 單群客戶交付與錢包恢復

2026-10-27，產品版本維持 **0.3.0**。本輪只準備單群交付、備份與恢復，不調整停輪、遊戲規則、額度上限或資料保留方式。

## 已確定範圍與尚未啟用項目

- 一個客戶群，約 60 份錢包，以 5 人並行作為這次驗證情境；不是把第 6 人擋掉，也不宣稱任意人數或真實網路都具有相同延遲。
- 客戶正式群 ID 尚未提供，群組切換及正式資源建立暫緩。指定的維護群／頻道不是客戶遊戲群。
- 正式啟用全新帳本，不移入測試玩家、餘額、簽到或歷史；測試帳本與現有入口保留供後續測試。
- 正式程式來源為 `main`，只能部署理解目前 `welcome`、週簽到、reset version 2 及 archive format 2 的相容版本；不可把較舊 main 或歷史 Worker 當成現行資料的直接回退包。
- 維運摘要與通知使用 [既有維護頻道](https://discord.com/channels/1441097301685698703/1564187899019141140)。不在此張貼金鑰、憑證、逐人餘額、原始帳本或解密備份。
- 資料刪除、歷史封存與大幅架構／程式優化延後，不隨此輪加入。

正式群提供後，確認 `ALLOWED_GUILD_IDS` 只包含該群；指令頻道、管理身分組、得獎頻道與維護頻道分別核對。正式使用獨立 Worker／DO 狀態、production namespace、憑證與恢復金鑰，不直接改寫現有測試資源。**同一 Firestore 專案的多個 namespace 不會得到獨立供應商額度**：正式／測試若共用專案，必須先完成共用持久用量管控；不能複製目前 DO 的計數器各自消費。可使用獨立正式 Firebase 專案以隔離帳本及用量，實際資源選擇待正式部署階段核對，此輪不建立。

## 日常防護與恢復界線

現有雲端 alarm 約每 24 小時嘗試建立同一 readTime 的完整加密備份，保留最近三份有效世代；未完成或驗帳失敗的候選不取代有效副本。超過 26 小時提醒、48 小時嚴重告警及玩家 API 保護沿用原設定。恢復落差以最後有效快照的 readTime 為準，不把下載時間當成資料最新時間。

`wallet:recovery backup` **只下載既有有效快照**並在本機解密驗帳，不觸發新備份、不 pause、不 export/release、不新增 Firestore 讀寫。需要保全事故當下最新進度時，另依 [雲端交接手冊](cloud-runtime.md)排定停止寫入與最新備份；一般下載不能代替該流程。

`wallet:recovery drill` 只還原到新的本機 SQLite，以本機 API 核對所有錢包並重播備份中的原始 spin／簽到／重設請求；重播前後七表須完全相同，來源 archive 也須不變。支援新版精簡重設憑證。它不會把某人的舊餘額覆蓋回正在遊玩的帳本。

金鑰錯誤、環境不符、跨群、來源專案／namespace 不符、分頁不完整或驗帳失敗會拒絕；既有輸出目錄不覆蓋。每次使用新目錄保留證據。本機解密資料與報告仍屬受控資料，均放於忽略 Git 的 `backups/`，不能隨原始碼或聊天分享。

## 操作指令

以下為**現有測試服務**的已核對來源，不能直接套用為客戶正式設定。金鑰與 Webhook 檔沿用受控本機位置，不列出內容。

下載最後有效加密備份並核對全部資料：

```powershell
npm run wallet:recovery -- backup --env .env.cloud.local --key-file data/backup-keys/cloud-key.txt --environment test --project slot-game-203db --namespace jokers-circus-v2-20261024-test --out backups/customer-recovery/example-backup
```

以該檔進行隔離恢復，並發送一則維運摘要：

```powershell
npm run wallet:recovery -- drill --archive backups/customer-recovery/example-backup/archive.json --key-file data/backup-keys/cloud-key.txt --environment test --out backups/customer-recovery/example-drill --notify-webhook-file data/backup-keys/monitor-webhook.txt --notify-guild 1441097301685698703 --notify-channel 1564187899019141140
```

不加三個 `--notify-*` 參數則不通知。正式單群備份／演練另外傳入 `--guild <客戶群ID>`；遇到其他群資料時整份拒絕，不自動過濾或截短帳本。環境、專案、namespace、金鑰與 origin 必須替換為已確認的正式值。

通知前 GET Webhook 核對精確的維護群／頻道，POST 前保存 sending 意圖。成功回應須含訊息 ID 與正確頻道；送出結果不明記為 uncertain、不自動重貼，4xx（含 429）記為 blocked。這個手動工具不自動重試通知；先查看本機 `report.json` 與頻道，再決定後續處理。通知失敗不把已完成的備份或恢復改成失敗，但命令非零結束，要求維運人員檢查。

命令會產生摘要 `report.json`；backup 另有完整加密 `archive.json`，drill 另有 `local-drill/restored.sqlite` 與詳細報告。CLI 只輸出操作結果、錢包數及帳本版本，不輸出玩家 ID、餘額、金鑰或上游錯誤。

## 事故處理順序

1. **玩家說戲籌異常**：收集群、玩家、時間與原請求資訊，查原始結算；未核對前不補發、不要求先清除工作階段資料。
2. **懷疑持續錯誤入帳／誤管理操作**：先暫停新操作並等待已開始交易結束，保留狀態、備份與原操作紀錄；不刪除原帳本或把舊餘額直接改回去。
3. **程式更新故障**：使用支援目前帳本／備份格式的相容程式回退，保留最新資料與原額度，不倒灌昨天的資料。
4. **必須更換資料來源／恢復整個服務**：先確認原 writer 停止；依雲端手冊完成最新一致快照、驗帳及 export/release，保留原額度。若原來源已無法讀取，先明列最後可用 readTime 與不可恢復區間，再規劃災難恢復；不能把舊快照宣稱為包含故障前最後進度。
5. **在全新空白目的地恢復**：解密到新 SQLite 並驗帳，以相容的 Firestore importer 移入空白 namespace；已有非空目的地不得覆蓋。重新 seed 的來源 fingerprint、revision、錢包及額度必須一致，原 writer 不可重新啟用。同一供應商專案的恢復匯入成本亦須計入原持久額度；本機模擬測試用的獨立匯入計數器不能直接當作正式部署設定。
6. **恢復後再開放**：逐人核對餘額，驗證原請求不重複入帳、簽到與重設紀錄保留；新服務要求重新登入。核對告警與通知，再向客戶說明恢復範圍與可能遺失區間。

目前未提供一鍵覆蓋正式資料庫、Discord 聊天指令還原或自動災難切換；這些操作需要先確定權威來源及停止寫入，不能僅憑維護頻道中的一句訊息觸發。

## 這次完成的驗證

- `npm test`：399 通過、1 項既有條件跳過；包含錯誤金鑰、錯誤環境、跨群拒絕、來源不符、下載分頁異常、通知去識別、目的地核對、通知不確定狀態與不可覆蓋。
- `npm run test:recovery`：隔離 Firestore emulator 與真正 workerd；單群 60 份 production 格式錢包、5 人並行結算、七表完整恢復、舊下注去重、60 人精簡重設重播、舊 writer 釋放、全新 DO、重新登入及非空目的地拒絕。結果為 `test-results/customer-recovery-report.json`。
- 該次隔離冷恢復約 5.1 秒，5 人並行請求約 380ms；僅代表本機模擬器，不包括真實雲端部署、Discord OAuth、DNS、人工反應或真實延遲，不作為客戶 RTO／速度保證。
- 現行既有備份 revision 1304（5 錢包、1,304 帳本、1,299 原請求、1,281 局）已下載、解密、還原及原請求重播；原七表與來源檔不變。不是把測試資料移入正式帳本，也不是新建每日快照。
- 本輪證據位於 `backups/customer-wallet-readiness-20261027/live-backup/` 與 `live-drill/`。隔離恢復摘要已送至指定維護頻道；備份、金鑰與逐人資料未上傳。

正式群 ID 提供後，才執行正式資源與全新帳本設定、客戶真人驗收；目前不宣稱已完成客戶正式上線或實際供應商災難重建時間驗收。
