# 備份與恢復

## 雲端備份

每 24 小時嘗試產生完整一致快照，固定 Firestore readTime，每步最多 20 筆新帳本及其結果，並分頁處理錢包與公告。checkpoint 可續作；50 分鐘未完成的候選捨棄後從最後有效快照重試。通過驗帳才發布，保留最近三份。

archive format 2 使用 AES-256-GCM 分塊與認證目錄，相容 format 1 還原。上限 128 MiB／8,192 塊，達八成提醒、超限拒絕，不截斷歷史。備份超過 48 小時未成功會保護玩家 API。

恢復落差以最後有效 readTime 為準，不以下載時間計算。目標約 24 小時加備份完成時間，故障時可能更久；本機演練時間不代表真實雲端 RTO。金鑰與備份分開保管，Git 忽略不等於加密或存取權限。

## 下載與隔離演練

以下來源是現有測試服務，正式資料必須改用已核對的環境、專案、namespace、金鑰及 origin。

```powershell
npm run wallet:recovery -- backup --env .env.cloud.local --key-file data/backup-keys/cloud-key.txt --environment test --project slot-game-203db --namespace jokers-circus-v2-20261024-test --out backups/customer-recovery/example-backup
npm run wallet:recovery -- drill --archive backups/customer-recovery/example-backup/archive.json --key-file data/backup-keys/cloud-key.txt --environment test --out backups/customer-recovery/example-drill
```

backup 只下載既有有效快照，不觸發新備份、不 pause／export、不增加 Firestore 讀寫。drill 還原到新 SQLite，以本機 API 核對全部錢包及重播 spin／簽到／重設；前後七表與來源 archive 須不變。錯誤金鑰、環境、來源、跨群、分頁或驗帳失敗均拒絕，既有輸出不覆蓋。單群資料可加 `--guild <群ID>`。

需要通知時才加 `--notify-webhook-file <私密檔> --notify-guild <群ID> --notify-channel <頻道ID>`，事前核對目的地。只傳摘要；結果不明不自動重貼。手動工具的 4xx 包含 429 會 blocked，不同於排程監控的重試規則。通知失敗不抹去已成功的備份／演練結果。

## 事故處理

1. 核對玩家、群、時間與原請求。持續異常時先 pause 並等待已開始交易完成，保留最新資料及事故證據。
2. 程式故障只回退相容程式，不能倒灌昨天餘額。相容版本須理解 welcome、週簽到、reset version 2、archive format 2。
3. 需要換來源時，先確認原 writer 停止，取得最新一致快照、驗帳及原額度；新目的地必須空白。
4. 恢復後核對全部餘額、原請求去重、簽到及歷史，要求重新登入，再驗證告警與入口。無法恢復的區間明確告知。

跨日備份、金鑰保管及七表還原的歷史證據位於 `backups/customer-wallet-readiness-20261027/`。60 錢包／5 人並行隔離恢復可用 `npm run test:recovery` 重驗；歷史紀錄不代表正式客戶資源已建立。

## 回退到 Node，保留雲端新增資料

同一 v2 Firestore 仍是權威來源，因此此回退不需要把資料搬回過期 v1。先停止雲端 writer，再帶回它消耗的額度與最新備份；不能只啟動舊 Node 程序。

```powershell
npm run cloud:control -- pause --env .env.cloud.local
npm run cloud:control -- backup --env .env.cloud.local
# 重複 backup，每次執行一個 checkpoint，直到 complete=true；失敗先檢查額度。
npm run cloud:control -- export --env .env.cloud.local --to backups/cloud-handoff/released.json
npm run cloud:handoff -- restore --from backups/cloud-handoff/released.json --key-file data/backup-keys/cloud-key.txt --environment test --to backups/cloud-handoff/returned.sqlite
npm run cloud:handoff -- return-quota --from backups/cloud-handoff/released.json --handoff backups/cloud-handoff/handoff.json --env .env.server.local
```

`pause` 拒絕新請求並等待遊戲／指令／派送結束；backup 使用最後進度並含公告訊息狀態。`export` 必須在 paused、無進行中工作、完整快照與遠端 revision 一致時執行，會永久設為 **released**。重複 export 得到同一 receipt，不再消耗遠端讀取；遺失回應仍可重取。released 物件不能再次 activate，也不能重新 seed。

`return-quota` 將雲端相對原 handoff 新增的用量加回**原三個檔案**，保留意外的本機新增用量、儲存成長及更高的文件估算；每個檔案都有 receipt，重做不重複累加。原檔缺失時拒絕，不建立替代檔。完整解密／驗帳及三組額度回傳成功後，再以原 v2 設定執行 `npm run firestore:backup` 取得新驗證快照，確認七張表與 returned.sqlite 一致，將新的 metadata 配對作為 Node backup baseline，恢復 Node 遊戲、維護與唯一公告派送器。重新確認公開網址與 Discord 入口。

若雲端完全無法匯出／釋放，不能假定它已停止或用舊額度開啟 Node；先恢復雲端控制／隔離寫入，再取回資料。此限制避免雙 writer 與額度重置。未來再次移至雲端需要新的完整交接設計，不能刪除已釋放 DO 來重開。


## SQLite 可攜式加密

雲端 JSON archive 與 `.jcbak` 是不同格式。以下工具只處理已驗帳的本機快照，不連 Firestore。

```powershell
# 一次建立私密金鑰；已有檔案時拒絕覆蓋，不輸出內容。
npm run backup:portable -- keygen --key-file data/backup-keys/private.key

# 匯出時指定「已產生的完整快照」，不要直接複製運行中的 SQLite 主檔。
npm run backup:portable -- export --from backups/your-verified-snapshot.sqlite --to backups/encrypted/snapshot.jcbak --key-file data/backup-keys/private.key --environment test

# 驗證完整解密、SHA-256、餘額／帳本／回合／原請求，不發布還原檔。
npm run backup:portable -- verify --from backups/encrypted/snapshot.jcbak --key-file data/backup-keys/private.key --environment test

# 只還原到全新檔案，不覆蓋資料庫、不自動切換服務。
npm run backup:portable -- restore --from backups/encrypted/snapshot.jcbak --to data/recovery/new-wallet.sqlite --key-file data/backup-keys/private.key --environment test
```

環境必須明確填 `test` 或 `production`，來源、加密檔與還原環境需一致。`export`／`verify` 的本機暫存預設為 `data/portable-backup-work`，可用 `--work-directory` 指定其他私密本機目錄。`restore` 在目的檔同磁碟暫存，確保驗證後才發布。

金鑰必須另存一份到可恢復的私密位置，例如密碼管理器的安全附件；不要和加密檔放在同一個共享資料夾，也不要提交 Git。失去金鑰就無法解密。Windows 的檔案權限仍由所在資料夾 ACL 管理，`0600` 不能代替系統 ACL。正式使用前確認備份與金鑰各自可取回。

## 完整性與失敗行為

- 使用 AES-256-GCM、每次新的 96-bit 隨機 nonce 及 128-bit 驗證標記；格式、環境、快照大小／雜湊／建立時間的標頭也納入驗證。參照 [Node.js Crypto 文件](https://nodejs.org/api/crypto.html#class-decipheriv)。
- 逐塊加密／解密，不把整份資料讀入記憶體；目前單份快照上限 256 MiB，超過就拒絕，不截斷歷史。
- 匯出先透過 `VACUUM INTO` 建立含已提交 WAL 的一致快照，驗帳後加密，再完整解密驗證一次才發布。
- 解密的驗證標記與 SHA-256 通過後，才開啟 SQLite 驗帳；所有表原值保留，包含公告事件與訊息狀態。
- 金鑰錯誤、資料遭修改、截斷、附加內容、環境錯誤或資料驗帳失敗，都不發布還原檔。已存在的目的檔一律拒絕，不會覆寫原備份或使用中的資料。
- 用同磁碟硬連結完成不覆蓋的發布；不支援硬連結的檔案系統會拒絕。先在本機 NTFS／相容檔案系統產生驗證完成的加密檔，再傳送至雲端。不得因失敗改成覆寫原資料。
- 一般失敗會清除本次擁有的暫存檔；程序或主機突然中斷可能留下 `.partial` 或私密暫存目錄。未完成檔不當成備份，不自動清理來源或其他檔案。


歷史相容備援保存在 `backups/latest-reset-20261027/compatible-recovery/`，只能在核對當下設定與資料格式後使用。舊部署識別碼只供追溯，不自動視為安全回退目標。

## 一次性清除測試玩家

僅適用 `test`、v2、名稱以 `-test` 結尾的帳本。這是清除錢包、簽到、遊玩及原請求紀錄，與 `/戲籌管理` 的餘額重設不同；不提供正式帳本清除功能。

1. 停止所有 writer，將雲端設為 paused，完成最新備份並下載、解密驗帳。
2. `npm run testdata:reset -- plan --archive <archive.json> --key-file <私密金鑰> --out <新私密目錄>` 產生文件清單。計畫包含玩家 ID，不能提交 Git。
3. 核對 project、namespace、revision 與數量；僅在部署獲准後，暫時將測試 Worker 的 `TEST_DATA_RESET_ID` 設為計畫的 operationId。此旗標預設不存在。
4. `npm run testdata:reset -- prepare --env <私密環境檔> --plan <plan.json> --confirm "DELETE ALL TEST PLAYERS"`，之後以相同參數改用 `step`，直到 complete。
5. 中斷時維持 paused，以原計畫續作。若出現未列入的文件，停止並調查，不擴大刪除範圍。檢查空帳本快照及保留備份，確認完成才重新 activate，移除暫時旗標。

程序分批刪除並驗證集合為空，保留用量計數及原備份，失敗不自動恢復服務。新帳本有獨立識別，舊登入、舊下注快取及舊管理確認卡失效。新玩家重新開啟遊戲後才建立錢包。實際清理前須核對當下額度足夠；不可清空 quota 來繞過額度限制。

本機 QA 先停止服務、核對環境與完整備份，再將舊資料庫移至私密備份位置並建立空庫；不得帶入舊 WAL／SHM。`data/` 內的 Firestore quota、金鑰與備份不屬於玩家資料。
