# 基本資料保護

## 已有保護

- Discord 互動檢查 Ed25519 簽章與時間；OAuth 驗證本人及群成員，session 最長一小時，定期重驗成員資格。
- 錢包 API 從 session 取得群與玩家，不信任請求指定的帳號。管理面板每次重驗群、頻道、開啟者與角色。
- 登入／session 限流、JSON／互動請求大小限制、有限結算佇列；原子交易與 request ID 防重複扣款。
- API 與私有管理回應 `no-store`；錯誤不回傳資料庫、檔案路徑或憑證。玩家名稱採文字節點；Discord 私人回覆及維運通知停用 mentions。賭場公告僅允許已驗證玩家 ID 的明確 mentions，不解析暱稱中的 everyone、身分組或其他標記。
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

## 相依套件維護

Node 使用 `.node-version` 的 24 LTS 安全版本；npm 12 的 `allowScripts` 僅允許鎖定版本的 esbuild／workerd 安裝原生執行檔，停用 protobufjs 的提示腳本與可選 fsevents 編譯。`.npmrc` 拒絕舊工具鏈及未審核的安裝腳本；新增或更新含腳本的相依時，須先檢查腳本再更新允許清單，勿使用全部允許。專案本身的 Discord `postinstall` 照常執行。

Vite 8 的 Rolldown／Oxc 建置保留原 Chrome／Edge 107、Firefox 104、Safari 16 編譯目標；Vite 歸為開發相依，Docker 建置後移除開發工具。Miniflare 版本配合穩定 Wrangler 的官方依賴，即使其標籤帶 beta 也不獨立降回舊 runtime。Undici 保留受維護的 7.x 安全修正版，避免強制替換相依套件未採用的 8.x API。

## Firestore 相依修正

Firestore 的舊 `@google-cloud/firestore-api` 支線以 scoped override 固定 `google-gax=5.0.4`、`gcp-metadata=8.1.2`，均符合原 SDK 的相依範圍。這是 npm audit 建議的不含問題依賴之相容版本，移除引入 `rimraf → glob → minimatch` 的支線；不是將最新版強塞進舊 SDK。Firestore 9.4.0 與其主要 Google API 支線保留。更新 SDK 時須重新核對並移除不再需要的 override；以全新 `npm ci`、稽核及 emulator／REST／備份恢復驗證相容性。[glob 公告](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)、[minimatch 公告](https://github.com/advisories/GHSA-g3hv-75wg-m249)

## Discord SDK／Zod 修補

2026-10-28 修補 [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)。保留官方 SDK **2.5.0**，其外部 Zod 相依透過 scoped override 固定為 **4.6.7**。SDK 的發布檔另內含舊 Zod，不能只靠 override 或零警示宣稱修復。

`npm ci` 的專案 `postinstall` 執行 `scripts/security/patch-discord-sdk.js`，對 SDK 內含的 ESM／CommonJS 驗證器回移[上游的集合大小先行檢查](https://github.com/colinhacks/zod/commit/a0ebf97)：超過 array 的 `.max()`／`.length()` 或 set 的 `.max()`／`.size()` 時，在走訪元素前拒絕。原有合法輸入、轉換、較小集合的診斷及 SDK 通訊介面保留；沒有新增玩法限制。Zod 3 的 map 沒有大小上限 API，不套用不存在的 v4 方法。

SDK 的 `.d.ts` 改指向官方 `zod/v3` 相容型別；實際 JavaScript 仍使用已修補的內含驗證器，不切換到 Zod 4 API，也不將外部套件的 v3 runtime 打入遊戲。

修補清單 `scripts/security/discord-sdk-patch.json` 鎖定兩份原始／修補後 SHA-256。未知版本或內容拒絕套用；Vite 建置及完整驗證入口會再次檢查，跳過安裝 scripts 時不能默默產生未修補的正式建置。這是本專案維護的安全回移，並非 Discord 已發布修正版；未來 SDK 升級須重新確認內含程式與型別，再移除或更新回移。

`tests/discord-sdk-security.test.js` 驗證大量非法集合在同步／非同步模式下不走訪元素、兩種模組格式、合法資料、真實 SDK 的 READY／方向鎖定／OAuth／錢包身分與錯誤處理。稽核結果仍需定期重跑，零警示不能取代內含程式的回歸測試；未發布前，線上服務仍使用原建置。

依據：[OWASP HTTP Headers](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html)、[CSP](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html)。
