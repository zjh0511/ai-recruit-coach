// 演練狀態機（沿用 AI業務教練 session.js）：狀態由程式控制，LLM 只負責講話。
// INTAKE → READY → ROLEPLAY → COMPLETED → FEEDBACK_READY
// 兩種模式：call（招募邀約電訪）／meet（招募面談）
//
// 由程式決定的事（R007）：
//   ・引導次數：模型回報 guiding，程式計數；用完（新手 5 次、其他 3 次）就讓對方委婉拒絕
//   ・結果分級：模型回報 commit（答應了什麼），程式依回合數與信任度決定算不算數
//   ・顧慮／動機：模型只回報編號，程式對回原文
//   ・信任度、星等：程式夾住範圍

import { parseJson } from './gateway.js?v=6';
import { checkCompliance, interventionMessage } from './compliance.js?v=6';
import * as P from './prompts.js?v=6';

// 至少要講幾句才算數：避免第一句就「答應見面」，練不到東西
export const MIN_TURNS = { call: 2, meet: 4 };
// 對方答應的門檻：信任度低於這個值時，模型回報的 commit 不算數（程式把關）
export const COMMIT_TRUST = 55;
const SESSION_TTL = 60 * 60 * 1000;

const sessions = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) if (now - s.touched > SESSION_TTL) sessions.delete(id);
}, 10 * 60 * 1000).unref?.();

const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export function getSession(id) {
  const s = sessions.get(id);
  if (s) s.touched = Date.now();
  return s;
}

const list = (a, n) => (Array.isArray(a) ? a.filter(x => typeof x === 'string' && x.trim()).slice(0, n) : []);

// ── 建立 Session：Persona + 情境 + 示範話術稿 ─────────────────────
export async function startSession(gw, { mode = 'call', gender, age, background, difficulty = 1, context = 'warm', contextNote = '' }) {
  if (!P.MODES[mode]) throw new Error('unknown_mode');
  difficulty = Math.min(5, Math.max(1, Number(difficulty) || 1));
  if (!P.CONTEXTS[context]) context = 'warm';
  const base = P.personaPrompt({ gender, age, background, difficulty, mode, context, contextNote });

  // 示範話術有問題（洩漏私人資訊、編造收入數字）就重新產生，並具體說出錯在哪（AI業務教練 §4.1：籠統的「請修正」沒用）
  let p = null, problem = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const extra = problem ? `\n\n【重要】上一次你產生的示範話術${problem}。請重新設計整份 JSON。` : '';
    const r = await gw.generate(base + extra, {
      json: true, temp: attempt === 0 ? 1.0 : 0.7, max: 4000, tier: 'fast', noThink: true, timeout: 60000,
    });
    p = parseJson(r.text);
    if (!p?.opening_line || !p?.demo) { problem = null; continue; }
    problem = P.demoProblem(p.demo);
    if (!problem) break;
    console.warn(`[persona] 示範話術有問題：${problem}，重新產生`);
  }
  if (!p?.opening_line || !p?.demo) throw new Error('persona_generation_failed');

  p.personality = P.scrubMeta(p.personality);
  p.communication_style = P.scrubMeta(p.communication_style);
  p.public_summary = P.scrubMeta(p.public_summary) || [age, background].filter(Boolean).join('，') || '一位招募對象';
  p.concerns = list(p.concerns, 3);
  p.motives = list(p.motives, 2);
  p.objections = list(p.objections, 3);

  const persona = { ...p, gender, age, background, difficulty, contextNote };
  const D = P.difficultyOf(difficulty);
  // 初始信任度由程式夾在難度區間內（AI業務教練 D021）
  const trust = Math.min(D.trust[1], Math.max(D.trust[0], Number(p.trust) || D.trust[0]));

  const id = newId();
  sessions.set(id, {
    id, mode, context, state: 'READY', persona,
    difficulty, maxGuidance: D.guidance, canEnd: D.canEnd, trust,
    history: [], violations: [],
    concernsFound: new Set(), motivesFound: new Set(),
    commit: null,                // 程式認可的最佳結果（commit 鍵）
    guidance: 0, guided: 0, declined: false,
    startedAt: null, touched: Date.now(), lastUser: '', latency: [],
  });

  return {
    sessionId: id, mode, context, contextLabel: P.CONTEXTS[context].label,
    persona: {                       // 只回傳表面資訊，顧慮與動機不下發到畫面
      name: p.name, summary: p.public_summary,
      voice: p.voice_hint || { rate: 1, pitch: 1 },
      gender, difficulty, difficultyLabel: D.label,
    },
    scenario: p.scenario,
    demo: P.scrubDeep(p.demo),
    opening: p.opening_line,
    totals: { concerns: p.concerns.length, motives: p.motives.length },
  };
}

export function beginRoleplay(s) {
  if (s.state === 'READY') {
    s.state = 'ROLEPLAY';
    s.startedAt = Date.now();
    s.history.push({ speaker: 'candidate', text: s.persona.opening_line, at: Date.now() });
  }
  return { opening: s.persona.opening_line };
}

// ── 卡住偵測 ────────────────────────────────────────────────────
export function isStuck(text, last) {
  const t = (text || '').trim();
  if (t.length < 3) return true;
  if (t === last) return true;
  return /^(嗯+|呃+|那個|欸|喔+|我不知道|不知道要說什麼|怎麼說|沒事)[。！？…]*$/.test(t);
}

const best = (mode, a, b) => {
  const O = P.OUTCOMES[mode] || {};
  return (O[b]?.tier || 0) > (O[a]?.tier || 0) ? b : a;
};

export function outcomeOf(s) {
  const o = P.OUTCOMES[s.mode]?.[s.commit];
  if (o) return { key: s.commit, tier: o.tier, label: o.label };
  return { key: 'none', tier: 0, label: s.declined ? '對方婉拒了' : '這次還沒有約成' };
}

// ── 一個回合 ────────────────────────────────────────────────────
export async function handleTurn(gw, s, userText) {
  if (s.state !== 'ROLEPLAY') throw new Error('這次談話已經結束了，請按「結束練習」看回饋。');
  const text = (userText || '').trim();
  s.history.push({ speaker: 'user', text, at: Date.now() });

  // 1) 合規先行：高風險當場暫停（GPT 版：演練過程中及時阻止）
  const c = checkCompliance(text);
  if (c.hits.length) for (const h of c.hits) s.violations.push({ ...h, quote: text.slice(0, 60) });
  if (c.level === 'high') {
    const msg = interventionMessage(c.hits);
    s.history.push({ speaker: 'system', text: msg, at: Date.now() });
    return { type: 'compliance', text: msg, ended: false, trust: s.trust };
  }

  const stuck = isStuck(text, s.lastUser);
  s.lastUser = text;
  const userTurns = s.history.filter(h => h.speaker === 'user').length;
  const gentle = s.difficulty <= 1;
  const mustDecline = s.guidance >= s.maxGuidance;

  // 2) 角色扮演生成（輸出驗證，最多重試一次）
  const sys = P.roleplaySystem(s.persona, s.mode, s.context);
  const turn = P.roleplayTurn({
    history: s.history.filter(h => h.speaker !== 'system').slice(-14),
    userText: text, trust: s.trust, guidance: s.guidance, maxGuidance: s.maxGuidance,
    mustDecline, gentle, mode: s.mode,
    // 程式不會認可的答應，也不要讓對方嘴上答應（否則畫面結果和對話對不起來）
    notYet: userTurns < MIN_TURNS[s.mode] ? 'early' : s.trust < COMMIT_TRUST ? 'trust' : null,
  });

  // 退回重產生時要具體說出錯在哪（AI業務教練 §4.1：籠統的「請修正」沒用）
  let say = null, data = {}, ms = 0, fix = '';
  for (let attempt = 0; attempt < 3 && !say; attempt++) {
    const r = await gw.generate(turn + fix, {
      system: sys, json: true, temp: attempt === 0 ? 0.9 : 0.6, max: 1200, tier: 'fast', noThink: true,
    });
    ms += r.ms;
    data = parseJson(r.text) || {};
    say = P.validateRoleplay(data.say);
    if (say && s.mode === 'call' && P.phoneDrift(say)) {
      // 電訪變成當面聊天（R013）
      console.warn('[roleplay] 電訪變成當面聊天，重新產生');
      say = null;
      fix = '\n\n【重要】上一次你講得好像你們已經見面、坐在一起了。你們現在是在講電話，沒有見面。請用講電話的口吻重新回答。';
    } else if (!say) fix = '\n\n【重要】上一次你跳出了角色。請只用招募對象本人的口吻回答。';
  }
  if (!say) say = mustDecline ? '不好意思，我覺得我現在應該沒有這個打算，我們改天再聊好嗎？' : '嗯……所以你是想跟我說什麼？';

  // 3) 狀態更新（由程式控制）
  const delta = Math.max(-15, Math.min(15, Number(data.trust_delta) || 0));
  s.trust = Math.max(0, Math.min(100, s.trust + delta));

  // 引導計數：對方在引導，或招募者這句明顯卡住，都算一次；講出有進展的話（信任上升）就歸零
  if (data.guiding === true || stuck) { s.guidance += 1; s.guided += 1; }
  else if (delta > 0) s.guidance = 0;

  const concerns = s.persona.concerns || [], motives = s.persona.motives || [];
  for (const n of (Array.isArray(data.revealed_concerns) ? data.revealed_concerns : [])) {
    const t = concerns[Number(n) - 1]; if (t) s.concernsFound.add(t);
  }
  for (const n of (Array.isArray(data.revealed_motives) ? data.revealed_motives : [])) {
    const t = motives[Number(n) - 1]; if (t) s.motivesFound.add(t);
  }

  // 答應了什麼：回合數與信任度都夠才算數
  const allowed = Object.keys(P.MODES[s.mode].commits);
  let committed = false;
  if (allowed.includes(data.commit) && userTurns >= MIN_TURNS[s.mode] && s.trust >= COMMIT_TRUST) {
    const prev = s.commit;
    s.commit = best(s.mode, s.commit, data.commit);
    committed = s.commit !== prev;
  }

  // 4) 結束條件（程式判定）
  //   ・引導用完之後這一回合對方決定婉拒（任何難度都會；GPT 版規則）
  //   ・可以主動結束的難度：對方自己決定婉拒，且已經講了幾句
  //   ・電訪：約到見面就結束；面談：答應考照（最佳結果）就結束，答應說明會／二次面談還可以繼續談
  let ended = false;
  if (data.declined === true && (mustDecline || (s.canEnd && userTurns >= 2))) { s.declined = true; ended = true; }
  else if (mustDecline && s.guidance > s.maxGuidance) {
    // 模型不配合（引導用完了還在引導）時的保險絲：由程式讓對方委婉結束
    s.declined = true; ended = true;
    say = '不好意思，我覺得我們今天先聊到這裡就好，之後有需要我再跟你聯絡，好嗎？';
  }
  else if (s.mode === 'call' && s.commit === 'meet') ended = true;
  else if (s.mode === 'meet' && s.commit === 'license') ended = true;
  if (ended) s.state = 'COMPLETED';

  s.latency.push(ms);
  s.history.push({ speaker: 'candidate', text: say, at: Date.now() });

  return {
    type: 'candidate', text: say, ended, trust: s.trust,
    found: { concerns: s.concernsFound.size, motives: s.motivesFound.size },
    totals: { concerns: concerns.length, motives: motives.length },
    outcome: committed ? outcomeOf(s) : null,
    warn: c.level === 'warn' ? c.hits.map(h => `${h.type}：${h.why}`) : null,
    ms,
  };
}

// ── 結束 → 評分與回饋 ──────────────────────────────────────────
const FILLER = /嗯|呃|那個|就是說|然後|欸/g;

export async function evaluate(gw, s) {
  s.state = 'EVALUATING';
  try { return await evaluateInner(gw, s); }
  catch (e) { s.state = 'COMPLETED'; throw e; }       // 評分失敗不弄丟逐字稿（AI業務教練 D033）
}

async function evaluateInner(gw, s) {
  const userTurns = s.history.filter(h => h.speaker === 'user');
  const texts = userTurns.map(t => t.text);
  const metrics = {
    turns: userTurns.length,
    avgLen: userTurns.length ? Math.round(texts.join('').length / userTurns.length) : 0,
    fillers: texts.join('').match(FILLER)?.length || 0,
    repeats: texts.length - new Set(texts).size,
    guided: s.guided,
    finalTrust: s.trust,
    durationSec: s.startedAt ? Math.round((Date.now() - s.startedAt) / 1000) : 0,
    concernsFound: [...s.concernsFound],
    motivesFound: [...s.motivesFound],
  };
  const outcome = outcomeOf(s);

  const prompt = P.evaluationPrompt({
    persona: s.persona, transcript: s.history.filter(h => h.speaker !== 'system'),
    metrics, violations: s.violations, mode: s.mode, context: s.context, outcome,
  });

  let fb = null;
  for (let attempt = 0; attempt < 3 && !fb?.scores; attempt++) {
    const r = await gw.generate(prompt, { json: true, temp: 0.3 + attempt * 0.2, max: 8000, tier: 'judge', noThink: true });
    fb = parseJson(r.text);
    if (!fb?.scores) console.warn(`[evaluate] 第 ${attempt + 1} 次解析失敗（${r.model}）`);
  }
  if (!fb?.scores) throw new Error('evaluation_failed');

  // 分數由程式規範化：0～5、0.5 級距；有高風險違規時專業度上限 2.5
  const high = s.violations.some(v => v.level === 'high');
  for (const k of SCORE_KEYS) {
    const raw = fb.scores[k];
    let v = Number(raw?.score ?? raw) || 0;
    v = Math.max(0, Math.min(5, Math.round(v * 2) / 2));
    if (k === 'professionalism' && high) v = Math.min(v, 2.5);
    fb.scores[k] = { score: v, evidence: typeof raw?.evidence === 'string' ? raw.evidence : '' };
  }
  for (const k of Object.keys(fb.scores)) if (!SCORE_KEYS.includes(k)) delete fb.scores[k];

  fb.example_script = P.scrubBrands(fb.example_script);
  fb.improvements = P.scrubDeep(Array.isArray(fb.improvements) ? fb.improvements : []);
  fb.positives = Array.isArray(fb.positives) ? fb.positives : [];
  fb.next_challenge = P.scrubBrands(fb.next_challenge);
  // 違規一定要點名（GPT 版：回饋時一定要特別點名指正）——不靠模型記得寫，程式附上
  fb.violations = s.violations.map(v => ({ type: v.type, law: v.law, why: v.why, quote: v.quote, level: v.level }));

  s.state = 'FEEDBACK_READY';
  return {
    ...fb, metrics, outcome, mode: s.mode,
    modeName: P.MODES[s.mode].name,
    contextLabel: P.CONTEXTS[s.context]?.label,
    difficultyLabel: P.difficultyOf(s.difficulty).label,
    persona: { name: s.persona.name, summary: s.persona.public_summary },
    transcript: s.history.filter(h => h.speaker !== 'system').map(h => ({ speaker: h.speaker, text: h.text })),
    concerns: s.mode === 'meet' ? s.persona.concerns : null,        // 演練結束後才揭露
    motives: s.mode === 'meet' ? s.persona.motives : null,
    avgLatencyMs: s.latency.length ? Math.round(s.latency.reduce((a, b) => a + b, 0) / s.latency.length) : 0,
  };
}

export const SCORE_KEYS = ['fluency', 'friendliness', 'awareness', 'confidence', 'professionalism'];

export function dropSession(id) { sessions.delete(id); }
