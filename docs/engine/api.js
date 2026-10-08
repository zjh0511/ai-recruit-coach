// 本地 API 層 —— 取代原本的伺服器。
// 保留與伺服器版完全相同的呼叫介面，UI 不需要知道背後有沒有伺服器。
// 全部運算都在使用者自己的瀏覽器完成，金鑰與文件都不離開這台裝置。

import { PROVIDERS, createAdapter, scrubKey, friendlyError } from './gateway.js?v=8';
import * as CE from './session.js?v=8';
import * as AD from './advisor.js?v=8';
import * as KB from './knowledge.js?v=8';

let gw = null;                 // 目前登入的模型連線
let current = { provider: null, key: null };
let onEvent = null;            // 降階／額度事件通知 UI

// 開放給使用者選的服務商。引擎仍支援六家（gateway.js），
// 但目前只開放 Google AI Studio（使用者決定）。要恢復其他家，把代號加回這裡即可。
export const ENABLED = ['gemini'];
export const providers = () => Object.fromEntries(
  Object.entries(PROVIDERS).filter(([k]) => ENABLED.includes(k)));
export const onModelEvent = fn => { onEvent = fn; if (gw) gw.onEvent = fn; };

function need() {
  if (!gw) { const e = new Error('尚未設定 API 金鑰，請重新登入'); e.auth = true; throw e; }
  return gw;
}

async function connect(provider, key) {
  if (!ENABLED.includes(provider)) {
    const e = new Error('目前只支援 Google AI Studio 的 API 金鑰');
    e.auth = true;
    throw e;
  }
  const a = createAdapter(provider, key);
  try {
    await a.init();                                  // 探測可用模型，順便驗證金鑰
  } catch (err) {
    const raw = scrubKey(err.message, key);
    const e = new Error(friendlyError(raw, provider) || `無法連線：${raw.slice(0, 160)}`);
    e.auth = true;
    throw e;
  }
  a.onEvent = onEvent;
  gw = a;
  current = { provider, key };
  return a;
}

// 重新整理頁面後用已存的金鑰靜默恢復連線
export async function restore(provider, key, pin) {
  if (!provider || !key) return false;
  try {
    const a = await connect(provider, key);
    if (pin) a.pin(pin);
    return true;
  } catch { return false; }
}

export const isReady = () => !!gw;

// 登出或換人登入時放掉記憶體裡的連線——金鑰清掉了，連線卻還拿著舊的，下一位就能直接用前一位的額度
export function disconnect() { gw = null; current = { provider: null, key: null }; }

// ── 路由（與伺服器版同名，方便日後再切回伺服器架構）──────────────
export async function api(path, body = {}) {
  try {
    switch (path) {
      case '/login': {
        const a = await connect(body.provider, body.key);
        if (body.pin) a.pin(body.pin);          // 沿用上次選定的模型
        return { ok: true, provider: body.provider, fast: a.fast, judge: a.judge, file: a.supportsFile };
      }

      // 模型清單與指定（不指定就維持自動）
      case '/models/status': return need().status();
      case '/models/set': return need().pin(body.model || null);

      // 功能一：招募對象痛點分析
      case '/analyze/pain':
        if (!body.background?.trim()) throw new Error('請描述一下招募對象的背景');
        return await AD.painPoints(need(), body);

      // 功能二／三：招募邀約電訪、招募面談（角色扮演）
      case '/session/start': {
        if (!body.background?.trim()) throw new Error('請描述一下招募對象的背景');
        const mode = ['call', 'meet', 'system'].includes(body.mode) ? body.mode : 'call';
        const docs = [];
        if (mode === 'system') {
          for (const id of (body.docIds || []).slice(0, KB.MAX_PICK)) { const d = await KB.getDoc(id); if (d) docs.push(d); }
          if (!docs.length) throw new Error('請先選擇制度文件');
        }
        return await CE.startSession(need(), {
          mode, gender: body.gender, age: body.age, docs,
          background: body.background.slice(0, 1000), difficulty: Number(body.difficulty) || 1,
          context: body.context || 'warm', contextNote: (body.contextNote || '').slice(0, 300),
        });
      }

      // 第二版：公司招募制度文件（只存在這支手機）
      case '/doc/list': return { docs: await KB.listDocs() };
      case '/doc/upload':
        if (!body.name || !body.base64) throw new Error('沒有收到檔案');
        return await KB.ingest(need(), body);
      case '/doc/delete': await KB.deleteDoc(body.id); return { ok: true };
      case '/doc/lesson': {
        const ids = (body.ids || []).slice(0, KB.MAX_PICK);
        if (!ids.length) throw new Error('請先選擇制度文件');
        return await KB.lessonView(ids);
      }
      case '/doc/seen': await KB.markSeen((body.ids || []).slice(0, KB.MAX_PICK)); return { ok: true };
      case '/doc/coach': return await KB.coachLesson(need(), body.id);
      case '/session/begin': return CE.beginRoleplay(session(body));
      case '/session/turn':
        if (!body.text?.trim()) throw new Error('請輸入內容');
        return await CE.handleTurn(need(), session(body), body.text.slice(0, 600));
      case '/session/end': {
        const s = session(body);
        const out = await CE.evaluate(need(), s);
        CE.dropSession(s.id);
        return out;
      }
      case '/session/abort': CE.dropSession(body.sessionId); return { ok: true };

      // 功能四：問問招募教練
      case '/coach/chat':
        if (!body.message?.trim()) throw new Error('請輸入內容');
        return await AD.coachChat(need(), { ...body, message: body.message.slice(0, 2000) });

      default:
        throw new Error('unknown_endpoint');
    }
  } catch (e) {
    if (e.auth) throw e;
    const raw = scrubKey(e.message, current.key);
    const friendly = friendlyError(raw, current.provider);

    if (friendly) {
      console.error(`[api] ${path} → ${friendly}`);
      // 只有「金鑰無效／沒權限」才該退回登入畫面；
      // 餘額不足、限流、逾時都不是金鑰問題，把人踢回登入只會讓他更困惑
      if (/金鑰無效|沒有使用權限|是否已開通/.test(friendly)) {
        const err = new Error(friendly); err.auth = true; throw err;
      }
      throw new Error(friendly);
    }

    // 我們自己丟出的操作提示，原文就是給使用者看的
    if (/請先|沒有收到|未指定|請描述|請輸入|超過上限|讀不到|解析失敗|產生失敗|不支援|逾時，請重新開始|已經結束了/.test(raw)) {
      throw new Error(raw);
    }

    console.error(`[api] ${path} → ${raw.slice(0, 200)}`);
    throw new Error('剛剛好像卡了一下，請再試一次。');
  }
}

function session(body) {
  const s = CE.getSession(body.sessionId);
  if (!s) throw new Error('這次練習的連線已經逾時，請重新開始。');
  return s;
}
