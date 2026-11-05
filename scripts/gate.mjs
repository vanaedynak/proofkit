#!/usr/bin/env node
// Proofkit lifecycle hook.
//   node gate.mjs session-start   -> remembers when the conversation started
//   node gate.mjs stop            -> blocks finishing while source files changed in this
//                                    conversation are newer than .proof/report.md
// Reads the hook payload (JSON) from stdin, prints a JSON decision to stdout. Never throws:
// any internal error lets the agent stop normally.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MAX_BLOCKS = 3;
const MAP_TEMPLATE = fileURLToPath(new URL('../skills/proof-verify/references/project-map.md', import.meta.url)).split(path.sep).join('/');
const SKIP_DIRS = new Set(['node_modules', '.git', '.proof', 'dist', 'build', 'out', '.next', '.nuxt', '.venv', 'venv',
  '__pycache__', 'target', '.gradle', '.idea', '.vscode', '.cache', 'coverage', '.agents', '.agent', 'fixtures']);
const SOURCE_EXT = /\.(html?|css|scss|sass|less|m?[jt]sx?|cjs|vue|svelte|py|java|kt|kts|gradle|lua|luau|rs|go|cs|cpp|cc|c|h|hpp|swift|dart|rb|php|ya?ml|toml|json|sql|sh|ps1|bat|glsl|wgsl|shader)$/i;
const STATE_DIR = path.join(os.tmpdir(), 'proofkit');

const mode = process.argv[2];
let out = {};
try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const stateFile = path.join(STATE_DIR, `${(input.conversationId || 'unknown').replace(/[^\w-]/g, '')}.json`);
  const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};

  if (mode === 'session-start') {
    state.start ??= Date.now();
    out = sessionStart(input, state);
    fs.writeFileSync(stateFile, JSON.stringify(state));
  } else if (mode === 'pretool') {
    out = pretool(input);
  } else if (mode === 'stop') {
    out = stop(input, state);
    fs.writeFileSync(stateFile, JSON.stringify(state));
  }
} catch (e) {
  out = {};
}
process.stdout.write(JSON.stringify(out));

// An existing project (≥ 20 source files) gets its project map injected at the start, so the agent knows
// the product before touching it — or is told to write the map first if there is none yet.
function sessionStart(input, state) {
  const ws = (input.workspacePaths || [])[0];
  if (!ws || !fs.existsSync(ws)) return {};
  const files = [];
  walk(ws, 0, files, 0);
  state.existingProject = files.length >= 20;
  if (!state.existingProject) return {};
  const map = path.join(ws, '.proof', 'project-map.md');
  let text;
  if (fs.existsSync(map)) {
    const body = fs.readFileSync(map, 'utf8');
    const age = Math.round((Date.now() - fs.statSync(map).mtimeMs) / 86400000);
    text = `[proofkit] PROJECT MAP of this workspace (.proof/project-map.md, updated ${age} day(s) ago). ` +
      `Use it to understand the product and to jump straight to the right files. If something in it turns ` +
      `out to be wrong or outdated, or your change adds a screen/module, update the map at the end.\n\n` +
      body.slice(0, 12000) + (body.length > 12000 ? '\n…(truncated — read the full file if needed)' : '');
  } else {
    text = `[proofkit] This is an EXISTING project (${files.length >= 2000 ? '2000+' : files.length} source files) with no project ` +
      `map yet. Before changing anything (unless the user only asks a question), spend 5–8 minutes building ` +
      `.proof/project-map.md following the template ${MAP_TEMPLATE} — it is reused by every future task, so ` +
      `later fixes start instantly. Then do the task.`;
  }
  // lessons learned in this project and an unfinished plan travel with the map
  const lessons = path.join(ws, '.proof', 'lessons.md');
  if (fs.existsSync(lessons)) text += `

[proofkit] LESSONS from earlier tasks in this project (.proof/lessons.md) — obey them:
` + fs.readFileSync(lessons, 'utf8').slice(-4000);
  const plan = path.join(ws, '.proof', 'plan.md');
  if (fs.existsSync(plan)) {
    const p = fs.readFileSync(plan, 'utf8');
    if (/\[ \]/.test(p)) text += `

[proofkit] An UNFINISHED PLAN exists (.proof/plan.md). If the user's request continues that work, resume from the first open milestone:
` + p.slice(0, 3000);
  }
  return { injectSteps: [{ systemMessage: { systemMessage: text } }] };
}

function stop(input, state) {
  if (input.terminationReason && input.terminationReason !== 'NO_TOOL_CALL') return {};
  const ws = (input.workspacePaths || [])[0];
  if (!ws || !fs.existsSync(ws)) return {};

  if (!state.start) {
    // No SessionStart record: fall back to the transcript's creation time.
    try { state.start = fs.statSync(input.transcriptPath).birthtimeMs; } catch { return {}; }
  }

  const changed = [];
  walk(ws, 0, changed, state.start);
  if (!changed.length) return {};             // nothing built/edited -> Q&A turn, let it stop
  if (state.existingProject && !state.askedMap && !fs.existsSync(path.join(ws, '.proof', 'project-map.md'))) {
    state.askedMap = true;
    return {
      decision: 'continue',
      reason: `[proofkit stop-gate] This existing project still has no .proof/project-map.md. Write it now from what you ` +
        `learned (template: ${MAP_TEMPLATE}) so the next task starts with full context, then finish.`,
    };
  }
  const newest = Math.max(...changed.map(c => c.mtime));

  const report = path.join(ws, '.proof', 'report.md');
  const reportTime = fs.existsSync(report) ? fs.statSync(report).mtimeMs : 0;
  if (reportTime >= newest - 1000) {
    // Report is fresh. If screenshots were taken, make sure the agent actually looked at them.
    const reportText = fs.readFileSync(report, 'utf8');
    const size = (reportText.match(/^\s*\**Size\**\s*:\s*\**\s*([SML])\b/im) || [])[1];
    // Size S: the fix must stay small (native solution first) and must not touch unrelated files.
    if (size === 'S' && !state.askedBudget) {
      const d = gitDiff(ws);
      const noisy = d.files.filter(f => /(^|\/)(generated|dist|build)\/|lock\.(json|yaml)$|\.lock$|\.min\./i.test(f));
      const justified = /why (it is |this is )?(bigger|larger|more than)|bigger fix because|native (option|solution) (does not|doesn't|is not)/i.test(reportText);
      if ((d.lines > 40 && !justified) || noisy.length) {
        state.askedBudget = true;
        return {
          decision: 'continue',
          reason: `[proofkit stop-gate] This is a size-S task but ` +
            (d.lines > 40 && !justified ? `the diff is ${d.lines} changed lines (budget ~20, hard stop 30). Re-check for a native 1–5 line ` +
              `solution (platform/plugin API, CSS property, component prop, existing helper; look it up with npx ctx7@latest or web search). ` +
              `If you find one, replace your change with it and re-verify. If not, add a "Why it is bigger" line to .proof/report.md. ` : '') +
            (noisy.length ? `You changed unrelated/generated files: ${noisy.join(', ')} — restore them (git checkout -- <file>) unless the fix needs them. ` : '') +
            `Then finish.`,
        };
      }
    }
    const shots = listPngs(path.join(ws, '.proof'));
    if (!shots.length || viewedPng(input.transcriptPath) !== false) {
      // Size L (or a big unsized change) also needs the independent playtester review.
      const needsReview = size === 'L' || (!size && changed.length >= 5);
      if (!needsReview || fs.existsSync(path.join(ws, '.proof', 'review.md')) || state.askedReview) return {};
      state.askedReview = true;
      return {
        decision: 'continue',
        reason: `[proofkit stop-gate] You changed ${changed.length} source files but there is no .proof/review.md. ` +
          `Before finishing, invoke the playtester subagent (invoke_subagent, TypeName "playtester", Role ` +
          `"Independent QA Playtester") with the user's ORIGINAL request verbatim, the project path and how to ` +
          `launch it. Wait for its verdict, fix every BLOCKER/MAJOR, re-verify, update .proof/report.md, then answer.`,
      };
    }
    state.blocks = (state.blocks || 0) + 1;
    if (state.blocks > MAX_BLOCKS) return {};
    return {
      decision: 'continue',
      reason: `[proofkit stop-gate ${state.blocks}/${MAX_BLOCKS}] Your verification produced ${shots.length} screenshot(s) ` +
        `(${shots.slice(0, 6).join(', ')}) but you never opened any of them, so "reviewed screenshots" is not true yet. ` +
        `Open the key screenshots now with view_file (every viewport + every screen/state), go through the ` +
        `Visual review checklist in the proof-verify skill (scale, empty gaps, overlap, cut-off text, device-appropriate ` +
        `controls, fake data), fix every defect you see, re-run the probe, and add a "## Visual review" section to ` +
        `.proof/report.md with one line per screenshot describing what you saw. Then give your final answer.`,
    };
  }

  state.blocks = (state.blocks || 0) + 1;
  if (state.blocks > MAX_BLOCKS) return {};   // don't loop forever

  const files = changed.sort((a, b) => b.mtime - a.mtime).slice(0, 8).map(c => path.relative(ws, c.file)).join(', ');
  const why = reportTime
    ? `You edited files (${files}) AFTER writing .proof/report.md, so its evidence is stale.`
    : `You changed ${changed.length} source file(s) (${files}) in this task but there is no .proof/report.md.`;
  return {
    decision: 'continue',
    reason: `[proofkit stop-gate ${state.blocks}/${MAX_BLOCKS}] ${why} Do not finish yet. ` +
      `Follow the proof-verify skill: launch the result, exercise every requirement from the user's request ` +
      `(for web UIs run ui_probe.mjs with --click-all and a --steps scenario, and view the screenshots), fix what ` +
      `fails, re-run, then write .proof/report.md (checklist with PASS/PARTIAL/FAIL/NOT RUN + evidence). ` +
      `If this was a trivial edit, a one-line report.md stating what you checked is enough. Then give your final answer.`,
  };
}

// Multi-line `python -c "…"` / `node -e "…"` and newline-separated command lists break on Windows
// (PowerShell quoting) and are refused by the permission checker. Rewrite them into an equivalent
// single-line command: inline code goes to a temp script file; plain command lists are joined with ';'.
// The decision stays "ask", so the normal permission rules still decide whether the command may run.
function pretool(input) {
  const cmd = input.toolCall?.args?.CommandLine;
  const ws = (input.workspacePaths || [])[0] || os.tmpdir();
  const tmp = path.join(ws, '.proof', 'tmp');
  // `$env:PORT="3000"; node server.mjs` → `node --env-file=<tmp> server.mjs` (only for node/npm/npx/python,
  // which are allowed anyway — the rewritten command still goes through the normal permission rules).
  const envm = typeof cmd === 'string' && !/\r?\n/.test(cmd.trim()) &&
    cmd.trim().match(/^((?:\$env:[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:"[^"]*"|'[^']*'|[^;\s]+)\s*;\s*)+)((node|npm|npx|python3?)\b.*)$/);
  if (envm && !/[&|;<>`]|\$\(/.test(envm[2])) {   // never rewrite if the tail could chain other commands
    const vars = [...envm[1].matchAll(/\$env:([A-Za-z_][A-Za-z0-9_]*)\s*=\s*("([^"]*)"|'([^']*)'|([^;\s]+))/g)]
      .map(v => `${v[1]}=${v[3] ?? v[4] ?? v[5]}`);
    fs.mkdirSync(tmp, { recursive: true });
    const envFile = path.join(tmp, `env_${Date.now()}.env`);
    fs.writeFileSync(envFile, vars.join('\n') + '\n');
    const rest = envm[2], tool = envm[3];
    let next;
    if (tool === 'node') next = rest.replace(/^node\b/, `node --env-file="${envFile}"`);
    else if (tool === 'npm' || tool === 'npx') next = `node --env-file="${envFile}" "${path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'run_with_env.mjs')}" ${rest}`;
    else next = rest.replace(/^python3?\b/, m => `node --env-file="${envFile}" "${path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'run_with_env.mjs')}" ${m}`);
    return { decision: 'ask', reason: 'proofkit: moved $env: assignments into an env file', overwrite: { CommandLine: next } };
  }
  if (typeof cmd !== 'string' || !/\r?\n/.test(cmd.trim())) return { decision: 'ask' };   // untouched: 'ask' = normal permission flow (an empty answer would DENY)
  const m = cmd.trim().match(/^(python3?|py|node)\s+(-c|-e)\s+(["'])([\s\S]*)\3\s*$/);
  // bash heredoc (does not exist in PowerShell):  python - <<'EOF' … EOF  /  blender -b -P - … <<'EOF' … EOF
  const hd = cmd.trim().match(/^((?:python3?|py|node|blender)\b[^\n<]*?)\s*<<-?\s*['"]?(\w+)['"]?\s*\r?\n([\s\S]*?)\r?\n\2\s*$/);
  if (hd && !/[&|;>`]|\$\(/.test(hd[1])) {
    const tool = hd[1].split(/\s+/)[0];
    fs.mkdirSync(tmp, { recursive: true });
    const file = path.join(tmp, `heredoc_${Date.now()}.${tool === 'node' ? 'cjs' : 'py'}`);
    fs.writeFileSync(file, hd[3]);
    let head = hd[1];
    if (tool === 'blender') head = /\s-P\s+-(?=\s|$)/.test(head) ? head.replace(/\s-P\s+-(?=\s|$)/, ` -P "${file}"`) : `${head} -P "${file}"`;
    else head = /\s-(?=\s|$)/.test(head) ? head.replace(/\s-(?=\s|$)/, ` "${file}"`) : `${head} "${file}"`;
    return { decision: 'ask', reason: 'proofkit: heredoc moved to a script file', overwrite: { CommandLine: head } };
  }
  // blender … --python-expr "<multi-line code>" …  →  blender … -P <file> …
  const bm = !m && cmd.trim().match(/^(blender\b[^"']*?)\s--python-expr\s+(["'])([\s\S]*?)\2(.*)$/);
  let next;
  if (bm && !/[&|;<>`]|\$\(/.test(bm[1] + bm[4])) {
    let code = bm[3];
    if (bm[2] === '"') code = code.replace(/`"/g, '"').replace(/\\"/g, '"');
    fs.mkdirSync(tmp, { recursive: true });
    const file = path.join(tmp, `inline_${Date.now()}.py`);
    fs.writeFileSync(file, code);
    const head = bm[1].replace(/\s-P\s+-(?=\s|$)/, '');   // drop a dangling "-P -"
    next = `${head} -P "${file}"${bm[4].replace(/\r?\n/g, ' ')}`;
  } else if (m) {
    const isPy = m[1] !== 'node';
    let code = m[4];
    if (m[3] === '"') code = code.replace(/`"/g, '"').replace(/\\"/g, '"');   // PowerShell / C-style escaped quotes
    fs.mkdirSync(tmp, { recursive: true });
    const file = path.join(tmp, `inline_${Date.now()}.${isPy ? 'py' : 'cjs'}`);
    fs.writeFileSync(file, code);
    next = `${isPy ? 'python' : 'node'} "${file}"`;
  } else if (!/[{}(]|@'|@"|<<|`$/.test(cmd)) {
    next = cmd.split(/\r?\n/).map(s => s.trim()).filter(Boolean).join('; ');
  } else {
    return { decision: 'ask' };
  }
  return { decision: 'ask', reason: 'proofkit: rewrote multi-line command to a single line', overwrite: { CommandLine: next } };
}

// Changed lines (added + deleted) and files in the working tree vs HEAD, ignoring .proof/. No git → zeros.
function gitDiff(ws) {
  try {
    const out = execFileSync('git', ['-C', ws, 'diff', 'HEAD', '--numstat', '--', '.', ':(exclude).proof'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
    let lines = 0; const files = [];
    for (const row of out.split('\n')) {
      const [a, d, f] = row.split('\t'); if (!f) continue;
      files.push(f); lines += (Number(a) || 0) + (Number(d) || 0);
    }
    return { lines, files };
  } catch { return { lines: 0, files: [] }; }
}

function listPngs(dir, depth = 0, acc = []) {
  if (depth > 3) return acc;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (e.isDirectory()) listPngs(path.join(dir, e.name), depth + 1, acc);
    else if (/\.png$/i.test(e.name)) acc.push(e.name);
  }
  return acc;
}

// true = a png was opened, false = none was, null = can't tell (no transcript) -> don't block.
function viewedPng(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return null;
  try {
    const text = fs.readFileSync(transcriptPath, 'utf8');
    return /"name":"(read_file|view_file|view_image)","args":\{[^}]*\.png/i.test(text);
  } catch { return null; }
}

function walk(dir, depth, acc, since) {
  if (depth > 8 || acc.length > 2000) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(p, depth + 1, acc, since);
    } else if (SOURCE_EXT.test(e.name) && !/^(package-lock|yarn\.lock|pnpm-lock)/.test(e.name)) {
      try { const m = fs.statSync(p).mtimeMs; if (m > since) acc.push({ file: p, mtime: m }); } catch {}
    }
  }
}
