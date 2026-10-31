# 監控與用量

| 監控 | 執行位置 | 資料與通知 |
|---|---|---|
| 遊戲健康 | `jokers-circus-monitor`，每 10 分鐘 | 唯讀 DO 狀態、備份、alarm、Firestore 保守預留；連續兩次異常／恢復才通知 |
| Cloudflare 用量 | GitHub `cloudflare-usage.yml`，每 15 分鐘 | 官方帳戶彙總；Free 門檻／預測，Paid 每日觀測；API 故障／恢復 |

兩者都不下注、不修改帳本。Cloudflare 方案與 Firestore `notify-only` 是不同設定；Firestore 八成提醒不因升級 Workers Paid 而停用。遊戲健康條件見[部署](deployment.md#獨立監控)。

## 外部排程設定

在 [GitHub Actions 設定](https://github.com/Wunia0219/discord-bot/settings/secrets/actions) 配置：

| 類型 | 名稱 | 值 |
|---|---|---|
| Variable | `CF_ACCOUNT_ID` | 遊戲的 Cloudflare Account ID |
| Secret | `CF_ANALYTICS_TOKEN` | 該帳戶的 Account Analytics → Read 專用 token |
| Secret | `CF_USAGE_DISCORD_WEBHOOK` | 私人維護頻道 webhook，勿用遊戲公告頻道 |

Workflow 的 `CLOUD_PLAN` 已設 `paid`（2026-10-31 使用者確認）；CLI 必須明確提供 `CLOUD_PLAN=free|paid`，不猜測方案。`node scripts/cloud/cloudflare-usage.js dry-run` 只查詢與輸出摘要，不發通知。憑證不得放入 Git、聊天、前端，亦不可用 Wrangler OAuth 代替長期監控 token。[token 權限](https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/api-token-auth/)

排程只在預設分支執行，PR 不取得 Secrets。合併後用 **Actions → Cloudflare usage → Run workflow** 驗證；正常狀態安靜，表格保存在 run Summary。Secrets 存在不代表內容或權限已驗證。

## Free 與 Paid 判斷

- **Paid（現行）**：顯示 UTC 當日 Worker／DO 請求、SQL 讀寫、DO 活躍時間與近 24 小時儲存峰值合計；只通知用量 API 故障與恢復，不發 Free 耗盡警示。未量測月累計、Worker CPU 或 GB-month，付費內含量與帳單查 Cloudflare Billing。
- **Free（相容）**：Worker／DO 各 100,000 次／日，SQL 讀 5,000,000／寫 100,000 列／日，DO 13,000 GB-s／日，儲存 5 GB。80%、90%、100% 各通知一次；最近最多一小時速率預測會在重設前耗盡時提醒，至少觀察 15 分鐘。
- Free 每日窗口為 UTC 午夜至午夜（台灣 08:00 重設）；儲存不每日歸零，低於 70% 才重新準備提醒。官方值可能延遲，預測不是帳單。
- 切換 Free → Paid 取消尚未送出的 Free 額度重試；API 故障狀態仍保留。方案變更不能讓結果不明的舊訊息再次送出。

指標含同帳戶所有應用，Firestore 文件數不能替代 SQL 列數。來源：[Workers](https://developers.cloudflare.com/workers/platform/pricing/)、[DO](https://developers.cloudflare.com/durable-objects/platform/pricing/)；價格集中於[費用文件](cloudflare-costs.md)。

## 發送與故障處理

`monitor/usage/analytics.js` 查官方 API，`policy.js` 判斷方案，`notifications.js` 維護去重狀態；`monitor/discord.js` 負責發送分類。API 錯誤顯示「用量未知」，不當成零。

通知意圖先存 artifact，成功後才 POST，完成狀態再保存（保留 7 天）。429 到期重新查風險；過時提醒取消。逾時／5xx／中斷保存 `uncertain`，不盲目重貼；`blocked`／`uncertain` 須核對頻道及 webhook，勿刪狀態強制重送。歷史或狀態缺損讓 workflow 失敗，應啟用 Actions 失敗通知作備援。

GitHub 排程可能延遲，公開 repo 60 天無活動可停用排程；需確認最近成功時間。[排程限制](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) 標準公開 runner 與 artifact 儲存分開計算，見 [GitHub 計費](https://docs.github.com/en/billing/concepts/product-billing/github-actions)。
