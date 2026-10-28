# 架構與資料契約

前端使用 PixiJS／Vite；Node 與 Cloudflare 共用驗證及錢包核心。線上由單一 Durable Object 管理專案額度、登入與排程，Firestore v2 是權威帳本。產品版本以 `package.json` 為準。

## 模組

| 位置 | 責任 |
|---|---|
| `src/main.js` | 啟動、操作狀態與畫面協調 |
| `src/game/` | 現行規則、輪帶、算獎及歷史規則 |
| `src/platform/` | Discord 登入、錢包請求及歷史同步 |
| `src/ui/reels/` | 場景、停輪、快停與自動旋轉 |
| `src/ui/dealer/`、`src/ui/audio/`、`src/ui/wins/` | 荷官、聲音、得獎演出 |
| `src/ui/player/`、`src/ui/dialogs/`、`src/ui/shared/` | 玩家資訊、視窗及共用畫面元件 |
| `server/index.js`、`server/config.js` | Node 啟動與後端選擇 |
| `server/http/`、`server/discord/` | API、簽章、權限及私人指令回覆 |
| `server/wallet/` | 共用錢包規則、session、SQLite 結算 |
| `server/sqlite/`、`server/firestore/` | 儲存、查詢、驗帳、遷移 |
| `server/recovery/`、`server/operations/` | 備份恢復、交接及維運 |
| `server/testing/` | 僅限 loopback 的本機假帳號 |
| `cloud/` | REST 傳輸、DO 狀態、加密備份及 HTTP 入口 |
| `monitor/` | 獨立唯讀監控及通知 |
| `scripts/admin/` | 本機、雲端維運、模擬器及恢復工具 |
| `scripts/assets/`、`scripts/audio/` | 素材製作、無損檢查及音效預覽 |
| `scripts/game/` | 數學驗算與模型匯出 |
| `scripts/qa/`、`scripts/qa/helpers/` | 完整驗證入口、瀏覽器情境與共用啟動設定 |
| `scripts/lib/` | 跨 CLI 的 Node 執行工具，不進產品 bundle |
| `scripts/security/` | 鎖定版本的依賴安全回移、雜湊及建置檢查 |

## 檔案分類

| 位置 | 內容與維護原則 |
|---|---|
| 根目錄 | npm／Node／Vite／Docker／Wrangler 設定、網頁入口、README 與維護規範 |
| `.github/workflows/` | CI；只驗證，不部署 |
| `deploy/` | 公開環境範本與 Firestore 規則；私密設定留在忽略版控的 `.env*.local` |
| `docs/`、`docs/data/` | 主題文件及可重現的數學報告；玩法文件由 `export:model` 產生 |
| `images/`、`audio/`、`public/` | 執行時素材與政策頁，路徑由建置／載入程式引用 |
| `art/dealer/` | 原畫、參考、原幀、HD 圖集、設計候選與來源紀錄；不作為 runtime 載入 |
| `output/` | 可重建的模型交付 JSON |
| `tests/*.test.js` | 一般回歸；`*.integration.js` 為模擬器／workerd 情境 |
| `tests/helpers/`、`tests/fixtures/` | 獨立算獎 oracle、測試工具、固定像素基準及測試 Worker |
| `node_modules/`、`dist/`、`.wrangler/` | 忽略版控的相依套件、建置及本機 Worker 產物 |
| `.tools/`、`test-results/` | 忽略版控的工具快取、一次性維運腳本及驗證證據；不是產品來源 |
| `data/`、`backups/` | 私密帳本、用量、金鑰及備份；不可當暫存檔批次清除 |

來源素材、歷史規則及備份相容程式各有用途；未被前端匯入不等於可刪除。重新分類以模組責任為準，保留執行資源 URL、匯出格式與既有 CLI 入口。

## 結算與同步

啟動時登入／錢包與舞台準備並行，兩邊完成並還原正確盤面後才開放操作。啟動失敗會立即停止舞台渲染並保留錯誤／重試畫面；待同批晚到素材完成後回收荷官、貼圖、渲染器與 ResizeObserver，避免錯誤畫面背後持續耗用資源。正常進場的載入動畫與淡出時間沿用原設定。

1. 前端保留 request ID，先送結算請求，同步開始動畫；未確認結果時重用原 ID。
2. 後端由 session 決定群與玩家，驗證下注、冷卻及餘額。Firestore 同批讀 metadata、錢包、原請求、每日摘要，再原子提交。
3. v2 一局寫六份文件：metadata、錢包、根帳本、每日摘要、完整回合、原請求結果。重播原請求不新增寫入；未知 commit 結果不盲目重送。
4. 本局與權威餘額回傳後即可停輪；歷史分頁在背景補齊。較舊 revision 不能覆蓋新狀態。
5. 每玩家讀取合併；雲端單一 writer 的純讀快取 30 秒，Node 後端維持 5 秒。前景仍每 15～20 秒刷新。所有結算與管理操作在提交後更新快取，交易一律讀權威文件；快取命中不延長到期時間。慢回應不能覆蓋較新 revision，未知交易結果或傳輸錯誤清除快取並阻止舊請求回填；雲端暫停、重新啟用與重建 runtime 也會失效。

單一結算佇列最多 32 筆含執行中工作；尚未開始的請求最多等待 10 秒，逾時可沿原 ID 重試，已開始交易不取消。停輪與兩秒冷卻依[基準](reel-timing-baseline.md)。

## 儲存契約

Firestore 根路徑 `circus_wallet_v1/<namespace>`，主體為 `json`，查詢鍵另存。SQLite schema 3，Firestore schema 2，均有明確 test／production 環境檢查。

| 資料 | 保存內容 |
|---|---|
| `meta/state` | schema、環境、移入狀態、全域帳本序號 |
| `wallets` | 餘額、週簽到、摘要、revision、最近重設標記 |
| `ledger` | 完整流水與原請求連結；v2 四個純量查詢鍵取代 v1 四份副本 |
| 玩家 `rounds`、`operations` | 原始回合、規則、結果與永久去重 |
| 玩家 `days`、`adminDays`、`reversals` | 每日統計、管理額度與更正關聯 |
| `highlightEvents`、`highlightBoards` | 得獎公告事件、訊息 ID 及派送狀態 |

v2 錢包的 `historyCache` 是最近 100 局的無損 DEFLATE／Base64 快取，解壓上限 2 MiB；完整歷史及去重資料另存。冷登入只讀一份錢包。`compact-v1` 回傳輕量狀態，`/api/rounds` 以固定 `through` 版本補齊；更早歷史每頁最多 50 局。舊 client／v1／SQLite 仍支援完整快照。

週簽到依群、玩家及台灣日期去重，連續七天循環，中斷回第 1 天；原領取憑證保存實際發放金額，設定更動不改寫舊獎勵。新手戲籌與錢包首次建立原子提交。全群重設保留歷史，見[管理操作](discord-commands.md)。

## 遷移與相容性

`FIRESTORE_SCHEMA_VERSION` 須與 metadata 相符；不能只改版本數字或原地轉換。`scripts/admin/import-firestore.js --from <完整快照> --dry-run` 先產生本機規劃；實際移入只接受空白 namespace，分批原子保存進度，逐份驗證後才 ready。沿用原專案額度，不建立第二份計數器。

v2 接受新進度後，不能直接回到舊 v1 帳本。停止 writer、備份驗帳，再匯入另一個空白目的地。回退程式必須支援 welcome、週簽到、reset version 2、archive format 2；[恢復程序](recovery.md)集中管理。
