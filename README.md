# AI招募教練｜豪老師 Hao+

保險業務主管（以及準備晉升、開始做招募的業務夥伴）的招募演練工具。
在正式與招募對象面談之前，先和 AI 扮演的招募對象用語音演練，練完拿到五項能力評分與教練回饋。

**👉 網址：https://zjh0511.github.io/ai-recruit-coach/**

> ⚠️ 提醒：生成內容僅供自學參考，請勿公開分享。
> 業務員網路言行不得涉及招攬保險或招募行為。
> 本工具不提供法律、稅務、醫療或財務建議。

---

## 開發進度

架構沿用 [AI業務教練](https://github.com/zjh0511/ai-sales-coach)（從 AiCoach 複製後獨立修改）。
完整規劃見 [【AI招募教練】開發企劃書.md](【AI招募教練】開發企劃書.md)，決策紀錄見 [project/DECISION_LOG.md](project/DECISION_LOG.md)。

| 階段 | 內容 | 狀態 |
|---|---|---|
| 0 | 開專案：登入、首頁、模型設定、訓練紀錄、加到主畫面 | ✅ |
| 1 | 招募對象痛點分析 | 開發中 |
| 2 | 招募邀約電訪演練（語音） | — |
| 3 | 招募面談技巧演練（語音） | — |
| 4 | 問問招募教練＋收尾 | — |

---

## 架構

- **純前端 PWA，放在 GitHub Pages**：沒有伺服器、沒有冷啟動。
- **使用者自帶免費的 Google AI Studio 金鑰**：瀏覽器直接呼叫 Gemini，金鑰只存在使用者自己的裝置。
- **帳號與訓練紀錄同步用 Firebase**：和 AI業務教練共用同一個 Firebase 專案（同一組帳號兩邊都能登入），
  招募教練的資料放在 `/recruit/<uid>`，AI業務教練在 `/users/<uid>`。

### 和 AI業務教練放在同一個網域要注意的事

兩個 App 都在 `zjh0511.github.io`，瀏覽器把它們當成同一個網站：

| 項目 | 做法 |
|---|---|
| localStorage | 鍵名一律 `recruit.` 開頭（AI業務教練是 `aicoach.`） |
| Service Worker 快取 | 快取名稱 `recruit-v*`；清舊快取時只清自己的 |
| Firebase 安全規則 | 一個專案只有一份。`database.rules.json` 同時包含兩個 App 的規則，**兩個 repo 的這個檔案必須一模一樣** |

### 檔案

```
docs/                  ← GitHub Pages 網站根目錄
  index.html           單頁 App
  app.js               畫面流程
  style.css            第 9 行全域 [hidden]{display:none!important}
  sw.js                Service Worker（network-first，VERSION 每次改版 +1）
  manifest.webmanifest PWA 設定：圖示與桌面捷徑
  guide.html           API 金鑰申請教學
  voice.js             收音與朗讀（階段 2 起使用）
  firebase-config.js   Firebase 公開設定
  engine/
    api.js             本地 API 層
    gateway.js         模型備援、重試、額度降級
    account.js         帳號與雲端同步（Firebase REST，無 SDK）
    owner.js           個人資料依帳號分開存放
    tts.js             Gemini 真人語音輪替（階段 2 起使用）
    zhtw.js            簡轉繁保險絲
tools/
  selftest.mjs         自我測試（第 1 節不用金鑰）
  fbcheck.mjs          帳號同步與安全規則的端到端檢查
  serve.mjs            本機開發用靜態伺服器
  gencert.mjs          本機 HTTPS 憑證
參考資料/               保險業務員管理規則摘錄（合規詞庫的依據）
```

**零外部相依**，只用瀏覽器與 Node 內建 API，沒有 `node_modules`。

---

## 在自己電腦上開發

需要 Node.js 20 以上、Git for Windows（產生憑證用）。

```bash
node tools/gencert.mjs      # 產生本機 HTTPS 憑證（手機用麥克風必須走 HTTPS）
node tools/serve.mjs        # 電腦 http://localhost:8444，手機 https://<區網IP>:8443
node tools/selftest.mjs     # 自我測試
```

每次改版：`sw.js` 的 `VERSION` +1 → 跑 selftest → commit → push → iPhone 實機測試。

---

## 授權與免責

© 豪老師 Hao+。本專案原始碼公開供學習與測試參考，保留所有權利；
未另行取得書面同意前，請勿用於商業用途或轉散布為自有產品。

本工具為**招募溝通訓練用途**，不構成保險、法律、稅務、醫療或財務建議。
生成內容可能有誤，收入、制度與法規適用，一律以所屬公司公告及主管機關規定為準。
