#!/usr/bin/env node
// compare.mjs — put a reference image and your result side by side and score how close they are.
//
//   node compare.mjs <reference.png> <result.png> [--out .proof/compare.png] [--label "3/4 view"]
//
// Writes one image: REFERENCE | RESULT | DIFF heat-map, and prints scores (0-100, higher = closer):
//   layout  — low-res grayscale structure (where things are, sizes, proportions)
//   color   — palette similarity (color histogram)
//   overall — average of the two
// Numbers are a guide for "am I getting closer?" between iterations — ALWAYS also open the output
// image and list the concrete differences you see (shape, proportions, colors, spacing, missing parts).
import { launch } from './pw.mjs';
import fs from 'node:fs';
import path from 'node:path';

const a = process.argv.slice(2);
const pos = a.filter((x, i) => !x.startsWith('--') && !(a[i - 1] || '').startsWith('--'));
const opt = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
if (pos.length < 2) { console.error('usage: node compare.mjs <reference> <result> [--out file] [--label text]'); process.exit(2); }
const [ref, res] = pos.map(p => path.resolve(p));
const out = path.resolve(opt('out', '.proof/compare.png'));
const label = opt('label', '');
fs.mkdirSync(path.dirname(out), { recursive: true });
const dataUrl = p => `data:image/${path.extname(p).slice(1).replace('jpg', 'jpeg')};base64,${fs.readFileSync(p).toString('base64')}`;

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1800, height: 700 } });
await page.setContent(`<html><body style="margin:0;background:#222;font:16px sans-serif;color:#eee">
  <div style="display:flex;gap:12px;padding:12px;align-items:flex-start">
    <figure style="margin:0"><figcaption>REFERENCE</figcaption><img id=a style="max-width:580px;max-height:620px"></figure>
    <figure style="margin:0"><figcaption>RESULT ${label}</figcaption><img id=b style="max-width:580px;max-height:620px"></figure>
    <figure style="margin:0"><figcaption>DIFF (bright = different)</figcaption><canvas id=d></canvas></figure>
  </div></body></html>`);
const scores = await page.evaluate(async ([ua, ub]) => {
  const load = (id, src) => new Promise(r => { const im = document.getElementById(id); im.onload = () => r(im); im.src = src; });
  const A = await load('a', ua), B = await load('b', ub);
  // match B's displayed size to A's for a fair side-by-side
  B.style.width = A.width + 'px'; B.style.height = A.height + 'px'; B.style.objectFit = 'contain';
  const N = 64;
  const grab = (im) => { const c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d');
    // letterbox into a square, same as "contain"
    const s = Math.min(N / im.naturalWidth, N / im.naturalHeight), w = im.naturalWidth * s, h = im.naturalHeight * s;
    x.fillStyle = '#808080'; x.fillRect(0, 0, N, N); x.drawImage(im, (N - w) / 2, (N - h) / 2, w, h); return x.getImageData(0, 0, N, N).data; };
  const pa = grab(A), pb = grab(B);
  let gd = 0; const ha = new Array(64).fill(0), hb = new Array(64).fill(0);
  const d = document.getElementById('d'); d.width = d.height = 320; const dx = d.getContext('2d'); const img = dx.createImageData(N, N);
  for (let i = 0; i < N * N; i++) {
    const r1 = pa[i * 4], g1 = pa[i * 4 + 1], b1 = pa[i * 4 + 2], r2 = pb[i * 4], g2 = pb[i * 4 + 1], b2 = pb[i * 4 + 2];
    const y1 = .299 * r1 + .587 * g1 + .114 * b1, y2 = .299 * r2 + .587 * g2 + .114 * b2;
    const diff = Math.abs(y1 - y2); gd += diff;
    const cd = (Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2)) / 3;
    img.data[i * 4] = Math.min(255, cd * 2); img.data[i * 4 + 1] = Math.min(255, cd * 0.6); img.data[i * 4 + 2] = 40; img.data[i * 4 + 3] = 255;
    ha[(r1 >> 6) * 16 + (g1 >> 6) * 4 + (b1 >> 6)]++; hb[(r2 >> 6) * 16 + (g2 >> 6) * 4 + (b2 >> 6)]++;
  }
  const tmp = document.createElement('canvas'); tmp.width = tmp.height = N; tmp.getContext('2d').putImageData(img, 0, 0);
  dx.imageSmoothingEnabled = false; dx.drawImage(tmp, 0, 0, 320, 320);
  // layout: Pearson correlation of brightness and of edge maps (insensitive to "both are dark")
  const gray = p => Array.from({ length: N * N }, (_, i) => .299 * p[i * 4] + .587 * p[i * 4 + 1] + .114 * p[i * 4 + 2]);
  const edges = g => g.map((_, i) => { const x = i % N, y = (i / N) | 0; if (!x || !y || x === N - 1 || y === N - 1) return 0;
    const gx = g[i + 1] - g[i - 1], gy = g[i + N] - g[i - N]; return Math.hypot(gx, gy); });
  const corr = (u, v) => { const n = u.length, mu = u.reduce((s, x) => s + x, 0) / n, mv = v.reduce((s, x) => s + x, 0) / n;
    let su = 0, sv = 0, c = 0; for (let i = 0; i < n; i++) { const du = u[i] - mu, dv = v[i] - mv; c += du * dv; su += du * du; sv += dv * dv; }
    return su && sv ? c / Math.sqrt(su * sv) : 0; };
  const ga = gray(pa), gb = gray(pb);
  const layout = Math.max(0, (0.5 * corr(ga, gb) + 0.5 * corr(edges(ga), edges(gb)))) * 100;
  // color: palette overlap, ignoring the reference's dominant (background) bin
  const bgBin = ha.indexOf(Math.max(...ha));
  let inter = 0, tot = 0; for (let k = 0; k < 64; k++) { if (k === bgBin) continue; inter += Math.min(ha[k], hb[k]); tot += ha[k]; }
  const color = tot ? inter / tot * 100 : 100;
  return { layout: Math.round(layout), color: Math.round(color), overall: Math.round((layout + color) / 2) };
}, [dataUrl(ref), dataUrl(res)]);
await page.locator('body > div').screenshot({ path: out });
await browser.close();
console.log(`COMPARE ${path.basename(res)} vs ${path.basename(ref)}: overall=${scores.overall} layout=${scores.layout} color=${scores.color}`);
console.log(`side-by-side: ${out}  <- open it and list the differences you see`);
