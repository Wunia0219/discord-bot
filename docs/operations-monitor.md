# 獨立維運監控與通知

2026-10-26，版本 **0.2.7**。已依使用者當次授權，在「記事小本本 → 私人 #bot維護」建立「Joker’s Circus 維運通知」，保存至同帳戶獨立監控 Worker Secrets。遊戲唯讀監控支援與獨立 Worker 已部署，一組明確標示的模擬故障／恢復通知已在 Discord 確認。首次跨日備份還原驗收也已完成，見 [雲端手冊](cloud-runtime.md)。雲端 Cron 執行證據記錄於本頁末尾。

## 目前可用的功能

- 遊戲 Worker 的私有 `GET /__ops/status` 增加版本、備份／alarm 新鮮度、整體與維護／公告子額度的使用百分比及告警摘要。
- 遊戲 `/healthz` 使用 `package.json` 的產品版本，避免前端已升版、健康檢查仍寫死舊版。
- `cloud:control health` 唯讀核對維運摘要及版本；異常或遠端版本與本機不同時以非零狀態結束。`status` 保留原完整管理輸出。
- 新 `CLOUD_MONITOR_TOKEN` 只能讀遊戲 `GET /__ops/status`，不允許 POST、seed、啟用、暫停、備份、下載、驗證或釋放 writer。原 admin token 的用途不變，監控必須使用另一個隨機 token。
- 獨立 `jokers-circus-monitor` Worker 以每 10 分鐘的 Cron 呼叫自己的 SQLite DO，再唯讀查詢遊戲狀態。它不使用遊戲 DO、Firestore、Google 憑證、加密金鑰或 admin token，不操作玩家資料與遊戲額度。

維運狀態查詢只讀既有 DO 狀態及用量，不向 Firestore 發出查詢、不手動觸發備份。使用百分比沿用應用程式既有的保守額度估算，不是供應商即時帳單。程式未加入停輪測速、服務端耗時彙總或區域探測。

```powershell
# 使用現有私密雲端環境檔；若提供 CLOUD_MONITOR_TOKEN，status/health 優先使用它。
npm run cloud:control -- health --env .env.cloud.local
npm run cloud:control -- status --env .env.cloud.local
```

本機版本與線上不同時，`health` 的 `versionMatches=false` 是待發布提示，不代表遊戲故障；此命令不會部署或修復服務。

## 告警與通知規則

| 情況 | 等級 |
|---|---|
| 遊戲服務無法連線、未啟用，或監控授權失效 | 嚴重 |
| 備份狀態缺失／失敗，或最後有效備份超過 48 小時 | 嚴重 |
| 最後有效備份超過 26 小時，尚未到 48 小時 | 提醒 |
| alarm 缺失／失敗，或超過 30 分鐘未更新 | 嚴重 |
| 任一整體／維護／公告額度已達上限，或無法確認額度 | 嚴重 |
| 任一額度使用量達八成 | 提醒 |

相同告警組合連續兩次檢查後才通知；啟動時一切正常不發訊息。使用百分比持續變動不重貼同一警報，警報種類或等級改變才建立新的通知；全部恢復正常也須連續確認兩次，再發一則恢復通知。重複排程至少間隔一分鐘才重新探測。以上為監控節流與去抖，與已驗收的遊戲計時無關。

每次 POST 前先持久保存送出意圖；成功回應須包含訊息 ID 才確認。429 依 `Retry-After`／`retry_after` 等待後重試；等待期間已恢復且尚未發出的警報會取消。4xx 拒絕保留 `blocked`，網路中斷、5xx、無法確認訊息或重啟前仍為 `sending` 則保留 `uncertain`，不盲目重貼同一通知。因此回應遺失時可能略過通知，不宣稱 exactly-once 傳遞。

訊息只包含固定的異常說明、額度範圍及檢查時間；沒有玩家名稱、ID、下注、餘額、帳本、token 或 Webhook。`allowed_mentions.parse=[]`，不提及玩家、角色或 everyone。私有監控狀態會保留最後檢查、告警、確認與派送狀態，不保存上游原始錯誤內容。

## 日後指定通知位置時的設定

設定範本為 `deploy/monitor.env.example`，獨立設定檔為 `wrangler.monitor.jsonc`，預設 `MONITOR_ENABLED=false`。目的地未指定前維持停用，不把範本當作已啟用服務。

1. 確認使用現有 Workers Free；保留遊戲 Worker、DO、v2 帳本與全部原額度。監控使用自己的 `CircusMonitor` 類別及 migration，不能覆蓋遊戲設定或重新 seed 遊戲。
2. 產生新的 32-byte 隨機值；在遊戲 Worker 以 Secret `CLOUD_MONITOR_TOKEN` 保存，在監控 Worker 以 Secret `MONITORED_TOKEN` 保存同值。不要重用 admin token，或把它放入 `VITE_` 設定。
3. `MONITORED_ORIGIN` 填目前已確認的固定 `workers.dev` origin，不帶路徑、帳密或 query。監控只向該網址的 `GET /__ops/status` 傳送唯讀 token，不跟隨重新導向。
4. 使用獨立的私密 Discord 維運頻道，將對應 Webhook 存為監控 Worker 的 `MONITOR_WEBHOOK_URL` Secret；確認頻道與得獎公告不同。監控設定不接受遊戲的 `DISCORD_HIGHLIGHTS_WEBHOOK_URL`。不把憑證貼到聊天、日誌或 Git。
5. 完成 build／隔離測試後，才另行發布既有遊戲更新及獨立監控，將監控 `MONITOR_ENABLED=true`。若未提供 Webhook，檢查結果可保留，但通知狀態為 `unconfigured`，不對外傳送。
6. 以已核對的目的地安排實際通知驗收，包含一次問題與恢復；未驗收前仍將「外部告警接通」保留為待完成。

監控 Worker 公開只供應 `GET /healthz`，顯示設定與通知位置是否已提供；它不代表已完成一次探測。`GET /__ops/status` 須使用唯讀 token，才能查看最後檢查、告警、派送狀態及下次重試時間；不提供公開觸發檢查或任何遊戲寫入功能。

獨立 Worker 不依賴個人電腦或遊戲的 alarm，因此可發現遊戲單獨停止。它仍與遊戲共用 Cloudflare 平台；整個平台故障或通知服務不可用時，仍需日後另選第三方監控補足。Cron 設定的實際生效及真實通知驗收須在部署時確認，隔離測試不代替雲端驗收。

## 驗證與來源

```powershell
npm test
npm run test:cloud
npm run test:monitor
npm run build
```

`test:cloud` 使用官方 Firestore emulator 與真正 workerd，驗證唯讀 token 無法呼叫任何管理 POST、status 不增加 Firestore 額度，以及原結算／備份／回退契約。`test:monitor` 在真正 workerd 中以測試 wrapper 呼叫 scheduled handler，驗證 DO 重啟去重、恢復通知與公開存取保護；可控時鐘只存在測試 wrapper，不隨正式 Worker 發布。所有外部傳輸均為測試替身。

平台介面參照 [Cloudflare scheduled handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/)、[Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)與 [Discord Webhook](https://docs.discord.com/developers/resources/webhook#execute-webhook)。

## 10/26 實際接通與回退

- 遊戲後端版本：`6e2e5db1-b384-4627-bc30-c7063d412d1b`，0.2.7 唯讀監控支援；監控入口：`https://jokers-circus-monitor.nini900219.workers.dev`，Cron 每 10 分鐘。
- 遊戲只加入 `CLOUD_MONITOR_TOKEN`。原五組 Secrets、全部原變數、同一 DO namespace、Firestore 美國區域入口與 v2 範圍逐項保持一致。監控 Worker 只有 `MONITORED_TOKEN`、`MONITOR_WEBHOOK_URL`，不保存 admin、Google 或備份金鑰。
- 使用官方 [keep_assets](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/) 保留線上既有前端與政策頁；入口 HTML、主要 JS/CSS 雜湊一致。這不是完整的 0.2.7 前端發布，分支新介面／政策內容仍待另行驗收發布。
- 唯讀 token 可 GET status；未授權查詢及 pause／backup／archive／export／activate／seed／verify POST 均被拒絕。測試未執行管理動作，也未啟動本機 Firestore writer。
- 正式 readiness、health、雲端 Discord 診斷通過。首次使用預設本機診斷，因已停機本機服務與靜態頁轉址而失敗；改用既有 `--cloud` 模式後通過，沒有重新啟動本機 writer。
- 模擬通知送達 #bot維護，訊息 ID `1564192334130839683`、`1564192336605478943`。使用正式 ServiceMonitor 引擎與真實 Webhook，模擬探測與時鐘僅在本機驗收腳本；不是正式事故，未存取玩家資料。
- 實際維護子額度 reads 5682/6000（94.7%）提醒；整體 reads 7500/40000、backup revision 1088 與 alarm 正常。保留原 24 小時滾動額度，不提高上限或手動觸發備份消耗剩餘額度。

部署前程式、設定、前端雜湊、前後 status 與通知回執保存在忽略 Git 的 `backups/monitor-activation-20261026/`。其中私密環境備份須當憑證保管，不能分享。原跨日備份、還原 SQLite、獨立加密金鑰與額度均保留；本次沒有 seed、資料格式遷移或 writer 交接。

只需撤回監控時，先將獨立監控 Worker 的 `MONITOR_ENABLED` 改為 `false`，保留其他設定與 Secrets。若要回退本次遊戲程式，先停用監控避免舊版拒絕 token 造成誤報，再將同一遊戲 Worker 回退至 `c7ae9254-91eb-47bd-ac4d-bd3d95389d08`。只回退程式，保留現行 DO、額度與最新 Firestore；不可接回過期 v1 或舊帳本。回退後核對 readiness、source、backup/alarm、額度與原前端雜湊。跨主機／資料回退仍遵循 [雲端交接手冊](cloud-runtime.md)的停 writer、最新快照及 ownership 流程。

台灣時間 **2026-10-26 16:30:33.495** 已觀察到首次真正雲端 Cron 檢查（`checkedAt=1793003433495`），未使用手動觸發。它正確讀到維護子額度提醒；第一次尚未達連續兩次門檻，`confirmed=false`、`delivery=idle`，符合去抖規則。Cron 設定 API 確認每 10 分鐘，健康檢查 200、私有狀態拒絕未授權、公開 `/check` 不存在；監控雲端 Secrets 僅有唯讀 token 與專用 Webhook。證據：`backups/monitor-activation-20261026/cron-verification.json`、`cron-schedule.json`。模擬通知傳輸與實際 Cron 探測分開記錄，不把測試訊息冒充真實故障通知。
