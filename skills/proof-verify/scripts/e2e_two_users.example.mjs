// Template: end-to-end test with TWO users (chat, multiplayer, collaboration).
// Copy into the project as .proof/e2e.mjs, change URL/selectors, run:  node .proof/e2e.mjs
// Start the server first in the background and wait until it answers.
import { launch } from 'file:///{{PROOFKIT_DIR}}/skills/proof-verify/scripts/pw.mjs';
import fs from 'node:fs';

const URL = process.env.APP_URL || 'http://127.0.0.1:8000';
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok, extra }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); };
fs.mkdirSync('.proof/ui', { recursive: true });

const browser = await launch();
const errors = [];
async function user(name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  page.on('console', m => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  await page.goto(URL);
  return page;
}

try {
  const alice = await user('alice'), bob = await user('bob');
  // --- adapt from here -------------------------------------------------------
  await alice.fill('#nickname', 'alice'); await alice.click('text=Войти');
  await bob.fill('#nickname', 'bob');     await bob.click('text=Войти');
  await alice.waitForSelector('text=bob', { timeout: 5000 });
  check('alice sees bob online', true);

  await alice.click('text=bob');
  await alice.fill('#messageInput', 'привет, это тест 123');
  await alice.keyboard.press('Enter');
  await bob.click('text=alice');
  const got = await bob.waitForSelector('text=привет, это тест 123', { timeout: 5000 }).then(() => true).catch(() => false);
  check('bob receives decrypted message', got);
  await alice.screenshot({ path: '.proof/ui/e2e-alice.png' });
  await bob.screenshot({ path: '.proof/ui/e2e-bob.png' });
  // --- end -------------------------------------------------------------------
} catch (e) {
  check('scenario ran without exceptions', false, e.message.split('\n')[0]);
} finally {
  check('no JS errors in either client', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
  fs.writeFileSync('.proof/e2e-results.json', JSON.stringify(results, null, 2));
  process.exit(results.every(r => r.ok) ? 0 : 1);
}
