# AI招募教練 決策紀錄

> 編號用 **R** 開頭（R001 起），避免和 AI業務教練的 D 編號混淆。
> 每筆寫：決定了什麼、為什麼、實測數據或依據、犯了什麼錯、學到什麼。
> 沿用自 AI業務教練的設計，引用時寫「AI業務教練 Dxxx」。

---

## 2026-10-08｜R001 從 AI業務教練複製一份獨立修改

**決定**：沿用 AiCoach（zjh0511/ai-sales-coach，commit 3092e9c）的純前端 PWA 架構，複製後獨立修改（企劃書 Q2-A）。

**搬過來的**：gateway.js、tts.js、zhtw.js、account.js、owner.js（簡化）、api.js（只留登入與模型設定）、voice.js、style.css、guide.html＋9 張金鑰教學圖、serve.mjs、gencert.mjs、fbcheck.mjs，以及登入、首頁、模型設定、訓練紀錄、加到主畫面的畫面流程。

**沒搬的**：商品行銷、理賠諮詢、文件上傳（docx.js、knowledge.js、store.js）、OpenRouter 登入（oauth.js）、更新前舊資料的認領流程（新 App 沒有舊資料）、教練聲音的試聽音檔（內容未確認，階段 4 再處理）。

**之後的同步方式**：AiCoach 修了基礎建設（gateway、tts、voice、account）的 bug 時，手動搬過來，並在這裡記下來源 commit。

---

## 2026-10-08｜R002 和 AI業務教練同網域：所有共用資源都要分開命名

**背景**：兩個 App 都在 `zjh0511.github.io`，瀏覽器的 localStorage、Cache Storage、IndexedDB 是整個網域共用的。

**決定**：

| 資源 | AI業務教練 | AI招募教練 |
|---|---|---|
| localStorage 鍵名 | `aicoach.*` | `recruit.*` |
| 登入狀態 | `aicoach.acct` | `recruit.acct`（兩個 App 各自登入、各自登出） |
| SW 快取 | `aicoach-v*` | `recruit-v*` |
| Firebase 資料 | `/users/<uid>` | `/recruit/<uid>` |
| manifest id | `/ai-sales-coach/` | `/ai-recruit-coach/` |

**為什麼資料不放在 `/users/<uid>/recruit`**：AiCoach 的 `push()` 用 PUT 整份覆寫 `/users/<uid>`，招募教練的資料會被蓋掉。

**發現 AiCoach 的一個問題（未修）**：AiCoach 的 `sw.js` 在 activate 時刪掉「所有」名稱不是自己的快取，會連 `recruit-v*` 一起刪。影響只有「招募教練的離線快取被清掉」，有網路時完全不受影響（network-first）。要修的話改 AiCoach 的 `sw.js` 一行並 VERSION +1，待豪老師決定。

**金鑰**：不自動帶入 AI業務教練的金鑰（那是另一個 App 的資料），只在同帳號用過時提醒「可以貼同一把」。

---

## 2026-10-08｜R003 共用 Firebase 的安全規則

**決定**（企劃書 Q3-A）：安全規則加上 `/recruit/$uid`（只能讀寫自己的），與 `/users/$uid` 放在同一份 `database.rules.json`，兩個 repo 的檔案內容必須相同。

**做法**：豪老師在瀏覽器登入 Firebase 控制台；規則用已登入的 Firebase CLI 部署（`firebase deploy --only database`），控制台畫面確認已更新。

**驗證**：
- 未登入對 `/users`、`/recruit`、`/recruit/<任意>`、根目錄讀取，以及對 `/recruit/test` 寫入，一律 401。
- 「登入後只讀得到自己的」要等登入同步做好後跑 `tools/fbcheck.mjs`。這支會在正式專案建立並刪除一個測試帳號，由豪老師執行。
- selftest 檢查兩個 repo 的規則檔一模一樣。

---

## 2026-10-08｜R004 合規詞庫以全國法規資料庫為準

**決定**：合規詞庫一律以全國法規資料庫的〈保險業務員管理規則〉為準（豪老師指定）。

**依據**：查閱現行版本（民國 114 年 01 月 02 日修正，pcode G0390016），與招募最直接相關的是第 19 條第 1 項第 6 款「未經所屬公司同意而招聘人員」，其餘對照見 `參考資料/保險業務員管理規則_摘錄.md`。詞庫草案在階段 2 前交豪老師逐條確認。

---

## 2026-10-08｜R005 第一版不做職稱設定；接觸情境分四種

**背景**：會做招募的不只業務主管，也包含想晉升主管的業務夥伴；緣故關係不會自稱職稱，只有陌生開發才可能說（豪老師說明）。

**決定**：不做職稱設定。示範話術依接觸情境決定：緣故、轉介紹不提職稱；陌生開發才用「我是○○人壽的○○」。接觸情境：緣故（親友、老同學、前同事）、轉介紹、陌生開發、既有客戶（自己的保戶）。

---

## 2026-10-08｜R006 暫用文字圖示

**決定**：正式 App 圖示由豪老師提供（企劃書 Q7）。在那之前用程式產生的文字圖示（藍底白字「AI 招募」），不使用 AiCoach 的品牌主視覺 `brand-hao.jpg`（品牌主視覺每次使用前都要先問）。
