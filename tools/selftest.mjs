// AI招募教練 自我測試。
//
//   node tools/selftest.mjs        跑全部
//   node tools/selftest.mjs 1      只跑第 1 節
//
// 第 1 節是規則層：不需要金鑰、不花任何額度，每次改版都要跑。
// 之後的節次（真的呼叫 Gemini）會在各功能開發時加上，跑之前要先問豪老師（會用到額度）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as own from '../docs/engine/owner.js';
import * as acct from '../docs/engine/account.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'docs');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const only = process.argv[2];

let pass = 0, fail = 0;
const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log(`${c ? '  ok  ' : ' FAIL '} ${m}${!c && x ? ' → ' + x : ''}`); };
const section = (n, title) => (!only || only === String(n)) && (console.log(`\n=== ${n}. ${title} ===`), true);

// 遞迴列出 docs/ 底下的程式與頁面
const files = (dir, ext) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(d =>
  d.isDirectory() ? files(path.join(dir, d.name), ext) : ext.test(d.name) ? [path.join(dir, d.name)] : []);

if (section(1, '規則層（不用金鑰）')) {
  // ── 和 AI業務教練同網域：儲存空間不能撞名 ──
  ok(Object.values(own.KEYS).every(k => k.startsWith('recruit.')), '個人資料的鍵名都以 recruit. 開頭');
  const app = read('docs/app.js');
  const aicoachRefs = app.split('\n').filter(l => /['"`]aicoach\./.test(l));
  ok(aicoachRefs.length === 1 && aicoachRefs[0].includes("getItem('aicoach.apikey#'"),
    'app.js 只「讀取」AI業務教練的金鑰是否存在，不寫入任何 aicoach. 鍵', aicoachRefs.join(' | '));
  const engineAicoach = files(path.join(DOCS, 'engine'), /\.js$/)
    .filter(f => /['"`]aicoach[.-]/.test(fs.readFileSync(f, 'utf8'))).map(f => path.basename(f));
  ok(!engineAicoach.length, 'engine/ 沒有任何 aicoach 開頭的儲存鍵', engineAicoach.join(', '));
  const accSrc = read('docs/engine/account.js');
  ok(/const ACCT = 'recruit\.acct'/.test(accSrc), '登入狀態存在 recruit.acct（不和 AI業務教練共用）');
  ok(accSrc.includes("'/recruit/' + A.uid") && !accSrc.includes("'/users/'"),
    '雲端資料寫在 /recruit/<uid>（AI業務教練會整份覆寫 /users/<uid>）');

  // ── 依帳號分開存放 ──
  const mem = new Map(), store = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
  let who = 'A';
  const my = own.scoped(store, () => who);
  my.set(own.KEYS.apikey, 'key-of-A');
  who = 'B';
  ok(my.get(own.KEYS.apikey) === null, '換人登入後看不到前一位的金鑰');
  my.set(own.KEYS.apikey, 'key-of-B');
  who = 'A';
  ok(my.get(own.KEYS.apikey) === 'key-of-A', '各帳號的資料互不覆蓋');
  ok(own.scopedKey('k', null) === 'k', '沒有帳號功能時維持原本的鍵名');

  // ── 同步合併：兩邊都不能弄丟紀錄 ──
  const m = acct.merge(
    { history: [{ at: 3 }, { at: 1 }], prefs: { diff: '2', updatedAt: 20 } },
    { history: [{ at: 2 }, { at: 1 }], prefs: { diff: '5', updatedAt: 10 } });
  ok(m.history.map(r => r.at).join() === '3,2,1', '訓練紀錄以時間取聯集、新的在前', m.history.map(r => r.at).join());
  ok(m.prefs.diff === '2', '偏好設定以較新的為準');

  // ── 安全規則：兩個 App 共用一份 ──
  const rules = read('database.rules.json');
  ok(/"users"\s*:\s*\{\s*"\$uid"\s*:\s*\{\s*"\.read"\s*:\s*"\$uid === auth\.uid",\s*"\.write"\s*:\s*"\$uid === auth\.uid"/.test(rules),
    '安全規則保留 AI業務教練的 /users（只能讀寫自己的）');
  ok(/"recruit"\s*:\s*\{\s*"\$uid"\s*:\s*\{\s*"\.read"\s*:\s*"\$uid === auth\.uid",\s*"\.write"\s*:\s*"\$uid === auth\.uid"/.test(rules),
    '安全規則有 /recruit（只能讀寫自己的）');
  const ruleCode = rules.replace(/^\s*\/\/.*$/gm, '');          // 註解裡本來就寫著「不要改成 auth != null」
  ok(!/"\.read"\s*:\s*("auth != null"|true)/.test(ruleCode), '安全規則沒有開放給所有人讀');
  const sibling = path.join(ROOT, '..', 'AiCoach', 'database.rules.json');
  if (fs.existsSync(sibling)) ok(fs.readFileSync(sibling, 'utf8') === rules, 'AI業務教練 repo 的規則檔和這裡一模一樣（從哪邊部署都一樣）');

  // ── PWA ──
  const sw = read('docs/sw.js');
  ok(/const PREFIX = 'recruit-'/.test(sw) && /k\.startsWith\(PREFIX\) && k !== CACHE/.test(sw),
    'Service Worker 只清自己的舊快取（不會刪到 AI業務教練的）');
  ok(/fetch\(req\.url, \{ cache: 'no-cache' \}\)/.test(sw), 'Service Worker 繞過 HTTP 快取（AI業務教練 D026）');
  const shell = [...sw.matchAll(/'\.\/([^']*)'/g)].map(x => x[1]).filter(Boolean);
  const missing = shell.filter(f => !fs.existsSync(path.join(DOCS, f)));
  ok(!missing.length, `預快取清單的 ${shell.length} 個檔案都存在`, missing.join(', '));
  const mf = JSON.parse(read('docs/manifest.webmanifest'));
  ok(mf.id === '/ai-recruit-coach/', 'manifest 的 id 是 /ai-recruit-coach/（和 AI業務教練是兩個 App）');
  const noIcon = mf.icons.map(i => i.src).filter(s => !fs.existsSync(path.join(DOCS, s)));
  ok(!noIcon.length, 'manifest 的圖示檔都存在', noIcon.join(', '));
  const html = read('docs/index.html');
  ok(mf.shortcuts.every(s => html.includes(`data-fn="${new URLSearchParams(s.url.split('?')[1]).get('go')}"`)),
    '桌面捷徑都對得到首頁的功能');

  // ── 畫面 ──
  ok(/^\[hidden\]\{display:none!important\}/m.test(read('docs/style.css')), 'CSS 有全域 [hidden]{display:none!important}（D046）');
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g), ...app.matchAll(/\.id = '([\w-]+)'/g)].map(x => x[1]));
  const used = [...new Set([...app.matchAll(/\$\('#([\w-]+)/g)].map(x => x[1]))];
  const noEl = used.filter(id => !ids.has(id));
  ok(!noEl.length, `app.js 用到的 ${used.length} 個畫面元件都存在`, noEl.join(', '));
  ok(html.includes('提醒：生成內容僅供自學參考，請勿公開分享。'), '歡迎頁有「生成內容僅供自學參考」提醒');
  ok((html.match(/業務員網路言行不得涉及招攬保險或招募行為/g) || []).length >= 2, '歡迎頁與首頁都有「網路言行」提醒');
  ok(!/type="file"/.test(html), '沒有任何上傳檔案的入口（GPT 版：嚴禁接受截圖）');

  // ── 原始碼衛生 ──
  // shell → Python 寫檔時 \b、\n 會變成真的控制字元（AI業務教練 D037）
  const bad = files(DOCS, /\.(js|html|css|webmanifest)$/).concat(files(path.join(ROOT, 'tools'), /\.mjs$/))
    .filter(f => /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(fs.readFileSync(f, 'utf8'))).map(f => path.relative(ROOT, f));
  ok(!bad.length, '原始碼裡沒有控制字元', bad.join(', '));
}

console.log(`\n${fail ? '❌' : '✅'} ${pass} 項通過${fail ? `，${fail} 項失敗` : ''}\n`);
process.exitCode = fail ? 1 : 0;      // Windows 上 process.exit() 會觸發 libuv 斷言
