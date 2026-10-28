# 基本資料保護

## 已有保護

- Discord 互動檢查 Ed25519 簽章與時間；OAuth 驗證本人及群成員，session 最長一小時，定期重驗成員資格。
- 錢包 API 從 session 取得群與玩家，不信任請求指定的帳號。管理面板每次重驗群、頻道、開啟者與角色。
- 登入／session 限流、JSON／互動請求大小限制、有限結算佇列；原子交易與 request ID 防重複扣款。
- API 與私有管理回應 `no-store`；錯誤不回傳資料庫、檔案路徑或憑證。玩家名稱採文字節點，Discord 停用 mentions。
- Node 只提供 dist，拒絕隱藏檔、路徑穿越與外部符號連結。本機 QA 僅 loopback，拒絕轉送及外站 Origin。
- Firestore 用後端服務帳號，瀏覽器規則拒絕直接讀寫。Cloud sessions 與備份加密；監控 token 只有唯讀權限。

## 瀏覽器防護

Node／Worker 共用 `server/http/security-headers.js`：nosniff、no-referrer，停用不需要的相機、麥克風、定位、付款及 USB 權限。HTML 的 CSP 限制腳本為本站、禁止 inline script／eval、禁止外部表單及 base URL，允許 Discord 嵌入、官方頭貼及必要的 blob worker。

Vite 建置從同一份設定產生 `dist/_headers`，讓直接由 Cloudflare 靜態資源服務回傳的頁面也套用政策，不必增加 Worker 請求量。

PixiJS 使用 `pixi.js/unsafe-eval` 提供的靜態替代實作，以支援禁止 eval 的政策；模組名稱不表示開放 eval。現有 DOM 排版需 inline style，仍保留此項；CSP 是額外防線，不能取代輸入驗證。

## 憑證與備份

Client Secret、Google 私鑰、管理 token、Webhook、備份金鑰不得出現在 `VITE_*`、Git、前端、聊天或公開日誌。`.env*`、`data/`、`backups/`、`.tools/` 被忽略；交付打包只取指定產物，不能壓縮整個工作區。

備份與金鑰分開存於私密位置，Windows 以資料夾 ACL 控制；`0600` 不能取代 ACL。疑似外洩時先撤銷／輪替相應憑證，核對操作與備份，不單純刪除日誌。新金鑰不能讓舊備份失去解密能力。

HTTPS、平台帳號 MFA、最小 IAM 權限及供應商存取紀錄由部署帳戶核對。程式回歸不等於滲透測試或供應商稽核；線上保護須以實際部署驗證。

## 依賴限制

2026-10-28 的 `npm audit --omit=dev` 仍回報 Discord SDK 2.5.0 使用的 Zod 3.25.76 有[大型集合驗證耗盡記憶體風險](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)：2 個 high 相依警示，屬同一漏洞，`fixAvailable=false`。SDK 要求 Zod 3，公告修復版為 4.6.6；跨主版本替換需另驗相容性。此結果是當日紀錄，後續以重新執行 audit 為準。

SDK 在瀏覽器處理 Discord 訊息並檢查來源；後端錢包不使用 Zod，HTTP 大小限制不能修補 SDK 解析。待 SDK 相容修補後重驗 Discord 登入，此警示仍未解決。

依據：[OWASP HTTP Headers](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html)、[CSP](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html)。
