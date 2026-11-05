// Re-export of playwright-core so your own test scripts can use it from any folder without
// npm install or NODE_PATH:   import { launch } from 'file:///C:/.../proof-verify/scripts/pw.mjs';
import { chromium } from 'playwright-core';
export { chromium };

// Launch the installed Edge/Chrome (no browser download needed).
export async function launch(opts = {}) {
  let last;
  for (const channel of ['msedge', 'chrome', undefined]) {
    try { return await chromium.launch({ channel, headless: true, ...opts }); } catch (e) { last = e; }
  }
  throw last;
}
