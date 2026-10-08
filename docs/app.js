// AI招募教練｜豪老師 Hao+ — 畫面流程。
// 架構與 AI業務教練（zjh0511/ai-sales-coach）相同：純前端，金鑰只存在這台裝置，
// 帳號與訓練紀錄透過 Firebase 同步（和 AI業務教練共用同一個專案，資料放在 /recruit/<uid>）。
//
// 階段 0：登入、首頁、模型設定、訓練紀錄、加到主畫面。四個功能依企劃書 §5 逐階段接上。
import { api, providers, restore, onModelEvent, disconnect } from './engine/api.js';
import * as acct from './engine/account.js';
import * as own from './engine/owner.js';

const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };

// 個人資料（訓練紀錄、偏好、金鑰、教練對話、語音額度狀態）依帳號分開存放，理由見 engine/owner.js。
// 一律經過 my.get／set／del，不要直接用 localStorage 讀寫這幾項。
const K = own.KEYS;
const uid = () => (acct.configured() ? acct.user()?.uid || own.NOBODY : null);
const my = own.scoped(localStorage, uid);

// 不屬於任何帳號的裝置狀態（看過歡迎頁、提示過安裝）
const SEEN_KEY = own.PREFIX + 'seen';
const PROV_KEY = own.PREFIX + 'provider';
const INSTALL_TIP_KEY = own.PREFIX + 'installtip';

const S = { fn: null };

// 各功能開放的階段。還沒做好的先告訴使用者，不要讓按鈕按了沒反應。
const COMING = {
  pain: '招募對象痛點分析：開發中（階段 1）',
  call: '招募邀約電訪演練：開發中（階段 2）',
  meet: '招募面談技巧演練：開發中（階段 3）',
  chat: '問問招募教練：開發中（階段 4）',
};

// ── 畫面切換 ────────────────────────────────────────────────
function show(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === 's-' + name));
  if (name === 'history') renderHistory();
  if (name === 'models') renderModels();
  syncInstallBtn();                                    // 三個畫面都有「加到主畫面」
  if (name === 'home') {
    // 強制登入的把關點。帳號在使用途中失效（管理者停用、token 被撤銷）時，
    // 不在演練中硬切畫面，而是在下一次回到首頁時擋下來。
    if (acct.configured() && !acct.user()) { initAuth(); return show('auth'); }
    updateAccount(); updateWho();
  }
}

document.addEventListener('click', e => {
  const g = e.target.closest('[data-go]');
  if (!g) return;
  show(g.dataset.go);
});

let toastT;
function toast(msg, ms = 2800) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms);
}

// ── 金鑰 ────────────────────────────────────────────────────
// 全部運算都在這台裝置完成，金鑰只存在瀏覽器，不會送到任何伺服器。
const cred = () => ({ provider: localStorage.getItem(PROV_KEY), key: my.get(K.apikey) });

// api() 由 engine/api.js 提供；認證失敗會帶 e.auth，統一在這裡退回登入畫面
window.addEventListener('unhandledrejection', e => { if (e.reason?.auth) logout(e.reason.message); });

// ── 登入畫面 ────────────────────────────────────────────────
let PROVIDERS = {};

async function initLogin() {
  PROVIDERS = providers();
  const sel = $('#lg-provider');
  sel.innerHTML = '';
  for (const [k, p] of Object.entries(PROVIDERS)) {
    const o = el('option', null, p.label);
    o.value = k;
    sel.append(o);
  }
  sel.value = localStorage.getItem(PROV_KEY) || Object.keys(PROVIDERS)[0] || 'gemini';
  syncProvider();

  // 重新整理後用已存的金鑰靜默恢復，失敗就回登入畫面
  const { provider, key } = cred();
  if (provider && key) {
    $('#lg-msg').textContent = '正在恢復上次的連線…';
    if (await restore(provider, key, loadPin())) return show(localStorage.getItem(SEEN_KEY) ? 'home' : 'welcome');
    my.del(K.apikey);
    $('#lg-msg').className = 'note err';
    $('#lg-msg').textContent = '上次的金鑰已失效，請重新輸入';
  } else $('#lg-msg').textContent = '';
  show('login');
}

// 同一個網站上的 AI業務教練用的是 aicoach.apikey#<uid>。同一台裝置、同一個帳號用過的話，
// 提醒他可以貼同一把——但不自動帶入：金鑰屬於另一個 App 的資料，由使用者自己決定。
const usedSalesCoach = () => {
  const u = acct.user()?.uid;
  try { return !!(u && localStorage.getItem('aicoach.apikey#' + u)); } catch { return false; }
};

function syncProvider() {
  const p = PROVIDERS[$('#lg-provider').value] || {};
  $('#lg-note').textContent = [p.note, p.hint ? `金鑰${p.hint}` : ''].filter(Boolean).join('　·　');
  $('#lg-link').href = p.url || '#';
  $('#lg-same').hidden = !usedSalesCoach();
  // 金鑰算在「申請時 AI Studio 登入的那個 Google 帳號」，不是 App 登入的帳號——程式也無從檢查一把金鑰是誰的，
  // 只能在申請前提醒。手機登入好幾個 Google 帳號時，很容易拿到別人的金鑰（用掉別人的額度）。
  const u = acct.user(), hint = $('#lg-acct');
  hint.hidden = !u?.email;
  if (u?.email) {
    hint.replaceChildren('你在 App 登入的是 ', el('b', null, u.email),
      '。按下面的按鈕會先請你選擇 Google 帳號——請選你自己的（用 Google 登入 App 的人就選這一個），'
      + '不要用到別人的帳號，不然用的是別人的額度。');
  }
}
$('#lg-provider').onchange = syncProvider;
$('#lg-show').onchange = e => { $('#lg-key').type = e.target.checked ? 'text' : 'password'; };

$('#lg-go').onclick = async () => {
  const provider = $('#lg-provider').value;
  const key = $('#lg-key').value.trim();
  const msg = $('#lg-msg');
  if (!key) { msg.className = 'note err'; msg.textContent = '請先貼上金鑰'; return; }

  const btn = $('#lg-go'); btn.disabled = true; btn.textContent = '驗證中…';
  msg.className = 'note'; msg.textContent = '正在向 Google 確認金鑰…';
  try {
    if (localStorage.getItem(PROV_KEY) !== provider) my.del(K.models);
    const j = await api('/login', { provider, key, pin: loadPin() });
    localStorage.setItem(PROV_KEY, provider);
    my.set(K.apikey, key);
    $('#lg-key').value = '';
    msg.className = 'note ok'; msg.textContent = `已連線：${j.fast}`;
    updateAccount();
    show(localStorage.getItem(SEEN_KEY) ? 'home' : 'welcome');
  } catch (e) {
    msg.className = 'note err'; msg.textContent = e.message;
  }
  btn.disabled = false; btn.textContent = '驗證並登入';
};

// 首頁顯示目前的服務商與正在使用的模型，並提供明顯的入口去更換
async function updateAccount() {
  const { provider } = cred();
  const box = $('#home-acct');
  box.hidden = !provider;
  $('#home-logout').hidden = !provider;
  if (!provider) return;

  $('#acct-provider').textContent = PROVIDERS[provider]?.label || provider;
  $('#acct-fast').textContent = '載入中…';
  $('#acct-judge').textContent = '';
  try {
    const st = await api('/models/status');
    if (st.pinned) {
      $('#acct-fast').textContent = `模型　${st.pinned}`;
    } else {
      $('#acct-fast').textContent = `模型　${st.active.fast || '—'}（自動）`;
      if (st.active.fast !== st.active.judge) $('#acct-judge').textContent = `分析時改用　${st.active.judge}`;
    }
  } catch {
    $('#acct-fast').textContent = '模型　—';
  }
}

$('#home-logout').onclick = () => {
  if (confirm('登出後需要重新輸入 API 金鑰，訓練紀錄不會被刪除。確定登出？')) logout();
};

// ── 模型設定 ────────────────────────────────────────────────
let modelFilter = '';

// 指定的模型；null 代表自動
function loadPin() {
  try { const v = JSON.parse(my.get(K.models)); return typeof v === 'string' ? v : null; }
  catch { return null; }
}
const savePin = m => { m ? my.set(K.models, JSON.stringify(m)) : my.del(K.models); savePrefs({}); };

async function renderModels() {
  const b = $('#m-body'); b.innerHTML = '';
  let st;
  try { st = await api('/models/status'); } catch (e) { return void b.append(el('p', 'note', e.message)); }

  const cooling = new Map(st.cooling.map(c => [c.id, c.minutes]));

  b.append(el('p', 'note',
    '不確定選哪個就用「自動」。若模型額度用盡，系統會自動改用下一個可用模型，'
    + '十分鐘後再回頭嘗試，練習不會中斷。'));

  if (st.models.length > 30) {
    const f = el('input');
    f.id = 'm-filter'; f.type = 'search'; f.placeholder = `搜尋模型（共 ${st.models.length} 個）`;
    f.value = modelFilter;
    f.oninput = () => { modelFilter = f.value; renderModels().then(() => $('#m-filter')?.focus()); };
    b.append(f);
  }

  const pick = async id => {
    savePin(id);
    await api('/models/set', { model: id });
    toast(id ? `已改用 ${id}` : '已改為自動選擇');
    renderModels();
  };

  const row = (id, label, extra) => {
    const on = st.pinned === id;                      // id 為 null 時代表「自動」
    const r = el('button', 'doc' + (on ? ' on' : ''));
    r.style.cssText = 'width:100%;text-align:left;font:inherit;color:inherit';
    const info = el('div', 'info');
    info.append(el('b', null, (on ? '● ' : '○ ') + label));
    if (extra) info.append(el('small', null, extra));
    r.append(info);
    if (on) r.append(el('span', 'badge', '使用中'));
    r.onclick = () => pick(id);
    return r;
  };

  const c = el('div', 'card');
  c.append(el('h4', null, '選擇模型'));
  const auto = st.auto.fast === st.auto.judge
    ? `目前會用 ${st.auto.fast || '—'}`
    : `演練用 ${st.auto.fast || '—'}，評分用 ${st.auto.judge || '—'}`;
  c.append(row(null, '自動（推薦）', auto));

  // 推薦的排前面，其餘按名稱排序
  const rec = st.recommended || [];
  const q = modelFilter.trim().toLowerCase();
  let sorted = st.models
    .filter(m => !q || m.id.toLowerCase().includes(q) || (m.label || '').toLowerCase().includes(q))
    .sort((a, b) => {
      const ra = rec.indexOf(a.id), rb = rec.indexOf(b.id);
      if (ra !== rb) return (ra < 0 ? 999 : ra) - (rb < 0 ? 999 : rb);
      return a.id.localeCompare(b.id);
    });

  const LIMIT = 30;
  const hidden = Math.max(0, sorted.length - LIMIT);
  if (!q && hidden) sorted = sorted.slice(0, LIMIT);

  for (const m of sorted) {
    const cd = cooling.get(m.id);
    c.append(row(m.id, m.id, [
      rec.includes(m.id) ? '★ 推薦' : null,
      m.label !== m.id ? m.label : null,
      cd ? `⚠️ 額度用盡，約 ${cd} 分鐘後恢復` : null,
    ].filter(Boolean).join('　·　')));
  }
  if (hidden) c.append(el('p', 'note', `另有 ${hidden} 個模型未顯示，請用上方搜尋框尋找。`));
  if (q && !sorted.length) c.append(el('p', 'note', '找不到符合的模型。'));
  b.append(c);
  b.append(el('p', 'note', `共偵測到 ${st.models.length} 個可用模型，清單來自你的金鑰實際查詢結果。`));
  b.scrollTop = 0;
}

function logout(reason) {
  my.del(K.apikey);
  disconnect();
  if (reason) { $('#lg-msg').className = 'note err'; $('#lg-msg').textContent = reason; }
  show('login');
}

// ── 首頁四大功能 ────────────────────────────────────────────
document.querySelectorAll('[data-fn]').forEach(b => b.onclick = () => {
  S.fn = b.dataset.fn;
  toast(COMING[S.fn] || '開發中', 3200);
});

// ── 偏好設定 ────────────────────────────────────────────────
const prefs = () => { try { return JSON.parse(my.get(K.prefs)) || {}; } catch { return {}; } };
function savePrefs(p) {
  my.set(K.prefs, JSON.stringify({ ...prefs(), ...p, updatedAt: Date.now() }));
  syncSoon();
}

// ── 訓練紀錄 ────────────────────────────────────────────────
const NAMES = {
  fluency: '說話流暢度', friendliness: '聲音語調的親切感', awareness: '談話內容的掌握',
  confidence: '自信心', professionalism: '專業度',
};

function starRow(name, score, ev) {
  const w = el('div');
  const r = el('div', 'row');
  r.append(el('span', 'nm', name));
  const st = el('span', 'stars', '★★★★★');
  st.setAttribute('aria-label', `${name} ${score} 顆星`);
  const fill = el('i', null, '★★★★★');
  fill.setAttribute('aria-hidden', 'true');
  fill.style.width = (score / 5 * 100) + '%';
  st.append(fill); r.append(st);
  r.append(el('span', 'sc', score.toFixed(1)));
  w.append(r);
  if (ev) w.append(el('p', 'ev', ev));
  return w;
}

const history_ = () => { try { return JSON.parse(my.get(K.history) || '[]'); } catch { return []; } };

function renderHistory() {
  const b = $('#h-body'); b.innerHTML = '';
  const h = history_();
  if (!h.length) { b.append(el('p', 'note', '還沒有紀錄。電訪演練與面談演練開放後，每次練完的評分都會記在這裡。')); return; }

  const avg = {};
  for (const k of Object.keys(NAMES)) {
    const v = h.map(x => x.scores?.[k]).filter(n => typeof n === 'number');
    if (v.length) avg[k] = v.reduce((a, c) => a + c, 0) / v.length;
  }
  const c0 = el('div', 'card'); c0.append(el('h4', null, `我的招募能力（${h.length} 次平均）`));
  for (const k of Object.keys(avg)) c0.append(starRow(NAMES[k], Math.round(avg[k] * 2) / 2, ''));
  b.append(c0);

  for (const r of h) {
    const c = el('div', 'card');
    const d = new Date(r.at);
    c.append(el('h4', null, `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}　${r.modeName || ''}　${r.name || ''}`));
    if (r.persona) c.append(el('p', 'muted', r.persona));
    const tot = Object.values(r.scores || {});
    if (tot.length) c.append(el('p', null, '平均 ' + (tot.reduce((a, x) => a + x, 0) / tot.length).toFixed(1) + ' 星'));
    if (r.summary) c.append(el('p', 'ev', r.summary));
    b.append(c);
  }
  const clr = el('button', 'link', '清除所有紀錄');
  clr.onclick = () => { if (confirm('確定要刪除全部訓練紀錄？')) { my.del(K.history); renderHistory(); } };
  b.append(clr);
}

// ── 帳號與雲端同步 ──────────────────────────────────────────
// 同步只涵蓋「訓練紀錄」與「偏好設定」；API 金鑰永遠留在本機。
let syncBadge = null, syncing = false, syncTimer;

// 登入、登出、換人之後，把記憶體裡屬於前一位的東西換掉
function switchOwner() { /* 階段 2 起：語音額度狀態、教練對話 */ }

function bundle() {
  const p = prefs();
  return {
    history: history_(),
    prefs: {
      diff: p.diff || '', ctx: p.ctx || '', coach: p.coach || '',
      provider: localStorage.getItem(PROV_KEY) || '',
      models: my.get(K.models) || '',
      updatedAt: p.updatedAt || 0,
    },
  };
}

function applyBundle(b) {
  try { my.set(K.history, JSON.stringify((b.history || []).slice(0, 50))); } catch { /* 容量滿 */ }
  const p = b.prefs || {};
  // 模型指定只在「服務商相同」時才套用
  if (p.models && p.provider && p.provider === localStorage.getItem(PROV_KEY)) my.set(K.models, p.models);
  my.set(K.prefs, JSON.stringify({ diff: p.diff || '', ctx: p.ctx || '', coach: p.coach || '', updatedAt: p.updatedAt || 0 }));
}

function setSync(state) {
  if (!syncBadge) return;
  const M = { busy: ['sync busy', '同步中…'], ok: ['sync', '已同步'], err: ['sync off', '同步失敗'] };
  const [cls, txt] = M[state] || M.ok;
  syncBadge.className = cls;
  syncBadge.textContent = txt;
}

// 同步失敗絕對不能擋住任何功能——練習比同步重要。
async function syncNow(loud = false) {
  if (!acct.configured() || !acct.user() || syncing) return;
  syncing = true; setSync('busy');
  const who = acct.user().uid;
  try {
    const remote = await acct.pull();
    // 等雲端回應的這段時間裡換了人：這一輪的資料不屬於現在的人，整輪放棄
    if (acct.user()?.uid !== who) { syncing = false; return; }
    // pull() 回傳 null 代表拿不到 token（沒網路或帳號失效），不能謊報「已同步」
    if (remote === null) {
      syncing = false;
      if (!acct.user()) return accountRevoked();
      setSync('err');
      if (loud) toast('目前連不上雲端，紀錄先存在這台裝置，之後會自動同步');
      return;
    }
    const merged = acct.merge(bundle(), remote);
    applyBundle(merged);
    if (!await acct.push(merged, who)) throw new Error('寫入雲端失敗，稍後會再試');
    setSync('ok');
    if (loud && merged.history.length) toast('已與雲端同步，共 ' + merged.history.length + ' 筆紀錄');
  } catch (e) {
    setSync('err');
    if (loud) toast(e.message);
  }
  syncing = false;
}
const syncSoon = () => { clearTimeout(syncTimer); syncTimer = setTimeout(() => syncNow(), 2500); };

function accountRevoked() {
  disconnect();
  switchOwner();
  updateWho();
  toast('你的帳號已失效或被停用，請重新登入', 5000);
  const cur = document.querySelector('.screen.on')?.id;
  if (cur === 's-home') { initAuth(); show('auth'); }
}

function updateWho() {
  const u = acct.user();
  const line = $('#home-who');
  $('#home-signout').hidden = !u;
  line.hidden = !u;
  syncBadge = null;
  if (!u) return;
  line.innerHTML = '';
  line.append(el('span', null, '👤'), el('b', null, u.name || u.email));
  syncBadge = el('span', 'sync', '已同步');
  line.append(syncBadge);
}

// ── 註冊／登入畫面 ──────────────────────────────────────────
const authMsg = (cls, t) => { $('#au-msg').className = 'note ' + cls; $('#au-msg').textContent = t; };

async function afterAuth() {
  disconnect();                 // 記憶體裡可能還留著前一位的模型連線
  switchOwner();
  updateWho();
  await syncNow(true);          // 先把雲端資料拉下來，再進金鑰流程（模型指定才會生效）
  await initLogin();
  updateAccount(); syncInstallBtn(); handleShortcut();
}

function initAuth() {
  authMsg('', '');
  $('#au-pw').value = '';
  $('#au-google').innerHTML = '';        // 可重複呼叫：登出再登入不該疊出兩顆按鈕
  $('#au-google').hidden = false;
  $('#au-apple').hidden = !acct.appleReady();
  if (acct.googleReady()) {
    acct.googleButton($('#au-google'), e => e ? authMsg('err', e.message) : afterAuth())
      .catch(e => authMsg('err', e.message));
    // Google 的登入元件在某些環境（尤其 iOS 的桌面 App／內建瀏覽器）會靜靜地不渲染也不報錯
    setTimeout(() => {
      if ($('#au-google').children.length) return;
      $('#au-google').hidden = true;
      authMsg('', '這個環境無法使用 Google 登入，請改用下方的 E-mail 註冊或登入。');
    }, 6000);
  } else {
    $('#au-google').hidden = true;
  }
}

const emailPw = () => [$('#au-email').value.trim(), $('#au-pw').value];

async function emailAuth(btn, label, fn) {
  const [email, pw] = emailPw();
  if (!email) return authMsg('err', '請先輸入 E-mail');
  btn.disabled = true; btn.textContent = '處理中…';
  authMsg('', '');
  try { await fn(email, pw); await afterAuth(); }
  catch (e) { authMsg('err', e.message); }
  btn.disabled = false; btn.textContent = label;
}

$('#au-in').onclick = () => emailAuth($('#au-in'), '登入', acct.signInEmail);
$('#au-up').onclick = () => emailAuth($('#au-up'), '註冊新帳號', acct.signUpEmail);
$('#au-pw').addEventListener('keydown', e => { if (e.key === 'Enter') $('#au-in').click(); });

$('#au-reset').onclick = async () => {
  const [email] = emailPw();
  if (!email) return authMsg('err', '請先輸入 E-mail，重設信會寄到這個地址');
  try { await acct.resetEmail(email); authMsg('ok', '重設密碼的信已寄出，請到信箱收信'); }
  catch (e) { authMsg('err', e.message); }
};

$('#au-apple').onclick = async () => {
  try { await acct.signInApple(); await afterAuth(); }
  catch (e) { authMsg('err', e.message); }
};

// 登出：下一位在這台裝置登入的人看不到你的資料（各帳號分開存放），你的金鑰也會清掉。
$('#home-signout').onclick = async () => {
  if (!confirm('登出後，下一位在這台裝置登入的人看不到你的紀錄和資料。\n'
    + '你的 API 金鑰會從這台裝置清除，下次登入要重新貼上。\n\n確定登出？')) return;
  clearTimeout(syncTimer);
  await syncNow();              // 還沒送上雲端的紀錄先送出去
  my.del(K.apikey);
  acct.signOut();
  disconnect();
  switchOwner();
  updateWho();
  initAuth();
  show('auth');
};

// ── PWA：註冊 Service Worker 與「加到主畫面」──────────────────
// isSecureContext 才對——http://localhost 也是安全來源，SW 在那裡同樣能註冊（本機測試需要）
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* 不支援就算了，功能不受影響 */ });
}

const standalone = () =>
  window.matchMedia('(display-mode: standalone)').matches
  || window.matchMedia('(display-mode: fullscreen)').matches
  || navigator.standalone === true;

// 平台判斷：iPadOS 的 UA 自稱 Mac，只能靠觸控點數分辨；
// 從 LINE 點連結進來的內建瀏覽器根本沒有「加入主畫面」。
function platform() {
  const ua = navigator.userAgent;
  const iPhone = /iPhone|iPod/.test(ua);
  const iPad = /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const inApp = /Line\/|FBAN|FBAV|Instagram|MicroMessenger/i.test(ua);   // LINE／FB／IG／微信
  const browser = /CriOS/.test(ua) ? 'chrome'
    : /EdgiOS/.test(ua) ? 'edge'
    : /FxiOS/.test(ua) ? 'firefox'
    : /OPiOS|OPT\//.test(ua) ? 'opera'
    : 'safari';
  const android = /Android/i.test(ua);
  return { iPhone, iPad, ios: iPhone || iPad, android, inApp, browser };
}

let installEvent = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();               // 由我們自己決定何時提示
  installEvent = e;
  syncInstallBtn();
});
window.addEventListener('appinstalled', () => { installEvent = null; syncInstallBtn(); });

// 已經是獨立 App 就不必再提示。iOS 上桌面 App 的儲存空間與 Safari 是分開的，
// 先在瀏覽器登入根本帶不過去，所以「先裝再登入」才是正確順序（AI業務教練 D032）。
function syncInstallBtn() {
  const hide = standalone();
  document.querySelectorAll('[data-install]').forEach(b => { b.hidden = hide; });
}

// ── 教學浮層 ────────────────────────────────────────────────
// 分享圖示長什麼樣是使用者最容易認錯的地方，所以直接畫出來。
const ICON_SHARE = '<span class="sh-icon"><svg viewBox="0 0 24 24">'
  + '<path d="M12 15V4"/><path d="M8.5 7.5 12 4l3.5 3.5"/>'
  + '<path d="M6 12v7a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-7"/></svg></span>';
const ICON_MORE = '<span class="sh-icon"><svg viewBox="0 0 24 24">'
  + '<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/>'
  + '<circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>'
  + '<circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg></span>';
const ICON_PLUS = '<span class="sh-icon"><svg viewBox="0 0 24 24">'
  + '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8.5v7M8.5 12h7"/></svg></span>';

// install：顯示「立即安裝」（Android 有系統安裝事件時）；done：顯示「我已經加過了」
function sheet(title, lead, steps, { why = true, install = false, done = false } = {}) {
  $('#sh-why').hidden = !why;
  $('#sh-install').hidden = !install;
  $('#sh-done').hidden = !done;
  $('#sheet .btn[data-close]').classList.toggle('primary', !install);   // 一次只有一顆藍色主按鈕
  $('#sh-title').textContent = title;
  $('#sh-lead').innerHTML = lead;
  $('#sh-steps').innerHTML = steps.map((s, i) =>
    `<div class="sh-step"><span class="sh-n">${i + 1}</span><div><p>${s[0]}</p>`
    + (s[1] ? `<small>${s[1]}</small>` : '') + '</div></div>').join('');
  $('#sheet').hidden = false;
}
document.querySelectorAll('#sheet [data-close]').forEach(e => {
  e.onclick = () => { $('#sheet').hidden = true; };
});

async function promptInstall() {
  const ev = installEvent;
  if (!ev) return;
  $('#sheet').hidden = true;
  ev.prompt();
  const r = await ev.userChoice.catch(() => null);
  installEvent = null;
  if (r?.outcome === 'accepted') { toast('已加到主畫面'); syncInstallBtn(); }
}
$('#sh-install').onclick = promptInstall;

document.addEventListener('click', e => {
  if (e.target.closest('[data-install]')) installGuide();
});

// 安裝教學。按「加到主畫面」按鈕，或第一次用手機瀏覽器打開時自動跳出（auto）。
async function installGuide({ auto = false } = {}) {
  const p = platform();
  const opt = { done: auto };                    // 自動跳出時多一個「我已經加過了」

  // 1) Android／桌面 Chrome：真的可以一鍵安裝。自動跳出時瀏覽器不准直接叫安裝視窗，先顯示說明
  if (installEvent && !auto) return promptInstall();
  if (installEvent) {
    return sheet('加到主畫面', '把 AI招募教練加到手機桌面，之後點圖示就能開啟，<b>全螢幕、像一般 App 一樣</b>。'
      + '按下面的「立即安裝」，再按系統跳出的「安裝」就完成了。', [], { ...opt, install: true });
  }

  // 2) LINE／FB／IG 的內建瀏覽器：連「加入主畫面」的選項都沒有，先把人帶到真正的瀏覽器
  if (p.inApp) {
    return sheet('請先用瀏覽器開啟',
      '你現在是從 <b>LINE／Facebook 之類的 App 內建瀏覽器</b>開啟的，'
      + '這種瀏覽器<b>沒有</b>「加入主畫面」的功能。先換到系統瀏覽器就可以了。',
      [[`點右上角的${ICON_MORE}`, '有些版本在右下角，圖示是三個點或箭頭'],
       ['選「用 Safari 開啟」或「用其他瀏覽器開啟」', 'Safari 或 Chrome 都可以，Android 選 Chrome'],
       ['在瀏覽器裡再按一次這顆「加到主畫面」']], opt);
  }

  // 3) iPhone／iPad：沒有 API 可以自動建立捷徑（Apple 的規定），只能教。
  if (p.ios) {
    const STEP1 = {
      safari: [`點${p.iPad ? '螢幕<b>右上角</b>（網址列右邊）' : '螢幕<b>最下方中間</b>'}的分享鍵${ICON_SHARE}`,
        '就是「方形加向上箭頭」那個圖示，不是圓圈裡的箭頭'],
      chrome: [`點<b>網址列右邊</b>的分享鍵${ICON_SHARE}`,
        '找不到的話，點右下角的 ⋯ 再選「分享」'],
      edge: ['點螢幕最下方的 <b>⋯</b> → 選「分享」', '再從系統的分享選單往下找'],
      firefox: ['點網址列右邊的 <b>⋯</b> → 選「分享」', '再從系統的分享選單往下找'],
      opera: ['從瀏覽器選單選「分享」', '再從系統的分享選單往下找'],
    };
    const NAME = { safari: 'Safari', chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox', opera: 'Opera' };
    const hint = p.browser === 'safari' ? ''
      : `你現在用的是 <b>${NAME[p.browser]}</b>，它建立的捷徑在 iOS 上一樣是全螢幕開啟，不必換瀏覽器。`;
    return sheet('加到主畫面',
      `iPhone／iPad 不允許網頁自己建立捷徑（Apple 的規定），要你手動按兩下。${hint}`,
      [STEP1[p.browser],
       ['在選單裡往下滑，找「加入主畫面」',
        `圖示是${ICON_PLUS}，通常要滑過一整排 App 圖示才看得到`],
       ['右上角按「新增」', '桌面就會出現 AI招募教練 的圖示']], opt);
  }

  // 4) Android 但瀏覽器沒給安裝事件：教選單的位置
  if (p.android) {
    return sheet('加到主畫面', '把 AI招募教練加到手機桌面，之後點圖示就能開啟，全螢幕、像一般 App 一樣。',
      [[`點瀏覽器右上角的 <b>⋮</b>`, 'Chrome、Edge、Samsung 瀏覽器都在右上角或右下角'],
       ['選「<b>加到主畫面</b>」或「<b>安裝應用程式</b>」'],
       ['按「安裝」或「新增」', '桌面就會出現 AI招募教練 的圖示']], opt);
  }
  if (auto) return;                              // 桌面電腦不自動跳

  // 5) 桌面瀏覽器但沒有安裝事件（Firefox、Safari，或已經裝過）
  return sheet('加到桌面',
    '這個瀏覽器沒有提供一鍵安裝。可以用網址列的安裝圖示，或直接用瀏覽器的選單。',
    [['看網址列右側有沒有安裝圖示', 'Chrome／Edge 是一個螢幕加箭頭的小圖示'],
     ['或從瀏覽器選單找「安裝」／「建立捷徑」'],
     ['macOS 的 Safari 是「檔案 → 加入 Dock」'],
     ['Firefox 桌面版沒有這個功能', '手機上開這個網址會比較順']]);
}

// 第一次用手機瀏覽器打開：主動教安裝（AI業務教練 D045）。每個瀏覽器只自動跳一次。
async function autoInstallTip() {
  if (standalone()) return;
  const p = platform();
  if (!(p.ios || p.android || p.inApp)) return;
  try { if (localStorage.getItem(INSTALL_TIP_KEY)) return; } catch { return; }
  // Android 的安裝事件通常在載入後一兩秒才來
  for (let i = 0; i < 25 && p.android && !installEvent; i++) await new Promise(r => setTimeout(r, 100));
  if (standalone() || !$('#sheet').hidden) return;
  try { localStorage.setItem(INSTALL_TIP_KEY, String(Date.now())); } catch { /* 無痕模式 */ }
  installGuide({ auto: true });
}

// 從桌面圖示的「快速動作」進來時直接開對應功能
function handleShortcut() {
  const go = new URLSearchParams(location.search).get('go');
  if (!go) return;
  history.replaceState({}, '', location.pathname);
  if (COMING[go]) $(`[data-fn="${go}"]`)?.click();
}

// ── 啟動 ────────────────────────────────────────────────────
$('#btn-welcome').onclick = () => { localStorage.setItem(SEEN_KEY, '1'); show('home'); };
$('#home-acct').hidden = true; $('#home-logout').hidden = true;

// 額度用盡自動降階時，讓使用者知道發生了什麼，而不是默默變慢或變差
let lastEvt = 0;
onModelEvent(e => {
  if (Date.now() - lastEvt < 8000) return;          // 同一波事件不要洗版
  lastEvt = Date.now();
  if (e.type === 'slow') toast(`${e.model} 沒有回應，已換下一個模型`, 4000);
  else if (e.type === 'busy') toast(`${e.model} 目前使用的人太多，暫時換別的模型（約 ${e.minutes} 分鐘後回頭嘗試）`, 5000);
  else if (e.type === 'quota') toast(`${e.model} 額度用盡，已自動改用備援模型（約 ${e.minutes} 分鐘後回頭嘗試）`, 5000);
  else if (e.type === 'fallback') toast(`目前改用 ${e.to}`, 3000);
});

async function boot() {
  setTimeout(autoInstallTip, 600);                  // 先讓畫面出來，再跳安裝教學
  switchOwner();
  // 強制登入：判斷依據是本機存的登入狀態，不是連線檢查——沒網路時仍然進得去
  if (acct.configured() && !acct.user()) {
    initAuth();
    return show('auth');
  }
  if (acct.user()) { updateWho(); syncNow(); }
  await initLogin();
  updateAccount(); syncInstallBtn(); handleShortcut();
}
boot();
