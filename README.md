# Joker’s Circus

Discord Activity：5×3 轉輪、243 路，後端負責算獎、戲籌、週簽到及請求去重，各群錢包獨立。產品版本 **1.0.2**，唯一版本來源為 `package.json`；玩法識別碼 `circus-243-v2` 另行維護。

## 開發與驗證

需要 Node.js **24.22.1+（24 LTS）**、npm **12.2.1+（12.x）**；圖片工具另需 Python／Pillow，Firestore 模擬器需 Java 21。

先進入儲存庫根目錄（可看到 `package.json`）。Windows PowerShell 執行 `. .\scripts\setup\setup-toolchain.ps1`，下載經 SHA-256 核對的專案專用 Node x64／npm，並設定目前 shell 的 PATH。其他系統依 `.node-version` 安裝 Node，再執行 `npm install --global npm@12.2.1`。

Windows 若已安裝專案工具鏈，但 PowerShell 阻擋 `.ps1`，可直接啟用，不必調整執行原則：

```powershell
$projectNodeVersion = (Get-Content .node-version -Raw).Trim()
$projectNodePath = (Resolve-Path ".tools/node-x64/node-v$projectNodeVersion-win-x64").Path
$env:Path = "$projectNodePath;$env:Path"
node --version
npm.cmd --version
```

此 PATH 只對目前視窗生效；Windows 後續指令使用 `npm.cmd`，避免命中受阻擋的 `npm.ps1`。尚未安裝工具鏈時，先依上方版本需求安裝 Node／npm。

```sh
npm ci
npm run dev
```

瀏覽器試玩：`http://127.0.0.1:4187/`。完整本機錢包驗收：`npm run validation:start`，開啟 `http://127.0.0.1:4192/wallet-test`。

固定檢查入口為 `npm run verify`；準備 Java 21 與 Firestore emulator 後，用 `npm run verify:full` 執行完整檢查。合併前用 `npm run verify:ci` 加跑慢幀／輸入延遲及 CSP 非同步回歸，並一次彙整獨立失敗；首次須以 `npx playwright install chromium` 安裝鎖定的瀏覽器。以上只建置與驗證，不部署；步驟與 CI 見[測試文件](docs/testing.md)。

## 文件

| 分類 | 文件 |
|---|---|
| 程式與專案結構 | [架構／資料流程／檔案分類](docs/architecture.md)、[測試](docs/testing.md) |
| 雲端與資料庫 | [部署](docs/deployment.md)、[Firestore 結算儲存](docs/settlement-storage.md)、[Cloudflare 費用](docs/cloudflare-costs.md)、[監控](docs/monitoring.md) |
| 維運與交付 | [正式服交付](docs/customer-handoff.md)、[備份恢復](docs/recovery.md)、[資料保護](docs/security.md) |
| Discord | [指令與管理](docs/discord-commands.md)、[賭場公告](docs/casino-announcements.md) |
| 遊戲與素材 | [玩家體驗](docs/player-experience.md)、[停輪基準](docs/reel-timing-baseline.md)、[數學](docs/game-math.md)、[素材](docs/assets.md) |

Cloudflare 已升級 Workers Paid（2026-10-31 使用者確認）。正式服使用獨立 Worker／DO 與台灣 `asia-east1` Firestore v2 帳本，雲端為唯一 writer，本機 `FIRESTORE_LIVE_ENABLED=false`。發布版本、來源與驗收結果見[正式服交付](docs/customer-handoff.md)；Git 合併與部署分開處理。
