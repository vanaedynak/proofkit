#!/usr/bin/env node
// route_tour.mjs — screenshot EVERY screen of an app, so a big change (new theme, layout rework,
// dependency upgrade) can be checked everywhere, not only on the 2–3 screens you edited.
//
//   node route_tour.mjs --url http://localhost:5173 --routes .proof/routes.txt --out .proof/tour/before
//   ... make the change ...
//   node route_tour.mjs --url http://localhost:5173 --routes .proof/routes.txt --out .proof/tour/after
//   node visual_diff.mjs .proof/tour/before .proof/tour/after
//
// Options:
//   --routes <file>      one route per line ("/catalog", "/title/some-alias"); "#" starts a comment;
//                        take them from the router file / project map, with real ids for detail pages
//   --hash               app uses a hash router (/#/catalog)
//   --storage <file>     JSON {key: value} put into localStorage before every page (guest mode, test data)
//   --setup <file>       JSON steps run once per viewport before the tour, e.g. pass a login/guest screen:
//                        [{"click":"text=Смотреть как гость"},{"fill":["#email","test@test.dev"]},{"wait":800}]
//   --viewports <list>   default 1440x900,375x812; presets: ipad, ipad-portrait, phone, desktop
//   --wait <ms>          wait after load (default 1200)
//   --freeze             disable CSS animations (stable shots for visual_diff)
//   --max-scroll <n>     scroll through at most n screen heights to trigger lazy loading (default 6)
// Live data (feeds, "new episodes") differs between runs: take the BEFORE tour twice; screens that differ
// between those two runs are noisy — compare them by eye instead of trusting the diff.
// Prints one line per route: OK, or the JS errors / failed requests / overflow found there.
// Exit code: 0 = every route clean, 1 = problems, 2 = error.
import { launch } from './pw.mjs';
import fs from 'node:fs';
import path from 'node:path';

const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 && a[i + 1] && !a[i + 1].startsWith('--') ? a[i + 1] : d; };
const has = k => a.includes('--' + k);
const URL0 = opt('url'), ROUTES = opt('routes');
if (!URL0 || !ROUTES) { console.error('usage: node route_tour.mjs --url <base> --routes <file> [--out dir] [--hash] [--storage seed.json] [--viewports ...] [--freeze]'); process.exit(2); }
const OUT = path.resolve(opt('out', '.proof/tour'));
const WAIT = Number(opt('wait', 1200));
const MAXS = Number(opt('max-scroll', 6));   // screens to scroll through (infinite feeds would never end)
const PRESETS = { ipad: [1180, 820, true], 'ipad-portrait': [820, 1180, true], phone: [390, 844, true], desktop: [1440, 900, false] };
const VPS = opt('viewports', '1440x900,375x812').split(',').map(v => { const p = PRESETS[v]; const [w, h] = p || v.split('x').map(Number); return { w, h, touch: !!(p && p[2]), name: p ? v : `${w}x${h}` }; });
const routes = fs.readFileSync(ROUTES, 'utf8').split(/\r?\n/).map(l => l.replace(/#.*$/, '').trim()).filter(Boolean);
const setup = opt('setup') ? JSON.parse(fs.readFileSync(opt('setup'), 'utf8')) : [];
const storage = opt('storage') ? JSON.parse(fs.readFileSync(opt('storage'), 'utf8')) : null;
fs.mkdirSync(OUT, { recursive: true });

const slug = r => (r.replace(/^\/+/, '').replace(/[^\w-]+/g, '_') || 'home').slice(0, 60);
const browser = await launch();
let bad = 0;
const shots = new Map();   // screenshot hash -> routes (identical screens = a gate in front of the app?)
console.log(`ROUTE TOUR ${URL0}  (${routes.length} routes × ${VPS.length} viewports) -> ${OUT}`);
for (const vp of VPS) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1, hasTouch: vp.touch, isMobile: vp.touch && vp.w < 700 });
  await ctx.addInitScript(([st, freeze]) => {
    if (st) for (const [k, v] of Object.entries(st)) { try { if (localStorage.getItem(k) === null || !sessionStorage.getItem('__pk_seeded')) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch {} }
    try { sessionStorage.setItem('__pk_seeded', '1'); } catch {}
    if (freeze) document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'; document.head.appendChild(s); });
  }, [storage, has('freeze')]);
  const page = await ctx.newPage();
  let log = [];
  page.on('pageerror', e => log.push(`js: ${String(e.message).slice(0, 160)}`));
  page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) log.push(`console: ${m.text().slice(0, 160)}`); });
  page.on('response', r => { if (r.status() >= 400 && !/favicon/.test(r.url())) log.push(`http ${r.status()} ${r.url().slice(0, 120)}`); });
  if (setup.length) {
    await page.goto(has('hash') ? `${URL0.replace(/\/+$/, '')}/#/` : URL0, { waitUntil: 'load' });
    await page.waitForTimeout(WAIT);
    for (const st of setup) {
      try {
        if (st.click) await page.click(st.click, { timeout: 5000 });
        if (st.fill) await page.fill(st.fill[0], st.fill[1], { timeout: 5000 });
        if (st.press) await page.keyboard.press(st.press);
        await page.waitForTimeout(st.wait || 400);
      } catch (e) { console.log(`  SETUP FAILED ${JSON.stringify(st)}: ${String(e.message).split('\n')[0]}`); bad++; }
    }
  }
  for (const r of routes) {
    log = [];
    const url = has('hash') ? `${URL0.replace(/\/+$/, '')}/#${r.startsWith('/') ? r : '/' + r}` : new URL(r, URL0).href;
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 20000 });
      await page.waitForTimeout(WAIT);
      // scroll through the page so lazy images/rows load, then back to the top and wait for the network
      await page.evaluate(async (max) => { const h = () => Math.min(document.documentElement.scrollHeight, innerHeight * max); for (let y = 0; y < h(); y += innerHeight * 0.8) { scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); } scrollTo(0, 0); }, MAXS);
      await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
      await page.evaluate(() => Promise.all([...document.images].filter(i => !i.complete).map(i => new Promise(r => { i.onload = i.onerror = r; setTimeout(r, 3000); }))));
      const over =await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (over > 1) log.push(`horizontal overflow ${over}px`);
      const file = path.join(OUT, `${slug(r)}@${vp.name}.png`);
      const buf = await page.screenshot({ path: file, fullPage: true });
      const key = `${vp.name}:${buf.length}:${buf.subarray(buf.length >> 1, (buf.length >> 1) + 4096).toString('base64')}`;
      shots.set(key, [...(shots.get(key) || []), r]);
    } catch (e) { log.push(`failed: ${String(e.message).split('\n')[0]}`); }
    if (log.length) bad++;
    console.log(`  ${log.length ? 'PROBLEM' : 'OK     '} ${r} @${vp.name}${log.length ? ' — ' + [...new Set(log)].slice(0, 4).join(' | ') : ''}`);
  }
  await ctx.close();
}
await browser.close();
for (const [k, rs] of shots) if (rs.length >= Math.max(3, routes.length * 0.6)) {
  bad++;
  console.log(`WARNING: ${rs.length} routes look IDENTICAL at ${k.split(':')[0]} (${rs.slice(0, 5).join(', ')}…) — probably a login/guest/onboarding screen in front of the app. Open one screenshot; pass it with --setup or --storage.`);
}
console.log(bad ? `${bad} route/viewport combination(s) with problems.` : 'All routes clean.');
process.exit(bad ? 1 : 0);
