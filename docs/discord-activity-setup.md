# Discord Activity 私人測試接入

## 最新測試環境：2026-10-18 v5

前後端已更新為 `circus-20-v5`：參考使用者提供的 243 路輪帶頻率，沿用現有賠率與 20 條固定線，五軸各 80 格；高分圖標占 27.5%～40%、WILD 占 2.5%～6.25%。精確 RTP 96%、自然最高派彩 200 倍。完整數量、原表差異、可重現驗證見 [v5 模型](model-v5.md)，完整五軸陣列在 [reels.json](../output/reel-design-v5/reels.json)。

62 項自動測試通過；完整加權枚舉涵蓋全部 3,276,800,000 組停點，再跑 100 萬局交叉核對。更新前已備份 `backups/test-2026-10-18T15-23-56-344Z.sqlite`，本機與既有公開通道 `/healthz` 均確認為 v5。舊 v1～v4 回合保留原始規則、停點、派彩與餘額；後端重送相同請求不重複扣款。

關閉並重新開啟 Discord Activity 登入，在遊玩介紹確認 `circus-20-v5` 與「五軸各 80 格」。Portal 的網址設定沿用既有通道。瀏覽器已核對新版賠率表、80 格與圖標比例；Discord 內體驗仍需使用者確認。

## 歷史更新：2026-10-18 v4

目前後端及前端已更新為 `circus-20-v4`。套用 V1 賠率、WILD 與 H1 同為單線 20／100／500 倍；五軸各 200 格，高分占 10%～10.5%、WILD 占 2%～2.5%，精確 RTP 96%，自然最高派彩仍為總下注 200 倍。完整數學與實際演出機率見 [v4 模型](model-v4.md)。

58 項自動測試通過，另完成涵蓋全部 320,000,000,000 組停點的加權枚舉。更新前已備份至 `backups/test-2026-10-18T15-01-16-053Z.sqlite`，再重啟試玩後端；本機及既有公開通道 `/healthz` 都確認為 v4，首頁及新版 JS HTTP 200。舊錢包帳本保留。關閉並重新開啟 Discord Activity 登入，在遊玩介紹確認 `circus-20-v4`；Portal 的兩個網址設定不需更改。Discord 內新版體驗仍需使用者試玩確認。

瀏覽器已核對 v4 規則與完整賠率表，最高獎真實盤面預覽在下注 100 時顯示派彩 20,000、8 條得獎線，籌碼前後維持 10,000。驗證畫面保存在 `test-results/v4-paytable-preview.png`。

## 歷史更新：2026-10-18 v3

目前通道為 `sounds-pound-reg-dean.trycloudflare.com`，Activity `/` Mapping 使用此主機；Interactions Endpoint 為 `https://sounds-pound-reg-dean.trycloudflare.com/api/interactions`。下方舊通道名稱屬歷史修復紀錄。

已將試玩後端更新為 `circus-20-v3`：BIG 20、SUPER 50、MEGA 200 倍，自然最高派彩 200 倍、精確 RTP 96%。本機及公開 `/healthz` 均已確認為 v3，公開首頁與新版 JS HTTP 200。更新前已用 VACUUM INTO 備份 SQLite，舊錢包與紀錄保留；關閉並重新開啟 Activity 登入即可，無需再次修改 Portal 網址。

57 項自動測試通過，含 v1／v2 舊回合與重送保存。瀏覽器實際檢查 BIG／SUPER／MEGA 預覽：下注 100，派彩分別 2,300／15,165／20,000，預覽後餘額保持 10,000。Discord 內的新版體驗留待使用者試玩確認。數學與機率見 [v3 模型](model-v3.md)。

目前已加入官方 Embedded App SDK 2.5.0，等待 Discord READY 後再開啟遊戲。本機測試版已設定後端密鑰並啟用 OAuth 基本身分登入，使用者已確認在 Discord 實際登入成功；SDK READY 不代表完成 OAuth 登入。一般瀏覽器模式仍可直接使用。已新增伺服器錢包，測試版不匯入舊瀏覽器餘額；設定與驗收方式見 [錢包與正式交付](wallet-and-release.md)。

## 1. 使用者準備

1. 在 Discord 的「使用者設定 → 進階」開啟「開發者模式」。
2. 準備自己可管理的測試伺服器與語音頻道。
3. 前往 https://discord.com/developers/applications ，選取既有 Application，或建立新 Application。名稱與圖示可稍後修改。
4. 從 General Information 複製 Application ID。這是公開識別碼，本階段不需要 Bot Token 或 Client Secret。

未公開發佈的 Activity 啟動權限有限，先使用 Application 擁有者帳號測試；其他測試人員需依 Discord 的開發團隊／測試者設定取得權限，不能假設伺服器所有人都能啟動。

## 2. 設定並啟動遊戲

將 `.env.example` 複製成 `.env.local`，填入：

```dotenv
VITE_DISCORD_CLIENT_ID=你的ApplicationID
```

`VITE_` 變數會出現在前端建置，不可放 Token 或 Secret。`.env.local` 已被 Git 忽略。更改 ID 後需要重新建置。

在專案目錄執行：

```powershell
npm run activity:serve
```

此命令先建置，再由 Node 後端於 `http://127.0.0.1:4188` 提供 `dist/` 內的靜態遊戲與 `/api/token`，避免把開發伺服器和原始專案經由隧道公開。先依下方「基本身分登入」建立 `.env.server.local`；原有的 `npm run dev` 使用 4187，可繼續獨立使用瀏覽器模式。

## 3. 取得臨時 HTTPS 網址

Windows 測試工具放在 `.tools/cloudflared.exe`（不提交 Git、不安裝系統服務）。若檔案不存在，請從 [Cloudflare 官方下載頁](https://developers.cloudflare.com/tunnel/downloads/) 取得 Windows 64-bit 執行檔。

另開一個 PowerShell，在專案目錄執行：

```powershell
.\.tools\cloudflared.exe tunnel --url http://127.0.0.1:4188 --http-host-header localhost:4188
```

複製輸出的 `https://某個名稱.trycloudflare.com`。此網址能被持有連結的人存取，不等於有登入保護的私人網站。只提供測試遊戲；保持上述兩個程序運行，電腦關機／停止隧道後網址失效。重新啟動隧道通常會換網址，需要更新下一步的設定。

## 4. Developer Portal

1. 選取相同的 Application。
2. **Activities → URL Mappings** 新增並儲存：

   | Prefix | Target |
   | --- | --- |
   | `/` | 上一步的主機名稱，例如 `某個名稱.trycloudflare.com`，不含 `https://` |

3. **Activities → Settings** 開啟 **Enable Activities** 並儲存。官方流程會建立預設的 Launch 入口，不必先撰寫 Bot 指令。
4. READY 握手後依下方「基本身分登入」設定 OAuth；本機測試版已完成並由使用者確認登入成功。

## 基本身分登入（使用者已確認實機登入成功）

1. OAuth2 → Redirects 新增 `https://127.0.0.1` 並儲存。這是官方 Activity 教學的占位網址，SDK 處理回到 Activity；使用者已完成此步。
2. 在專案根目錄建立 `.env.server.local`（本機已建立），內容如下。只在自己的電腦填入 Client Secret，不要貼到聊天或提交 Git：

   ```dotenv
   DISCORD_CLIENT_ID=1561284960986599626
   DISCORD_CLIENT_SECRET=
   PORT=4188
   ```

3. 密鑰填妥後，在 `.env.local` 新增 `VITE_DISCORD_AUTH_ENABLED=true`。Client Secret 只能放後端設定檔，不可加 `VITE_` 前綴。
4. 停止舊的 4188 靜態預覽程序，執行 `npm run activity:serve`。既有隧道仍指向 4188，可沿用目前 URL Mapping；只重建前端、卻仍使用舊 Vite preview 服務會缺少登入 API。
5. 關閉並重新開啟 Discord Activity，同意 `identify` 基本身分授權。右上方顯示「Discord 已登入」，「遊玩介紹」會列出登入名稱與 Discord ID（手機也能查看）。取消或失敗會顯示可重試的錯誤，不會冒充登入成功。

後端僅回傳 SDK 身分驗證所需的 access token，禁止快取、不記錄 token／密鑰、不回傳 refresh token；伺服器錢包新增最多 1 小時的記憶體 Session，後端重啟需重新登入，SQLite 帳本則持久保存。前端只保留基本 user 資料；登入授權與錯誤路徑已用模擬 Discord API 測試，使用者已於 2026-10-18 確認真實 Discord 登入成功。未啟用 OAuth 時繼續原本 Activity 試玩模式。

## 5. 在 Discord 內驗證

使用 Application 擁有者帳號進入測試伺服器的頻道，在應用程式啟動器搜尋應用程式名稱並啟動。

- 遊戲完成載入；桌面寬畫面右上角標示「Discord 試玩」，窄畫面可由「遊玩介紹」確認模式。
- 馬戲團素材載入正常；SPIN 後仍能停輪、顯示贏線、播放 WIN 與跳分。
- 音效按鈕可手動開啟；縮放 Activity 不產生主頁捲動或遮住操作。
- 切離與重新進入不會白屏。不同網址或裝置的本機帳本不保證共享，這不是 Discord 帳號錢包。
- 再測 Discord 手機端的載入、音效與版面；先在 Activities → Settings → Supported Platforms 啟用需要的 iOS／Android 平台。
- 桌面版依可用寬高等比例縮放相同構圖，操作列固定在機台下方；手機版才切換直向與橫向排列，並在 READY 後請求 UNLOCKED 方向。測試空白鍵 SPIN，以及開啟紀錄／介紹時不會誤觸下注。
- 本機重新建置後，關閉再啟動 Discord Activity 以載入新版。外層黑邊可能由 Discord 的 Activity 容器決定，不能只靠遊戲 CSS 保證消除。

## 排查

- 找不到 Activity：確認開發者模式、Application 所屬帳號／團隊、URL Mapping 與 Enable Activities；重新開啟啟動器搜尋名稱。
- 無法載入：確認 4188 服務及 cloudflared 還在執行，Mapping 沒有填 `https://`，且是最新的隧道主機名稱。
- 缺少 Application ID：填寫 `.env.local` 後重新執行 `npm run activity:serve`。
- Discord 連線逾時：確認 ID 對應同一個 Portal Application，從 Discord 啟動，關閉再重新開啟 Activity。
- 原本籌碼沒出現：localhost、公開網址與 Discord 代理是不同來源，本機儲存不會自動搬移。

## 參考與驗證範圍

- [Discord 官方接入指南](https://docs.discord.com/developers/activities/building-an-activity)
- [Discord 本機開發](https://docs.discord.com/developers/activities/development-guides/local-development)
- [Discord 代理與網路](https://docs.discord.com/developers/activities/development-guides/networking)
- [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)

自動測試驗證一般瀏覽器回退、設定錯誤、等待 READY、逾時處理及方向解鎖請求，使用模擬 SDK。使用者已完成 Portal 設定並回報成功在 Discord 內試玩。自適應新版已在瀏覽器測試多種視窗尺寸；Discord 新版版面與手機端仍須實機確認。

## 2026-10-18 測試通道修復

舊的 `corn-acquire-lamps-detected.trycloudflare.com` DNS 回覆 NXDOMAIN，本機 4188 服務正常。已重新建立 Quick Tunnel：`stanford-glance-imposed-server.trycloudflare.com`，首頁與最新主程式 HTTP 200。使用者已將 Discord Portal 的 `/` URL Mapping Target 改成此新主機名稱，並確認重新開啟 Activity 後可正常遊玩。

目前通道程序與網址資訊保存在不提交 Git 的 `.tools/activity-tunnel.json`，診斷日誌在 `test-results/activity-tunnel.stderr.log`。此為臨時網址，不能視為固定部署地址。

同日已將 4188 的舊 Vite preview 替換為 Node 登入後端，沿用上述隧道。後端程序資訊保存在 `.tools/activity-server.json`；未記錄密鑰或 Token。已確認公開首頁／新版 JS 為 HTTP 200，空授權碼回傳預期的 HTTP 400，密鑰檔網址回傳 404，前端 JS 未包含後端密鑰。連線檢查後，使用者已重新開啟 Activity 並確認 Discord 身分登入成功。
