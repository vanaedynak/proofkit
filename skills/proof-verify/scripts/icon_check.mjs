#!/usr/bin/env node
// icon_check.mjs — see an app icon the way users will (tiny, on light and dark, in a taskbar, a browser
// tab, an iPad home screen) and export every format apps need.
//
//   node icon_check.mjs icon.png|icon.svg [--out .proof/icon] [--label v2]
//   node icon_check.mjs icon.svg --export build/icons [--ios-bg "#0b1220"]
//
// Writes <out>/icon-sheet<-label>.png and prints checks:
//   transparency, how much of the canvas the artwork fills, visibility on light/dark backgrounds,
//   and how much detail survives at 32 px and 16 px (thin lines and small text vanish there).
// --export writes: png/<size>.png (16…1024), icon.ico (16–256, for Windows/Electron),
//   apple-touch-icon.png (180), AppIcon-1024.png (opaque, for iOS/iPadOS — no transparency allowed),
//   favicon-32.png, maskable-512.png (artwork inside the 80 % safe zone, for Android/PWA).
// Compare several candidates by running it once per file with --label and opening the sheets side by side.
import { launch } from './pw.mjs';
import fs from 'node:fs';
import path from 'node:path';

const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
const src = a.find((x, i) => !x.startsWith('--') && !(a[i - 1] || '').startsWith('--'));
if (!src || !fs.existsSync(src)) { console.error('usage: node icon_check.mjs <icon.png|icon.svg> [--out dir] [--label name] [--export dir] [--ios-bg #hex]'); process.exit(2); }
const out = path.resolve(opt('out', '.proof/icon')); fs.mkdirSync(out, { recursive: true });
const label = opt('label', '');
const ext = path.extname(src).toLowerCase();
const mime = ext === '.svg' ? 'image/svg+xml' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
const dataUrl = `data:${mime};base64,${fs.readFileSync(src).toString('base64')}`;
const EXPORT_SIZES = [16, 24, 32, 48, 64, 128, 180, 192, 256, 512, 1024];

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const res = await page.evaluate(async ([url, sizes, iosBg]) => {
  const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('cannot load image')); i.src = url; });
  const W = img.naturalWidth || 1024, H = img.naturalHeight || 1024;
  const draw = (s, bg, pad = 0) => {
    const c = document.createElement('canvas'); c.width = c.height = s; const x = c.getContext('2d');
    if (bg) { x.fillStyle = bg; x.fillRect(0, 0, s, s); }
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    // step down in halves for crisp small sizes
    let cur = img, cw = W, ch = H;
    while (cw / 2 > s * (1 - 2 * pad) * 1.01) { const t = document.createElement('canvas'); t.width = Math.round(cw / 2); t.height = Math.round(ch / 2); t.getContext('2d').drawImage(cur, 0, 0, t.width, t.height); cur = t; cw = t.width; ch = t.height; }
    const inner = s * (1 - 2 * pad), sc = Math.min(inner / cw, inner / ch);
    x.drawImage(cur, (s - cw * sc) / 2, (s - ch * sc) / 2, cw * sc, ch * sc);
    return c;
  };
  const big = draw(512), bd = big.getContext('2d').getImageData(0, 0, 512, 512).data;
  // transparency + artwork bounds
  let x0 = 512, y0 = 512, x1 = -1, y1 = -1, transparentCorners = 0;
  for (const [cx, cy] of [[2, 2], [509, 2], [2, 509], [509, 509]]) if (bd[(cy * 512 + cx) * 4 + 3] < 20) transparentCorners++;
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) if (bd[(y * 512 + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const fill = x1 < 0 ? 0 : Math.max(x1 - x0 + 1, y1 - y0 + 1) / 512;
  // a full-bleed 'plate' (rounded square/circle background) legitimately reaches the edges
  const plate = [[256, 3], [3, 256], [508, 256], [256, 508]].every(([px, py]) => bd[(py * 512 + px) * 4 + 3] > 200);
  // visibility: mean colour distance between artwork edge pixels and a background
  const lumAt = (d, i) => (d[i] * .3 + d[i + 1] * .59 + d[i + 2] * .11);
  const vis = bg => { const c = draw(128, bg).getContext('2d').getImageData(0, 0, 128, 128).data; const b = bg === '#ffffff' ? 255 : 30; let s = 0, n = 0; for (let i = 0; i < c.length; i += 4) { const v = Math.abs(lumAt(c, i) - b); if (v > 6) { s += v; n++; } } return n ? Math.round(s / n) : 0; };
  // detail retention: downscale to s, upscale back, compare edge energy with the 128 px version
  const edges = c => { const d = c.getContext('2d').getImageData(0, 0, 128, 128).data; let e = 0; for (let y = 1; y < 127; y++) for (let x = 1; x < 127; x++) { const i = (y * 128 + x) * 4; e += Math.abs(lumAt(d, i) - lumAt(d, i + 4)) + Math.abs(lumAt(d, i) - lumAt(d, i + 512)); } return e; };
  const ref = draw(128, '#808080'), e0 = edges(ref);
  const keep = s => { const small = draw(s, '#808080'); const up = document.createElement('canvas'); up.width = up.height = 128; const u = up.getContext('2d'); u.imageSmoothingEnabled = true; u.drawImage(small, 0, 0, 128, 128); return Math.round(Math.min(1, edges(up) / Math.max(1, e0)) * 100); };
  const checks = { plate, raster: !/svg/.test(url.slice(5, 20)), source: `${W}x${H}`, square: Math.abs(W - H) <= 1, transparentCorners, fill: +fill.toFixed(2), visLight: vis('#ffffff'), visDark: vis('#1e1e1e'), detail32: keep(32), detail16: keep(16) };

  // ---- sheet ----
  const S = document.createElement('canvas'); S.width = 1360; S.height = 930; const g = S.getContext('2d');
  g.fillStyle = '#d9dde3'; g.fillRect(0, 0, 1360, 930); g.font = '600 15px system-ui, sans-serif'; g.fillStyle = '#111';
  const sizes2 = [16, 24, 32, 48, 64, 128, 256];
  // rows: light / dark
  [['#ffffff', 'on light', 20], ['#1e1e1e', 'on dark', 330]].forEach(([bg, name, top]) => {
    g.fillStyle = bg; g.fillRect(20, top, 1320, 290); g.fillStyle = bg === '#ffffff' ? '#333' : '#ddd'; g.fillText(name, 32, top + 24);
    let x = 40; for (const s of sizes2) { g.drawImage(draw(s), x, top + 270 - s); g.fillText(String(s), x, top + 286 - 300 + 300 - 4 > 0 ? top + 288 : top + 288); x += s + 34; }
  });
  // pixel zoom of 16 and 32
  g.fillStyle = '#111'; g.fillText('16 px and 32 px, zoomed ×6 (what the pixels really are)', 32, 650);
  g.imageSmoothingEnabled = false; g.drawImage(draw(16, '#1e1e1e'), 32, 662, 96, 96); g.drawImage(draw(32, '#ffffff'), 140, 662, 192, 192); g.imageSmoothingEnabled = true;
  // taskbar mock
  g.fillStyle = '#202020'; g.fillRect(360, 660, 470, 48); for (let i = 0; i < 6; i++) { g.fillStyle = '#3a3a3a'; g.fillRect(380 + i * 72, 668, 32, 32); }
  g.drawImage(draw(32), 380 + 2 * 72, 668); g.fillStyle = '#9ecbff'; g.fillRect(380 + 2 * 72 + 8, 704, 16, 3);
  g.fillStyle = '#111'; g.fillText('taskbar 32 px', 360, 728);
  // browser tab mock
  g.fillStyle = '#e8eaed'; g.fillRect(360, 740, 470, 40); g.fillStyle = '#fff'; g.beginPath(); g.roundRect(372, 746, 230, 34, [8, 8, 0, 0]); g.fill();
  g.drawImage(draw(16), 384, 755); g.fillStyle = '#222'; g.font = '13px system-ui'; g.fillText('My App — Home', 408, 767); g.font = '600 15px system-ui, sans-serif';
  g.fillStyle = '#111'; g.fillText('browser tab 16 px', 360, 800);
  // iPad home screen mock (squircle mask, opaque like iOS renders it)
  const hx = 860, hy = 640; const grad = g.createLinearGradient(hx, hy, hx + 470, hy + 270); grad.addColorStop(0, '#5b6cff'); grad.addColorStop(1, '#ff7aa8');
  g.fillStyle = grad; g.beginPath(); g.roundRect(hx, hy, 470, 270, 18); g.fill();
  for (let r = 0; r < 2; r++) for (let c = 0; c < 5; c++) {
    const px = hx + 24 + c * 88, py = hy + 24 + r * 118;
    g.save(); g.beginPath(); g.roundRect(px, py, 72, 72, 16); g.clip();
    if (r === 0 && c === 2) { g.fillStyle = iosBg || '#000'; g.fillRect(px, py, 72, 72); g.drawImage(draw(72), px, py); }
    else { g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(px, py, 72, 72); }
    g.restore();
    g.fillStyle = '#fff'; g.font = '12px system-ui'; g.fillText(r === 0 && c === 2 ? 'My App' : '', px + 14, py + 90);
  }
  g.fillStyle = '#111'; g.font = '600 15px system-ui, sans-serif'; g.fillText('iPad home screen (iOS fills transparency with ' + (iosBg || 'black') + ')', 860, 928 - 8);

  const exports = {};
  for (const s of sizes) exports[s] = draw(s).toDataURL('image/png');
  exports.ios = draw(1024, iosBg || null).toDataURL('image/png');
  exports.iosFlat = draw(1024, iosBg || '#000000').toDataURL('image/png');
  exports.maskable = draw(512, iosBg || null, 0.1).toDataURL('image/png');
  return { checks, sheet: S.toDataURL('image/png'), exports };
}, [dataUrl, EXPORT_SIZES, opt('ios-bg', null)]);
await browser.close();

const sheetFile = path.join(out, `icon-sheet${label ? '-' + label : ''}.png`);
fs.writeFileSync(sheetFile, Buffer.from(res.sheet.split(',')[1], 'base64'));
const c = res.checks, warn = [];
if (!c.square) warn.push(`source is ${c.source}, not square`);
if (c.fill < 0.6) warn.push(`artwork fills only ${Math.round(c.fill * 100)}% of the canvas — it will look tiny next to other icons (aim 75–90%)`);
if (c.fill > 0.98 && c.transparentCorners === 4 && !c.plate) warn.push('artwork touches the edges — leave a small margin');
if (c.raster && Math.max(...c.source.split('x').map(Number)) < 1024) warn.push(`raster source is only ${c.source} — exports above that size will be blurry; provide 1024 px or SVG`);
if (c.visDark < 25) warn.push(`almost invisible on dark backgrounds (contrast score ${c.visDark}) — add an outline/background plate`);
if (c.visLight < 25) warn.push(`almost invisible on light backgrounds (contrast score ${c.visLight})`);
if (c.detail32 < 55) warn.push(`only ${c.detail32}% of the detail survives at 32 px — simplify: fewer, thicker shapes, no thin lines or text`);
if (c.detail16 < 35) warn.push(`at 16 px only ${c.detail16}% of the detail survives — make sure the silhouette alone is recognisable`);
console.log(`ICON CHECK ${src} (${c.source}${c.transparentCorners === 4 ? ', transparent background' : ', opaque background'})`);
console.log(`  fill ${Math.round(c.fill * 100)}% · visibility light ${c.visLight} / dark ${c.visDark} · detail kept: 32px ${c.detail32}%, 16px ${c.detail16}%`);
for (const w of warn) console.log(`  ! ${w}`);
console.log(`  sheet: ${sheetFile}  (open it: does it read at 16–32 px? on dark? next to other icons?)`);

if (opt('export')) {
  const dir = path.resolve(opt('export')); fs.mkdirSync(path.join(dir, 'png'), { recursive: true });
  const buf = d => Buffer.from(d.split(',')[1], 'base64');
  for (const s of EXPORT_SIZES) fs.writeFileSync(path.join(dir, 'png', `${s}.png`), buf(res.exports[s]));
  fs.writeFileSync(path.join(dir, 'apple-touch-icon.png'), buf(res.exports[180]));
  fs.writeFileSync(path.join(dir, 'favicon-32.png'), buf(res.exports[32]));
  fs.writeFileSync(path.join(dir, 'AppIcon-1024.png'), buf(res.exports.iosFlat));
  fs.writeFileSync(path.join(dir, 'maskable-512.png'), buf(res.exports.maskable));
  // .ico with PNG-compressed entries (Windows Vista+, Electron, browsers)
  const icoSizes = [16, 24, 32, 48, 64, 128, 256], pngs = icoSizes.map(s => buf(res.exports[s]));
  const head = Buffer.alloc(6 + 16 * pngs.length); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let off = head.length;
  pngs.forEach((p, i) => { const e = 6 + i * 16, s = icoSizes[i]; head.writeUInt8(s >= 256 ? 0 : s, e); head.writeUInt8(s >= 256 ? 0 : s, e + 1); head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6); head.writeUInt32LE(p.length, e + 8); head.writeUInt32LE(off, e + 12); off += p.length; });
  fs.writeFileSync(path.join(dir, 'icon.ico'), Buffer.concat([head, ...pngs]));
  console.log(`  exported to ${dir}: png/16…1024, icon.ico, apple-touch-icon.png, favicon-32.png, AppIcon-1024.png (opaque), maskable-512.png`);
}
process.exit(warn.length ? 1 : 0);
