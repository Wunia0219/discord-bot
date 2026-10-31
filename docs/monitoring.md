# Cloudflare 用量預警

`.github/workflows/cloudflare-usage.yml` 在 GitHub 每 15 分鐘讀取 Cloudflare 官方帳戶彙總，不呼叫玩家 API、不寫入 Firestore／DO。現有每十分鐘的遊戲健康／備份／Firestore 保守估算告警仍由 `jokers-circus-monitor` 負責。

## 一次設定

在 [GitHub → Settings → Secrets and variables → Actions](https://github.com/Wunia0219/discord-bot/settings/secrets/actions) 新增：

| 類型 | 名稱 | 值 |
| --- | --- | --- |
| Variable | `CF_ACCOUNT_ID` | 遊戲所屬 Cloudflare Account ID；本機正式 Wrangler 設定的 `account_id` |
| Secret | `CF_ANALYTICS_TOKEN` | 專用 token：Account → Account Analytics → Read，只允許該帳戶 |
| Secret | `CF_USAGE_DISCORD_WEBHOOK` | 私人維護頻道 webhook；不要使用公開遊戲公告 webhook |

[Cloudflare token 設定](https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/api-token-auth/)；不得放入 Git、聊天、前端或使用 Wrangler OAuth 代替長期憑證。合併至預設分支 `main` 後，從 **Actions → Cloudflare usage → Run workflow** 手動驗證；正常用量保持安靜，完整表格在該次 run 的 Summary。自動排程只執行預設分支，PR 不執行、不取得 Secrets。

## 判斷與通知

| 官方指標 | Free 參考線 |
| --- | ---: |
| Worker／DO 請求 | 各 100,000／日 |
| SQLite 讀取／寫入 | 5,000,000／100,000 列／日 |
| DO 活躍時間 | 13,000 GB-s／日 |
| SQLite 儲存 | 5 GB（不每日歸零） |

來源：[Workers](https://developers.cloudflare.com/workers/platform/pricing/)、[DO](https://developers.cloudflare.com/durable-objects/platform/pricing/)。統計包含同帳戶的正式、測試、監控及其他應用；請求、SQL 列數與 Firestore 文件數分開計算。

- 每項達 80%、90%、100% 各升級一次；同級不重貼。每日窗口是 UTC 午夜至午夜，台灣 08:00 重設。
- 最近最多一小時平均速率預估會在重設前用盡時提前提醒，預估兩小時內耗盡再升級；新的一天至少觀察十五分鐘。流量改變或官方指標延遲都會影響預測，不能保證一定提前通知。
- 儲存以各 namespace 近 24 小時峰值合計作保守參考，並非即時帳單；不每天重發，低於 70% 後才重新準備下一次提醒。
- API 失敗顯示「用量未知」，故障與恢復各通知一次，不當成零用量。無玩家資料、憑證或 mentions。

通知意圖先保存為 GitHub artifact，成功才 POST；完成狀態再保存，保留 7 天。429 等待後重查當前風險，過時警示取消；逾時／5xx／中斷送出可能已成功，保留 `uncertain`，不盲目重貼。新門檻仍可升級通知。遇到 `blocked`／`uncertain`，先核對維護頻道及 webhook，再決定是否重送；不要刪除狀態附件以強制重送。歷史查詢、狀態缺損或摘要失敗會讓 workflow 失敗，應開啟 GitHub Actions 失敗通知作為備援。

公開 repo 的標準 GitHub runner 執行免費；這個工作不安裝 npm 套件，附件只含少量彙總與通知狀態。既有 CI 附件／其他工作仍占 GitHub 儲存配額。[GitHub 計費](https://docs.github.com/en/billing/concepts/product-billing/github-actions)

GitHub 排程可能延遲，公開 repo 連續 60 天無活動會停用排程；定期確認最後成功時間，避免將它視為保證即時的告警服務。[排程限制](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

這項監測不建立訂閱、不停用遊戲。目前依 Free 參考線判斷；未啟用 Workers Paid 時，供應商硬上限仍可能中斷操作。日後升級 Paid，這份表仍只是免費線參考，不能代替付費月用量／帳單。方案及成本見[Cloudflare 費用](cloudflare-costs.md)。
