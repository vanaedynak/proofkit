#!/usr/bin/env node
// ui_probe.mjs — open a web UI in a real browser and report what is broken.
//
// Usage:
//   node ui_probe.mjs --dir <static-folder> [--entry index.html]   (serves the folder itself)
//   node ui_probe.mjs --url http://localhost:5173                   (an already running dev server)
// Options:
//   --out <folder>        where to write report.json + screenshots (default: ./.proof/ui)
//   --steps <file.json>   scripted scenario to run (see SKILL.md "Scenario steps")
//   --click-all           click every visible button and report buttons that change nothing / throw
//   --viewports 1440x900,768x1024,375x812
//   --wait <ms>           extra wait after load (default 500)
//   --freeze              disable CSS animations/transitions (stable before/after shots for visual_diff.mjs)
//
// Exit code: 0 = no problems found, 1 = problems found, 2 = probe itself failed.

import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const OUT = path.resolve(args.out || '.proof/ui');
const VIEWPORTS = (args.viewports || '1440x900,768x1024,375x812').split(',').map(v => {
  const [w, h] = v.split('x').map(Number);
  return { width: w, height: h, name: `${w}x${h}` };
});
const WAIT = Number(args.wait ?? 500);

fs.mkdirSync(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', '.woff': 'font/woff', '.woff2': 'font/woff2', '.vtt': 'text/vtt', '.wasm': 'application/wasm',
};

function serve(dir) {
  return new Promise(resolve => {
    const root = path.resolve(dir);
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(root, p);
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); return res.end('not found');
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function launch() {
  const errors = [];
  for (const channel of ['msedge', 'chrome', undefined]) {
    try {
      return await chromium.launch({ channel, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
    } catch (e) { errors.push(`${channel}: ${e.message.split('\n')[0]}`); }
  }
  throw new Error('No browser could be launched:\n' + errors.join('\n'));
}

const report = { url: null, problems: [], viewports: {}, steps: null, clickAll: null };
const problem = (kind, detail, where) => report.problems.push({ kind, where, detail });

let server = null;
let browser = null;
try {
  let url = args.url;
  if (!url) {
    if (!args.dir) throw new Error('pass --dir <folder> or --url <url>');
    server = await serve(args.dir);
    url = `http://127.0.0.1:${server.address().port}/${args.entry || ''}`;
  }
  report.url = url;
  browser = await launch();

  for (const vp of VIEWPORTS) {
    const page = await newPage(vp);
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(WAIT);
    const shot = path.join(OUT, `shot-${vp.name}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    const layout = await page.evaluate(inspectLayout);
    report.viewports[vp.name] = { screenshot: shot, ...layout, console: page._log };
    if (vp === VIEWPORTS[0]) {   // canvas / 3D telemetry once, at the main viewport
      const t = await page.evaluate(inspect3D, 3000).catch(e => ({ error: String(e.message).slice(0, 200) }));
      if (t) { report.scene3d = t; threeProblems(t, `${vp.name} on load`); }
    }
    if (layout.horizontalOverflow > 1)
      problem('horizontal-overflow', `page is ${layout.horizontalOverflow}px wider than the viewport; offenders: ${JSON.stringify(layout.overflowing.slice(0, 8))}`, vp.name);
    for (const c of layout.covered) problem('covered-control', `"${c.label}" is visible but another element sits on top of it (${c.coveredBy}) — clicks will not reach it`, vp.name);
    for (const t of layout.tiny) problem('tiny-control', `"${t.label}" is only ${t.w}x${t.h}px`, vp.name);
    for (const c of layout.clipped) problem('clipped-control', `"${c.label}" is partly outside the viewport (${JSON.stringify(c.rect)})`, vp.name);
    for (const t of layout.clippedText) problem('clipped-text', `"${t.label}" (${t.el}) does not fit its box by ${t.overflowPx}px — text is cut off or spills out`, vp.name);
    for (const l of page._log) problem(l.type, l.text, vp.name);
    await page.close();
  }

  if (args.steps) report.steps = await runSteps(JSON.parse(fs.readFileSync(args.steps, 'utf8')));
  if (args['click-all']) report.clickAll = await clickAll();
} catch (e) {
  report.fatal = String(e && e.stack || e);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.close();
}

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
printSummary();
process.exit(report.fatal ? 2 : report.problems.length ? 1 : 0);

// ---------------------------------------------------------------------------

async function newPage(vp) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
  await ctx.addInitScript(sceneHook);
  if (args.freeze) await ctx.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {   // deterministic screenshots for visual_diff
    const st = document.createElement('style'); st.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
    document.head.appendChild(st);
  }));
  const page = await ctx.newPage();
  page._log = [];
  page.on('console', m => { if (/favicon\.ico/.test(m.location()?.url || '')) return; if (m.type() === 'error' || m.type() === 'warning') page._log.push({ type: `console-${m.type()}`, text: m.text().slice(0, 500) }); });
  page.on('pageerror', e => page._log.push({ type: 'js-exception', text: String(e.message).slice(0, 500) }));
  page.on('requestfailed', r => page._log.push({ type: 'request-failed', text: `${r.url()} ${r.failure()?.errorText}` }));
  page.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) page._log.push({ type: 'http-error', text: `${r.status()} ${r.url()}` }); });
  const close = page.close.bind(page);
  page.close = async () => { await close(); await ctx.close(); };
  return page;
}

// Injected before any page script: three.js announces every Scene/WebGLRenderer to
// window.__THREE_DEVTOOLS__ (also in production builds). We keep them, remember the camera of the
// last render() call, and count animation frames — no change to the game's code needed.
function sceneHook() {
  const pk = window.__proofkit = { scenes: [], renderers: [], camera: null, scene: null, renders: 0 };
  const hub = new EventTarget();
  hub.addEventListener('observe', e => {
    const o = e.detail;
    if (o && o.isScene) pk.scenes.push(o);
    if (o && o.isWebGLRenderer || o && typeof o.render === 'function' && o.domElement) {
      pk.renderers.push(o);
      const render = o.render.bind(o);
      o.render = (scene, camera) => { pk.scene = scene; pk.camera = camera; pk.renders++; return render(scene, camera); };
    }
  });
  window.__THREE_DEVTOOLS__ = hub;
}

// Runs inside the page: fps over `ms`, and for three.js scenes which main objects the camera sees.
async function inspect3D(ms) {
  const pk = window.__proofkit;
  if (!document.querySelector('canvas') || !pk) return null;
  const r0 = pk.renders, t0 = performance.now();
  let frames = 0;
  await new Promise(res => { const f = () => { frames++; performance.now() - t0 < ms ? requestAnimationFrame(f) : res(); }; requestAnimationFrame(f); });
  const secs = (performance.now() - t0) / 1000;
  const out = { fps: Math.round(frames / secs), renderFps: pk.renderers.length ? Math.round((pk.renders - r0) / secs) : null, three: !!pk.scenes.length };
  const scene = pk.scene || pk.scenes[pk.scenes.length - 1], cam = pk.camera;
  if (!scene || !cam) return out;
  const info = pk.renderers[0]?.info?.render;
  if (info) { out.drawCalls = info.calls; out.triangles = info.triangles; }
  scene.updateMatrixWorld(true);
  cam.updateMatrixWorld?.(true);
  // candidates: top-level objects (a glTF "Scene" wrapper is unwrapped); label = own or first descendant name
  const cands = [];
  for (let o of scene.children) { while (/^(Scene|AuxScene|RootNode)?$/.test(o.name) && o.children.length === 1) o = o.children[0]; cands.push(o); }
  const label = o => { if (o.name && !/^(Scene|RootNode)$/.test(o.name)) return o.name; let n = null; o.traverse(c => { if (!n && c !== o && c.name) n = c.name; }); if (n) return `${n}…`; let g = null; o.traverse(c => { if (!g && c.geometry) g = c.geometry.type.replace(/Geometry$/, ""); }); return `${o.type}#${o.id}${g ? `(${g})` : ""}`; };
  const objs = [];
  for (const o of cands) {
    let box = null, nan = false;
    o.traverse(m => {
      if (!m.isMesh && !m.isPoints && !m.isLine && !m.isSprite) return;
      if (!m.visible || !m.geometry) return;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox?.();
      const b = m.geometry.boundingBox; if (!b) return;
      const wb = b.clone().applyMatrix4(m.matrixWorld);
      if (![wb.min.x, wb.min.y, wb.min.z, wb.max.x, wb.max.y, wb.max.z].every(Number.isFinite)) { nan = true; return; }
      box = box ? box.union(wb) : wb;
    });
    if (!box && !nan) continue;
    if (nan) { objs.push({ name: label(o), nan: true }); continue; }
    const V = box.min.constructor, size = new V().subVectors(box.max, box.min), center = new V().addVectors(box.min, box.max).multiplyScalar(0.5);
    let inside = 0, sx0 = 1, sx1 = -1, sy0 = 1, sy1 = -1;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const p = new V(x, y, z).project(cam);
      if (p.z < -1 || p.z > 1) continue;
      if (Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1) inside++;
      sx0 = Math.min(sx0, p.x); sx1 = Math.max(sx1, p.x); sy0 = Math.min(sy0, p.y); sy1 = Math.max(sy1, p.y);
    }
    const c = center.clone().project(cam), centerIn = Math.abs(c.x) <= 1 && Math.abs(c.y) <= 1 && c.z >= -1 && c.z <= 1;
    const screenShare = sx1 > sx0 ? +(Math.min(1, (Math.min(sx1, 1) - Math.max(sx0, -1)) / 2) * Math.min(1, (Math.min(sy1, 1) - Math.max(sy0, -1)) / 2)).toFixed(3) : 0;
    objs.push({ name: label(o), inView: inside > 0 || centerIn, screenShare: Math.max(0, screenShare),
      size: +size.length().toFixed(2), center: [center.x, center.y, center.z].map(v => +v.toFixed(1)),
      distance: +center.distanceTo(cam.getWorldPosition(new V())).toFixed(1) });
  }
  objs.sort((a, b) => (b.size || 0) - (a.size || 0));
  out.objects = objs.slice(0, 12);
  out.objectsTotal = objs.length;
  return out;
}

function threeProblems(t, where) {
  if (!t) return;
  if (t.fps < 30) problem('low-fps', `${t.fps} fps over 3 s (want ≥ 30, ideally ≥ 50) — the game will feel laggy`, where);
  if (t.renderFps === 0) problem('not-rendering', 'a three.js renderer exists but render() was not called for 3 s — frozen or render loop never started', where);
  for (const o of t.objects || []) if (o.nan) problem('nan-transform', `"${o.name}" has NaN/Infinity in its transform — it vanished (bad physics/maths)`, where);
  const real = (t.objects || []).filter(o => !o.nan);
  if (real.length && !real.some(o => o.inView)) problem('nothing-in-view', `the camera sees none of the ${t.objectsTotal} scene objects (${real.slice(0, 5).map(o => o.name).join(', ')}) — camera points at nothing`, where);
}

// Runs inside the page.
function inspectLayout() {
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  const label = el => (el.getAttribute('aria-label') || el.title || el.innerText || el.value || el.id || el.className || el.tagName).toString().trim().replace(/\s+/g, ' ').slice(0, 60);
  const sel = el => el.id ? `#${el.id}` : el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : '');
  const visible = el => {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    if (r.width <= 2 || r.height <= 2 || s.visibility === 'hidden' || s.display === 'none') return false;
    // walk ancestors: effective opacity, and "visually-hidden" containers (1px boxes / clip) that hide children
    let op = 1;
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
      const as = getComputedStyle(a);
      op *= Number(as.opacity);
      if (a !== el) {
        const ar = a.getBoundingClientRect();
        if ((ar.width <= 2 || ar.height <= 2) && as.overflow !== 'visible') return false;
        if (as.clip && as.clip !== 'auto') return false;
        if (as.clipPath && /inset\(50%|circle\(0/.test(as.clipPath)) return false;
      }
    }
    return op > 0.05;
  };
  const overflowing = [];
  for (const el of document.body.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width && r.right > vw + 1 && visible(el) && getComputedStyle(el).position !== 'fixed') {
      let p = el.parentElement, clippedByAncestor = false;
      while (p && p !== document.body) {
        const o = getComputedStyle(p).overflowX;
        if (o === 'hidden' || o === 'auto' || o === 'scroll' || o === 'clip') { clippedByAncestor = true; break; }
        p = p.parentElement;
      }
      if (!clippedByAncestor) overflowing.push({ el: sel(el), right: Math.round(r.right) });
    }
  }
  const controls = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=slider], [onclick], [tabindex]:not([tabindex="-1"])')]
    .filter(visible).filter(el => !(el.tagName === 'INPUT' && el.type === 'file' && getComputedStyle(el).opacity === '0'));
  const covered = [], tiny = [], clipped = [], list = [];
  for (const el of controls) {
    const r = el.getBoundingClientRect();
    list.push({ label: label(el), el: sel(el), w: Math.round(r.width), h: Math.round(r.height) });
    const isSlider = el.type === 'range' || el.getAttribute('role') === 'slider';
    if (!isSlider && (r.width < 20 || r.height < 20)) tiny.push({ label: label(el), w: Math.round(r.width), h: Math.round(r.height) });
    const inScroller = (() => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll') return true; } return false; })();
    if (!inScroller && (r.left < -1 || r.right > vw + 1)) clipped.push({ label: label(el), rect: { left: Math.round(r.left), right: Math.round(r.right) } });
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cx >= 0 && cx < vw && cy >= 0 && cy < vh) {
      const top = document.elementFromPoint(cx, cy);
      // an open modal/overlay is supposed to cover the page behind it
      const modal = top && top.closest('[role=dialog], [aria-modal=true], dialog, .modal, .overlay, [class*=modal], [class*=overlay]');
      const behindModal = modal && !modal.contains(el);
      if (top && !behindModal && top !== el && !el.contains(top) && !top.contains(el) && !(el.labels && [...el.labels].some(l => l.contains(top))))
        covered.push({ label: label(el), coveredBy: sel(top) });
    }
  }
  // text that doesn't fit its box (cut off by overflow:hidden / ellipsis, or spilling out of a button)
  // Measure each visible text node against its box: the nearest button/link/cell/label, or the nearest
  // ancestor that clips (overflow != visible). Decorative children don't count — only real text.
  const clippedText = [], seen = new Set(), range = document.createRange();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode());) {
    if (!n.textContent.trim() || !n.parentElement || !visible(n.parentElement)) continue;
    let box = n.parentElement.closest('button, a, [role=button], label, td, th, li');
    if (!box) {
      for (let a = n.parentElement; a && a !== document.body; a = a.parentElement) {
        const o = getComputedStyle(a); if (o.overflowX !== 'visible' || o.overflowY !== 'visible') { box = a; break; }
      }
    }
    if (!box || seen.has(box)) continue;
    // intentional truncation (ellipsis / line-clamp) is a design choice, not a bug
    const intentional = [n.parentElement, box].some(e => { const cs = getComputedStyle(e);
      return cs.textOverflow === 'ellipsis' || (cs.webkitLineClamp && cs.webkitLineClamp !== 'none'); });
    if (intentional) continue;
    const r = box.getBoundingClientRect();
    if (!r.width) continue;
    range.selectNodeContents(n);
    let over = 0;
    for (const tr of range.getClientRects()) over = Math.max(over, tr.right - r.right, r.left - tr.left, tr.bottom - r.bottom, r.top - tr.top);
    if (over > 2) { seen.add(box); clippedText.push({ label: label(box), el: sel(box), overflowPx: Math.round(over) }); }
  }
  // the main visual (game canvas, video, image, map) — how much of the screen does it use?
  let main = null;
  for (const el of document.querySelectorAll('canvas, video, svg, img, iframe')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (!main || r.width * r.height > main.area) main = { el: sel(el), w: Math.round(r.width), h: Math.round(r.height), area: r.width * r.height };
  }
  if (main) { main.widthShare = +(main.w / vw).toFixed(2); main.heightShare = +(main.h / vh).toFixed(2); }
  return {
    horizontalOverflow: document.documentElement.scrollWidth - vw,
    overflowing, covered, tiny, clipped, clippedText: clippedText.slice(0, 15), mainVisual: main, controls: list,
    title: document.title,
  };
}

async function runSteps(steps) {
  const vp = VIEWPORTS[0];
  const page = await newPage(vp);
  const results = [];
  await page.goto(report.url, { waitUntil: 'load' });
  await page.waitForTimeout(WAIT);
  for (const [i, step] of steps.entries()) {
    const name = step.name || JSON.stringify(step).slice(0, 80);
    let value, before;
    try {
      if (step.expectChange) before = await page.evaluate(step.expectChange);
      if (step.reload) { await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(WAIT); }
      if (step.viewport) { const [w, h] = step.viewport.split('x').map(Number); await page.setViewportSize({ width: w, height: h }); }
      if (step.click) {    // move the mouse there first (wakes auto-hiding controls), like a real user
        const box = await page.locator(step.click).first().boundingBox().catch(() => null);
        if (box) { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 }); await page.waitForTimeout(150); }
        await page.click(step.click, { timeout: 5000 });
      }
      if (step.dblclick) await page.dblclick(step.dblclick, { timeout: 5000 });
      if (step.hover) await page.hover(step.hover, { timeout: 5000 });
      if (step.fill) await page.fill(step.fill[0], step.fill[1], { timeout: 5000 });
      if (step.select) await page.selectOption(step.select[0], step.select[1], { timeout: 5000 });
      if (step.press) for (let n = 0; n < (step.repeat || 1); n++) { await page.keyboard.press(step.press); if (step.repeat) await page.waitForTimeout(step.every || 60); }
      if (step.setFiles) await page.setInputFiles(step.setFiles[0], [].concat(step.setFiles[1]).map(f => path.resolve(f)));
      if (step.clickAt) {  // [selector, fractionX] — e.g. click 75% along a progress bar
        const box = await page.locator(step.clickAt[0]).boundingBox();
        await page.mouse.click(box.x + box.width * step.clickAt[1], box.y + box.height / 2);
      }
      if (step.drag) {     // [selector, fromFraction, toFraction]
        const box = await page.locator(step.drag[0]).boundingBox(), y = box.y + box.height / 2;
        await page.mouse.move(box.x + box.width * step.drag[1], y); await page.mouse.down();
        await page.mouse.move(box.x + box.width * step.drag[2], y, { steps: 8 }); await page.mouse.up();
      }
      // --- games: hold keys / steer with the mouse over time, film it, measure fps ---
      const vpNow = page.viewportSize();
      if (step.mouseMove) await page.mouse.move(vpNow.width * step.mouseMove[0], vpNow.height * step.mouseMove[1], { steps: step.mouseSteps || 10 });
      if (step.mouseDown) await page.mouse.down({ button: step.mouseDown === 'right' ? 'right' : 'left' });
      if (step.mouseUp) await page.mouse.up({ button: step.mouseUp === 'right' ? 'right' : 'left' });
      const hold = step.hold ? [].concat(step.hold) : [];
      for (const k of hold) await page.keyboard.down(k);
      const film = step.filmstrip ? { frames: 6, every: 250, ...(step.filmstrip === true ? {} : step.filmstrip) } : null;
      if (film) await filmstrip(page, film, i, step.screenshot || step.name || 'film', name);
      else if (hold.length) await page.waitForTimeout(step.ms || 1000);
      if (step.fps) {
        const fps = await page.evaluate(ms => new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; performance.now() - t0 < ms ? requestAnimationFrame(f) : r(n * 1000 / (performance.now() - t0)); }; requestAnimationFrame(f); }), step.fps);
        value = { ...(value || {}), fps: Math.round(fps) };
        if (fps < (step.minFps || 30)) problem('low-fps', `${Math.round(fps)} fps (want ≥${step.minFps || 30}) — game will feel laggy`, `step ${i}: ${name}`);
      }
      for (const k of hold.reverse()) await page.keyboard.up(k);
      if (step.wait) await page.waitForTimeout(step.wait);
      if (step.waitFor) await page.waitForFunction(step.waitFor, null, { timeout: step.timeout || 5000 });
      if (step.expectChange) {
        const after = await page.evaluate(step.expectChange);
        if (JSON.stringify(after) === JSON.stringify(before)) throw new Error(`input had no effect: ${step.expectChange} stayed ${JSON.stringify(after)}`);
        value = { ...(value || {}), before, after };
      }
      if (step.eval && /\b(damage|kill|destroy|takeDamage|die|explode|win|lose|setScore|addScore|complete|onEnemy\w*|setHealth|teleport)\w*\s*\(|\b(score|health|hp|lives|kills)\s*[-+*]?=(?!=)/i.test(step.eval))
        problem('faked-outcome', `eval calls game internals to produce an outcome (${step.eval.slice(0, 90)}) — this proves nothing; achieve it with real keys/mouse (hold/mouseMove/mouseDown)`, `step ${i}: ${name}`);
      if (step.eval) value = value ? { ...value, eval: await page.evaluate(step.eval) } : await page.evaluate(step.eval);
      if (step.expect) {
        const ok = await page.evaluate(step.expect);
        if (!ok) throw new Error(`expectation failed: ${step.expect}` + (value !== undefined ? ` (eval => ${JSON.stringify(value)})` : ''));
      }
      if (step.expectText) {
        const has = await page.evaluate(t => document.body.innerText.toLowerCase().includes(t.toLowerCase()), step.expectText);
        if (!has) throw new Error(`text not visible on page: "${step.expectText}"`);
      }
      if (step.screenshot || step.inspect) {  // re-run layout checks in this state (modals, game screen, ...)
        const lay = await page.evaluate(inspectLayout);
        for (const t of lay.clippedText) problem('clipped-text', `"${t.label}" (${t.el}) cut off by ${t.overflowPx}px`, `step ${i}: ${name}`);
        for (const c of lay.covered) problem('covered-control', `"${c.label}" covered by ${c.coveredBy}`, `step ${i}: ${name}`);
        if (lay.horizontalOverflow > 1) problem('horizontal-overflow', `${lay.horizontalOverflow}px`, `step ${i}: ${name}`);
        const m = lay.mainVisual, vpw = page.viewportSize().width;
        if (m && m.area > 20000) {
          const want = vpw >= 1000 ? 0.6 : 0.45;  // main visual should dominate: >=60% height on desktop, >=45% on phones
          if (m.heightShare < want && m.widthShare < 0.6)
            problem('small-main-visual', `largest visual ${m.el} is ${m.w}x${m.h} = ${Math.round(m.heightShare * 100)}% of screen height (want ≥${want * 100}%) — the main content looks tiny; scale it up`, `step ${i}: ${name}`);
        }
      }
      if (step.screenshot || step.scene3d) {   // which 3D objects does the camera see in this state?
        const t = await page.evaluate(inspect3D, step.scene3d ? 3000 : 300).catch(() => null);
        if (t && t.three) { value = { ...(value || {}), scene3d: { fps: t.fps, inView: (t.objects || []).filter(o => o.inView).map(o => o.name), outOfView: (t.objects || []).filter(o => !o.inView).map(o => o.name) } }; if (step.scene3d) threeProblems(t, `step ${i}: ${name}`); else for (const o of t.objects || []) if (o.nan) problem('nan-transform', `"${o.name}" has NaN in its transform`, `step ${i}: ${name}`); }
      }
      if (step.screenshot) await page.screenshot({ path: path.join(OUT, `step-${String(i).padStart(2, '0')}-${step.screenshot}.png`) });
      const fresh = page._log.splice(0);
      for (const l of fresh) problem(l.type, l.text, `step ${i}: ${name}`);
      results.push({ i, name, ok: true, value });
    } catch (e) {
      const msg = String(e.message).split('\n')[0];
      results.push({ i, name, ok: false, error: msg });
      problem('step-failed', msg, `step ${i}: ${name}`);
      await page.screenshot({ path: path.join(OUT, `step-${String(i).padStart(2, '0')}-FAILED.png`) }).catch(() => {});
    }
  }
  await page.close();
  return results;
}

// Capture N frames while the game runs (keys may be held), save them as one contact sheet.
// Identical frames mean the game froze or ignored the input.
async function filmstrip(page, { frames, every }, i, label, name) {
  const shots = [];
  for (let n = 0; n < frames; n++) {
    if (n) await page.waitForTimeout(every);
    shots.push(await page.screenshot({ type: 'jpeg', quality: 70 }));
  }
  if (new Set(shots.map(b => b.toString('base64'))).size === 1)
    problem('frozen-frames', `all ${frames} frames identical over ${(frames - 1) * every}ms — game is frozen or ignores the input`, `step ${i}: ${name}`);
  const cols = Math.min(3, frames), vp = page.viewportSize(), w = Math.round(vp.width / cols * 0.98);
  const sheet = await page.context().newPage();
  await sheet.setViewportSize({ width: cols * (w + 6) + 6, height: Math.ceil(frames / cols) * (Math.round(w * vp.height / vp.width) + 28) + 6 });
  await sheet.setContent(`<body style="margin:0;padding:3px;background:#111;display:flex;flex-wrap:wrap;font:13px sans-serif;color:#ddd">${shots.map((b, n) =>
    `<figure style="margin:3px;width:${w}px"><img style="width:100%;display:block" src="data:image/jpeg;base64,${b.toString('base64')}"><figcaption>t=${n * every}ms</figcaption></figure>`).join('')}</body>`);
  await sheet.screenshot({ path: path.join(OUT, `step-${String(i).padStart(2, '0')}-${label}-film.png`), fullPage: true });
  await sheet.close();
}

async function clickAll() {
  const vp = VIEWPORTS[0];
  const page = await newPage(vp);
  await page.goto(report.url, { waitUntil: 'load' });
  await page.waitForTimeout(WAIT);
  const count = await page.locator('button:visible, [role=button]:visible').count();
  const results = [];
  for (let i = 0; i < count; i++) {
    if (i) { await page.goto(report.url, { waitUntil: 'load' }); await page.waitForTimeout(200); }  // isolate: a modal opened by one button must not block the next
    const btn = page.locator('button:visible, [role=button]:visible').nth(i);
    const label = ((await btn.getAttribute('aria-label').catch(() => null)) || (await btn.innerText().catch(() => '')) || (await btn.getAttribute('title').catch(() => '')) || `#${i}`).trim().slice(0, 60);
    const before = await page.evaluate(() => document.body.innerHTML.length + '|' + document.body.innerHTML.slice(0, 20000) + '|' + [...document.querySelectorAll('video,audio')].map(m => `${m.paused}${m.muted}${m.volume}${m.playbackRate}`).join() + '|' + !!document.fullscreenElement);
    try {
      page.once('filechooser', fc => fc.setFiles([]).catch(() => {}));
      await page.mouse.move(vp.width / 2, vp.height / 2);   // wake auto-hiding controls like a real user would
      await btn.hover({ timeout: 1500 }).catch(() => {});
      await btn.click({ timeout: 2500 });
      await page.waitForTimeout(250);
      const after = await page.evaluate(() => document.body.innerHTML.length + '|' + document.body.innerHTML.slice(0, 20000) + '|' + [...document.querySelectorAll('video,audio')].map(m => `${m.paused}${m.muted}${m.volume}${m.playbackRate}`).join() + '|' + !!document.fullscreenElement);
      const errs = page._log.splice(0);
      for (const l of errs) problem(l.type, l.text, `click-all: "${label}"`);
      results.push({ label, changedSomething: before !== after, errors: errs.length });
    } catch (e) {
      const lines = String(e.message).replace(/\x1b\[[0-9;]*m/g, '').split('\n');
      const why = lines.filter(l => /intercepts|not visible|not enabled|not stable|pointer-events|outside of the viewport/.test(l)).slice(-1)[0]?.trim() || lines[0];
      results.push({ label, error: why });
      problem('unclickable', why, `click-all: "${label}"`);
    }
  }
  const dead = results.filter(r => r.changedSomething === false).map(r => r.label);
  if (dead.length) report.notes = (report.notes || []).concat(`Buttons with no visible DOM/media effect on an empty page (may be fine if they need loaded content first — re-test them in a scenario with content loaded): ${dead.join(', ')}`);
  await page.close();
  return results;
}

function printSummary() {
  const out = [];
  out.push(`UI probe: ${report.url}`);
  if (report.fatal) out.push(`PROBE FAILED: ${report.fatal}`);
  for (const [name, v] of Object.entries(report.viewports)) out.push(`  [${name}] controls=${v.controls.length} overflow=${v.horizontalOverflow}px screenshot=${v.screenshot}`);
  const s3 = report.scene3d;
  if (s3 && !s3.error) {
    out.push(`  [canvas] fps=${s3.fps}${s3.three ? ` three.js renders/s=${s3.renderFps} drawCalls=${s3.drawCalls ?? '?'} triangles=${s3.triangles ?? '?'}` : ''}`);
    if (s3.objects) out.push(`  [3D] in view: ${s3.objects.filter(o => o.inView).map(o => `${o.name}(${Math.round(o.screenShare * 100)}%)`).join(', ') || 'NOTHING'}; out of view: ${s3.objects.filter(o => !o.inView && !o.nan).map(o => o.name).join(', ') || '-'}`);
  }
  if (report.steps) out.push(`  scenario: ${report.steps.filter(s => s.ok).length}/${report.steps.length} steps passed`);
  if (report.clickAll) out.push(`  click-all: ${report.clickAll.length} buttons clicked`);
  out.push(report.problems.length ? `PROBLEMS (${report.problems.length}):` : 'No problems detected.');
  for (const p of report.problems.slice(0, 60)) out.push(`  - [${p.kind}] (${p.where}) ${p.detail}`);
  for (const n of report.notes || []) out.push(`  note: ${n}`);
  out.push(`Full report: ${path.join(OUT, 'report.json')}`);
  console.log(out.join('\n'));
}

function parseArgs(a) {
  const o = {};
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith('--')) continue;
    const k = a[i].slice(2);
    if (a[i + 1] === undefined || a[i + 1].startsWith('--')) o[k] = true; else o[k] = a[++i];
  }
  return o;
}
