// 操作手冊與教學影片用的 App 截圖（iPhone 390×844、2 倍解析度、iPhone 的 User-Agent）。
// 做法沿用 AI業務教練 D046：無頭 Edge＋DevTools Protocol，不裝任何套件。
//
//   node tools/shots.mjs [輸出資料夾]      預設：教學影片/素材/screens
//
// ・AI 的回應是真的：用 D:\Hao+App\API Key.txt 的金鑰呼叫 Gemini（只用文字額度，約 30 次）
// ・真人語音的請求一律攔下來（不花每天只有幾十句的語音額度），App 會退回內建朗讀
// ・第一段用正式的 Firebase 設定只拍「註冊／登入」與「加到主畫面」；之後關掉帳號功能拍其餘畫面，
//   不會碰到任何人的帳號資料
// ・headless Edge 會送 Chrome 的安裝事件，教學會變成 Android 的「立即安裝」→ 擋掉，才是 iPhone 的樣子（D046）
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { geminiKeys } from './keys.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'docs');
const OUT = process.argv[2] || path.join(ROOT, '教學影片', '素材', 'screens');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 8461, DBG = 9341, W = 390, H = 844;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';

let realConfig = true;                       // 第一段用正式設定（拍登入畫面），之後關掉帳號功能
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg' };
const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel === '/') rel = '/index.html';
  if (rel === '/firebase-config.js' && !realConfig) {
    res.writeHead(200, { 'content-type': MIME['.js'] });
    return res.end("export const FB = { apiKey: '', dbUrl: '', googleClientId: '', appleClientId: '', apple: false };");
  }
  const f = path.join(DOCS, path.normalize(rel));
  if (!f.startsWith(DOCS) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(res);
}).listen(PORT);

const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'recruit-shots-'));
const browser = spawn(EDGE, [`--remote-debugging-port=${DBG}`, `--user-data-dir=${profile}`, '--headless=new', '--disable-extensions',
  '--no-first-run', '--autoplay-policy=no-user-gesture-required', `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function wsUrl() {
  for (let i = 0; i < 50; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p) return p.webSocketDebuggerUrl; }
    catch { /* 還沒起來 */ }
    await sleep(200);
  }
  throw new Error('瀏覽器沒有啟動');
}
const ws = new WebSocket(await wsUrl());
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
  if (m.method === 'Fetch.requestPaused') send('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'Failed' });
});
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'evaluate failed: ' + expr.slice(0, 80));
  return r.result?.result?.value;
};
const waitFor = async (expr, ms = 90000, label = expr) => {
  const t = Date.now();
  while (Date.now() - t < ms) { if (await js(`!!(${expr})`)) return; await sleep(250); }
  throw new Error('等太久：' + label);
};
const on = n => `document.querySelector('#s-${n}.on')`;
const click = sel => js(`(document.querySelector(${JSON.stringify(sel)}).click(), true)`);
const shots = [];
async function snap(name) {
  await js(`document.querySelector('#toast')?.classList.remove('on'), true`);   // 提示泡泡不要擋畫面
  await sleep(450);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64'));
  shots.push(name);
  console.log('  📸 ' + name);
}
// 長畫面：捲到某個元素的位置再拍
const scrollTo = (scroller, target, offset = 12) => js(`(() => { const s = document.querySelector(${JSON.stringify(scroller)});
  const t = [...s.querySelectorAll('*')].find(e => e.matches(${JSON.stringify(target)}));
  if (!t) return false; s.scrollTop = t.offsetTop - s.offsetTop - ${offset}; return true; })()`);
const scrollText = (scroller, text, offset = 12) => js(`(() => { const s = document.querySelector(${JSON.stringify(scroller)});
  const t = [...s.querySelectorAll('h3,h4,summary,p,b')].find(e => e.textContent.includes(${JSON.stringify(text)}));
  if (!t) return false; let y = 0, n = t; while (n && n !== s) { y += n.offsetTop; n = n.offsetParent; }
  s.scrollTop = Math.max(0, t.getBoundingClientRect().top - s.getBoundingClientRect().top + s.scrollTop - ${offset}); return true; })()`);
const say = async t => {
  const n = await js(`document.querySelectorAll('#p-log .msg').length`);
  await js(`(document.querySelector('#p-text').value = ${JSON.stringify(t)}, document.querySelector('#btn-send').click(), true)`);
  await waitFor(`document.querySelectorAll('#p-log .msg').length >= ${n + 2} || document.querySelector('#s-wait.on, #s-fb.on')`, 90000, '對方回應');
  await sleep(500);
};
const ended = () => js(`!!document.querySelector('#s-wait.on, #s-fb.on')`);
const sample = label => js(`[...document.querySelectorAll('#f-sample .chip')].find(c => c.textContent === ${JSON.stringify(label)}).click()`);

const key = geminiKeys()[0];
if (!key) { console.log('找不到 Gemini 金鑰'); process.exit(1); }

try {
  await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setUserAgentOverride', { userAgent: UA, platform: 'iPhone' });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*streamGenerateContent*' }, { urlPattern: '*-tts:*' }] });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); e.stopImmediatePropagation(); }, true);
    try { localStorage.setItem('recruit.installtip', '1'); } catch {}` });

  // ── 第一段：註冊／登入、加到主畫面（正式的帳號設定）──
  await send('Page.navigate', { url: `http://localhost:${PORT}/` });
  await waitFor(on('auth'), 30000, '註冊登入畫面');
  await sleep(2500);                                         // 等 Google 登入按鈕畫出來
  await snap('01-auth');
  await js(`document.querySelector('#s-auth [data-install]').click()`);
  await waitFor(`!document.querySelector('#sheet').hidden`);
  await snap('02-install-ios');

  // ── 第二段：關掉帳號功能，從貼金鑰開始 ──
  realConfig = false;
  await js(`localStorage.clear(), localStorage.setItem('recruit.installtip', '1'), true`);
  await send('Page.navigate', { url: `http://localhost:${PORT}/?v=2` });
  await waitFor(on('login'), 30000, '貼金鑰畫面');
  await snap('03-login');
  await js(`(localStorage.setItem('recruit.provider', 'gemini'), localStorage.setItem('recruit.apikey', ${JSON.stringify(key)}), true)`);
  await send('Page.navigate', { url: `http://localhost:${PORT}/?v=3` });
  await waitFor(on('welcome'), 30000, '歡迎頁');
  await snap('04-welcome');
  await click('#btn-welcome');
  await waitFor(on('home'));
  await waitFor(`document.querySelector('#acct-fast').textContent.includes('gemini')`, 30000, '模型');
  await snap('05-home');
  await js(`(document.querySelector('#s-home .scroll').scrollTop = 99999, true)`);
  await snap('05b-home-bottom');

  // ── 功能一：痛點分析 ──
  console.log('\n功能一：痛點分析');
  await js(`(document.querySelector('#s-home .scroll').scrollTop = 0, true)`);
  await click('[data-fn="pain"]');
  await waitFor(on('intake'));
  await sample('全職媽媽');
  await snap('06-pain-intake');
  await click('#btn-go');
  await waitFor(on('pain'), 120000, '痛點分析');
  await snap('07-pain-result');
  await scrollText('#pain-body', '三個潛在痛點'); await snap('07b-pain-points');
  await scrollText('#pain-body', '他最可能的顧慮'); await snap('07c-pain-concerns');
  await scrollText('#pain-body', '建議的接觸方式'); await snap('07d-pain-approach');

  // ── 功能二：電訪 ──
  console.log('\n功能二：電訪演練');
  await click('#btn-pain2call');
  await waitFor(on('intake'));
  await js(`document.querySelector('#f-diff .chip[data-v="1"]').click()`);
  await snap('08-call-intake');
  await js(`(document.querySelector('#s-intake .scroll').scrollTop = 99999, true)`);
  await snap('08b-call-intake-diff');
  await click('#btn-go');
  await waitFor(on('brief'), 120000, '電訪示範話術稿');
  await snap('09-call-brief');
  await scrollTo('#s-brief .scroll', '#b-demo'); await snap('09b-call-demo');
  await click('#btn-start');
  await waitFor(`document.querySelectorAll('#p-log .msg.customer').length >= 1`, 30000);
  await say('喂，好久不見！我是以前的同事阿豪，最近還好嗎？');
  await say('我最近換到保險業，想約你喝杯咖啡，跟你分享我現在的工作，聽聽看就好，不適合也完全沒關係。');
  await snap('10-call-play');
  await say('保證月入十萬，很輕鬆');
  await snap('10b-call-redcard');
  for (const t of ['抱歉，剛剛講得太誇張了。收入要看努力，以公司制度為準。我是記得你說孩子上小學了，想重回職場，覺得可以聊聊。',
    '那這週六下午三點，約在你家附近的咖啡廳好嗎？就半小時。', '週日早上也可以，我配合你的時間。']) {
    if (await ended()) break;
    await say(t);
  }
  if (!await ended()) await click('#btn-end');
  await waitFor(on('fb'), 120000, '電訪評分');
  await snap('11-call-fb');
  await scrollText('#fb-body', '五項能力評分'); await snap('11b-call-scores');
  await scrollText('#fb-body', '合規提醒'); await snap('11c-call-compliance');
  await scrollText('#fb-body', '可以再調整的地方'); await snap('11d-call-improve');

  // ── 功能三：面談 ──
  console.log('\n功能三：面談演練');
  await js(`document.querySelector('#s-fb .back').click()`);
  await waitFor(on('home'));
  await click('[data-fn="meet"]');
  await waitFor(on('intake'));
  await sample('科技業工程師');
  await click('#btn-go');
  await waitFor(on('brief'), 120000, '面談示範話術稿');
  await snap('12-meet-brief');
  await scrollTo('#s-brief .scroll', '#b-demo'); await snap('12b-meet-demo');
  await click('#btn-start');
  await waitFor(`document.querySelectorAll('#p-log .msg.customer').length >= 1`, 30000);
  for (const t of ['謝謝你今天願意出來。最近工作還順利嗎？你覺得接下來幾年的發展空間怎麼樣？',
    '聽起來你有點卡住，你心裡最在意的是什麼？是收入、時間，還是成就感？',
    '我懂。很多人一開始都怕要賣給親友。我們公司有完整培訓，主管會陪你，收入看努力，以公司制度為準。',
    '這週六下午有一場事業說明會，會介紹培訓跟制度，要不要一起來聽聽看？聽完不適合也沒關係。']) {
    if (await ended()) break;
    await say(t);
  }
  await snap('12c-meet-play');
  if (!await ended()) await click('#btn-end');
  await waitFor(on('fb'), 120000, '面談評分');
  await snap('13-meet-fb');
  await scrollText('#fb-body', '對方心裡真正在意的事'); await snap('13b-meet-hidden');

  // ── 功能四：公司招募制度演練（虛構的制度文件）──
  console.log('\n功能四：公司招募制度演練');
  await js(`document.querySelector('#s-fb .back').click()`);
  await waitFor(on('home'));
  await click('[data-fn="system"]');
  await waitFor(on('docs'));
  await snap('14-docs-consent');
  await js(`document.querySelector('#d-agree').click()`);
  await js(`(HTMLInputElement.prototype.click = function () {}, true)`);     // 無頭瀏覽器沒有檔案選擇視窗
  await click('#btn-upload');
  for (const f of ['收入制度（虛構）.docx', '晉升考核辦法（虛構）.pdf']) {
    const n0 = await js(`document.querySelectorAll('#d-list .pol').length`);
    const { result: { root } } = await send('DOM.getDocument', { depth: 1 });
    const { result: { nodeId } } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#f-file' });
    await send('DOM.setFileInputFiles', { nodeId, files: [path.join(ROOT, 'tools', 'fixtures', f)] });
    if (n0 === 0) { await sleep(800); await snap('14b-docs-reading'); }
    await waitFor(`document.querySelectorAll('#d-list .pol').length > ${n0} && document.querySelector('#s-docs.on')`, 180000, '研讀 ' + f);
  }
  await snap('14c-docs-list');
  await click('#d-next');
  await waitFor(on('learn'), 30000);
  await snap('15-learn');
  await js(`document.querySelector('#l-body details').open = true`);
  await scrollText('#l-body', '收入結構'); await snap('15b-learn-income');
  await js(`[...document.querySelectorAll('#l-body .btn')].find(b => b.textContent === '產生教練講解').click()`);
  await waitFor(`document.querySelector('#l-body').innerText.includes('60 秒制度介紹稿')`, 120000, '教練講解');
  await scrollText('#l-body', '教練講解', 4); await snap('15c-learn-coach');
  await click('#l-go');
  await waitFor(on('intake'));
  await sample('社會新鮮人');
  await click('#btn-go');
  await waitFor(on('brief'), 120000, '制度示範話術稿');
  await snap('16-sys-brief');
  await scrollTo('#s-brief .scroll', '#b-demo'); await snap('16b-sys-demo');
  await click('#btn-start');
  await waitFor(`document.querySelectorAll('#p-log .msg.customer').length >= 1`, 30000);
  for (const t of ['今天想跟你說明我們公司的制度。你最想先了解哪一塊？收入、晉升，還是培訓？',
    '新人前 12 個月，每個月有 25,000 元的新人津貼，條件是當月 FYC 要達到 20,000 元，沒達到那個月就沒有。',
    '晉升業務主任很快，到職滿 3 個月就可以升了。',
    '我要誠實跟你說，每季 FYC 沒有達到 60,000 元會列入輔導，連續 2 季沒達到就會終止合約。']) {
    if (await ended()) break;
    await say(t);
  }
  await snap('16c-sys-play');
  if (!await ended()) await click('#btn-end');
  await waitFor(on('fb'), 120000, '制度評分');
  await snap('17-sys-fb');
  await scrollText('#fb-body', '必講重點（講到'); await snap('17b-sys-keypoints');
  await scrollText('#fb-body', '制度文件不一樣的說法') || await scrollText('#fb-body', '制度內容講得正確');
  await snap('17c-sys-wrong');

  // ── 功能五：問問招募教練 ──
  console.log('\n功能五：問問招募教練');
  await js(`document.querySelector('#s-fb .back').click()`);
  await waitFor(on('home'));
  await click('[data-fn="chat"]');
  await waitFor(on('chat'));
  await snap('18-chat');
  await js(`[...document.querySelectorAll('#ch-log .chat-q .chip')].find(c => c.textContent.includes('賣給親友')).click()`);
  await waitFor(`document.querySelectorAll('#ch-log .msg.coach .say').length >= 1`, 90000, '教練回覆');
  await js(`(document.querySelector('#ch-log').scrollTop = 0, true)`);
  await snap('18b-chat-reply');

  // ── 其他：訓練紀錄、模型設定 ──
  console.log('\n其他');
  await js(`document.querySelector('#s-chat .back').click()`);
  await waitFor(on('home'));
  await js(`document.querySelector('[data-go="history"]').click()`);
  await waitFor(on('history'));
  await snap('19-history');
  await js(`document.querySelector('#s-history .back').click()`);
  await waitFor(on('home'));
  await js(`document.querySelector('#home-acct').click()`);
  await waitFor(`document.querySelector('#s-models.on') && document.querySelectorAll('#m-body .doc').length > 1`, 30000);
  await snap('20-models');
  if (errors.length) console.log('\n  瀏覽器錯誤：' + errors.slice(0, 3).join(' | '));
} catch (e) {
  console.log(' 失敗：' + e.message);
  await snap('zz-error').catch(() => {});
  process.exitCode = 1;
} finally {
  ws.close(); browser.kill(); server.close();
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Edge 還鎖著就算了 */ }
}
console.log(`\n共 ${shots.length} 張，存在 ${OUT}`);
