# Discord Activity 私人測試接入

目前已加入官方 Embedded App SDK 2.5.0，等待 Discord READY 後再開啟遊戲。一般瀏覽器模式仍可直接使用。此階段不取得使用者身分，籌碼與紀錄仍在本機儲存；SDK READY 不代表完成 OAuth 登入。

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

此命令先建置，再於 `http://127.0.0.1:4188` 提供 `dist/` 內的靜態遊戲，避免把開發伺服器和原始專案經由隧道公開。原有的 `npm run dev` 使用 4187，可繼續獨立使用。

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
4. 此次只做 READY 握手，尚未呼叫 authorize/authenticate；OAuth Redirect URI 和 Client Secret 留待帳號登入階段設定。

## 5. 在 Discord 內驗證

使用 Application 擁有者帳號進入測試伺服器的頻道，在應用程式啟動器搜尋應用程式名稱並啟動。

- 遊戲完成載入；桌面寬畫面右上角標示「Discord 試玩」，窄畫面可由「遊玩介紹」確認模式。
- 阿努比斯 idle 正常；SPIN 後仍能停輪、顯示贏線、播放 action 與跳分。
- 音效按鈕可手動開啟；縮放 Activity 不產生主頁捲動或遮住操作。
- 切離與重新進入不會白屏。不同網址或裝置的本機帳本不保證共享，這不是 Discord 帳號錢包。
- 再測 Discord 手機端的載入、音效與版面；先在 Activities → Settings → Supported Platforms 啟用需要的 iOS／Android 平台。
- 新版依可用寬高切換桌面、直向與橫向排列，並在 READY 後請求 UNLOCKED 方向。測試空白鍵 SPIN，以及開啟紀錄／介紹時不會誤觸下注。
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
