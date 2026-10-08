// 改版：sw.js 的 VERSION +1，並把所有檔案引用的「?v=版本」換成新版本。
//
//   node tools/bump.mjs
//
// 為什麼要在網址上加版本（R015）：GitHub Pages 每個檔案都送 max-age=600。
// 豪老師實測時，iPhone 拿到了新的 index.html，style.css 和 app.js 卻還是十分鐘前的舊版，
// 畫面變成「新的版面、舊的樣式和程式」。網址帶上版本號之後，新的頁面一定會去抓同一版的檔案。
// 每個檔案的引用都要用同一個版本號：同一個模組被不同網址載入，會變成兩份互不相干的程式。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const files = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(d =>
  d.isDirectory() ? files(path.join(dir, d.name)) : /\.(js|html)$/.test(d.name) ? [path.join(dir, d.name)] : []);

const swPath = path.join(DOCS, 'sw.js');
let sw = fs.readFileSync(swPath, 'utf8');
const cur = Number(/const VERSION = 'v(\d+)'/.exec(sw)[1]);
const next = cur + 1;
sw = sw.replace(`const VERSION = 'v${cur}'`, `const VERSION = 'v${next}'`);
fs.writeFileSync(swPath, sw);

// 相對路徑的 import／export from，以及 HTML 裡的 style.css、app.js
const IMPORT = /(\bfrom\s+['"])(\.{1,2}\/[^'"?]+\.js)(\?v=\d+)?(['"])/g;
const HTML = /((?:href|src)=")((?!https?:)[^"?]+\.(?:css|js))(\?v=\d+)?(")/g;
let changed = 0;
for (const f of files(DOCS)) {
  if (f === swPath) continue;
  const src = fs.readFileSync(f, 'utf8');
  const out = f.endsWith('.html')
    ? src.replace(HTML, (m, a, p, _v, z) => `${a}${p}?v=${next}${z}`)
    : src.replace(IMPORT, (m, a, p, _v, z) => `${a}${p}?v=${next}${z}`);
  if (out !== src) { fs.writeFileSync(f, out); changed++; }
}
console.log(`VERSION v${cur} → v${next}，更新了 ${changed} 個檔案的引用`);
