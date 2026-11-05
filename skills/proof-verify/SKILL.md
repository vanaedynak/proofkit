---
name: proof-verify
description: >-
  Use this skill whenever you build, change or fix anything runnable — a web app, UI, game, player,
  desktop app, CLI, server, bot, Minecraft/Roblox plugin, 3D model in Blender, ML/image-generation
  pipeline, or anything built from a reference image/mockup — and BEFORE telling the user it is done.
  It gives ready-made tools to actually launch and exercise the result (real-browser UI probe with
  screenshots and scenarios, a real Minecraft test server with a bot player, Blender turnaround
  renders and a hinge/pivot rig check for animated parts, game playtesting with held keys, filmstrips
  and fps, reference-vs-result comparison) plus design-quality and per-project verification recipes. Use it also when the user reports "buttons don't work",
  "layout is broken", "it crashes".
---

# proof-verify — prove it works before you say it works

Writing code is half the job. The other half is **running the thing like the user will** and fixing
what is broken. The user has repeatedly received apps whose buttons did nothing, whose layout broke on
small screens, and which had obviously never been opened. Do not be that agent.

## The loop (sizes M and L — for a size-S fix use the fast path from the rules instead)

1. **Checklist first.** Before coding, write `.proof/checklist.md` in the project: one line per
   concrete, testable requirement from the user's request (split compound requests: "volume + mute" is
   two lines). Add implicit ones: "no console errors", "works at 375px width", "builds from clean".
2. **Build.**
3. **Launch and exercise** using the recipe for the project type below. Every checklist line needs
   evidence: a command + its real output, a passing scenario step, or a screenshot you actually looked at.
4. **Look at screenshots.** Open the PNGs with your file viewer and look. Ask: does it look like the
   request? Is anything overlapping, cut off, unstyled, empty, misaligned, too small?
5. **Fix → re-run the same checks.** A fix without a re-run is not a fix. Repeat until clean.
6. **Write `.proof/report.md`** (template below).
7. **Independent review** (non-trivial builds): `invoke_subagent` with TypeName `playtester`, Role
   "Independent QA Playtester", and a Prompt containing the user's ORIGINAL request verbatim, the
   project path and how to launch it. Wait for its message. Fix every BLOCKER/MAJOR it reports,
   re-verify, and invoke it again (max 3 rounds). Put its final verdict in the report and final answer.

**Splitting big work across agents** (optional, for clearly separable parts, e.g. "3D model" + "game
code", or "backend" + "frontend"): define the interface first (file names, object names, API), then
`invoke_subagent` one builder per part with a precise prompt and its own folder; integrate and verify
the whole yourself. Never let two agents edit the same files.

## Any task — the general method (the recipes below are only examples of it)

Most requests will not match a recipe exactly (a music generator, a file organizer, a tray utility, a
presentation, a data pipeline, a hardware script, something nobody has built). The method is the same:

1. **Picture the user's moment of truth.** Write in the checklist, in 3–5 lines: who opens it, what
   they do in the first minute, what they must see/hear/get for them to say "wow, it works", and what
   would make them say "this is garbage". Unstated expectations count (a "player" plays all common
   formats; a "game" is fun; a "tool" handles messy real input; a "generator" produces good output,
   not just any output).
2. **Find the quality bar.** Name 1–3 of the best existing products/results of this kind (search the
   web if unsure) and what makes them good. Your result is judged against those, not against "it runs".
3. **Decide how you will OBSERVE the result** — before coding. Every output type has a way to look at it:
   - visual (UI, image, video, 3D, chart, PDF, slides) → render to PNG and open it; filmstrip for motion
     (`ffmpeg -i out.mp4 -vf fps=2,tile=4x2 sheet.png`), PDF → `pdftoppm`/browser screenshot;
   - audio (music, TTS, effects) → render to WAV, check duration/peak/silence with `ffprobe`/`ffmpeg
     -af volumedetect,silencedetect`, and render a spectrogram (`ffmpeg -i a.wav -lavfi showspectrumpic=s=1024x512 spec.png`) and look at it;
   - files/data (converter, organizer, scraper, pipeline) → run on realistic AND messy samples you
     create (unicode names, empty, huge, duplicates, broken), diff the outputs, count results;
   - interactive/stateful (bots, servers, multiplayer, background apps) → drive it with a script as a
     fake user, several users, restart it, check persistence and logs;
   - long-running/system (tray apps, watchers, schedulers) → start, trigger the event, check effect,
     check it survives restart and does not eat CPU/RAM (`Get-Process`).
   If no tool exists for observing it, **write a small harness** (`.proof/harness.*`) — that is part of the job.
4. **Exercise it the way the user will, then the way they will by accident**: wrong input, double
   clicks, closing midway, no internet, very small/large window, a second run.
5. **Judge like the demanding user** with the observations open in front of you: would they keep it?
   List every gap vs. step 1 and step 2, fix, re-observe. Then get the `playtester` review.
6. **Unknown territory**: if you have not done this kind of thing before, first build a tiny spike that
   proves the riskiest part works (the codec, the API, the model on this GPU), observe it, then build.

## Running commands on this machine (Windows)

- Run Python tools as modules: `python -m pytest`, `python -m uvicorn app:app`, `python -m pip install …`,
  `python -m http.server 8000` — not bare `pytest`/`uvicorn` (PATH issues; may also be blocked).
- Node tools via `npx …` / `npm run …`. Start servers with your tool's background/async option, then
  poll the URL until it answers; stop them when done.
- **Every command is ONE line** — never put several commands on separate lines in one call (newlines
  make the whole call get refused). One command per call, or join with `;` on a single line.
- Long checks (mc_test, Blender renders, servers): run in the background and wait with your
  `command_status` tool. Do NOT poll with PowerShell `if (…) { … }` / loops — they are refused.
- The skill's scripts always exist at the paths shown — don't spend calls checking them with Test-Path.
- Any code longer than one line goes into a file (`.proof/check_crypto.mjs`, `tests/test_x.py`) and is
  run with `node file` / `python file`. Multi-line `node -e "…"` / `python -c "…"` are blocked.
- Never use `$env:VAR=…; cmd` chains or `Remove-Item -Recurse` — they are blocked and abort the run.
  Pass config as CLI args, or write a small script file and run it with `node`/`python`.
- If a command is refused, do NOT give up silently: switch to an allowed form above and continue.
- **Line endings**: many files here are CRLF. If a file edit fails to match, re-read the exact lines and
  retry once with the exact text. Never rewrite a whole file just to change line endings, never write
  patch scripts for a one-line change, and check `git diff` shows only your lines (no whole-file churn).

## Recipes by project type

### Web UI (static HTML/JS, React/Vite/Next, browser games, players, dashboards)

The probe is at `scripts/ui_probe.mjs` (next to this file; run it with the absolute path).
It uses the installed Edge/Chrome, no downloads needed.

```bash
# static folder
node <skill>/scripts/ui_probe.mjs --dir . --out .proof/ui --click-all
# dev server (start it in the background first, e.g. npm run dev)
node <skill>/scripts/ui_probe.mjs --url http://localhost:5173 --out .proof/ui --click-all --steps .proof/steps.json
```

It reports, per viewport (1440, 768, 375 wide): JS exceptions, console errors, failed/404 requests,
horizontal overflow and which elements cause it, controls covered by other elements (clicks can't reach
them), controls cut off by the screen edge, tiny controls, and with `--click-all` every button that
throws or changes nothing. Screenshots: `.proof/ui/shot-*.png`. Exit 0 = clean.
Every scenario step with `screenshot` (or `"inspect": true`) re-checks layout **in that state** — so
screenshot every screen/modal (menu, game, pause, game over, settings, mobile) to get them checked:
- `clipped-text` — a label doesn't fit its button/cell (e.g. "СОХРАНИТЬ" cut off). Fix: shorter text,
  smaller letter-spacing/padding, `white-space: nowrap` + wider button, or let it wrap.
- `small-main-visual` — the main canvas/video/image uses too little of the screen (<60% height on
  desktop, <45% on phone). Fix: size it from the viewport, e.g. board height `min(80vh, …)`, cell size
  computed from `innerHeight`, re-computed on `resize`.
- `covered-control` — something sits on top of a control in that state.
**Treat every reported problem as a bug to fix**, then re-run until the probe exits 0 (or explain in the
report why a remaining item is intentional).

Viewport presets with touch emulation: `--viewports 1440x900,ipad,ipad-portrait,phone`. The probe also
reports `low-contrast` text (WCAG ratio, solid backgrounds only; repeats are counted once).

**Every screen at once** (themes, redesigns, upgrades, "don't break anything"): `scripts/route_tour.mjs`
screenshots every route from a list (`--routes .proof/routes.txt`, `--hash` for hash routers, `--setup` to
pass a login/guest screen, `--storage` for test data) and reports JS errors / failed requests / overflow per
route; it warns when all screens look identical (a gate you did not pass). Before/after + `visual_diff.mjs`
shows exactly which screens changed. **App icons/logos**: `scripts/icon_check.mjs` (sizes 16–256 on light and
dark, taskbar, browser tab, iPad home screen, detail kept at 16/32 px; `--export` writes .ico, iOS 1024,
favicon, PWA icons) — process in the `design-quality` skill.

**Always write a scenario** (`.proof/steps.json`) that walks the user's actual features with real
data (a page with no content hides most bugs). All step keys (click, fill, press, setFiles, hold,
mouseMove, filmstrip, fps, scene3d, expect, expectChange, screenshot, …), their order and an example:
**read `{{PROOFKIT_DIR}}/skills/proof-verify/references/ui-steps.md` with view_file before writing steps.**

**Visual review — open every screenshot and answer each question; fix every "no":**
- **Scale:** does the main thing (game board, video, editor, canvas) use most of the space? On a
  1440×900 screen a game board that is 300px tall is a bug. On 375×812 it must still fill the width.
- **Right controls for the device:** touch buttons only on touch/narrow screens; hover-only UI has a
  touch alternative.
- **No fake/placeholder data:** no invented high scores, lorem ipsum, "Song name", broken image icons.
- **Every screen reached:** menu, settings, records, empty state, error state, game over — screenshot each.
- **Text:** readable size and contrast, nothing cut off, no overlapping, fonts actually loaded
  (digits/letters render correctly, no tofu or odd glyphs).
- **Layout:** aligned, consistent spacing, nothing overlapping or hidden behind another layer,
  modals centered and closable.
- **Matches the request:** "beautiful neon/dark theme" — would the user say wow, or "meh"?

Custom multi-user / complex browser tests (Playwright without install, two-user template): see `ui-steps.md`.

**Design** (new UI, theme, redesign, or any UI change in an existing product): follow the
`design-quality` skill — PRESERVE mode with before/after `visual_diff.mjs` for existing products,
CREATE mode with tokens, anti-slop list and scored self-critique for new designs.

Things the probe can't judge — you must check from screenshots: visual quality, hierarchy, alignment,
contrast, whether it matches what was asked ("beautiful dark theme" = actually look at it).
Fullscreen/autoplay/clipboard may be restricted in headless mode: verify the handler is wired and
called (`eval` a flag or spy), and say so in the report.

### Games (browser / three.js / canvas)
PLAY it, don't just click the menu: held keys, mouse steering, filmstrips, new-player test (30 s
hands-off must not lose; simple strategy must score), outcomes only via real input, close-up of
moving parts, playability checklist; 3D telemetry is automatic. **Read `{{PROOFKIT_DIR}}/skills/proof-verify/references/games.md` before testing a game.**

### 3D models that will be ANIMATED or used in a game
Every moving part = separate object (L/R separate), parented, origin ON the hinge; check with
`blender_rig_check.py`. **Details: `{{PROOFKIT_DIR}}/skills/proof-verify/references/rigging.md`.**

### Desktop apps (Electron, Tauri, Python Tk/Qt, etc.)
- Electron/Tauri: run the renderer's web build through the UI probe (`--url` to the dev server).
- Launch the real app in the background, capture its stdout/stderr for ~10 s, confirm no traceback and
  the window process stays alive. For Python GUIs, separate logic from UI and unit-test the logic;
  for Qt use `QT_QPA_PLATFORM=offscreen` to construct the main window in a test.

### CLI tools, libraries, backends, bots
- Run the real entry point with realistic args, including a bad input and `--help`. Show output.
- Servers: start in background, hit every endpoint with `curl`/a small script, check status codes and
  bodies, then stop it. Check logs for stack traces.
- Write automated tests for core logic (pytest / vitest / node:test) and run them. Crypto/encoding:
  round-trip tests, wrong-key must fail, tampered ciphertext must be rejected.
- Bots (Telegram, Discord): unit-test handlers with fake update objects; never require real tokens.

### Minecraft (Paper/Spigot) plugins
Test on a REAL Paper 1.21.11 server with a bot player via `scripts/mc_test.mjs` (build with Maven).
**Read `{{PROOFKIT_DIR}}/skills/proof-verify/references/minecraft.md` before building/testing a plugin.**

### 3D models (Blender), especially from a reference image
Build with a bpy script, render with `blender_turnaround.py`, compare with `compare.mjs`, loop 3–6
times (~20 min budget). **Read `{{PROOFKIT_DIR}}/skills/proof-verify/references/blender.md` before modelling** (modelling craft, proportions, budget).

### Matching a design reference (website / app screenshot / mockup)
Build it, screenshot at the reference's size (`--viewports 1440x900` or the ref's aspect), then
`node <skill>/scripts/compare.mjs ref.png .proof/ui/shot-1440x900.png --out .proof/compare.png`.
Loop: list differences (layout grid, spacing, font sizes/weights, colors, gradients, glow, corner
radii, icons, imagery) → fix → re-compare, until it is hard to tell them apart at a glance. Recreate
imagery: phone mockups/illustrations in CSS/SVG, or generate assets with your `generate_image` tool.

### Roblox
- Use the roblox-mcp-pro tools if available: run the place, read `manage_logs` for errors,
  `capture_studio` / `ui_preview` to look at UI. Otherwise at least run `selene`/`luau-analyze` if installed.

### ML / image or video generation / GPU apps
- Check the GPU first: `nvidia-smi` (name, VRAM). Size defaults to it (e.g. 6 GB VRAM → fp16, small
  batch, attention slicing/CPU offload, low-res first).
- Smoke-run the real pipeline end-to-end with the smallest settings (few steps, small resolution) and
  confirm an output file is produced; open the image and look at it. Record time and peak VRAM.
- If a model download is huge, ask once before downloading; still verify everything around it.

### Anything else
Use "Any task — the general method" above. If you cannot run something (no hardware, needs
credentials), say it explicitly in the report under **Not verified**, with the exact command the user
should run.

## `.proof/report.md` template

```markdown
Size: M
# Verification report
Project: <name>   Date: <date>

## Checklist
| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Open multiple files → playlist | PASS | steps.json step 0, shot step-00-*.png |
| 2 | Fullscreen (F) | PARTIAL | handler called (eval), headless blocks real fullscreen |

## Commands run (last run, after final fixes)
- `node .../ui_probe.mjs --dir . --click-all --steps .proof/steps.json` → exit 0, 0 problems

## Visual review (screenshots actually opened)
- shot-1440x900.png — player left, playlist right, controls aligned; OK
- step-23-mobile.png — 180px empty gap between title card and playlist → FIXED (removed min-height), re-shot OK

## Bugs found and fixed during verification
- Progress bar drag jumped to 0 — fixed in player.js (pointer capture)

## Not verified
- Real fullscreen in a headed browser — run `npx serve .` and press F
```

Statuses: PASS (evidence shown), PARTIAL (explain), FAIL (still broken — say so), NOT RUN (explain why).
Never write PASS for something you did not execute after your last code change.

## Final answer to the user
Short: what was built, how to run it (exact command), the checklist summary (X/Y PASS), bugs you caught
and fixed, and anything not verified. Honest > impressive.
