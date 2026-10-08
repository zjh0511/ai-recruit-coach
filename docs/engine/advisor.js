// 非角色扮演類功能：招募對象痛點分析、問問招募教練。單次或短對話，不需要狀態機。

import { parseJson } from './gateway.js?v=6';
import { checkCompliance } from './compliance.js?v=6';
import * as P from './prompts.js?v=6';

// 需要嚴謹 JSON 的任務共用的重試邏輯（不同溫度會改變輸出結構）
async function jsonCall(gw, prompt, opts, valid) {
  let out = null;
  for (let i = 0; i < 3 && !valid(out); i++) {
    const r = await gw.generate(prompt, { json: true, temp: 0.4 + i * 0.2, tier: 'judge', noThink: true, ...opts });
    out = parseJson(r.text);
  }
  if (!valid(out)) throw new Error('analysis_failed');
  return out;
}

const str = v => (typeof v === 'string' ? v.trim() : '');

// ── 功能一：招募對象痛點分析 ─────────────────────────────────────
export async function painPoints(gw, { gender, age, background, context = 'warm' }) {
  if (!P.CONTEXTS[context]) context = 'warm';
  const out = await jsonCall(
    gw, P.painPointsPrompt({ gender, age, background, context }), { max: 6000 },
    o => Array.isArray(o?.points) && o.points.filter(p => str(p?.pain)).length >= 1
  );
  // 欄位整理成固定形狀，畫面不必猜；示範話術中立化
  out.points = P.scrubDeep(out.points.filter(p => str(p?.pain)).slice(0, 3).map(p => ({
    pain: str(p.pain), reason: str(p.reason), opportunity: str(p.opportunity), question: str(p.question),
  })));
  out.concerns = P.scrubDeep((Array.isArray(out.concerns) ? out.concerns : []).filter(c => str(c?.concern)).slice(0, 3)
    .map(c => ({ concern: str(c.concern), approach: str(c.approach) })));
  const a = out.approach || {};
  out.approach = P.scrubDeep({ channel: str(a.channel), opening: str(a.opening), avoid: str(a.avoid) });
  out.profile = str(out.profile);
  out.contextLabel = P.CONTEXTS[context].label;
  // 開場話術若出現編造的收入數字或私人資訊，不重跑（多花額度），改成提醒
  out.warning = P.demoProblem({ opening: out.approach.opening }) ? '這段開場裡有具體數字或私人資訊，實際使用前請改成「以公司制度為準」的說法。' : null;
  return out;
}

// ── 功能四：問問招募教練 ──────────────────────────────────────────
export async function coachChat(gw, { history, message, voice = false }) {
  const c = checkCompliance(message);
  const hist = (history || []).slice(-12)
    .filter(m => m?.text)
    .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', text: m.text }));

  const note = c.level === 'high'
    ? `\n\n【系統偵測】這則訊息可能涉及違反〈保險業務員管理規則〉的做法（${c.hits.map(h => `${h.type}，${h.law}`).join('；')}）。`
      + '請在回覆的第一段就直接指出風險與正確做法，再回答他的問題。'
    : '';

  const r = await gw.generate(message + note, {
    system: voice ? `${P.COACH_CHAT}\n\n${P.COACH_VOICE}` : P.COACH_CHAT,
    history: hist, temp: 0.85, max: 4000, tier: 'fast', noThink: true,
  });

  return {
    reply: P.scrubBrands(r.text.trim()),
    compliance: c.level === 'none' ? null : c.hits.map(h => `${h.type}（${h.law}）：${h.why}`),
  };
}
