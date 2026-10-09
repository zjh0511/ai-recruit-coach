// AI招募教練｜豪老師 Hao+ — 畫面流程。
// 架構與 AI業務教練（zjh0511/ai-sales-coach）相同：純前端，金鑰只存在這台裝置，
// 帳號與訓練紀錄透過 Firebase 同步（和 AI業務教練共用同一個專案，資料放在 /recruit/<uid>）。
//
// 四大功能：招募對象痛點分析、招募邀約電訪演練、招募面談技巧演練、問問招募教練。
import { Voice, supported, voiceInfo, MIC_AFTER_TTS_MS } from './voice.js?v=9';
import { TtsRotator, nextPacificMidnight, voiceFor, COACH_VOICES } from './engine/tts.js?v=9';
import { api, providers, restore, onModelEvent, disconnect } from './engine/api.js?v=9';
import { SAMPLES, MODES, CONTEXTS } from './engine/prompts.js?v=9';
import * as acct from './engine/account.js?v=9';
import * as own from './engine/owner.js?v=9';
import { setOwner } from './engine/store.js?v=9';

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

const S = {
  fn: 'call',            // 目前功能：pain | call | meet | chat
  sessionId: null, persona: null, ended: false, busy: false,
  totals: null,          // 面談：顧慮／動機各有幾項
  lastCandidate: null,   // 最近一次的招募對象資料卡，可以直接接去下一個功能
  lastFb: null,
  chatHistory: [],
  docIds: [],            // 招募制度演練勾選的文件（最多 5 份）
};

const FN_TITLE = { pain: '招募對象痛點分析', call: '招募邀約電訪演練', meet: '招募面談技巧演練', system: '公司招募制度演練', chat: '問問招募教練' };

// ── 畫面切換 ────────────────────────────────────────────────
function show(name) {
  if (name !== 'chat') chatVoiceOff();
  vmode = name === 'chat' ? 'chat' : 'play';
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === 's-' + name));
  if (name === 'history') renderHistory();
  if (name === 'models') renderModels();
  if (name === 'docs') renderDocs();
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
  if (g.dataset.go === 'home') abort();
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
  abort();
  my.del(K.apikey);
  disconnect();
  if (reason) { $('#lg-msg').className = 'note err'; $('#lg-msg').textContent = reason; }
  show('login');
}

const busy = (msg, on = true) => {
  $('#wait-msg').textContent = msg;
  $('#wait-spin').hidden = false; $('#eval-fail').hidden = true;
  if (on) show('wait');
};

// 共用的小元件
const card = (title, ...kids) => { const c = el('div', 'card'); if (title) c.append(el('h4', null, title)); c.append(...kids); return c; };
const list = arr => { const u = el('ul'); arr.forEach(x => u.append(el('li', null, x))); return u; };
function fold(title, open, ...kids) {
  const d = el('details', 'card fold'); d.open = open;
  d.append(el('summary', null, title), ...kids);
  return d;
}

// ── 首頁四大功能 ────────────────────────────────────────────
document.querySelectorAll('[data-fn]').forEach(b => b.onclick = () => openFn(b.dataset.fn));

function openFn(fn) {
  S.fn = fn;
  if (fn === 'chat') { renderChat(); return show('chat'); }
  if (fn === 'system') return openDocs();
  openIntake(fn);
}

// ── 招募對象資料卡 ──────────────────────────────────────────
// 一張資料卡三個功能共用：痛點分析完可以直接接去練電訪或面談，不用重填。
function openIntake(fn, keep = true) {
  S.fn = fn;
  $('#i-title').textContent = FN_TITLE[fn];
  $('#i-diff-wrap').hidden = fn === 'pain';
  $('#i-ctx-label').firstChild.nodeValue = fn === 'call' || fn === 'pain' ? '你和對方的關係' : '你和對方的關係（這次見面是怎麼約到的）';
  $('#btn-go').textContent = fn === 'pain' ? '分析痛點' : '建立招募對象';
  const p = prefs();                       // 沿用上次的難度與情境，不用每次重選
  if (p.diff) setChip('#f-diff', p.diff);
  if (p.ctx && CONTEXTS[p.ctx]) setChip('#f-ctx', p.ctx);
  const c = keep && S.lastCandidate;
  if (c) {
    setChip('#f-gender', c.gender); $('#f-age').value = c.age; $('#f-bg').value = c.background;
    setChip('#f-ctx', c.context); $('#f-ctxnote').value = c.contextNote || '';
  }
  syncDifficulty();
  show('intake');
  $('#s-intake .scroll').scrollTop = 0;
}

for (const id of ['#f-gender', '#f-diff', '#f-ctx']) {
  $(id).addEventListener('click', e => {
    const c = e.target.closest('.chip'); if (!c) return;
    $(id).querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === c));
    if (id === '#f-diff') syncDifficulty();
  });
}
const pick = id => $(id).querySelector('.chip.on')?.dataset.v;
const setChip = (id, v) => { const c = v && $(id).querySelector(`.chip[data-v="${v}"]`); if (c) c.click(); };

// 範例：按一下帶入 10 種台灣常見的招募對象原型（企劃書 §3.1）
for (const x of SAMPLES) {
  const b = el('button', 'chip', x.label);
  b.onclick = () => {
    setChip('#f-gender', x.gender); $('#f-age').value = x.age; $('#f-bg').value = x.background;
    $('#f-sample').querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === b));
  };
  $('#f-sample').append(b);
}

const DIFF_HINT = {
  1: '對方溫和有耐心，你講不順時會善意幫你接話。第一次練習建議從這裡開始。',
  2: '對方態度正常，會先問「你找我什麼事？」，需要一個清楚、真誠的理由才願意聽下去。',
  3: '對方對保險業有刻板印象，有一個明確的顧慮要你處理。',
  4: '對方防備心強、回答很短，會接連丟出兩到三個顧慮。',
  5: '接近真實的難搞對象：排斥保險業、連續拒絕，隨時可能結束談話。',
};
const syncDifficulty = () => { $('#diff-hint').textContent = DIFF_HINT[pick('#f-diff')] || ''; };

$('#btn-go').onclick = async () => {
  const background = $('#f-bg').value.trim();
  if (!background) return toast('請先描述一下招募對象的背景');
  const cand = {
    gender: pick('#f-gender') || '男', age: $('#f-age').value.trim(), background,
    context: pick('#f-ctx') || 'warm', contextNote: $('#f-ctxnote').value.trim(),
  };
  S.lastCandidate = cand;

  if (S.fn === 'pain') {
    savePrefs({ ctx: cand.context });
    busy('正在分析這位招募對象可能的痛點…');
    try { renderPain(await api('/analyze/pain', cand)); show('pain'); }
    catch (e) { if (e.auth) return logout(e.message); toast(e.message, 4000); show('intake'); }
    return;
  }

  busy('正在建立招募對象、準備示範話術稿…');
  try {
    const d = await api('/session/start', { ...cand, mode: S.fn, difficulty: pick('#f-diff'), docIds: S.fn === 'system' ? S.docIds : undefined });
    savePrefs({ diff: pick('#f-diff'), ctx: cand.context });
    S.sessionId = d.sessionId; S.persona = d.persona; S.totals = d.totals; S.ended = false;
    renderBrief(d);
    show('brief');
  } catch (e) { if (e.auth) return logout(e.message); toast(e.message, 4000); show('intake'); }
};

// ── 功能一：痛點分析結果 ────────────────────────────────────
function renderPain(d) {
  const b = $('#pain-body'); b.innerHTML = '';
  if (d.profile) b.append(card('對這位招募對象的理解', el('p', null, d.profile)));

  const c1 = card('三個潛在痛點');
  d.points.forEach((p, i) => {
    const w = el('div', 'pt');
    w.append(el('b', null, `${i + 1}. ${p.pain}`));
    if (p.reason) w.append(el('p', 'ev', '推測原因：' + p.reason));
    if (p.opportunity) w.append(el('p', 'lbl', '事業機會可以怎麼回應'), el('p', null, p.opportunity));
    if (p.question) w.append(el('p', 'lbl', '你可以這樣問'), el('p', 'quote', p.question));
    c1.append(w);
  });
  b.append(c1);

  if (d.concerns?.length) {
    const c = card('他最可能的顧慮');
    d.concerns.forEach(x => {
      const w = el('div', 'imp');
      w.append(el('b', null, '「' + x.concern.replace(/^「|」$/g, '') + '」'), el('p', null, x.approach));
      c.append(w);
    });
    b.append(c);
  }

  const a = d.approach || {};
  if (a.channel || a.opening) {
    const c2 = card('建議的接觸方式');
    if (d.contextLabel) c2.append(el('p', 'muted', '你和對方的關係：' + d.contextLabel));
    if (a.channel) c2.append(el('p', 'lbl', '方式與時機'), el('p', null, a.channel));
    if (a.opening) c2.append(el('p', 'lbl', '開場可以這樣說'), el('p', 'quote', a.opening));
    if (a.avoid) c2.append(el('p', 'lbl', '要避免'), el('p', null, a.avoid));
    b.append(c2);
  }
  if (d.warning) b.append(el('p', 'note', '⚠️ ' + d.warning));
  b.append(el('p', 'note', '以上皆為依有限資訊所做的推測，實際情況仍須透過提問確認。收入與制度的具體數字，一律以所屬公司公告為準。'));
  b.scrollTop = 0;
}

$('#btn-pain2call').onclick = () => openIntake('call');
$('#btn-pain2meet').onclick = () => openIntake('meet');

// ── 演練前：示範話術稿 ──────────────────────────────────────
// 示範話術稿的段落，照實際對話順序；['*'] 是拒絕／顧慮那一段
const DEMO_STEPS = {
  call: [['opening', '開場與交代來意'], ['invite', '邀約見面'], ['*', 'objection', '遇到拒絕時']],
  meet: [['icebreak', '破冰'], ['situation_q', '了解現況'], ['motive_q', '引出動機'], ['opportunity', '介紹事業機會'],
    ['*', 'concern', '遇到顧慮時'], ['close', '邀約下一步']],
  system: [['opening', '開場'], ['income', '說明收入結構'], ['career', '說明晉升路徑'], ['support', '說明新人支持'],
    ['challenge', '誠實說明考核與挑戰'], ['*', 'concern', '對方追問時'], ['close', '邀約下一步']],
};
// 演練畫面左上角、開始按鈕：一眼看得出現在練的是哪一個（R014）
const MODE_TAG = { call: '📞 電訪', meet: '🤝 面談', system: '📋 制度' };

function renderBrief(d) {
  const mode = S.fn;
  $('#b-title').textContent = FN_TITLE[mode];
  $('#btn-start').textContent = `${MODE_TAG[mode]}・開始演練`;
  $('#b-learn').hidden = mode !== 'system';
  $('#b-name').textContent = d.persona.name;
  $('#b-summary').textContent = [d.persona.summary, d.contextLabel, '難度：' + d.persona.difficultyLabel].filter(Boolean).join('　·　');
  $('#b-obj').textContent = d.scenario?.objective || MODES[mode].objective;
  $('#b-goal').textContent = mode === 'call'
    ? '成功：約到見面。'
    : '成功：對方答應參加事業說明會或二次面談；最好的結果：願意去考照。'
      + (mode === 'system'
        ? `對方會一直追問制度細節。這次要講到的重點：${(d.keyPoints || []).map((k, i) => `${i + 1}. ${k}`).join('　')}`
        : `對方心裡有 ${d.totals.concerns} 個顧慮、${d.totals.motives} 個想要的事，問對問題他才會說。`);

  const box = $('#b-demo'); box.innerHTML = '';
  box.append(el('h4', null, '示範話術稿（參考用，不是標準答案）'));
  const demo = d.demo || {};
  for (const [k, a, b] of DEMO_STEPS[mode]) {
    if (k === '*') {
      const o = demo[a];
      if (o) box.append(el('p', 'step-t', b), el('p', 'quote', '對方：' + (o.candidate || '')), el('p', null, '你：' + (o.you || '')));
    } else if (demo[k]) box.append(el('p', 'step-t', a), el('p', null, demo[k]));
  }
  $('#s-brief .scroll').scrollTop = 0;
}

// ── 第二版：公司招募制度文件 ─────────────────────────────────
// 流程：勾選文件（最多 5 份）→【招募制度重點】→ 設定招募對象 → 示範話術稿（可回看重點）→ 演練 → 回饋
const MAX_PICK = 5;
const consented = () => my.get(K.docconsent) === '1';

function openDocs() {
  S.fn = 'system';
  $('#d-consent').hidden = consented();
  $('#d-agree').checked = false;
  show('docs');                                   // show('docs') 會畫清單
}

// 清單可能同時被要求重畫好幾次（例如上傳完、切回這個畫面）：只畫最後一次，不然會出現重複的列
let docsRender = 0;
async function renderDocs() {
  const tok = ++docsRender;
  let docs = [];
  try { docs = (await api('/doc/list')).docs; } catch (e) { if (e.auth) return logout(e.message); return toast(e.message); }
  if (tok !== docsRender) return;
  const b = $('#d-list'); b.innerHTML = '';
  S.docIds = S.docIds.filter(id => docs.some(d => d.id === id));
  if (!docs.length) b.append(el('p', 'upl', '還沒有制度文件，先上傳一份吧。'));
  for (const d of docs) {
    const on = S.docIds.includes(d.id);
    const row = el('div', 'card sm pol' + (on ? ' on' : ''));
    const head = el('label', 'inline pol-h');
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = on;
    head.append(cb, el('b', null, d.title || d.name));
    row.append(head, el('p', 'muted', [d.name, new Date(d.at).toLocaleDateString('zh-TW'), d.lesson ? '已有教練講解' : ''].filter(Boolean).join('　')));
    cb.onchange = () => {
      if (cb.checked) {
        if (S.docIds.length >= MAX_PICK) { cb.checked = false; return toast(`一次最多選 ${MAX_PICK} 份`); }
        S.docIds.push(d.id);
      } else S.docIds = S.docIds.filter(x => x !== d.id);
      renderDocs();
    };
    const del = el('button', 'del', '🗑');
    del.onclick = async () => {
      if (!confirm(`刪除「${d.title || d.name}」？這份文件的整理與教練講解也會一起刪除。`)) return;
      await api('/doc/delete', { id: d.id }); S.docIds = S.docIds.filter(x => x !== d.id); renderDocs();
    };
    row.append(del);
    b.append(row);
  }
  $('#d-next').disabled = !S.docIds.length;
  $('#d-next').textContent = S.docIds.length ? `下一步：看制度重點（已選 ${S.docIds.length} 份）` : '先勾選至少一份制度文件';
}

$('#btn-upload').onclick = () => {
  if (!consented()) {
    if (!$('#d-agree').checked) { $('#d-consent').scrollIntoView({ block: 'start' }); return toast('請先閱讀上方的提醒並勾選確認', 4000); }
    my.set(K.docconsent, '1');
    $('#d-consent').hidden = true;
  }
  $('#f-file').click();
};

$('#f-file').onchange = async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  if (f.size > 18 * 1024 * 1024) return toast('檔案超過 18MB，請壓縮或分成幾份上傳', 4000);
  busy(`AI 正在研讀「${f.name}」並整理制度重點…\n文件較長時可能需要一兩分鐘`);
  try {
    const base64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(',')[1]);
      r.onerror = () => rej(new Error('檔案讀取失敗'));
      r.readAsDataURL(f);
    });
    const d = await api('/doc/upload', { name: f.name, base64 });
    if (S.docIds.length < MAX_PICK) S.docIds.push(d.id);           // 剛上傳的直接幫他勾起來
    toast(d.warning ? `已整理「${d.title}」，但⚠️ ${d.warning}` : `已整理好「${d.title}」`, d.warning ? 8000 : 3000);
  } catch (err) {
    if (err.auth) return logout(err.message);
    toast(err.message, 6000);
  }
  show('docs');
};

$('#d-next').onclick = () => openLearn('pick');

// ── 招募制度重點頁 ──────────────────────────────────────────
// 第一次一定會出現；看過之後按鈕變成「跳過，直接設定」。示範話術稿頁可以「回看」，看完回到示範話術稿。
let learnFrom = 'pick', learnView = null;

async function openLearn(from) {
  learnFrom = from;
  busy('正在載入制度重點…');
  try { learnView = await api('/doc/lesson', { ids: S.docIds }); }
  catch (e) { if (e.auth) return logout(e.message); toast(e.message); return show(from === 'review' ? 'brief' : 'docs'); }
  $('#l-go').textContent = from === 'review' ? '回到示範話術稿' : learnView.seen ? '跳過，直接設定招募對象' : '看完了，設定招募對象';
  renderLearn();
  show('learn');
}

const notMissing = x => x && !/^文件未載明/.test(String(x).trim());

function renderLearn() {
  const v = learnView, b = $('#l-body');
  b.innerHTML = '';
  if (v.keyPoints?.length) {
    const c = el('div', 'card key');
    c.append(el('h4', null, '🎯 演練時要講到的重點'));
    const ol = el('ol'); v.keyPoints.forEach(k => ol.append(el('li', null, k))); c.append(ol);
    c.append(el('p', 'note', '演練結束後，教練回饋會逐點檢查你有沒有把這幾點講給對方聽。'));
    b.append(c);
  }
  v.docs.forEach((d, i) => {
    const g = d.digest || {};
    const top = el('div', 'card');
    top.append(el('h3', null, (v.docs.length > 1 ? `${i + 1}. ` : '') + d.title));
    if (g.overview) top.append(el('p', null, g.overview));
    if (d.pdf) top.append(el('p', 'note', '這份是 PDF：數字是 AI 從原檔讀出來的，手機上沒辦法逐字核對，正式使用前請對照原文。'));
    else if (d.unverified?.length) top.append(el('p', 'note', `⚠️ 這幾個數字在原文找不到，請對照原文確認：${d.unverified.join('、')}`));
    b.append(top);

    const rows = (list, fmt) => { const u = el('ul'); list.forEach(x => u.append(el('li', null, fmt(x)))); return u; };
    const src = s => (s ? `（${s}）` : '');
    if (g.income?.length) b.append(fold('💰 收入結構', i === 0, rows(g.income, x => `${x.item}：${x.how}${notMissing(x.condition) ? `｜條件：${x.condition}` : ''}${src(x.source)}`)));
    if (g.career?.length) b.append(fold('📈 職涯晉升', false, rows(g.career, x => `${x.level}：${x.requirement}${src(x.source)}`)));
    if (g.support?.length) b.append(fold('🤝 新人支持', false, rows(g.support, x => `${x.item}：${x.detail}${src(x.source)}`)));
    if (g.assessment?.length) b.append(fold('📋 考核與留任', false, rows(g.assessment, x => `${x.item}：${x.detail}${src(x.source)}`)));
    if (g.costs?.length) b.append(fold('💳 需要自行負擔', false, list(g.costs)));
    if (g.sweet_points?.length || g.challenges?.length) {
      const w = el('div');
      if (g.sweet_points?.length) w.append(el('p', 'lbl', '對招募對象的吸引力'), list(g.sweet_points));
      if (g.challenges?.length) w.append(el('p', 'lbl', '要誠實說明的條件與挑戰'), list(g.challenges));
      b.append(fold('⚖️ 吸引力與挑戰', false, w));
    }
    if (g.faq?.length) {
      const w = el('div');
      g.faq.forEach(x => { const q = el('div', 'fabe'); q.append(el('p', 'quote', '對方：' + x.q), el('p', null, '你：' + x.a)); w.append(q); });
      b.append(fold('💬 對方常問的問題', false, w));
    }
    if (g.compliance?.length) b.append(fold('⚠️ 合規提醒', false, list(g.compliance)));
    if (g.missing?.length) {
      const f = fold('⚠️ 文件沒寫、不能亂講', false, el('p', 'note', '對方問到這些，老實說「我回去確認後再跟你說明」。'), list(g.missing));
      f.classList.add('warn');
      b.append(f);
    }
    b.append(coachCard(d));
  });
  b.scrollTop = 0;
}

// 第二層：教練講解。按了才產生（會用額度），每份文件只產生一次，存起來之後直接顯示
function coachCard(d) {
  const L = d.lesson;
  if (!L) {
    const c = el('div', 'card');
    c.append(el('h4', null, `✨ 教練講解${learnView.docs.length > 1 ? `：${d.title}` : ''}`));
    c.append(el('p', 'muted', '60 秒制度介紹稿、必講重點怎麼講、用文件裡的數字舉例、常見的講錯。'));
    const btn = el('button', 'btn', '產生教練講解');
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = '教練準備中…約 10～20 秒';
      try {
        const r = await api('/doc/coach', { id: d.id });
        d.lesson = r.lesson;
        learnView = await api('/doc/lesson', { ids: S.docIds });     // 必講重點可能跟著換成教練講解的版本
        renderLearn();
      } catch (e) {
        if (e.auth) return logout(e.message);
        toast(e.message, 5000); btn.disabled = false; btn.textContent = '產生教練講解';
      }
    };
    c.append(btn, el('p', 'note', '會使用你的 API 額度。每份文件只產生一次，之後會存起來重複看。'));
    return c;
  }
  const c = el('div', 'card coach');
  c.append(el('h4', null, `✨ 教練講解${learnView.docs.length > 1 ? `：${d.title}` : ''}`));
  if (L.pitch) c.append(el('p', 'lbl', '60 秒制度介紹稿'), el('p', null, L.pitch));
  if (L.key_points?.length) {
    c.append(el('p', 'lbl', '必講重點怎麼講'));
    L.key_points.forEach((k, i) => {
      const w = el('div', 'fabe');
      w.append(el('b', null, `${i + 1}. ${k.point}`));
      if (k.why) w.append(el('p', 'muted', '對方在意的是：' + k.why));
      if (k.say) w.append(el('p', null, '「' + k.say.replace(/^「|」$/g, '') + '」'));
      c.append(w);
    });
  }
  if (L.examples?.length) {
    c.append(el('p', 'lbl', '用文件裡的數字舉例'));
    L.examples.forEach(x => { const w = el('div', 'fabe'); if (x.case) w.append(el('b', null, x.case)); w.append(el('p', null, x.explain)); c.append(w); });
  }
  if (L.order?.length) { c.append(el('p', 'lbl', '建議的說明順序')); const ol = el('ol'); L.order.forEach(x => ol.append(el('li', null, x))); c.append(ol); }
  if (L.pitfalls?.length) c.append(el('p', 'lbl', '常見的講錯'), list(L.pitfalls));
  if (L.unverified?.length) c.append(el('p', 'note', `⚠️ 這幾個數字在制度資料裡找不到，請對照原文確認：${L.unverified.join('、')}`));
  return c;
}

$('#l-go').onclick = () => {
  if (learnFrom === 'review') return show('brief');
  if (!learnView.seen) api('/doc/seen', { ids: S.docIds }).catch(() => {});
  openIntake('system');
};
$('#l-back').onclick = () => (learnFrom === 'review' ? show('brief') : openDocs());
$('#b-learn').onclick = () => openLearn('review');

// ── Voice Engine ────────────────────────────────────────────
// 自動收音的排程用 epoch 擋掉過期的排程（AI業務教練 §4.3）：使用者自己按了麥克風、
// 打字送出、或演練結束之後，先前排定的「幾秒後開麥克風」都必須作廢。
let listenTimer = 0, listenEpoch = 0, emptyTries = 0, stallTries = 0;
const cancelListen = () => { clearTimeout(listenTimer); listenEpoch++; };

// 語音引擎只有一個（iOS 上多開 AudioContext／辨識器很容易互相卡住），
// 演練與「問問招募教練」共用；callback 依目前畫面分派。
let vmode = 'play';
const voice = new Voice({
  onPartial: t => { if (vmode === 'chat') return chatV.partial(t); if (t) setStatus('🎙️ ' + t, 'live'); },
  onFinal: t => { if (vmode === 'chat') return chatV.final(t); emptyTries = 0; stallTries = 0; submit(t); },
  onEmpty: () => {
    if (vmode === 'chat') return chatV.empty();
    if (++emptyTries <= 3) return nextTurn(600);
    emptyTries = 0;
    setStatus('沒有聽到聲音，點一下麥克風再說');
  },
  onStall: () => {
    if (vmode === 'chat') return chatV.stall();
    if (++stallTries <= 2) { setStatus('麥克風重新連接中…'); return nextTurn(800); }
    stallTries = 0;
    setStatus('麥克風沒有反應，點一下麥克風再試；也可以直接打字');
  },
  onState: s => {
    if (s === 'tts-quota-day') return quotaNotice();
    if (s === 'tts-fallback') {
      if (!ttsNotice) { ttsNotice = true; toast('真人語音暫時無法使用，先改用手機內建語音', 3500); }
      return;
    }
    if (vmode === 'chat') return chatV.state(s);
    const m = $('#btn-mic');
    m.classList.toggle('rec', s === 'listening');
    m.classList.toggle('talk', s === 'speaking');
    if (s === 'listening') setStatus('🎙️ 請說話…', 'live');
    else if (s === 'speaking') setStatus('對方正在說話（點麥克風可打斷）');
    else if (typeof s === 'string' && s.startsWith('error:')) {
      setStatus('');
      toast(s.includes('not-allowed') ? '麥克風權限被拒絕，請到 Safari 設定開啟' : '沒聽清楚，再說一次或直接打字');
    }
  },
});

// 真人語音（Gemini TTS）：用使用者同一把金鑰，三個語音模型輪流（AI業務教練 D043）
let ttsNotice = false;
const ttsStore = {
  load: () => JSON.parse(my.get(K.ttsq) || '{}'),
  save: st => my.set(K.ttsq, JSON.stringify(st)),
};
const tts = new TtsRotator({ store: ttsStore });
voice.cloud = {
  stream: (text, gender, signal, hint) => {
    const { provider, key } = cred();
    if (provider !== 'gemini' || !key) throw new Error('tts no key');
    return tts.stream(key, text, hint?.cloudVoice || voiceFor(gender === '女' ? '女' : '男'), signal);
  },
};

// 三個語音模型今天的免費額度都用完了：講清楚原因、幾點恢復。每天只講一次。
const QUOTA_NOTICE_KEY = own.PREFIX + 'ttsq.notice';
function quotaNotice() {
  const reset = nextPacificMidnight();
  if (localStorage.getItem(QUOTA_NOTICE_KEY) === String(reset)) return;
  localStorage.setItem(QUOTA_NOTICE_KEY, String(reset));
  const day = new Date(reset).toDateString() === new Date().toDateString() ? '今天' : '明天';
  const at = new Date(reset).toLocaleTimeString('zh-TW', { hour: 'numeric', minute: '2-digit' });
  const lead = `Google 免費的真人語音每天有上限（和 AI業務教練共用同一把金鑰的話是兩邊合計），今天的已經用完，<b>${day}${at}會恢復</b>。`
    + '在那之前 AI 對話照常，只是聲音先改用手機內建的朗讀。';
  if (!platform().ios) return sheet('今天的免費真人語音用完了', lead, [], { why: false });
  sheet('今天的免費真人語音用完了', lead + '<br>iPhone 內建的聲音可以免費換成好聽很多的版本：', [
    ['打開「設定」→「輔助使用」→「朗讀內容」→「聲音」'],
    ['選「中文（台灣）」→「美佳」，下載<b>加強版</b>', '檔案約一兩百 MB，建議連 Wi-Fi 下載'],
    ['下載完回到 App，之後的內建聲音就會自然很多'],
  ], { why: false });
}

const speakHint = () => ({ ...(S.persona?.voice || {}), gender: S.persona?.gender === '女' ? '女' : '男' });
const setStatus = (t, cls = '') => { const n = $('#p-status'); n.textContent = t; n.className = 'status ' + cls; };

const VOICE_HINT_KEY = own.PREFIX + 'voicehint';
function hintVoiceQuality() {
  if (voice.cloud) return;
  if (localStorage.getItem(VOICE_HINT_KEY)) return;
  const v = voiceInfo();
  if (!v || v.enhanced) return;
  localStorage.setItem(VOICE_HINT_KEY, '1');
  toast('想讓對方的聲音更像真人？iPhone：設定 → 輔助使用 → 旁白 → 語音 → 中文 → 下載「加強版」', 9000);
}

function push(log, speaker, text) {
  const n = $(log);
  n.appendChild(el('div', 'msg ' + speaker, text));
  n.scrollTop = n.scrollHeight;
}

// ── 開始演練 ────────────────────────────────────────────────
$('#btn-start').onclick = async () => {
  voice.unlock();                                    // iOS：第一句朗讀必須在使用者手勢中
  voice.resetStats();
  // 演練畫面標出現在練的是電訪還是面談，避免搞混
  $('#p-log').innerHTML = ''; $('#p-name').textContent = `${MODE_TAG[S.fn]}｜${S.persona.name}`;
  $('#p-found').hidden = S.fn === 'call';
  if (S.fn !== 'call') $('#p-found').textContent = foundText({ concerns: 0, motives: 0 });
  S.ended = false; show('play');
  if (!supported.stt) toast('這個瀏覽器不支援語音辨識，請用下方文字輸入', 4000);
  else hintVoiceQuality();
  try {
    const d = await api('/session/begin', { sessionId: S.sessionId });
    push('#p-log', 'customer', d.opening);
    await voice.speak(d.opening, speakHint());
    nextTurn();
  } catch (e) { toast(e.message); }
};

const foundText = f => `顧慮 ${f.concerns}/${S.totals?.concerns ?? 0}・動機 ${f.motives}/${S.totals?.motives ?? 0}`;

function nextTurn(delay = MIC_AFTER_TTS_MS) {
  if (S.ended) return;
  if (!supported.stt) return setStatus('請用下方輸入框回覆');
  if (voice.state === 'listening') return;
  clearTimeout(listenTimer);
  const ep = ++listenEpoch;
  if (delay > 1000) setStatus('正在切回麥克風…（點麥克風可以直接開始）');
  listenTimer = setTimeout(() => {
    if (ep !== listenEpoch || S.ended || S.busy) return;
    if (!document.querySelector('#s-play.on')) return;
    if (voice.state !== 'idle') return;
    if (!voice.listen()) setStatus('點一下麥克風開始說話');
  }, delay);
}

$('#btn-mic').onclick = () => {
  voice.unlock();
  cancelListen();
  emptyTries = 0; stallTries = 0;
  if (voice.state === 'speaking') { voice.stopSpeaking(); voice.listen(); }
  else if (voice.state === 'listening') voice.stopListening();
  else voice.listen();
};

$('#btn-send').onclick = () => {
  const t = $('#p-text').value.trim();
  if (t) { $('#p-text').value = ''; voice.abortListening(); submit(t); }
};
$('#p-text').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btn-send').click(); });

async function submit(text) {
  if (S.busy || S.ended || !S.sessionId) return;
  cancelListen();
  S.busy = true;
  push('#p-log', 'user', text);
  setStatus('對方思考中…', 'think');
  try {
    const d = await api('/session/turn', { sessionId: S.sessionId, text });

    if (d.type === 'compliance') {
      push('#p-log', 'system', d.text);
      setStatus(''); S.busy = false;
      toast('偵測到合規風險，演練已暫停，請換個說法再講一次', 4000);
      return nextTurn(300);
    }

    push('#p-log', 'customer', d.text);
    if (S.fn !== 'call') $('#p-found').textContent = foundText(d.found);
    if (d.outcome) toast('🎉 ' + d.outcome.label, 3200);
    if (d.warn) toast('注意用語：' + d.warn[0], 4000);
    // 談話結束要在朗讀「之前」就標記：對方講最後一句時使用者若又開口，不能再送出一回合
    if (d.ended) S.ended = true;
    S.busy = false;
    await voice.speak(d.text, speakHint());

    if (d.ended) { setStatus('這次談話結束了'); setTimeout(finish, 900); }
    else nextTurn();
  } catch (e) {
    S.busy = false; setStatus('');
    if (e.auth) { S.sessionId = null; return logout(e.message); }
    toast(e.message);
    if (/逾時/.test(e.message)) { S.sessionId = null; show('home'); }
  }
}

$('#btn-end').onclick = () => { S.ended = true; cancelListen(); voice.reset(); finish(); };

async function finish() {
  if (!S.sessionId) return show('home');
  cancelListen(); voice.reset(); busy('正在分析你剛才的表現…');
  const id = S.sessionId;
  try {
    const fb = await api('/session/end', { sessionId: id });
    S.sessionId = null;                     // 評分成功才放掉（AI業務教練 D033）
    fb.voiceStats = voice.stats();
    S.lastFb = fb;
    renderFeedback(fb); saveHistory(fb); show('fb');
  } catch (e) {
    if (e.auth) return logout(e.message);
    $('#wait-spin').hidden = true;
    $('#wait-msg').textContent = '評分沒有完成';
    $('#eval-why').textContent = e.message.replace(/[。.！!\s]+$/, '')
      + '。你的對話紀錄都還在，稍等一下再按「重新評分」就可以。';
    $('#eval-fail').hidden = false;
  }
}

$('#eval-retry').onclick = () => finish();
$('#eval-drop').onclick = () => {
  if (!confirm('放棄之後，這場演練的對話紀錄就不會留下。確定？')) return;
  abort(); show('home');
};

function abort() {
  if (S.sessionId) api('/session/abort', { sessionId: S.sessionId }).catch(() => {});
  S.sessionId = null; S.ended = true; cancelListen(); voice.reset();
}

$('#btn-again').onclick = () => openIntake(S.fn);
// 電訪約成功之後，最自然的下一步就是用同一位對象練面談
$('#btn-next').onclick = () => {
  if (S.fn === 'call' && S.lastFb?.outcome?.tier > 0) return openIntake('meet');
  show('home');
};

// ── 回饋畫面 ────────────────────────────────────────────────
function renderFeedback(fb) {
  const b = $('#fb-body'); b.innerHTML = '';

  const o = fb.outcome || { tier: 0, label: '' };
  const oc = el('div', `card outcome t${o.tier}`);
  oc.append(el('p', 'muted', `${fb.modeName}演練結果`), el('p', 'big', (o.tier === 2 ? '🏆 ' : o.tier === 1 ? '🎉 ' : '') + o.label));
  oc.append(el('p', 'note', [fb.persona?.name, fb.contextLabel, '難度：' + fb.difficultyLabel].filter(Boolean).join('　·　')));
  b.append(oc);

  b.append(card('總評', el('p', null, fb.summary || '')));

  const c2 = card('五項能力評分');
  for (const k of Object.keys(NAMES)) {
    const s = fb.scores?.[k]; if (!s) continue;
    c2.append(starRow(NAMES[k], s.score, s.evidence));
  }
  const tot = Object.values(fb.scores || {}).map(s => s.score);
  if (tot.length) c2.append(el('p', 'note', `平均 ${(tot.reduce((a, x) => a + x, 0) / tot.length).toFixed(1)} 顆星。只依文字逐字稿判斷，聽不到真正的音高音量，「親切感」是從用字與節奏推論。`));
  b.append(c2);

  // 違規一定要點名（GPT 版：回饋時一定要特別點名指正）——清單由程式提供，不靠模型記得
  if (fb.violations?.length) {
    const c = el('div', 'card warn');
    c.append(el('h4', null, '⚠️ 合規提醒：這次有說法要調整'));
    for (const v of fb.violations) {
      const w = el('div', 'imp');
      w.append(el('b', null, `「${v.quote}」`), el('p', 'law', `${v.type}｜${v.law}`), el('p', 'ev', v.why));
      c.append(w);
    }
    if (fb.compliance_note) c.append(el('p', 'note', fb.compliance_note));
    b.append(c);
  }

  if (fb.positives?.length) b.append(card('你做得好的地方', list(fb.positives)));

  if (fb.improvements?.length) {
    const c = card('可以再調整的地方');
    fb.improvements.forEach(i => {
      const d = el('div', 'imp');
      d.append(el('b', null, i.point || ''), el('p', 'ev', i.why || ''), el('p', null, i.how || ''));
      c.append(d);
    });
    b.append(c);
  }

  if (fb.example_script) b.append(card('示範話術', el('p', null, fb.example_script)));

  if (fb.concerns?.length || fb.motives?.length) {
    const fc = new Set(fb.metrics?.concernsFound || []), fm = new Set(fb.metrics?.motivesFound || []);
    const c = card(`對方心裡真正在意的事（挖到 ${fc.size + fm.size}／${(fb.concerns?.length || 0) + (fb.motives?.length || 0)}）`);
    if (fb.concerns?.length) { c.append(el('p', 'lbl', '顧慮')); c.append(list(fb.concerns.map(h => (fc.has(h) ? '✅ ' : '⬜ ') + h))); }
    if (fb.motives?.length) { c.append(el('p', 'lbl', '想要的事（動機）')); c.append(list(fb.motives.map(h => (fm.has(h) ? '✅ ' : '⬜ ') + h))); }
    b.append(c);
  }

  // 招募制度演練：必講重點、講錯的地方、對不到的數字（R016）
  if (fb.key_points?.length) {
    const got = fb.key_points.filter(k => k.covered).length;
    const c = el('div', 'card key');
    c.append(el('h4', null, `🎯 必講重點（講到 ${got}／${fb.key_points.length}）`));
    fb.key_points.forEach(k => {
      const d = el('div', 'kp');
      d.append(el('b', null, (k.covered ? '✅ ' : '⬜ ') + k.point));
      if (k.note) d.append(el('p', 'ev', k.note));
      c.append(d);
    });
    b.append(c);
  }
  if (fb.mode === 'system') {
    const c = el('div', 'card' + (fb.misstatements?.length ? ' warn' : ''));
    c.append(el('h4', null, fb.misstatements?.length ? `📌 和制度文件不一樣的說法（${fb.misstatements.length} 處）` : '📌 制度內容講得正確'));
    if (!fb.misstatements?.length) c.append(el('p', 'note', '對照制度文件，沒有發現講錯的數字或條件。'));
    for (const x of fb.misstatements || []) {
      const w = el('div', 'imp');
      w.append(el('b', null, `你說：「${x.quote}」`), el('p', null, '制度文件：' + x.fact));
      c.append(w);
    }
    if (fb.unknown_numbers?.length) c.append(el('p', 'note', `⚠️ 你講的這幾個數字在制度文件裡找不到，請確認：${fb.unknown_numbers.join('、')}`));
    if (fb.docTitles?.length) c.append(el('p', 'note', '對照的文件：' + fb.docTitles.join('、')));
    b.append(c);
  }

  if (fb.next_challenge) b.append(card('下一次的挑戰', el('p', null, fb.next_challenge)));

  if (fb.transcript?.length) {
    const t = el('div', 'log transcript');
    for (const m of fb.transcript) t.append(el('div', 'msg ' + (m.speaker === 'user' ? 'user' : 'customer'), m.text));
    b.append(fold('完整逐字稿', false, t));
  }

  const m = fb.metrics || {};
  const vs = fb.voiceStats;
  b.append(el('p', 'note',
    `回合數 ${m.turns}｜對談 ${m.durationSec} 秒｜對方最終信任度 ${m.finalTrust}/100｜對方引導你 ${m.guided} 次`
    + `｜AI 生成 ${fb.avgLatencyMs} ms` + (vs ? `｜你說完到對方開口 平均 ${vs.avg} ms` : '')));

  $('#btn-next').textContent = fb.mode === 'call' && o.tier > 0 ? '接著練面談' : '回首頁';
  b.scrollTop = 0;
}

// ── 功能四：問問招募教練（可以打字，也可以語音對談）──────────────
// 模型偶爾還是會冒出 Markdown 記號，純文字氣泡顯示會很醜，統一清掉
const clean = s => (s || '')
  .replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#{1,6}\s*/gm, '')
  .replace(/^>\s?/gm, '').replace(/^[-*]\s+/gm, '・').trim();

// 目前這一串對話存在這支手機（依帳號分開），按「清除」才刪。不同步到雲端。
function saveChat() {
  try { my.set(K.chat, JSON.stringify(S.chatHistory.slice(-60))); } catch { /* 容量滿時忽略 */ }
}
const loadChat = () => { try { S.chatHistory = JSON.parse(my.get(K.chat) || '[]'); } catch { S.chatHistory = []; } };

const coachGender = () => (prefs().coach === '女' ? '女' : '男');
const coachHint = () => ({ rate: 1, cloudVoice: COACH_VOICES[coachGender()] });

const CHAT_STARTERS = [
  '為什麼現在是加入保險業的好時機？',
  '怎麼跟工程師談這份工作的收入？',
  '對方說「我怕要賣給親友」，我該怎麼回應？',
  '全職媽媽想重回職場，我可以怎麼切入？',
  '新人前三個月怎麼帶，才留得住？',
  '約完說明會之後，要怎麼跟進？',
];

function coachBubble(text) {
  const m = el('div', 'msg coach', text);
  const b = el('button', 'say', '🔊 聽');
  b.onclick = () => {
    voice.unlock();
    if (voice.state === 'speaking') return voice.stopSpeaking();
    CV.ep++; clearTimeout(CV.hold); voice.abortListening();
    voice.speak(text, coachHint()).then(() => { if (CV.on) chatListen(); });
  };
  m.append(b);
  return m;
}

function renderChat() {
  const b = $('#ch-log'); b.innerHTML = '';
  if (!S.chatHistory.length) {
    const m = el('div', 'msg coach');
    m.append(el('p', null, '招募上遇到什麼問題都可以問我：產業趨勢、事業機會怎麼說、不同背景的對象怎麼談、顧慮怎麼回應、新人怎麼留得住。可以打字，也可以按 🎙️ 用講的。'));
    const q = el('div', 'chat-q');
    for (const s of CHAT_STARTERS) {
      const c = el('button', 'chip', s);
      c.onclick = () => sendChat(s);
      q.append(c);
    }
    m.append(q);
    b.append(m);
  }
  for (const t of S.chatHistory) {
    if (t.role === 'user') b.append(el('div', 'msg user' + (t.voice ? ' spoken' : ''), t.text));
    else b.append(coachBubble(clean(t.text)));
  }
  $('#ch-coach').querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.v === coachGender()));
  b.scrollTop = b.scrollHeight;
}

async function sendChat(q, spoken = false) {
  if (!q || S.busy) return;
  S.busy = true;
  const log = $('#ch-log');
  log.querySelector('.chat-q')?.remove();
  log.append(el('div', 'msg user' + (spoken ? ' spoken' : ''), q));
  const th = el('div', 'msg coach', '思考中…');
  log.append(th); log.scrollTop = 1e9;
  if (CV.on) chatStatus('教練思考中…', 'think');
  try {
    const d = await api('/coach/chat', { history: S.chatHistory, message: q, voice: CV.on });
    const text = clean(d.reply);
    th.replaceWith(coachBubble(text));
    S.chatHistory.push({ role: 'user', text: q, ...(spoken ? { voice: 1 } : {}) }, { role: 'ai', text: d.reply });
    saveChat();
    if (d.compliance) toast('⚠️ ' + d.compliance[0], 6000);
    S.busy = false; log.scrollTop = 1e9;
    if (CV.on) { await voice.speak(text, coachHint()); chatListen(); }
  } catch (e) {
    S.busy = false;
    if (e.auth) return logout(e.message);
    th.textContent = '發生錯誤：' + e.message;
    if (CV.on) chatStatus('剛剛沒有成功，點麥克風再說一次');
  }
}

$('#ch-send').onclick = () => {
  const q = $('#ch-text').value.trim();
  if (!q || S.busy) return;
  $('#ch-text').value = '';
  sendChat(q);
};
$('#ch-text').addEventListener('keydown', e => { if (e.key === 'Enter') $('#ch-send').click(); });
$('#chat-clear').onclick = () => {
  if (S.chatHistory.length && !confirm('清除這段對話？清除後就找不回來了。')) return;
  S.chatHistory = []; saveChat(); renderChat();
};

// 教練聲音：選了就讓他聽一下。試聽是事先錄好的音檔，不花學員的語音額度（AI業務教練 D043）
let previewAudio = null;
$('#ch-coach').addEventListener('click', e => {
  const c = e.target.closest('.chip'); if (!c) return;
  savePrefs({ coach: c.dataset.v });
  renderChat();
  voice.unlock();
  CV.ep++; clearTimeout(CV.hold); voice.abortListening(); voice.stopSpeaking();
  previewAudio?.pause();
  previewAudio = new Audio(`audio/coach-${c.dataset.v === '女' ? 'female' : 'male'}.mp3`);
  const after = () => { if (CV.on) chatListen(); };
  previewAudio.onended = after;
  previewAudio.play().catch(after);
});

// ── 語音對談 ──
// 問教練常常要描述一整段狀況、邊想邊講。一句結束後不馬上送出：繼續聽，
// CHAT_HOLD_MS 內沒有再開口才送（AI業務教練 D042）。也可以按「講完了」立刻送出。
const CHAT_HOLD_MS = 2500;
const CV = { on: false, buf: [], pending: '', ep: 0, hold: 0, timer: 0, empty: 0, stall: 0, flushNow: false };
const joinSaid = parts => parts.reduce((a, t) => (a && !/[，。！？、,.!?]$/.test(a) ? a + '，' : a) + t, '');
const chatStatus = (t, cls = '') => { const n = $('#ch-status'); n.textContent = t; n.className = 'status ' + cls; };

function chatVoiceOn() {
  if (!supported.stt) return toast('這個瀏覽器不支援語音辨識，請用打字的', 4000);
  voice.unlock();
  CV.on = true; CV.buf = []; CV.pending = ''; CV.empty = 0; CV.stall = 0; CV.flushNow = false;
  $('#s-chat').classList.add('voice');
  chatListen(0);
}

function chatVoiceOff() {
  if (!CV.on) return;
  CV.on = false; CV.ep++;
  clearTimeout(CV.hold); clearTimeout(CV.timer);
  voice.abortListening(); voice.stopSpeaking();
  if (CV.pending) CV.buf.push(CV.pending);
  if (CV.buf.length) $('#ch-text').value = joinSaid(CV.buf);
  CV.buf = []; CV.pending = '';
  $('#s-chat').classList.remove('voice');
  chatStatus('');
}

function chatListen(delay = MIC_AFTER_TTS_MS) {
  if (!CV.on) return;
  clearTimeout(CV.timer);
  const ep = ++CV.ep;
  if (delay > 1000) chatStatus('正在切回麥克風…（點麥克風可以直接開始）');
  CV.timer = setTimeout(() => {
    if (ep !== CV.ep || !CV.on || S.busy || !$('#s-chat.on')) return;
    if (voice.state !== 'idle') return;
    if (!voice.listen()) chatStatus('點一下麥克風開始說話');
  }, delay);
}

function chatFlush() {
  clearTimeout(CV.hold);
  CV.flushNow = false;
  if (CV.pending) { CV.buf.push(CV.pending); CV.pending = ''; }
  const t = joinSaid(CV.buf).trim();
  CV.buf = [];
  if (!t) return;
  CV.ep++; clearTimeout(CV.timer);
  voice.abortListening();
  sendChat(t, true);
}

const chatV = {
  partial(t) {
    if (!t || !CV.on) return;
    clearTimeout(CV.hold);
    CV.pending = t;
    chatStatus('🎙️ ' + joinSaid([...CV.buf, t]), 'live');
  },
  final(t) {
    if (!CV.on) return;
    CV.buf.push(t); CV.pending = ''; CV.empty = 0; CV.stall = 0;
    if (CV.flushNow) return chatFlush();
    chatStatus('🎙️ ' + joinSaid(CV.buf) + '　（停一下就會送出）', 'live');
    clearTimeout(CV.hold);
    CV.hold = setTimeout(chatFlush, CHAT_HOLD_MS);
    chatListen(0);
  },
  empty() {
    if (!CV.on) return;
    if (CV.buf.length || CV.pending) return chatFlush();
    CV.flushNow = false;
    if (++CV.empty <= 3) return chatListen(600);
    CV.empty = 0;
    chatStatus('沒有聽到聲音，點一下麥克風再說');
  },
  stall() {
    if (!CV.on) return;
    if (CV.buf.length) return chatFlush();
    if (++CV.stall <= 2) { chatStatus('麥克風重新連接中…'); return chatListen(800); }
    CV.stall = 0;
    chatStatus('麥克風沒有反應，點一下麥克風再試；也可以改用打字');
  },
  state(s) {
    const m = $('#ch-mic');
    m.classList.toggle('rec', s === 'listening');
    m.classList.toggle('talk', s === 'speaking');
    if (!CV.on) return;
    if (s === 'listening' && !CV.buf.length) chatStatus('🎙️ 請說話…', 'live');
    else if (s === 'speaking') chatStatus('教練正在說話（點麥克風可打斷）');
    else if (typeof s === 'string' && s.startsWith('error:')) {
      chatStatus('');
      toast(s.includes('not-allowed') ? '麥克風權限被拒絕，請到 Safari 設定開啟' : '沒聽清楚，再說一次或改用打字');
    }
  },
};

$('#ch-voice').onclick = chatVoiceOn;
$('#ch-kb').onclick = chatVoiceOff;
$('#ch-mic').onclick = () => {
  voice.unlock();
  CV.ep++; clearTimeout(CV.timer);
  if (voice.state === 'speaking') { voice.stopSpeaking(); voice.listen(); }
  else if (voice.state === 'listening') { CV.flushNow = true; voice.stopListening(); }
  else if (CV.buf.length) chatFlush();
  else voice.listen();
};
$('#ch-done').onclick = () => {
  if (voice.state === 'listening') { CV.flushNow = true; voice.stopListening(); }
  else chatFlush();
};

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

function saveHistory(fb) {
  try {
    const h = history_();
    h.unshift({
      at: Date.now(), mode: fb.mode, modeName: fb.modeName,
      persona: fb.persona?.summary || '', name: fb.persona?.name || '',
      outcome: fb.outcome?.label || '', tier: fb.outcome?.tier || 0,
      scores: Object.fromEntries(Object.entries(fb.scores || {}).map(([k, v]) => [k, v.score])),
      summary: fb.summary, next: fb.next_challenge,
      violations: fb.violations?.length || 0,
      kp: fb.key_points?.length ? [fb.key_points.filter(k => k.covered).length, fb.key_points.length] : undefined,
      wrong: fb.misstatements?.length || undefined,
    });
    my.set(K.history, JSON.stringify(h.slice(0, 50)));
    syncSoon();
  } catch { /* 容量滿時忽略 */ }
}

function renderHistory() {
  const b = $('#h-body'); b.innerHTML = '';
  const h = history_();
  if (!h.length) { b.append(el('p', 'note', '還沒有紀錄。每次電訪演練、面談演練練完的評分都會記在這裡。')); return; }

  const done = h.filter(r => r.tier > 0).length;
  b.append(el('p', 'note', `共 ${h.length} 次演練，其中 ${done} 次成功約到下一步。`));

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
    if (tot.length) c.append(el('p', null, [r.outcome && (r.tier === 2 ? '🏆 ' : r.tier === 1 ? '🎉 ' : '') + r.outcome,
      '平均 ' + (tot.reduce((a, x) => a + x, 0) / tot.length).toFixed(1) + ' 星',
      Array.isArray(r.kp) ? `必講重點 ${r.kp[0]}／${r.kp[1]}` : '', r.wrong ? `講錯 ${r.wrong} 處` : '',
      r.violations ? `⚠️ 合規提醒 ${r.violations} 次` : ''].filter(Boolean).join('｜')));
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
function switchOwner() {
  loadChat();
  try { tts.state = ttsStore.load(); } catch { tts.state = {}; }
  S.lastCandidate = null; S.lastFb = null; S.docIds = [];
  setOwner(uid());                 // 制度文件依帳號分開（store.js）
}

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
  // 第一次使用一定要先看過歡迎與提醒（GPT 版：第一次進入時要先說明提醒）
  if (!localStorage.getItem(SEEN_KEY) || !cred().key) return;
  if (FN_TITLE[go]) openFn(go);
}

// ── 啟動 ────────────────────────────────────────────────────
$('#btn-welcome').onclick = () => { localStorage.setItem(SEEN_KEY, '1'); show('home'); };
// 離開頁面（切換 App 也算）時只停掉麥克風與朗讀，不結束演練，回來還能繼續講
window.addEventListener('pagehide', () => { chatVoiceOff(); voice.reset(); });
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
