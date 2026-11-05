#!/usr/bin/env node
// mc_test.mjs — test a Minecraft (Paper/Spigot) plugin on a REAL server with a fake player (bot).
//
//   node mc_test.mjs --jar target/MyPlugin.jar --steps .proof/mc-steps.json [--out .proof/mc] [--version 1.21.11]
//
// What it does: copies the cached Paper server into <out>/server (fresh each run), accepts the EULA,
// sets offline mode + flat world, installs your plugin jar, makes the bot an operator, starts the server,
// waits for "Done", checks your plugin enabled without errors, joins a bot player ("TestBot"),
// runs your steps, stops the server and prints PASS/FAIL per step + server log problems.
// Exit 0 = everything passed.
//
// Steps (JSON array), each object can have:
//   {"name": "...", "chat": "/heal"}                  bot types a command or message
//   {"console": "give TestBot diamond 3"}             run a command from the server console
//   {"wait": 1000}
//   {"expectChat": "regex"}                           a chat/system message to the bot matching regex
//                                                     arrives (within "timeout" ms, default 5000)
//   {"expectLog": "regex"}                            server log line matching regex appears
//   {"expectInventory": "diamond_sword", "count": 1}  bot inventory contains item (>= count)
//   {"expectNoInventory": "dirt"}
//   {"expect": "bot.health === 20"}                   JS expression with `bot` (mineflayer) in scope
//   {"eval": "bot.entity.position"}                   value recorded in the report
//   {"rejoin": true}                                  bot disconnects and joins again (persistence)
//   {"restart": true}                                 restart the whole server (data saved to disk?)
// Messages received are kept in order, so expectChat sees messages that arrived after the previous step.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

const TOOLS = process.env.PROOFKIT_MC_TOOLS || [path.join(os.homedir(), '.proofkit-tools', 'mc'), path.join(os.homedir(), '.gemini', 'proofkit-tools', 'mc')]
  .find(d => fs.existsSync(d)) || path.join(os.homedir(), '.proofkit-tools', 'mc');   // set up by: node install.mjs --with-minecraft
const require = createRequire(path.join(TOOLS, 'package.json'));
let mineflayer;
try { mineflayer = require('mineflayer'); } catch {
  console.error(`mineflayer missing. Install once:  npm i mineflayer@4.39.0 --prefix ${TOOLS}`); process.exit(2);
}

const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
const JAR = opt('jar'), STEPS = opt('steps'), VERSION = opt('version', '1.21.11');
const OUT = path.resolve(opt('out', '.proof/mc')), PORT = Number(opt('port', 25599)), BOT = opt('bot', 'TestBot');
const extraJars = (opt('with', '') || '').split(',').filter(Boolean);   // dependency plugins
if (!JAR || !fs.existsSync(JAR)) { console.error(`--jar <plugin.jar> required (got ${JAR}); build the plugin first`); process.exit(2); }
const steps = STEPS ? JSON.parse(fs.readFileSync(STEPS, 'utf8')) : [];
const paper = path.join(TOOLS, `paper-${VERSION}.jar`);
if (!fs.existsSync(paper)) {
  console.error(`No cached server ${paper}. Download it once:\n  node -e "fetch('https://fill.papermc.io/v3/projects/paper/versions/${VERSION}/builds').then(r=>r.json()).then(b=>console.log(b.find(x=>x.channel==='STABLE').downloads['server:default'].url))"\n  then: curl -L -o ${paper} <url>`);
  process.exit(2);
}

// ---- prepare server dir ---------------------------------------------------
const SRV = path.join(OUT, 'server');
fs.rmSync(SRV, { recursive: true, force: true });
fs.mkdirSync(path.join(SRV, 'plugins'), { recursive: true });
fs.copyFileSync(paper, path.join(SRV, 'paper.jar'));
fs.writeFileSync(path.join(SRV, 'eula.txt'), 'eula=true\n');
fs.writeFileSync(path.join(SRV, 'server.properties'), [
  'online-mode=false', `server-port=${PORT}`, 'level-type=minecraft\\:flat', 'spawn-protection=0',
  'generator-settings={"layers"\\:[{"block"\\:"minecraft\\:bedrock","height"\\:1},{"block"\\:"minecraft\\:dirt","height"\\:2},{"block"\\:"minecraft\\:grass_block","height"\\:1}],"biome"\\:"minecraft\\:plains"}',
  'view-distance=4', 'simulation-distance=4', 'max-players=5', 'motd=proofkit-test', 'enable-command-block=true',
  'difficulty=peaceful', 'spawn-monsters=false', 'generate-structures=false'].join('\n'));
const offlineUuid = name => { const h = crypto.createHash('md5').update('OfflinePlayer:' + name).digest(); h[6] = (h[6] & 0x0f) | 0x30; h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.toString('hex'); return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`; };
fs.writeFileSync(path.join(SRV, 'ops.json'), JSON.stringify([{ uuid: offlineUuid(BOT), name: BOT, level: 4, bypassesPlayerLimit: true }]));
const pluginFile = path.join(SRV, 'plugins', path.basename(JAR));
fs.copyFileSync(JAR, pluginFile);
for (const j of extraJars) fs.copyFileSync(j, path.join(SRV, 'plugins', path.basename(j)));

const results = [], problems = [];
const log = [];
let server, logWaiters = [];
const pass = (name, ok, extra = '') => { results.push({ name, ok, extra }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };

function startServer() {
  return new Promise((resolve, reject) => {
    server = spawn('java', ['-Xms512M', '-Xmx2G', '-Dfile.encoding=UTF-8', '-Dstdout.encoding=UTF-8', '-Dstderr.encoding=UTF-8',
      '-jar', 'paper.jar', '--nogui'], { cwd: SRV });
    server.stdout.setEncoding('utf8'); server.stderr.setEncoding('utf8');
    const onLine = line => {
      log.push(line); fs.appendFileSync(path.join(OUT, 'server.log'), line + '\n');
      logWaiters = logWaiters.filter(w => (w.re.test(line) ? (w.res(line), false) : true));
      if (/Done \(/.test(line)) resolve();
    };
    let buf = '';
    const feed = d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i).replace(/\r$/, '')); buf = buf.slice(i + 1); } };
    server.stdout.on('data', feed); server.stderr.on('data', feed);
    server.on('exit', c => reject(new Error('server exited early, code ' + c)));
    setTimeout(() => reject(new Error('server did not finish starting in 180 s')), 180000);
  });
}
const consoleCmd = c => server.stdin.write(c.replace(/^\//, '') + '\n');
const waitLog = (re, ms) => {
  const hit = log.find(l => re.test(l)); if (hit) return Promise.resolve(hit);
  return new Promise((res, rej) => { const w = { re, res }; logWaiters.push(w); setTimeout(() => { logWaiters = logWaiters.filter(x => x !== w); rej(new Error('timeout')); }, ms); });
};
async function stopServer() {
  if (!server || server.exitCode !== null) return;
  consoleCmd('stop');
  await new Promise(r => { server.once('exit', r); setTimeout(() => { server.kill(); r(); }, 30000); });
}

let bot, chat = [];
function joinBot() {
  return new Promise((resolve, reject) => {
    bot = mineflayer.createBot({ host: '127.0.0.1', port: PORT, username: BOT, version: VERSION, auth: 'offline' });
    bot.on('messagestr', (m) => { chat.push(m); fs.appendFileSync(path.join(OUT, 'chat.log'), m + '\n'); });
    bot.once('spawn', () => setTimeout(resolve, 1500));
    bot.once('kicked', r => reject(new Error('kicked: ' + JSON.stringify(r))));
    bot.once('error', reject);
    setTimeout(() => reject(new Error('bot could not join in 30 s')), 30000);
  });
}
const leaveBot = () => new Promise(r => { if (!bot) return r(); bot.once('end', r); bot.quit(); setTimeout(r, 3000); });
const countItem = name => bot.inventory.items().filter(i => i.name === name).reduce((s, i) => s + i.count, 0);

fs.mkdirSync(OUT, { recursive: true });
for (const f of ['server.log', 'chat.log']) fs.rmSync(path.join(OUT, f), { force: true });
let exitCode = 1;
try {
  console.log(`Starting Paper ${VERSION} with ${path.basename(JAR)} on port ${PORT} …`);
  await startServer();
  pass('server started', true);
  const enable = log.find(l => /\]: \[[^\]]+\] Enabling \S+ v/i.test(l));   // "[MyPlugin] Enabling MyPlugin v1.0"
  pass('plugin enabled', !!enable, enable ? enable.replace(/^.*\]: /, '') : 'no "Enabling <plugin>" line in log — plugin.yml/main class wrong?');
  await joinBot();
  pass(`bot ${BOT} joined`, true);

  for (const [i, s] of steps.entries()) {
    const name = s.name || JSON.stringify(s).slice(0, 70);
    const seen = chat.length;
    try {
      if (s.restart) { await leaveBot(); await stopServer(); log.length = 0; await startServer(); await joinBot(); }
      if (s.rejoin) { await leaveBot(); await joinBot(); }
      if (s.console) consoleCmd(s.console);
      if (s.chat) bot.chat(s.chat);
      // eval is an ACTION (click a GUI slot, move, use item…): run it before waiting/expectations
      let value;
      if (s.eval) value = await (new Function('bot', `return (${s.eval})`))(bot);
      if (s.wait) await new Promise(r => setTimeout(r, s.wait));
      const T = s.timeout || 5000;
      if (s.expectChat) {
        const re = new RegExp(s.expectChat, 'i'); const t0 = Date.now();
        while (!chat.slice(seen).some(m => re.test(m)) && Date.now() - t0 < T) await new Promise(r => setTimeout(r, 100));
        if (!chat.slice(seen).some(m => re.test(m))) throw new Error(`no chat matching /${s.expectChat}/ — got: ${JSON.stringify(chat.slice(seen).slice(-5))}`);
      }
      if (s.expectLog) await waitLog(new RegExp(s.expectLog, 'i'), T).catch(() => { throw new Error(`no server log line matching /${s.expectLog}/`); });
      if (s.expectInventory) {
        const t0 = Date.now(); while (countItem(s.expectInventory) < (s.count || 1) && Date.now() - t0 < T) await new Promise(r => setTimeout(r, 100));
        const n = countItem(s.expectInventory); if (n < (s.count || 1)) throw new Error(`inventory has ${n}× ${s.expectInventory}, wanted ≥ ${s.count || 1}; items: ${bot.inventory.items().map(x => x.name + '×' + x.count).join(', ') || 'none'}`);
      }
      if (s.expectNoInventory && countItem(s.expectNoInventory) > 0) throw new Error(`inventory still has ${s.expectNoInventory}`);
      if (s.expect &&!(await (new Function('bot', `return (${s.expect})`))(bot))) throw new Error(`expectation false: ${s.expect}`);
      pass(`step ${i}: ${name}`, true, value !== undefined ? 'value=' + JSON.stringify(value) : '');
    } catch (e) {
      pass(`step ${i}: ${name}`, false, String(e.message).slice(0, 300));
    }
  }
} catch (e) {
  pass('run', false, String(e.message));
} finally {
  await leaveBot().catch(() => {});
  await stopServer().catch(() => {});
  const pluginName = path.basename(JAR).replace(/(-\d.*)?\.jar$/i, '');
  for (const l of log) {
    if (/\b(ERROR|SEVERE)\b|Exception|Could not load|Error occurred while enabling|Caused by:/.test(l)) problems.push(l.slice(0, 300));
  }
  if (problems.length) { console.log(`\nSERVER LOG PROBLEMS (${problems.length}):`); for (const p of problems.slice(0, 25)) console.log('  ' + p); }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ results, problems, chat }, null, 2));
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed, ${problems.length} server log problem(s). Logs: ${OUT}\\server.log, chat.log, report.json`);
  exitCode = failed || problems.length ? 1 : 0;
  process.exit(exitCode);
}
