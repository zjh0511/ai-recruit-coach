# AI招募教練｜豪老師 Hao+

保險業務主管（以及準備晉升、開始做招募的業務夥伴）的招募演練工具。
在正式與招募對象面談之前，先和 AI 扮演的招募對象用語音演練，練完拿到五項能力評分與教練回饋。

**👉 網址：https://zjh0511.github.io/ai-recruit-coach/**

要分享給同事試用：[SHARE.md](SHARE.md) 有一段可以直接貼到 LINE 的使用說明。

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
| 1 | 招募對象痛點分析 | ✅ |
| 2 | 招募邀約電訪演練（語音） | ✅ |
| 3 | 招募面談技巧演練（語音） | ✅ |
| 4 | 問問招募教練（打字／語音） | ✅ |
| 第二版 | 公司招募制度演練（上傳制度文件，最多勾 5 份） | ✅ |
| 之後 | 制度文件接到面談演練與問問招募教練、管理者報表、介紹影片 | — |

## 五大功能

| 功能 | 說明 |
|---|---|
| 🎯 招募對象痛點分析 | 填性別、年齡、背景（或按 10 種範例帶入）→ 三個潛在痛點＋事業機會怎麼回應＋可以直接問的問題、三個最可能的顧慮、建議的接觸方式 |
| 📞 招募邀約電訪演練 | 示範話術稿 → AI 扮演招募對象接電話 → 目標是約到見面 → 五項星等＋教練回饋 |
| 🤝 招募面談技巧演練 | 對方心裡有 2～3 個顧慮、1～2 個動機，問對問題才會說；答應事業說明會或二次面談算成功，願意考照是最佳結果 |
| 📋 公司招募制度演練 | 上傳公司的招募制度（PDF／Word／PPT，最多勾 5 份）→ AI 研讀整理成制度重點（可再產生教練講解）→ 對方追問收入、津貼、晉升、考核 → 回饋逐點檢查必講重點、點出和文件不一樣的說法。文件只存在手機 |
| 💬 問問招募教練 | 產業趨勢、事業機會、話術、顧慮回應、新人留任；可以打字，也可以語音對談 |

- **難易程度**：1 新手友善～5 實戰。對方卡住時會像真人一樣問「你找我什麼事？」，引導 3 次（新手友善 5 次）仍講不清楚就委婉拒絕。
- **合規**：每一句都比對〈保險業務員管理規則〉，高風險說法當場暫停，回饋時點名條次。
- **資料誠實**：AI 不給收入數字，一律「以公司制度為準」。

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
  voice.js             收音與朗讀
  audio/               教練聲音試聽檔（不花語音額度）
  firebase-config.js   Firebase 公開設定
  engine/
    api.js             本地 API 層
    gateway.js         模型備援、重試、額度降級
    account.js         帳號與雲端同步（Firebase REST，無 SDK）
    owner.js           個人資料依帳號分開存放
    tts.js             Gemini 真人語音輪替
    prompts.js         提示詞：招募對象人設、示範話術、角色扮演、評分、教練問答
    session.js         演練狀態機：引導次數、結果分級、評分規範化（程式管規則）
    advisor.js         痛點分析、問問招募教練
    compliance.js      合規詞庫（保險業務員管理規則）
    knowledge.js       制度文件：研讀整理、教練講解、必講重點、數字核對
    docx.js            Word／PPT 取字（瀏覽器內解 ZIP）
    store.js           制度文件存在手機的 IndexedDB（依帳號分開）
    zhtw.js            簡轉繁保險絲
tools/
  selftest.mjs         自我測試（第 1、2 節不用金鑰；第 3～6 節呼叫 Gemini）
  uitest.mjs           畫面端到端測試（無頭 Edge，iPhone 尺寸，會截圖）
  keys.mjs             讀 D:\Hao+App\API Key.txt 的測試金鑰（不印出）
  bump.mjs             改版：VERSION +1、所有檔案引用的 ?v= 一起更新
  fixtures/            虛構的制度文件（測試用，不是真實公司的制度）
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
node tools/selftest.mjs 1   # 規則層，不用金鑰
node tools/selftest.mjs 2   # 演練規則（假的模型），不用金鑰
node tools/selftest.mjs     # 全部，含真的呼叫 Gemini（約 35 次）
node tools/uitest.mjs       # 畫面端到端（約 20 次，不花真人語音額度）
node tools/fbcheck.mjs      # 帳號同步與安全規則（會建立並刪除一個測試帳號）
```

每次改版：`node tools/bump.mjs`（sw.js 的 VERSION +1，所有檔案引用的 `?v=` 一起更新）→ 跑 selftest → commit → push → iPhone 實機測試。

---

## 管理者報表（只有專案擁有者跑得動）

```bash
node tools/report.mjs
```

產生兩個 CSV（含 UTF-8 BOM，Excel 與 Google Sheets 都能直接開）：

| 檔案 | 內容 |
|---|---|
| `AI招募教練_成員總表.csv` | 每人一列：姓名、E-mail、登入方式、演練次數、最後演練、平均星等、五項能力各自平均、成功約到下一步幾次、願意考照幾次、合規提醒次數、三種演練各練幾次、目前難度 |
| `AI招募教練_演練明細.csv` | 每次演練一列：時間、模式、招募對象、結果、五項分數、必講重點、講錯幾處、合規提醒、教練總結、下次挑戰 |

帳號和 AI業務教練共用，報表只列**登入過 AI招募教練**的人。裝了 Google 雲端硬碟桌面版會自動寫進「AI招募教練報表」資料夾；
也可以用 `--out "資料夾"` 指定，`--no-detail` 只出總表。

> ⚠️ 報表包含同事的演練評分與教練回饋，是**個人表現資料**，不會進 repo（.gitignore）。放在哪裡、給誰看，請比照人事資料處理。

---

## 授權與免責

© 豪老師 Hao+。本專案原始碼公開供學習與測試參考，保留所有權利；
未另行取得書面同意前，請勿用於商業用途或轉散布為自有產品。

本工具為**招募溝通訓練用途**，不構成保險、法律、稅務、醫療或財務建議。
生成內容可能有誤，收入、制度與法規適用，一律以所屬公司公告及主管機關規定為準。
