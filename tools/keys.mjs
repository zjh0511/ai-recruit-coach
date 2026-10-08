// 讀取測試用的 Gemini 金鑰。只給 tools/ 底下的測試腳本用，絕不印出、不寫進任何輸出檔。
//
// 金鑰集中放在 D:\Hao+App\API Key.txt（AI業務教練開發經驗 §4.9），格式是「標籤行＋金鑰行」：
//   Gemini API Key
//   <主要金鑰>
//   Gemini API Key 備份:
//   <備用金鑰>
// 也可以用環境變數 GEMINI_API_KEY 指定。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = [path.join(ROOT, '..', 'API Key.txt'), path.join(ROOT, 'API Key.txt')];

export function geminiKeys() {
  const keys = [];
  if (process.env.GEMINI_API_KEY) keys.push(process.env.GEMINI_API_KEY.trim());
  for (const f of FILES) {
    if (!fs.existsSync(f)) continue;
    let label = '';
    for (const raw of fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (/\s/.test(line) || /:$/.test(line)) { label = line; continue; }     // 標籤行
      if (/gemini|google/i.test(label) || /^AQ\.|^AIza/.test(line)) keys.push(line);
      label = '';
    }
  }
  return [...new Set(keys)];
}
