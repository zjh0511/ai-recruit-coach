// 畫面端到端測試：在本機開一個無頭的 Edge（iPhone 375×667 尺寸），從歡迎頁一路按到評分回饋。
//
//   node tools/uitest.mjs [輸出資料夾]
//
// ・本機伺服器把 firebase-config.js 換成「帳號功能關閉」的版本，所以不需要登入，也不會碰到正式的帳號資料。
// ・金鑰讀 D:\Hao+App\API Key.txt（tools/keys.mjs），只放進這個測試瀏覽器自己的暫存設定檔，跑完就刪。
// ・真人語音的請求一律攔下來回失敗（App 會退回內建朗讀），不花每天只有幾十句的語音額度。
// ・文字模型會真的呼叫：一輪約 20 次。
// 用 Chrome DevTools Protocol 直接驅動瀏覽器，不需要安裝任何套件。
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { geminiKeys } from './keys.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'docs');
const OUT = process.argv[2] || path.join(os.tmpdir(), 'recruit-uitest');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 8460, DBG = 9339;
const W = 375, H = 667;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel === '/') rel = '/index.html';
  if (rel === '/firebase-config.js') {
    res.writeHead(200, { 'content-type': MIME['.js'] });
    return res.end("export const FB = { apiKey: '', dbUrl: '', googleClientId: '', appleClientId: '', apple: false };");
  }
  const f = path.join(DOCS, path.normalize(rel));
  if (!f.startsWith(DOCS) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(PORT);

const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'recruit-ui-'));
const browser = spawn(EDGE, [`--remote-debugging-port=${DBG}`, `--user-data-dir=${profile}`, '--headless=new', '--disable-extensions',
  '--no-first-run', '--autoplay-policy=no-user-gesture-required', `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });

let pass = 0, fail = 0;
const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log(`${c ? '  ok  ' : ' FAIL '} ${m}${!c && x ? ' → ' + x : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function cdp() {
  for (let i = 0; i < 50; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p) return p.webSocketDebuggerUrl; }
    catch { /* 還沒起來 */ }
    await sleep(200);
  }
  throw new Error('瀏覽器沒有啟動');
}
const ws = new WebSocket(await cdp());
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
  if (m.method === 'Fetch.requestPaused') {
    // 真人語音：攔下來回失敗，不花語音額度
    send('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'Failed' });
  }
});
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'evaluate failed');
  return r.result?.result?.value;
};
const waitFor = async (expr, ms = 60000, label = expr) => {
  const t = Date.now();
  while (Date.now() - t < ms) { if (await js(`!!(${expr})`)) return true; await sleep(250); }
  throw new Error('等太久：' + label);
};
let shot = 0;
const snap = async name => {
  await sleep(300);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const f = path.join(OUT, `${String(++shot).padStart(2, '0')}-${name}.png`);
  fs.writeFileSync(f, Buffer.from(r.result.data, 'base64'));
};
const click = sel => js(`(document.querySelector(${JSON.stringify(sel)}).click(), true)`);
const on = name => `document.querySelector('#s-${name}.on')`;
// 底部按鈕一定要在畫面裡（AI業務教練 D044：按鈕被推出畫面）
const footVisible = name => js(`(() => { const f = document.querySelector('#s-${name}.on .foot'); if (!f) return true; const r = f.getBoundingClientRect(); return r.bottom <= ${H} + 1 && r.top >= 0; })()`);

const key = geminiKeys()[0];
if (!key) { console.log('找不到 Gemini 金鑰'); process.exit(1); }

try {
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*streamGenerateContent*' }, { urlPattern: '*-tts:*' }] });
  // 測試瀏覽器自己的設定：金鑰與服務商（帳號功能關閉時鍵名不帶 #uid）
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { if (location.port === '${PORT}') {
    localStorage.setItem('recruit.provider', 'gemini'); localStorage.setItem('recruit.apikey', ${JSON.stringify(key)});
    localStorage.setItem('recruit.installtip', '1'); } } catch {}` });
  await send('Page.navigate', { url: `http://localhost:${PORT}/` });

  console.log('\n=== 歡迎與首頁 ===');
  await waitFor(on('welcome'), 30000, '歡迎頁');
  ok(await js(`document.querySelector('#s-welcome').innerText.includes('提醒：生成內容僅供自學參考')`), '第一次進來先看到歡迎與提醒');
  ok(await footVisible('welcome'), '「我了解，開始使用」在畫面內（375×667）');
  await snap('welcome');
  await click('#btn-welcome');
  await waitFor(on('home'));
  ok(await js(`document.querySelectorAll('#s-home .tile[data-fn]').length === 5`), '首頁有五個功能（第二版加上公司招募制度演練）');
  await waitFor(`document.querySelector('#acct-fast').textContent.includes('gemini')`, 20000, '模型設定顯示目前模型');
  await snap('home');

  console.log('\n=== 功能一：痛點分析 ===');
  await click('[data-fn="pain"]');
  await waitFor(on('intake'));
  ok(await js(`document.querySelector('#i-diff-wrap').hidden && document.querySelectorAll('#f-sample .chip').length === 10`), '資料卡：10 個範例、痛點分析不用選難度');
  await js(`[...document.querySelectorAll('#f-sample .chip')].find(c => c.textContent === '科技業工程師').click()`);
  ok(await js(`document.querySelector('#f-bg').value.includes('工程師')`), '按範例會帶入背景');
  await snap('intake');
  await click('#btn-go');
  await waitFor(on('pain'), 90000, '痛點分析結果');
  ok(await js(`document.querySelectorAll('#pain-body .pt').length === 3`), '顯示三個潛在痛點');
  ok(await js(`document.querySelector('#pain-body').innerText.includes('事業機會可以怎麼回應')`), '每個痛點附事業機會的回應');
  ok(await footVisible('pain'), '「用這位對象練電訪／面談」按鈕在畫面內');
  await snap('pain');

  console.log('\n=== 功能二：電訪演練 ===');
  await click('#btn-pain2call');
  await waitFor(on('intake'));
  ok(await js(`document.querySelector('#f-bg').value.includes('工程師') && !document.querySelector('#i-diff-wrap').hidden`), '接著練電訪：資料卡沿用、可以選難度');
  await js(`document.querySelector('#f-diff .chip[data-v="1"]').click()`);
  await click('#btn-go');
  await waitFor(on('brief'), 90000, '示範話術稿');
  ok(await js(`document.querySelectorAll('#b-demo .step-t').length >= 3`), '示範話術稿：開場、邀約、拒絕處理');
  await snap('brief-call');
  await click('#btn-start');
  await waitFor(`document.querySelectorAll('#p-log .msg.customer').length >= 1`, 30000, '對方的第一句');
  const say = async (t) => {
    const n = await js(`document.querySelectorAll('#p-log .msg').length`);
    await js(`(document.querySelector('#p-text').value = ${JSON.stringify(t)}, document.querySelector('#btn-send').click(), true)`);
    await waitFor(`document.querySelectorAll('#p-log .msg').length >= ${n + 2} || document.querySelector('#s-wait.on, #s-fb.on')`, 60000, '對方回應');
    await sleep(400);
  };
  await say('喂，好久不見！我是以前的同事阿豪，最近還好嗎？');
  await say('保證月入十萬，很輕鬆');
  ok(await js(`[...document.querySelectorAll('#p-log .msg.system')].some(m => m.textContent.includes('合規提醒'))`), '違規說法：演練中跳出合規紅卡');
  await snap('play-redcard');
  await say('抱歉剛剛講太誇張了，收入要看努力，以公司制度為準。我最近換到保險業，想約你喝杯咖啡聊聊，聽聽看就好，不適合也沒關係。');
  await say('那這週六下午三點，在你家附近的咖啡廳見好嗎？就半小時。');
  const endedByItself = await js(`!!document.querySelector('#s-wait.on, #s-fb.on')`);
  if (!endedByItself) { await say('週日早上也可以，我配合你的時間。'); }
  if (!await js(`!!document.querySelector('#s-wait.on, #s-fb.on')`)) await click('#btn-end');
  await waitFor(on('fb'), 90000, '評分回饋');
  ok(await js(`document.querySelectorAll('#fb-body .stars').length === 5`), '回饋：五項星等');
  ok(await js(`!!document.querySelector('#fb-body .outcome')`), '回饋：最上面是演練結果');
  ok(await js(`document.querySelector('#fb-body').innerText.includes('保險業務員管理規則第19條')`), '回饋：點名違規說法與法規條次');
  const outcome = await js(`document.querySelector('#fb-body .outcome .big').textContent`);
  console.log('      電訪結果：' + outcome);
  await snap('feedback-call');
  ok(await footVisible('fb'), '回饋頁底部按鈕在畫面內');

  console.log('\n=== 功能三：面談演練 ===');
  if (await js(`document.querySelector('#btn-next').textContent.includes('面談')`)) await click('#btn-next');
  else { await click('#btn-next'); await waitFor(on('home')); await click('[data-fn="meet"]'); }
  await waitFor(on('intake'));
  await js(`[...document.querySelectorAll('#f-sample .chip')].find(c => c.textContent === '全職媽媽').click()`);
  await click('#btn-go');
  await waitFor(on('brief'), 90000, '面談示範話術稿');
  ok(await js(`document.querySelectorAll('#b-demo .step-t').length >= 6`), '面談示範話術稿：破冰到邀約下一步');
  ok(await js(`document.querySelector('#b-goal').textContent.includes('考照')`), '演練前說明成功與最佳結果');
  await snap('brief-meet');
  await click('#btn-start');
  await waitFor(`document.querySelectorAll('#p-log .msg.customer').length >= 1`, 30000);
  ok(await js(`!document.querySelector('#p-found').hidden && document.querySelector('#p-found').textContent.includes('顧慮 0/')`), '面談畫面顯示挖到幾項顧慮／動機');
  for (const t of ['謝謝你今天出來。孩子上小學之後，你白天的生活跟以前比有什麼不一樣？',
    '聽起來你有在想重回職場，你心裡最在意的是什麼？',
    '我懂你的擔心，很多人一開始都怕要賣給親友。公司有完整培訓，主管會陪你，收入是看努力，以公司制度為準。',
    '這週六下午有一場事業說明會，要不要一起來聽聽看？聽完不適合也沒關係。']) {
    if (await js(`!!document.querySelector('#s-wait.on, #s-fb.on')`)) break;
    await say(t);
  }
  console.log('      挖到：' + await js(`document.querySelector('#p-found').textContent`));
  await snap('play-meet');
  if (!await js(`!!document.querySelector('#s-wait.on, #s-fb.on')`)) await click('#btn-end');
  await waitFor(on('fb'), 90000, '面談評分');
  ok(await js(`document.querySelector('#fb-body').innerText.includes('對方心裡真正在意的事')`), '面談回饋：揭露顧慮與動機');
  console.log('      面談結果：' + await js(`document.querySelector('#fb-body .outcome .big').textContent`));
  await snap('feedback-meet');

  console.log('\n=== 第二版：公司招募制度演練 ===');
  await js(`document.querySelector('#s-fb .back').click()`);
  await waitFor(on('home'));
  await click('[data-fn="system"]');
  await waitFor(on('docs'));
  ok(await js(`!document.querySelector('#d-consent').hidden && document.querySelector('#d-next').disabled`), '第一次進來：先看到保密提醒，還沒選文件不能下一步');
  await click('#btn-upload');
  ok(await js(`document.querySelector('#toast').textContent.includes('勾選確認')`), '沒勾保密確認就按上傳 → 擋下來');
  await js(`document.querySelector('#d-agree').click()`);
  await js(`(HTMLInputElement.prototype.click = function () {}, true)`);     // 無頭瀏覽器沒有檔案選擇視窗
  await click('#btn-upload');
  ok(await js(`document.querySelector('#d-consent').hidden`), '勾選確認後提醒收起來，下次不再出現');
  const FIX = path.join(ROOT, 'tools', 'fixtures');
  for (const f of ['收入制度（虛構）.docx', '晉升考核辦法（虛構）.pdf']) {
    const n0 = await js(`document.querySelectorAll('#d-list .pol').length`);
    const { result: { root } } = await send('DOM.getDocument', { depth: 1 });
    const { result: { nodeId } } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#f-file' });
    await send('DOM.setFileInputFiles', { nodeId, files: [path.join(FIX, f)] });
    await waitFor(`document.querySelectorAll('#d-list .pol').length > ${n0} && document.querySelector('#s-docs.on')`, 180000, '研讀 ' + f);
  }
  ok(await js(`document.querySelectorAll('#d-list .pol input:checked').length === 2`), '上傳的兩份文件自動勾起來');
  ok(await js(`document.querySelector('#d-next').textContent.includes('已選 2 份')`), '下一步按鈕顯示已選 2 份');
  await snap('docs');
  await click('#d-next');
  await waitFor(on('learn'), 30000, '制度重點頁');
  ok(await js(`document.querySelector('#l-body').innerText.includes('演練時要講到的重點') && document.querySelector('#l-body').innerText.includes('收入結構')`), '制度重點頁：必講重點與收入結構');
  ok(await js(`document.querySelector('#l-body').innerText.includes('這份是 PDF')`), 'PDF 提醒要對照原文核對數字');
  await snap('learn');
  await js(`[...document.querySelectorAll('#l-body .btn')].find(b => b.textContent === '產生教練講解').click()`);
  await waitFor(`document.querySelector('#l-body').innerText.includes('60 秒制度介紹稿')`, 90000, '教練講解');
  ok(true, '按了才產生教練講解');
  await snap('learn-coach');
  await click('#l-go');
  await waitFor(on('intake'));
  await js(`[...document.querySelectorAll('#f-sample .chip')].find(c => c.textContent === '社會新鮮人').click()`);
  await click('#btn-go');
  await waitFor(on('brief'), 90000, '制度示範話術稿');
  ok(await js(`!document.querySelector('#b-learn').hidden && document.querySelectorAll('#b-demo .step-t').length >= 6`), '制度示範話術稿＋可以回看制度重點');
  ok(await js(`document.querySelector('#btn-start').textContent.includes('📋 制度')`), '開始按鈕標明是制度演練');
  await snap('brief-system');
  await click('#btn-start');
  await waitFor(`document.querySelectorAll('#p-log .msg.customer').length >= 1`, 30000);
  ok(await js(`document.querySelector('#p-name').textContent.startsWith('📋 制度｜')`), '演練畫面左上角標明是制度演練');
  for (const t of ['今天想跟你說明我們公司的制度，你最想先了解哪一塊？',
    '新人前 12 個月，每個月有 25,000 元的新人津貼，條件是當月 FYC 達到 20,000 元。',
    '晉升業務主任要到職滿 6 個月，最近 6 個月累計 FYC 達 300,000 元，而且要增員 2 人。']) {
    if (await js(`!!document.querySelector('#s-wait.on, #s-fb.on')`)) break;
    await say(t);
  }
  if (!await js(`!!document.querySelector('#s-wait.on, #s-fb.on')`)) await click('#btn-end');
  await waitFor(on('fb'), 90000, '制度演練評分');
  ok(await js(`document.querySelector('#fb-body').innerText.includes('必講重點（講到')`), '回饋：必講重點逐點檢查');
  ok(await js(`/制度內容講得正確|和制度文件不一樣的說法/.test(document.querySelector('#fb-body').innerText)`), '回饋：對照制度文件檢查說法');
  await snap('feedback-system');

  console.log('\n=== 功能四：問問招募教練 ===');
  await js(`document.querySelector('#s-fb .back').click()`);
  await waitFor(on('home'));
  await click('[data-fn="chat"]');
  await waitFor(on('chat'));
  ok(await js(`document.querySelectorAll('#ch-log .chat-q .chip').length === 6`), '有 6 個快捷問題');
  await js(`document.querySelector('#ch-log .chat-q .chip').click()`);
  await waitFor(`document.querySelectorAll('#ch-log .msg.coach .say').length >= 1`, 60000, '教練回覆');
  ok(await js(`document.querySelector('#ch-log').innerText.length > 120`), '教練有實質回覆');
  await snap('chat');

  console.log('\n=== 訓練紀錄 ===');
  await js(`document.querySelector('#s-chat .back').click()`);
  await waitFor(on('home'));
  await js(`document.querySelector('[data-go="history"]').click()`);
  await waitFor(on('history'));
  ok(await js(`document.querySelector('#h-body').innerText.includes('共 3 次演練')`), '三次演練都記在紀錄裡');
  await snap('history');

  ok(!errors.length, '整段沒有任何程式錯誤', errors.slice(0, 3).join(' | '));
} catch (e) {
  fail++; console.log(' FAIL  ' + e.message);
  await snap('error').catch(() => {});
  if (errors.length) console.log('      瀏覽器錯誤：' + errors.slice(0, 3).join(' | '));
} finally {
  ws.close(); browser.kill(); server.close();
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Edge 還鎖著檔案就算了 */ }
}
console.log(`\n${fail ? '❌' : '✅'} ${pass} 項通過${fail ? `，${fail} 項失敗` : ''}（截圖：${OUT}）\n`);
process.exitCode = fail ? 1 : 0;
