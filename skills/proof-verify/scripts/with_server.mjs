#!/usr/bin/env node
// with_server.mjs — start a server, run ONE command against it, then stop the server (whole process tree)
// and exit. Use this instead of spawning a server inside your own test script: on Windows
// `child.kill()` only kills the cmd.exe/npx wrapper, the real server keeps running, your script never
// exits and the background task "runs" forever.
//
//   node with_server.mjs --serve "npx vite preview --port 5577 --strictPort" --cwd app --port 5577 -- node .proof/tmp/snap.mjs
//   node with_server.mjs --serve "npm run dev -- --port 5173" --cwd app --port 5173 -- node <proofkit>/skills/proof-verify/scripts/ui_probe.mjs --url http://localhost:5173 ...
//
// Options:
//   --serve "<cmd>"   the server command (one string)
//   --cwd <dir>       folder to start the server in (default: current)
//   --port <n>        port to wait for before running the command (required)
//   --wait <s>        max seconds to wait for the port (default 90)
//   --timeout <s>     hard limit for the whole run, then everything is killed (default 600)
// Everything after `--` is the command to run. Exit code = that command's exit code (124 on timeout,
// 3 if the server never started — its last output is printed).
import { spawn, execFileSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
const own = sep >= 0 ? argv.slice(0, sep) : argv;
const inner = sep >= 0 ? argv.slice(sep + 1) : [];
const opt = (k, d) => { const i = own.indexOf('--' + k); return i >= 0 && own[i + 1] !== undefined ? own[i + 1] : d; };
const SERVE = opt('serve'), PORT = Number(opt('port')), CWD = path.resolve(opt('cwd', '.'));
const WAIT = Number(opt('wait', 90)), TIMEOUT = Number(opt('timeout', 600));
if (!SERVE || !PORT || !inner.length) {
  console.error('usage: node with_server.mjs --serve "<server cmd>" --port <n> [--cwd dir] [--wait s] [--timeout s] -- <command> [args]');
  process.exit(2);
}

const win = process.platform === 'win32';
const killTree = (child) => {
  if (!child || child.exitCode !== null || !child.pid) return;
  try {
    if (win) execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGKILL');
  } catch {}
};
const portOpen = () => new Promise(r => {
  const s = net.connect({ port: PORT, host: '127.0.0.1' }, () => { s.destroy(); r(true); });
  s.on('error', () => { s.destroy(); r(false); });
  s.setTimeout(1500, () => { s.destroy(); r(false); });
});

let server, cmd, tail = '';
const finish = (code, msg) => {
  if (msg) console.log(msg);
  killTree(cmd); killTree(server);
  process.exit(code);
};
setTimeout(() => finish(124, `[with_server] TIMEOUT after ${TIMEOUT}s — killed the server and the command.`), TIMEOUT * 1000).unref();
process.on('SIGINT', () => finish(130));

if (await portOpen()) finish(3, `[with_server] port ${PORT} is already in use — pick a free port (or stop the old server).`);
console.log(`[with_server] starting: ${SERVE}  (in ${CWD})`);
server = spawn(SERVE, { cwd: CWD, shell: true, detached: !win, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
const keep = d => { tail = (tail + d).slice(-2000); };
server.stdout.on('data', keep); server.stderr.on('data', keep);
server.on('exit', c => { if (!started) finish(3, `[with_server] server exited (code ${c}) before port ${PORT} opened. Last output:\n${tail}`); });

let started = false;
for (let t = 0; t < WAIT * 2 && !started; t++) { started = await portOpen(); if (!started) await new Promise(r => setTimeout(r, 500)); }
if (!started) finish(3, `[with_server] port ${PORT} did not open within ${WAIT}s. Last server output:\n${tail}`);
console.log(`[with_server] server is up on port ${PORT}; running: ${inner.join(' ')}`);

// node/python run directly (args with spaces stay intact); npm/npx-style .cmd shims need a shell on Windows
const needShell = win && !/^(node|python3?|py)(\.exe)?$/i.test(path.basename(inner[0]));
const q = s => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);
cmd = needShell
  ? spawn(inner.map(q).join(' '), { stdio: 'inherit', shell: true, windowsHide: true })
  : spawn(inner[0] === 'node' ? process.execPath : inner[0], inner.slice(1), { stdio: 'inherit', windowsHide: true });
cmd.on('exit', c => finish(c ?? 1, `[with_server] command exited with code ${c}; server stopped.`));
