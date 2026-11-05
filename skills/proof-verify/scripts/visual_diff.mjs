#!/usr/bin/env node
// visual_diff.mjs — "did my change touch anything it should not have?"
//
//   node visual_diff.mjs <before-dir> <after-dir> [--out .proof/visual-diff] [--threshold 0.3]
//
// Compares every PNG that exists in both folders (same file name, e.g. two ui_probe runs:
// `--out .proof/before` before editing, `--out .proof/after` after). For each pair it prints
// UNCHANGED or CHANGED with the share of pixels that differ and the bounding box of the change,
// and writes <name>-diff.png: BEFORE | AFTER | changes highlighted in red.
// Use it to prove a fix changed only the intended spot and the rest of the design is intact.
// Exit code: 0 = all unchanged, 1 = something changed (read the list: intended or not?), 2 = error.
import { launch } from './pw.mjs';
import fs from 'node:fs';
import path from 'node:path';

const a = process.argv.slice(2);
const pos = a.filter((x, i) => !x.startsWith('--') && !(a[i - 1] || '').startsWith('--'));
const opt = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
if (pos.length < 2) { console.error('usage: node visual_diff.mjs <before-dir> <after-dir> [--out dir] [--threshold percent]'); process.exit(2); }
const [before, after] = pos.map(p => path.resolve(p));
const out = path.resolve(opt('out', '.proof/visual-diff'));
const threshold = Number(opt('threshold', '0.3'));   // % of changed pixels below which a pair counts as unchanged (anti-aliasing, caret blink)
fs.mkdirSync(out, { recursive: true });

const names = fs.readdirSync(before).filter(f => /\.png$/i.test(f) && !/-diff\.png$/i.test(f) && fs.existsSync(path.join(after, f)));
const onlyBefore = fs.readdirSync(before).filter(f => /\.png$/i.test(f) && !fs.existsSync(path.join(after, f)));
if (!names.length) { console.error(`no PNG with the same name in both ${before} and ${after}`); process.exit(2); }

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
let changed = 0;
console.log(`VISUAL DIFF ${before} -> ${after}`);
for (const f of names) {
  const url = p => `data:image/png;base64,${fs.readFileSync(p).toString('base64')}`;
  const r = await page.evaluate(async ([ua, ub]) => {
    const load = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
    const A = await load(ua), B = await load(ub);
    const w = Math.max(A.width, B.width), h = Math.max(A.height, B.height);
    const px = im => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.drawImage(im, 0, 0); return x.getImageData(0, 0, w, h).data; };
    const pa = px(A), pb = px(B);
    // Align rows like a text diff (LCS over row signatures), so content that only MOVED down/up because
    // something was inserted above it is not reported as changed — only inserted/removed/edited rows are.
    const sig = (p, y) => { const s = new Float32Array(48); for (let k = 0; k < 48; k++) { const i = (y * w + Math.floor((k + 0.5) * w / 48)) * 4; s[k] = p[i] * .3 + p[i + 1] * .59 + p[i + 2] * .11; } return s; };
    const SA = Array.from({ length: h }, (_, y) => sig(pa, y)), SB = Array.from({ length: h }, (_, y) => sig(pb, y));
    const same = (y1, y2) => { let d = 0; for (let k = 0; k < 48; k++) d += Math.abs(SA[y1][k] - SB[y2][k]); return d / 48 < 4; };
    const rowsA = Math.min(h, A.height), rowsB = Math.min(h, B.height);
    const dp = new Uint16Array((rowsA + 1) * (rowsB + 1)), W1 = rowsB + 1;
    for (let i = rowsA - 1; i >= 0; i--) for (let j = rowsB - 1; j >= 0; j--)
      dp[i * W1 + j] = same(i, j) ? dp[(i + 1) * W1 + j + 1] + 1 : Math.max(dp[(i + 1) * W1 + j], dp[i * W1 + j + 1]);
    const matchOf = new Int32Array(h).fill(-1);   // after-row -> before-row
    for (let i = 0, j = 0; i < rowsA && j < rowsB;) {
      if (same(i, j)) { matchOf[j] = i; i++; j++; } else if (dp[(i + 1) * W1 + j] >= dp[i * W1 + j + 1]) i++; else j++;
    }
    // Most common vertical shifts (0 for a fixed sidebar, -56 for content pushed down by an inserted bar, ...).
    // A pixel counts as unchanged if it equals the BEFORE pixel at one of these shifts (±1 px horizontally).
    const hist = new Map(); let shifted = 0;
    for (let y = 0; y < rowsB; y++) if (matchOf[y] >= 0) { const d = matchOf[y] - y; hist.set(d, (hist.get(d) || 0) + 1); if (d) shifted++; }
    const offs = [0, ...[...hist.entries()].sort((p, q) => q[1] - p[1]).map(e => e[0]).filter(d => d !== 0).slice(0, 5)];
    const mask = new Uint8Array(w * h); let n = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < rowsB; y++) {
      const tryOffs = matchOf[y] >= 0 ? [matchOf[y] - y, ...offs] : offs;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        let bad = true;
        for (const d of tryOffs) {
          const ya = y + d; if (ya < 0 || ya >= rowsA) continue;
          for (let dx = -1; dx <= 1 && bad; dx++) {
            const xx = x + dx; if (xx < 0 || xx >= w) continue;
            const j = (ya * w + xx) * 4;
            if (Math.abs(pa[j] - pb[i]) + Math.abs(pa[j + 1] - pb[i + 1]) + Math.abs(pa[j + 2] - pb[i + 2]) <= 30) bad = false;
          }
          if (!bad) break;
        }
        if (bad) { mask[y * w + x] = 1; n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
    }
    for (let y = rowsB; y < h; y++) for (let x = 0; x < w; x++) { mask[y * w + x] = 1; n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = y; }
    // sheet: before | after | after dimmed with changed pixels in red
    const s = Math.min(1, 520 / w), W = Math.round(w * s), H = Math.round(h * s);
    const c = document.createElement('canvas'); c.width = W * 3 + 24; c.height = H + 28; const x = c.getContext('2d');
    x.fillStyle = '#1b1b1b'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#ddd'; x.font = '14px sans-serif';
    x.fillText('BEFORE', 6, 18); x.fillText('AFTER', W + 18, 18); x.fillText('CHANGES (red)', 2 * W + 30, 18);
    x.drawImage(A, 6, 24, A.width * s, A.height * s); x.drawImage(B, W + 18, 24, B.width * s, B.height * s);
    const hl = document.createElement('canvas'); hl.width = w; hl.height = h; const hx = hl.getContext('2d'); const img = hx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      if (mask[i]) { img.data[i * 4] = 255; img.data[i * 4 + 1] = 30; img.data[i * 4 + 2] = 30; }
      else { const g = (pb[i * 4] * .3 + pb[i * 4 + 1] * .59 + pb[i * 4 + 2] * .11) * 0.35; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = g; }
      img.data[i * 4 + 3] = 255;
    }
    hx.putImageData(img, 0, 0); x.drawImage(hl, 2 * W + 30, 24, W, H);
    if (x1 >= 0) { x.strokeStyle = '#ffd400'; x.lineWidth = 2; x.strokeRect(2 * W + 30 + x0 * s, 24 + y0 * s, (x1 - x0 + 1) * s, (y1 - y0 + 1) * s); }
    return { shifted, pct: n / (w * h) * 100, box: x1 >= 0 ? [x0, y0, x1 - x0 + 1, y1 - y0 + 1] : null, size: [A.width, A.height, B.width, B.height], sheet: c.toDataURL('image/png') };
  }, [url(path.join(before, f)), url(path.join(after, f))]);
  const shiftNote = r.shifted ? `, ${r.shifted} rows only moved (ignored)` : '';
  const sizeNote = r.size[0] !== r.size[2] || r.size[1] !== r.size[3] ? ` (page size changed ${r.size[0]}x${r.size[1]} -> ${r.size[2]}x${r.size[3]})` : '';
  if (r.pct < threshold) { console.log(`  UNCHANGED ${f} (${r.pct.toFixed(2)}% px${shiftNote}${sizeNote})`); continue; }
  changed++;
  const diffFile = path.join(out, f.replace(/\.png$/i, '-diff.png'));
  fs.writeFileSync(diffFile, Buffer.from(r.sheet.split(',')[1], 'base64'));
  console.log(`  CHANGED   ${f}: ${r.pct.toFixed(1)}% of pixels, area x=${r.box?.[0]} y=${r.box?.[1]} w=${r.box?.[2]} h=${r.box?.[3]}${shiftNote}${sizeNote} -> ${diffFile}`);
}
for (const f of onlyBefore) console.log(`  MISSING   ${f} exists only in BEFORE (screen no longer reachable?)`);
await browser.close();
console.log(changed ? `${changed} of ${names.length} screenshots changed — open each -diff.png: every red area must be an intended change.` : `All ${names.length} screenshots unchanged.`);
process.exit(changed ? 1 : 0);
