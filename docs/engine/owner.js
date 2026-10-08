// 個人資料依帳號分開存放（沿用 AI業務教練 D047 的做法）。
//
// 同一台裝置可能有不同同事輪流登入（單位的訓練機、借來的手機）。訓練紀錄、偏好、
// 金鑰、教練對話若存在固定的鍵名，下一位登入的人會直接用上前一位的金鑰，
// 同步時還會把前一位的紀錄合併進自己的雲端帳號。所以每個帳號各存一份（鍵名後面接「#uid」）。
//
// 鍵名一律用 recruit. 開頭：AI招募教練和 AI業務教練（aicoach.）都放在 zjh0511.github.io，
// 瀏覽器把兩者當成同一個網站，localStorage 是共用的，鍵名撞到就會互相覆寫。
//
// 這是新 App，沒有「更新前的舊資料」要認領，所以不需要 AI業務教練那套 legacy 遷移。

export const PREFIX = 'recruit.';
export const KEYS = {
  history: PREFIX + 'history',
  prefs: PREFIX + 'prefs',
  models: PREFIX + 'models',
  apikey: PREFIX + 'apikey',
  chat: PREFIX + 'chat',
  ttsq: PREFIX + 'ttsq',
  docconsent: PREFIX + 'docconsent',   // 第一次上傳制度文件前的保密確認（企劃書 §12.3）
};

// 有帳號功能、但目前沒有人登入時用的「無主」空間：登出後殘留的寫入不會落進任何人的資料。
export const NOBODY = '-';

export const scopedKey = (k, uid) => (uid ? `${k}#${uid}` : k);

// uidFn 每次存取時才呼叫——登入狀態隨時會變，不能在建立時就把 uid 固定下來。
export function scoped(storage, uidFn) {
  return {
    get: k => storage.getItem(scopedKey(k, uidFn())),
    set: (k, v) => storage.setItem(scopedKey(k, uidFn()), v),
    del: k => storage.removeItem(scopedKey(k, uidFn())),
  };
}
