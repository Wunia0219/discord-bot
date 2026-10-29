# Joker’s Circus

Discord Activity：5×3 轉輪、243 路，後端負責算獎、戲籌、週簽到及請求去重，各群錢包獨立。產品版本 **0.3.2**，唯一版本來源為 `package.json`；玩法識別碼 `circus-243-v2` 另行維護。

## 開發與驗證

需要 Node.js **24.22.1+（24 LTS）**、npm **12.2.1+（12.x）**；圖片工具另需 Python／Pillow，Firestore 模擬器需 Java 21。

先進入儲存庫根目錄（可看到 `package.json`）。Windows PowerShell 執行 `. .\scripts\admin\setup-toolchain.ps1`，下載經 SHA-256 核對的專案專用 Node x64／npm，並設定目前 shell 的 PATH。其他系統依 `.node-version` 安裝 Node，再執行 `npm install --global npm@12.2.1`。

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

| 文件 | 內容 |
|---|---|
| [架構與檔案分類](docs/architecture.md) | 來源、產物、私密資料、模組邊界與同步契約 |
| [部署與維運](docs/deployment.md) | 環境、額度、Discord、監控 |
| [備份與恢復](docs/recovery.md) | 加密、驗帳、事故處理與 writer 交接 |
| [測試](docs/testing.md) | 自動測試、本機入口與人工驗收 |
| [客戶交付](docs/customer-handoff.md) | 單群範圍與交付條件 |
| [資料保護](docs/security.md) | 權限、憑證與瀏覽器防護 |
| [Discord 操作](docs/discord-commands.md) | 指令、管理面板與重設 |
| [玩家體驗](docs/player-experience.md) | 文字、操作與無障礙規則 |
| [停輪基準](docs/reel-timing-baseline.md) | 已驗收且需保留的時間及回饋 |
| [數學](docs/game-math.md) | 輪帶、RTP、賠率與驗算 |
| [素材](docs/assets.md) | 圖集、荷官、聲音與壓縮 |

現行測試服務由 Cloudflare Worker／Durable Object 使用 Firestore v2 帳本。雲端為唯一 writer，本機 `FIRESTORE_LIVE_ENABLED=false` 保留。客戶正式群 ID 尚待提供；正式帳本使用全新資料。正式版本以 `main` 為準，開發分支的修改不代表已合併或發布。
