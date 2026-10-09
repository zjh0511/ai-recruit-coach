// 公司招募制度文件：上傳 → AI 研讀整理 → 存在這支手機 → 制度重點頁、教練講解、演練、評分都用這份整理。
// 架構沿用 AI業務教練 knowledge.js（商品行銷演練，D007／D008／D040），內容改成招募制度（企劃書 §12）。
//
// 解析策略（零外部相依）：
//   .docx / .pptx  → 手機上直接拆 ZIP 讀 XML 取字（engine/docx.js），只把文字送給 AI
//   .pdf           → 原檔交給 AI 讀（中文與掃描版都比自寫解析器可靠）
//   .txt / .md     → 直接讀
// 文件存在使用者自己裝置的 IndexedDB（依帳號分開），不上雲端資料庫，也不進 GitHub。

import { officeText } from './docx.js?v=10';
import { parseJson } from './gateway.js?v=10';
import { digestPrompt, lessonPrompt, scrubDeep, numberSet, unknownNumbers } from './prompts.js?v=10';
import { allDocs, putDoc, delDoc, getDocById } from './store.js?v=10';

export const MAX_BYTES = 18 * 1024 * 1024;     // Google 單次請求的上限約 20MB
export const MAX_PICK = 5;                     // 一次演練最多勾 5 份（豪老師 2026-10-09 決定）
const MAX_TEXT = 300_000;
const KIND = 'system';

const ext = n => (n.split('.').pop() || '').toLowerCase();
const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const arr = v => (Array.isArray(v) ? v : []);
const str = v => (typeof v === 'string' ? v.trim() : '');

export async function listDocs() {
  return (await allDocs())
    .filter(d => d.kind === KIND)
    .map(({ id, name, title, at, chars, pages, pdf, seenAt, lesson }) => ({ id, name, title, at, chars, pages, pdf, seen: !!seenAt, lesson: !!lesson }))
    .sort((a, b) => b.at - a.at);
}
export const getDoc = id => getDocById(id);
export const deleteDoc = id => delDoc(id);

const b64ToBytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

// 整理結果整理成固定形狀：畫面與提示詞都不必猜欄位
function shape(d) {
  const rows = (v, keys) => arr(v).filter(x => x && typeof x === 'object' && str(x[keys[0]]))
    .map(x => Object.fromEntries(keys.map(k => [k, str(x[k])])));
  return scrubDeep({
    title: str(d.title), overview: str(d.overview),
    income: rows(d.income, ['item', 'how', 'condition', 'source']),
    career: rows(d.career, ['level', 'requirement', 'source']),
    support: rows(d.support, ['item', 'detail', 'source']),
    assessment: rows(d.assessment, ['item', 'detail', 'source']),
    costs: arr(d.costs).map(str).filter(Boolean),
    sweet_points: arr(d.sweet_points).map(str).filter(Boolean),
    challenges: arr(d.challenges).map(str).filter(Boolean),
    faq: rows(d.faq, ['q', 'a']),
    compliance: arr(d.compliance).map(str).filter(Boolean),
    missing: arr(d.missing).map(str).filter(Boolean),
  });
}
const facts = g => g.income.length + g.career.length + g.support.length + g.assessment.length;

// ── 上傳並研讀 ──────────────────────────────────────────────────
export async function ingest(gw, { name, base64 }) {
  const bytes = b64ToBytes(base64);
  const e = ext(name);
  if (bytes.length > MAX_BYTES) throw new Error(`檔案 ${(bytes.length / 1048576).toFixed(1)}MB 超過上限 18MB，請壓縮或分成幾份上傳`);
  if (e === 'doc' || e === 'ppt' || e === 'xls') throw new Error(`不支援舊版 .${e} 格式，請用 Office 另存成 .${e}x 或 PDF`);

  // 1) 取得可送進模型的內容
  let text = null, file = null;
  if (e === 'pdf') {
    if (!gw.supportsFile) throw new Error('目前的 AI 服務商無法直接讀取 PDF，請改上傳 .docx／.pptx／.txt');
    file = { mime: 'application/pdf', data: base64 };
  } else if (e === 'docx' || e === 'pptx') {
    text = (await officeText(bytes, name)).slice(0, MAX_TEXT);
    if (text.length < 20) throw new Error('這個檔案讀不到文字，可能內容都是圖片。請用 Office 另存成 PDF 再上傳。');
  } else if (e === 'txt' || e === 'md') {
    text = new TextDecoder('utf-8').decode(bytes).slice(0, MAX_TEXT);
  } else {
    throw new Error(`不支援的格式 .${e}，可用：PDF、Word（.docx）、PowerPoint（.pptx）、純文字`);
  }

  // 2) 研讀整理：一次讀完整份，之後都用這份整理，不必每次重送文件
  const prompt = digestPrompt(name) + (text ? `\n\n【文件內容】\n${text}` : '');
  let g = null;
  for (let i = 0; i < 3 && !(g?.title && facts(g)); i++) {
    const r = await gw.generate(prompt, {
      json: true, temp: 0.1 + i * 0.15, max: 32000, tier: 'judge', noThink: true, file, timeout: 150000,
    });
    const raw = parseJson(r.text);
    if (raw) g = shape(raw);
  }
  if (!g?.title) throw new Error('這份文件解析失敗，可能格式特殊或內容過少');

  // 3) 數字核對（R016）：有原文時（Word／PPT／純文字），整理裡每個帶單位的數字都要對得回原文
  //    PDF 原文在 Google 那邊讀，手機上沒有文字可以比對，所以畫面上會提醒自行核對。
  const unverified = text ? unknownNumbers(JSON.stringify(g), numberSet(text)) : null;

  const id = newId();
  const doc = {
    id, name, kind: KIND, title: g.title || name, at: Date.now(),
    text, chars: text ? text.length : null, pdf: e === 'pdf',
    pages: (text?.match(/【第 \d+ 頁】/g) || []).length || null,
    digest: g, unverified,
  };
  await putDoc(doc);

  let warning = null;
  // 「檔案不小、字卻很少」才是圖片多的徵兆。只看字數的話，本來就很短的制度文件也會被誤報（實測）
  if (text && text.length < 800 && bytes.length > 200 * 1024 && (e === 'docx' || e === 'pptx')) {
    warning = `這份檔案只讀到 ${text.length} 個字，內容可能大多是圖片。建議用 Office 另存成 PDF 再上傳，PDF 可以連圖片裡的文字一起讀。`;
  } else if (facts(g) < 3) {
    warning = '這份文件可辨識的制度內容偏少（收入、晉升、津貼、考核加起來不到 3 項），演練時 AI 能引用的內容有限。';
  } else if (unverified?.length) {
    warning = `整理結果裡有 ${unverified.length} 個數字在原文找不到（${unverified.slice(0, 3).join('、')}），制度重點頁會標出來，請對照原文確認。`;
  }
  return { id, title: doc.title, warning };
}

// ── 必講重點：教學頁與評分永遠看同一份清單（AI業務教練 D040）──────────────
// 有教練講解就用它的重點；沒有的話用收入、晉升、新人支持的第一項。多份文件時輪流各取一點，最多 3 點。
export function keyPointsOf(doc) {
  const fromLesson = arr(doc?.lesson?.key_points).map(k => str(k?.point)).filter(Boolean);
  if (fromLesson.length) return fromLesson.slice(0, 3);
  // 沒有教練講解時：從整理裡挑「有寫清楚條件」的項目（實測：直接拿第一項，會變成「首年度佣金：文件未載明條件」）
  const g = doc?.digest || {};
  const real = s => s && !/文件未載明/.test(s);
  const pick = (rows, a, b) => {
    const r = (rows || []).find(x => real(x[b])) || (rows || [])[0];
    return r && [r[a], real(r[b]) ? r[b] : ''].filter(Boolean).join('：');
  };
  return [
    pick(g.income, 'item', 'condition') || pick(g.income, 'item', 'how'),
    pick(g.career, 'level', 'requirement') || pick(g.assessment, 'item', 'detail'),
    pick(g.support, 'item', 'detail'),
  ].filter(Boolean).map(s => (s.length > 60 ? s.slice(0, 59) + '…' : s));
}
export function keyPointsFor(docs) {
  const lists = docs.map(keyPointsOf);
  const out = [];
  for (let i = 0; out.length < 3 && lists.some(l => l[i]); i++) {
    for (const l of lists) if (l[i] && out.length < 3 && !out.includes(l[i])) out.push(l[i]);
  }
  return out;
}

// 給角色扮演、示範話術、評分用的制度資料（要短，多份文件平均分配長度）
export function systemBrief(docs) {
  const per = Math.floor(7000 / Math.max(1, docs.length));
  return docs.map(d => {
    const g = d.digest || {};
    const L = [`《${g.title || d.name}》`];
    if (g.overview) L.push(`概述：${g.overview}`);
    for (const x of g.income || []) L.push(`收入・${x.item}：${x.how}${x.condition ? `（條件：${x.condition}）` : ''}`);
    for (const x of g.career || []) L.push(`晉升・${x.level}：${x.requirement}`);
    for (const x of g.support || []) L.push(`新人支持・${x.item}：${x.detail}`);
    for (const x of g.assessment || []) L.push(`考核・${x.item}：${x.detail}`);
    if (g.costs?.length) L.push(`自行負擔：${g.costs.join('；')}`);
    if (g.missing?.length) L.push(`文件未載明（不得亂講）：${g.missing.join('；')}`);
    return L.join('\n').slice(0, per);
  }).join('\n\n');
}

// 數字核對用：制度資料裡出現過的所有數值（整理＋有原文時連原文一起）
export function knownNumbers(docs) {
  return numberSet(docs.map(d => JSON.stringify(d.digest || {}) + (d.text || '')).join('\n'));
}

// ── 制度重點頁 ──────────────────────────────────────────────────
// 第一層直接用上傳時的整理，不花額度；第二層「教練講解」按了才產生，存回文件，之後重看不再花額度。
export async function lessonView(ids) {
  const docs = (await Promise.all(ids.map(id => getDocById(id)))).filter(Boolean);
  return {
    docs: docs.map(d => ({
      id: d.id, title: d.title || d.name, name: d.name, pdf: !!d.pdf,
      digest: d.digest || {}, lesson: d.lesson || null, seen: !!d.seenAt, unverified: d.unverified || null,
    })),
    keyPoints: keyPointsFor(docs),
    seen: docs.every(d => d.seenAt),
  };
}

export async function markSeen(ids) {
  for (const id of ids) {
    const doc = await getDocById(id);
    if (doc && !doc.seenAt) { doc.seenAt = Date.now(); await putDoc(doc); }
  }
}

export async function coachLesson(gw, id) {
  const doc = await getDocById(id);
  if (!doc) throw new Error('請先選擇制度文件');
  if (doc.lesson) return { lesson: doc.lesson, cached: true };

  const known = knownNumbers([doc]);
  const prompt = lessonPrompt(doc.digest || {});
  let L = null, fix = '';
  for (let i = 0; i < 3; i++) {
    const r = await gw.generate(prompt + fix, { json: true, temp: 0.5 + i * 0.15, max: 6000, tier: 'judge', noThink: true, timeout: 90000 });
    L = parseJson(r.text);
    if (!arr(L?.key_points).length) continue;
    // 教練講解裡的數字也要對得回制度資料（R016）
    const bad = unknownNumbers(JSON.stringify(L), known);
    if (!bad.length) break;
    fix = `\n\n【重要】上一次你寫出了制度資料裡沒有的數字（${bad.join('、')}）。數字只能照抄制度重點，請重新產生整份 JSON。`;
    if (i === 2) L.unverified = bad;
  }
  if (!arr(L?.key_points).length) throw new Error('教練講解產生失敗，請再試一次');

  const lesson = scrubDeep({
    pitch: str(L.pitch),
    key_points: arr(L.key_points).filter(k => str(k?.point)).slice(0, 3).map(k => ({ point: str(k.point), why: str(k.why), say: str(k.say) })),
    examples: arr(L.examples).filter(x => str(x?.explain)).slice(0, 3).map(x => ({ case: str(x.case), explain: str(x.explain) })),
    order: arr(L.order).map(str).filter(Boolean).slice(0, 7),
    pitfalls: arr(L.pitfalls).map(str).filter(Boolean).slice(0, 6),
  });
  if (L.unverified) lesson.unverified = L.unverified;
  lesson.at = Date.now();
  doc.lesson = lesson;
  await putDoc(doc);
  return { lesson, cached: false };
}
