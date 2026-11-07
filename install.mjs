#!/usr/bin/env node
// proofkit installer.
//
//   node install.mjs                         # Antigravity 2.0 / agy CLI (full plugin: rules, skills, hooks, reviewer)
//   node install.mjs --agent opencode        # OpenCode (full: skills, rules, playtester subagent, lifecycle plugin)
//   node install.mjs --agent claude          # Claude Code  (skills -> ~/.claude/skills)
//   node install.mjs --agent agents          # Codex CLI, Gemini CLI (skills -> ~/.agents/skills)
//   node install.mjs --agent all             # all of the above
// Options:
//   --rules            also add the always-on rules to the agent's global instructions file
//                      (CLAUDE.md / AGENTS.md / GEMINI.md), inside a marked block that re-installs replace
//   --with-minecraft   download the Paper test server + mineflayer bot for Minecraft plugin tests (~150 MB)
//   --dir <path>       custom install folder for the Antigravity plugin
//   --dry-run          only print what would be done
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SRC = path.dirname(fileURLToPath(import.meta.url));
const HOME = os.homedir();
const argv = process.argv.slice(2);
const flag = k => argv.includes('--' + k);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const DRY = flag('dry-run');
const agent = opt('agent', 'antigravity');
const slash = p => p.split(path.sep).join('/');
const log = (...m) => console.log(...m);
const run = (cmd, cwd) => { log(`  $ ${cmd}`); if (!DRY) execSync(cmd, { cwd, stdio: 'inherit' }); };

const TEXT = /\.(md|mjs|js|json|py|txt)$/i;
const SKIP = new Set(['.git', 'node_modules', '.proof', 'docs', 'install.mjs', 'README.md', 'NOTES.local.md', '.gitignore', 'LICENSE', 'opencode']);

// copy a tree, replacing {{PROOFKIT_DIR}} in text files
function copyTree(from, to, root) {
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (from === SRC && SKIP.has(e.name)) continue;
    if (e.name === 'node_modules') continue;
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) { if (!DRY) fs.mkdirSync(b, { recursive: true }); copyTree(a, b, root); continue; }
    if (DRY) continue;
    if (TEXT.test(e.name)) fs.writeFileSync(b, fs.readFileSync(a, 'utf8').replaceAll('{{PROOFKIT_DIR}}', root));
    else fs.copyFileSync(a, b);
  }
}

// remove everything in dir except node_modules (dir must be one we own)
function clean(dir, mustEndWith) {
  if (!fs.existsSync(dir)) return;
  if (!dir.replace(/[\\/]+$/, '').endsWith(mustEndWith)) throw new Error(`refusing to clean ${dir}`);
  for (const e of fs.readdirSync(dir)) if (e !== 'node_modules' && !DRY) fs.rmSync(path.join(dir, e), { recursive: true, force: true });
}

function upsertRules(file, label) {
  const rules = fs.readFileSync(path.join(SRC, 'rules', 'AGENTS.md'), 'utf8');
  const block = `<!-- proofkit:start -->\n${rules.trim()}\n<!-- proofkit:end -->`;
  const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const next = /<!-- proofkit:start -->[\s\S]*?<!-- proofkit:end -->/.test(old)
    ? old.replace(/<!-- proofkit:start -->[\s\S]*?<!-- proofkit:end -->/, block)
    : (old.trim() ? old.trimEnd() + '\n\n' : '') + block + '\n';
  log(`  rules -> ${file} (${label})`);
  if (!DRY) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, next); }
}

function installAntigravity() {
  const dir = path.resolve(opt('dir', path.join(HOME, '.gemini', 'config', 'plugins', 'proofkit')));
  log(`\n▶ Antigravity plugin -> ${dir}`);
  clean(dir, 'proofkit');
  if (!DRY) fs.mkdirSync(dir, { recursive: true });
  copyTree(SRC, dir, slash(dir));
  run('npm install --omit=dev --no-audit --no-fund', dir);
  try { execSync('agy --version', { stdio: 'ignore' }); run('agy plugin validate .', dir); }
  catch { log('  (agy CLI not found — open Antigravity → Customizations to check that "proofkit" is enabled)'); }
  log('  Restart Antigravity so it picks up the plugin.');
}

// skills-only install for agents that read SKILL.md folders
function installSkills(skillsDir, label) {
  log(`\n▶ ${label}: skills -> ${skillsDir}`);
  const root = path.dirname(skillsDir);   // {{PROOFKIT_DIR}}/skills/... must resolve to skillsDir/...
  for (const name of fs.readdirSync(path.join(SRC, 'skills'), { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const to = path.join(skillsDir, name.name);
    clean(to, name.name);
    if (!DRY) fs.mkdirSync(to, { recursive: true });
    copyTree(path.join(SRC, 'skills', name.name), to, slash(root));
    log(`  + ${name.name}`);
  }
  // the browser tools need playwright-core next to proof-verify
  const pv = path.join(skillsDir, 'proof-verify');
  if (!DRY && !fs.existsSync(path.join(pv, 'package.json'))) fs.writeFileSync(path.join(pv, 'package.json'), JSON.stringify({ private: true, type: 'module' }, null, 2));
  run('npm install playwright-core@1.56.1 --no-audit --no-fund', pv);
}

// ---------- OpenCode: skills + rules + playtester subagent + lifecycle plugin ----------
// The source text names Antigravity's tools; OpenCode has bash/read/grep/glob/write/edit/task/skill.
function forOpenCode(text) {
  return text
    .replace(/`invoke_subagent`,? (?:with )?TypeName\s+`playtester`(?:, Role\s+"[^"]*")?(, and a Prompt)?/g,
      (m, p) => 'the `task` tool with subagent_type `playtester`' + (p ? ' and a prompt' : ''))
    .replace(/\(invoke_subagent, TypeName "playtester", Role\s*` \+\s*`"Independent QA Playtester"\)/g, '(task tool, subagent_type "playtester")')
    .replace(/\(invoke_subagent, TypeName "playtester", Role "Independent QA Playtester"\)/g, '(task tool, subagent_type "playtester")')
    .replace(/`invoke_subagent` one builder per part/g, 'start one builder per part with the `task` tool,')
    .replace(/`invoke_subagent`/g, 'the `task` tool')
    .replace(/After invoking, wait for its message — do not poll `manage_subagents` more often than every 2 min\./g,
      'The task tool returns the verdict when the review is done.')
    .replace(/Wait for its message\./g, 'The task tool returns its verdict.')
    .replace(/\(`ask_question`\)/g, '(your `question` tool if you have it, otherwise a short numbered list in your reply — then stop and wait)')
    .replace(/with `ask_question`/g, 'in your reply')
    .replace(/your `grep_search` tool/g, 'your `grep` tool')
    .replace(/\bgrep_search\b/g, 'grep')
    .replace(/\bview_file\b/g, 'read')
    .replace(/\blist_dir\b/g, 'glob')
    .replace(/\bwrite_to_file\b/g, 'write')
    .replace(/\brun_command\b/g, 'bash')
    .replace(/ with Test-Path/g, '');
}

function copyTreeOpenCode(from, to, root) {
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) { if (!DRY) fs.mkdirSync(b, { recursive: true }); copyTreeOpenCode(a, b, root); continue; }
    if (DRY) continue;
    if (/\.md$/i.test(e.name)) {
      let t = fs.readFileSync(a, 'utf8').replaceAll('{{PROOFKIT_DIR}}', root);
      if (e.name === 'SKILL.md' && /## Running commands on this machine/.test(t)) {
        const sec = fs.readFileSync(path.join(SRC, 'opencode', 'running-commands.md'), 'utf8');
        t = t.replace(/## Running commands on this machine[\s\S]*?(?=\n## )/, sec.trimEnd() + '\n');
      }
      fs.writeFileSync(b, forOpenCode(t));
    } else if (TEXT.test(e.name)) fs.writeFileSync(b, fs.readFileSync(a, 'utf8').replaceAll('{{PROOFKIT_DIR}}', root));
    else fs.copyFileSync(a, b);
  }
}

function installOpenCode() {
  const base = path.join(HOME, '.config', 'opencode');
  const root = slash(base);   // {{PROOFKIT_DIR}}/skills/... -> ~/.config/opencode/skills/...
  log(`\n▶ OpenCode -> ${base}`);
  // skills
  for (const name of fs.readdirSync(path.join(SRC, 'skills'), { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const to = path.join(base, 'skills', name.name);
    clean(to, name.name);
    if (!DRY) fs.mkdirSync(to, { recursive: true });
    copyTreeOpenCode(path.join(SRC, 'skills', name.name), to, root);
    log(`  + skill ${name.name}`);
  }
  const pv = path.join(base, 'skills', 'proof-verify');
  if (!DRY && !fs.existsSync(path.join(pv, 'package.json'))) fs.writeFileSync(path.join(pv, 'package.json'), JSON.stringify({ private: true, type: 'module' }, null, 2));
  run('npm install playwright-core@1.56.1 --no-audit --no-fund', pv);
  // gate (shared lifecycle logic) -> ~/.config/opencode/proofkit/
  const gdir = path.join(base, 'proofkit');
  clean(gdir, 'proofkit');
  if (!DRY) {
    fs.mkdirSync(gdir, { recursive: true });
    for (const f of ['gate.mjs', 'run_with_env.mjs'])
      fs.writeFileSync(path.join(gdir, f), forOpenCode(fs.readFileSync(path.join(SRC, 'scripts', f), 'utf8').replaceAll('{{PROOFKIT_DIR}}', root)));
  }
  log(`  + gate -> ${gdir}`);
  // plugin
  const plugin = path.join(base, 'plugins', 'proofkit.js');
  if (!DRY) { fs.mkdirSync(path.dirname(plugin), { recursive: true }); fs.writeFileSync(plugin, fs.readFileSync(path.join(SRC, 'opencode', 'proofkit.js'), 'utf8').replaceAll('{{PROOFKIT_DIR}}', root)); }
  log(`  + plugin -> ${plugin}`);
  // playtester subagent: OpenCode frontmatter + the shared body
  const src = fs.readFileSync(path.join(SRC, 'agents', 'playtester.md'), 'utf8');
  const desc = (src.match(/^description:\s*(.+)$/m) || [])[1] || 'Independent QA playtester';
  const body = src.replace(/^---[\s\S]*?\n---\r?\n/, '');
  const agentFile = path.join(base, 'agents', 'playtester.md');
  if (!DRY) {
    fs.mkdirSync(path.dirname(agentFile), { recursive: true });
    fs.writeFileSync(agentFile, `---\ndescription: ${JSON.stringify(desc)}\nmode: subagent\n---\n` + forOpenCode(body.replaceAll('{{PROOFKIT_DIR}}', root)));
  }
  log(`  + agent -> ${agentFile}`);
  // always-on rules
  const rulesFile = path.join(base, 'AGENTS.md');
  const rules = forOpenCode(fs.readFileSync(path.join(SRC, 'rules', 'AGENTS.md'), 'utf8').replaceAll('{{PROOFKIT_DIR}}', root));
  const block = `<!-- proofkit:start -->\n${rules.trim()}\n<!-- proofkit:end -->`;
  const old = fs.existsSync(rulesFile) ? fs.readFileSync(rulesFile, 'utf8') : '';
  const next = /<!-- proofkit:start -->[\s\S]*?<!-- proofkit:end -->/.test(old)
    ? old.replace(/<!-- proofkit:start -->[\s\S]*?<!-- proofkit:end -->/, block)
    : (old.trim() ? old.trimEnd() + '\n\n' : '') + block + '\n';
  if (!DRY) fs.writeFileSync(rulesFile, next);
  log(`  rules -> ${rulesFile}`);
  // duplicates of the same skills in ~/.agents/skills or ~/.claude/skills would be loaded twice
  for (const d of [path.join(HOME, '.agents', 'skills', 'proof-verify'), path.join(HOME, '.claude', 'skills', 'proof-verify')])
    if (fs.existsSync(d)) log(`  note: ${d} also exists — OpenCode reads it too; remove it if you see the skill twice.`);
  log('  Restart OpenCode so it picks up the plugin.');
}

async function installMinecraft() {
  const dir = process.env.PROOFKIT_MC_TOOLS || path.join(HOME, '.proofkit-tools', 'mc');
  log(`\n▶ Minecraft test tools -> ${dir}`);
  if (!DRY) fs.mkdirSync(dir, { recursive: true });
  if (!DRY && !fs.existsSync(path.join(dir, 'package.json'))) fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ private: true }, null, 2));
  run('npm install mineflayer@4.39.0 --no-audit --no-fund', dir);
  const version = opt('mc-version', '1.21.11'), jar = path.join(dir, `paper-${version}.jar`);
  if (fs.existsSync(jar)) { log(`  paper ${version} already present`); return; }
  const meta = await (await fetch(`https://fill.papermc.io/v3/projects/paper/versions/${version}/builds/latest`)).json();
  const d = meta.downloads['server:default'];
  log(`  downloading ${d.name} (${Math.round(d.size / 1048576)} MB)`);
  if (DRY) return;
  const buf = Buffer.from(await (await fetch(d.url)).arrayBuffer());
  if (crypto.createHash('sha256').update(buf).digest('hex') !== d.checksums.sha256) throw new Error('paper jar checksum mismatch');
  fs.writeFileSync(jar, buf);
}

try {
  const targets = agent === 'all' ? ['antigravity', 'claude', 'agents'] : [agent];
  for (const t of targets) {
    if (t === 'antigravity') installAntigravity();
    else if (t === 'opencode') installOpenCode();
    else if (t === 'claude') {
      installSkills(path.join(HOME, '.claude', 'skills'), 'Claude Code');
      if (flag('rules')) upsertRules(path.join(HOME, '.claude', 'CLAUDE.md'), 'Claude Code');
    } else if (t === 'agents') {
      installSkills(path.join(HOME, '.agents', 'skills'), 'Codex / OpenCode / Gemini CLI');
      if (flag('rules')) {
        upsertRules(path.join(HOME, '.codex', 'AGENTS.md'), 'Codex');
        upsertRules(path.join(HOME, '.config', 'opencode', 'AGENTS.md'), 'OpenCode');
        upsertRules(path.join(HOME, '.gemini', 'GEMINI.md'), 'Gemini CLI');
      }
    } else throw new Error(`unknown --agent ${t} (use antigravity | opencode | claude | agents | all)`);
  }
  if (flag('with-minecraft')) await installMinecraft();
  log('\n✔ proofkit installed.' + (DRY ? ' (dry run — nothing was written)' : ''));
} catch (e) {
  console.error(`\n✖ ${e.message}`);
  process.exit(1);
}
