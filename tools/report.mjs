// AI招募教練 管理者報表：成員總表＋演練明細（CSV，Excel、Google Sheets 都能直接開）。
// 沿用 AI業務教練 tools/report.mjs 的做法。
//
//   node tools/report.mjs                      → 輸出到 Google 雲端硬碟（有裝的話）或 ./報表/
//   node tools/report.mjs --out "資料夾路徑"
//   node tools/report.mjs --no-detail          → 只出總表，不出逐筆明細
//
// 資料來源有兩個，靠 uid 對起來：
//   1. firebase auth:export          → 帳號（和 AI業務教練共用同一份帳號名單）
//   2. firebase database:get /recruit → 招募教練的演練紀錄（AI業務教練的在 /users，這裡不讀）
// 帳號是兩個 App 共用的，所以只列「登入過 AI招募教練」的人：登入時會同步一次偏好設定，
// /recruit/<uid> 有資料就代表登入過。只用過 AI業務教練的人不會出現在這份報表。
//
// 為什麼用 CLI：安全規則對所有人都是拒絕，只有專案擁有者的憑證有管理權限，
// 那份憑證在 firebase CLI 裡（`firebase login` 存下來的）。所以這支腳本只有豪老師自己跑得動。
//
// ⚠️ 這份報表包含同事的演練評分與教練回饋，是**個人表現資料**。
//    產出之後放在哪裡、給誰看，請比照公司的人事資料處理。報表不進版控（.gitignore）。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PROJECT = 'ai-sales-coach-4b4cb';
const args = process.argv.slice(2);
const argOf = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const DETAIL = !args.includes('--no-detail');

const HOME = process.env.USERPROFILE || process.env.HOME || '';
const DRIVE = [
  'G:/我的雲端硬碟', 'G:/My Drive', 'H:/我的雲端硬碟', 'H:/My Drive',
  HOME && path.join(HOME, 'My Drive'),
  HOME && path.join(HOME, 'Google Drive'),
].find(d => d && fs.existsSync(d));
const OUT = argOf('--out') || (DRIVE ? path.join(DRIVE, 'AI招募教練報表') : '報表');

// 和 App 畫面上的名稱一致（GPT 版的五個評分項目）
const NAMES = {
  fluency: '說話流暢度', friendliness: '聲音語調的親切感', awareness: '談話內容的掌握',
  confidence: '自信心', professionalism: '專業度',
};
const MODE = { call: '招募邀約電訪', meet: '招募面談', system: '招募制度說明' };
const DIFF = { 1: '新手友善', 2: '一般', 3: '挑戰', 4: '高難度', 5: '實戰' };

// 直接跑 firebase-tools 的 JS 入口，不經過 firebase.cmd（Node 24 起不允許直接 spawn .cmd）
const CLI = [
  path.join(process.env.APPDATA || '', 'npm/node_modules/firebase-tools/lib/bin/firebase.js'),
  '/usr/local/lib/node_modules/firebase-tools/lib/bin/firebase.js',
  path.join(process.env.HOME || '', '.npm-global/lib/node_modules/firebase-tools/lib/bin/firebase.js'),
].find(p => p && fs.existsSync(p));
if (!CLI) {
  console.error('找不到 firebase-tools。請先執行：npm install -g firebase-tools && firebase login');
  process.exit(1);
}
const fb = (...a) => execFileSync(process.execPath, [CLI, ...a, '--project', PROJECT], {
  encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
});

// ── 取資料 ──────────────────────────────────────────────────
const tmp = path.join(os.tmpdir(), `recruit-auth-${Date.now()}.json`);
let accounts = [], cloud = {};
try {
  fb('auth:export', tmp, '--format=json');
  accounts = JSON.parse(fs.readFileSync(tmp, 'utf8')).users || [];
} finally {
  fs.rmSync(tmp, { force: true });
}
try {
  cloud = JSON.parse(fb('database:get', '/recruit')) || {};
} catch {
  console.log('  （提醒）讀不到雲端演練紀錄，只產出空白報表。');
}

// ── CSV：中文在 Excel 開啟需要 BOM，否則會變亂碼 ─────────────
const cell = v => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const csv = rows => '\uFEFF' + rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
const when = ms => {
  const n = Number(ms);
  if (!n) return '';
  const d = new Date(n), p = x => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length * 100) / 100 : '';
const modeOf = x => x.modeName || MODE[x.mode] || x.mode || '';

// ── 組報表 ──────────────────────────────────────────────────
const byUid = new Map(accounts.map(a => [a.localId, a]));
const users = Object.keys(cloud).filter(u => byUid.has(u)).map(u => byUid.get(u));
const orphans = Object.keys(cloud).filter(u => !byUid.has(u));

const summary = [[
  '姓名', 'E-mail', '登入方式', '帳號建立時間', '最後登入（兩個 App 合計）',
  '演練次數', '最後演練', '平均星等', ...Object.values(NAMES),
  '成功約到下一步', '願意考照', '合規提醒次數',
  `${MODE.call}次數`, `${MODE.meet}次數`, `${MODE.system}次數`, '目前難度',
]];
const detail = [[
  '姓名', 'E-mail', '演練時間', '模式', '招募對象', '結果',
  ...Object.values(NAMES), '本次平均', '必講重點', '講錯幾處', '合規提醒', '教練總結', '下次挑戰',
]];

const rows = users.map(a => {
  const h = cloud[a.localId]?.history || [];
  const prefs = cloud[a.localId]?.prefs || {};
  const per = {};
  for (const k of Object.keys(NAMES)) per[k] = avg(h.map(x => x.scores?.[k]).filter(n => typeof n === 'number'));
  const all = h.flatMap(x => Object.values(x.scores || {})).filter(n => typeof n === 'number');
  const count = m => h.filter(x => x.mode === m).length;
  const name = a.displayName || (a.email || '').split('@')[0];

  summary.push([
    name, a.email, a.providerUserInfo?.[0]?.providerId === 'google.com' ? 'Google' : 'E-mail',
    when(a.createdAt), when(a.lastSignedInAt),
    h.length, when(h[0]?.at), avg(all), ...Object.keys(NAMES).map(k => per[k]),
    h.filter(x => x.tier > 0).length, h.filter(x => x.tier === 2).length,
    h.reduce((s, x) => s + (x.violations || 0), 0),
    count('call'), count('meet'), count('system'), DIFF[prefs.diff] || '',
  ]);

  for (const x of h) {
    const s = Object.values(x.scores || {}).filter(n => typeof n === 'number');
    detail.push([
      name, a.email, when(x.at), modeOf(x), x.name, x.outcome || '',
      ...Object.keys(NAMES).map(k => x.scores?.[k] ?? ''),
      avg(s), Array.isArray(x.kp) ? `${x.kp[0]}／${x.kp[1]}` : '', x.wrong || '', x.violations || '',
      x.summary, x.next,
    ]);
  }
  return { name, email: a.email, sessions: h.length, avg: avg(all), wins: h.filter(x => x.tier > 0).length };
});

// ── 寫檔 ────────────────────────────────────────────────────
fs.mkdirSync(OUT, { recursive: true });
const f1 = path.join(OUT, 'AI招募教練_成員總表.csv');
fs.writeFileSync(f1, csv(summary));
let f2 = null;
if (DETAIL) {
  f2 = path.join(OUT, 'AI招募教練_演練明細.csv');
  fs.writeFileSync(f2, csv(detail));
}

// ── 畫面摘要 ────────────────────────────────────────────────
console.log(`\n  帳號總數 ${accounts.length}（和 AI業務教練共用）　·　登入過 AI招募教練 ${users.length} 人　·　演練總次數 ${detail.length - 1}\n`);
const w = Math.max(6, ...rows.map(r => [...r.name].length * 2));
for (const r of rows.sort((a, b) => b.sessions - a.sessions)) {
  console.log(`  ${r.name.padEnd(w - [...r.name].length)}  ${String(r.sessions).padStart(3)} 次   成功 ${r.wins} 次   平均 ${r.avg || '—'} 星   ${r.email}`);
}
if (!rows.some(r => r.sessions)) console.log('  （還沒有人的演練紀錄同步上來）');
if (orphans.length) {
  console.log(`\n  ⚠️ 雲端有 ${orphans.length} 筆孤兒資料（帳號已刪但資料還在），已從報表排除：`);
  for (const u of orphans) console.log(`     ${u}`);
  console.log('     要清掉的話：firebase database:remove /recruit/<uid> --project ' + PROJECT);
}
console.log(`\n  已寫出：\n    ${f1}${f2 ? '\n    ' + f2 : ''}`);
console.log(DRIVE && !argOf('--out')
  ? '  （在 Google 雲端硬碟資料夾裡，會自動同步上雲端）\n'
  : '  提示：裝了 Google 雲端硬碟桌面版之後這支腳本會自動寫進去，也可以用 --out "資料夾路徑" 自己指定。\n');
