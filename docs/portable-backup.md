# 加密備份與離線還原

`npm run backup:portable` 使用已驗帳的 SQLite 完整快照，產生可攜式 `.jcbak` 加密檔；這個工具本身不連 Firestore、不開遊戲服務，也不改任何雲端資料。

2026-10-24 現況：Discord 服務已移至 Cloudflare，雲端加密備份已下載還原並逐表比對。現行備份先以 `cloud:control archive` 下載，再依 [雲端手冊](cloud-runtime.md)使用對應恢復工具；雲端 JSON archive 與本頁 `.jcbak` 是不同格式。雲端 active 時不得用本機 `firestore:backup` 直接存取現行資料，Node 來源流程僅供隔離開發或完成 writer／額度交接後使用。

## 操作

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

本工具負責本機快照的可攜式加密，不建立雲端排程。現行 Cloudflare 排程及下載還原已另行實作並驗證；首次跨日自動備份含新增進度的驗收、恢復金鑰獨立保管及額外 Google Drive 副本狀態，統一見 [收尾計畫](roadmap.md)。

## 2026-10-23 實測資料演練

14:19 的最新 Firestore 快照包含 2 個錢包、779 筆帳本、777 筆原請求結果、763 局及 0 筆真實公告。與 14:01 備份相比，新增的 5 局及對應帳本／去重均已納入，舊帳本／回合／原請求逐列保持不變。

獨立封存於 `backups/post-discord-play-20261023/`：`source.sqlite`、來源 metadata、`post-discord-play.jcbak`、`restored-rehearsal.sqlite`、`manifest.json`。金鑰另存於被 Git 忽略的 `data/backup-keys/portable-20261023.key`，未上傳。

加密還原後全部七張表逐列相等，v2 匯入指紋相等；結果見 `test-results/portable-post-discord-play-report.json`。此快照之後的新增進度，仍須在真正切換前停止 writer、再取最新備份，不以本次演練取代切換驗證。

完整回歸 314 項、Firestore 模擬器 52 項全數通過，無跳過。加密還原後的快照也完成 v2／v1 演練：777 筆原請求各重送一次共 1,554 次，沒有新增寫入；隔離演練新增的簽到與一局遊戲在回退後仍保留。備份專項涵蓋 WAL、錯誤金鑰／環境、標頭／密文／驗證標記遭修改、截斷／額外資料，以及拒絕覆蓋來源、既有備份與金鑰。
