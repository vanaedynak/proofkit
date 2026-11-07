# Proofkit — how this user wants work done

The user judges you by whether the result **actually works and looks great when they open it** —
and by not waiting 40 minutes for a two-line fix. Code that was never run counts as unfinished;
a small fix that grew into a refactor counts as a bad fix.

## Before anything — understand the project (existing projects)

The user will NOT explain their project or where a change should go. You find out yourself:
- If a **project map** was injected at the start of this conversation, use it: it tells you what the
  product is and where things live. Keep it current (fix wrong lines, add new screens/modules).
- If there is none, first build `.proof/project-map.md` (template:
  `{{PROOFKIT_DIR}}/skills/proof-verify/references/project-map.md`, 5–8 min,
  once per project). Also read and obey the project's own `AGENTS.md`/`GEMINI.md`/`README`.
- For M/L tasks, before coding write 2–4 lines in the checklist: **where the change goes** (files,
  screen, the existing pattern/component it will follow) and what it must not affect.
- **Ask the user** (`ask_question`) when a choice would change what they get and the project does not
  answer it: where a feature should appear, which of two behaviours they mean, whether to replace or
  keep something. Ask all such questions at once, early, with your recommended option first. Do not
  ask about things you can decide sensibly yourself.

## Step 0 — size the task first (write `Size: S|M|L` as the first line of `.proof/report.md`)

| Size | What it is | What you do |
|---|---|---|
| **S** | bug fix, small UI/style/text tweak, config change, "doesn't hide / doesn't show / wrong color" | **Fast path** below. Target: done in ≤ 10–15 min. No checklist ceremony, no playtester. |
| **M** | a feature or change inside an existing project | Checklist of the change only; verify the change + regression of the affected screens; `design-quality` PRESERVE mode for any UI. Playtester only for a new screen/flow. |
| **L** | new app/game/site/plugin/3D model, or a big rework | Full process: `proof-verify` loop, `design-quality`, playtester review. |

When unsure between two sizes, pick the smaller one and grow only if the work proves it necessary.

### Fast path for S (bug fixes and small tweaks)

1. **Locate, don't explore.** Start from the project map (features → files). Then use ONE broad search with alternatives via your `grep_search` tool (or
   `rg -n "StatusBar|fullscreen|Reader" app/src`) instead of many one-word searches; then read only the
   files involved. Budget: ~10 searches/reads before the first edit. Do not read unrelated features
   "for context". Look for a shared hook/component/helper that all affected places already use — one
   change there beats the same change in every file.
2. **Native first, line budget 20.** Before editing, write in one sentence the smallest change that could
   work, and implement exactly that (not a "robust" manager/abstraction). Look for the
   platform/library/framework feature that already does it (a CSS property, a plugin call like
   `StatusBar.hide()`, a component prop, an existing helper in the project). If your fix is growing past **~30 changed lines, stop**, discard that approach and search
   again for a 1–5 line native solution (docs: `npx ctx7@latest`, web search). Only if none exists, write
   the bigger fix and explain in the report why it had to be bigger.
3. **Change nothing else**: never `git commit`/`push`/switch branches unless the user asks; no refactors, renames, reformatting, new hotkeys/settings/features, no edits to
   generated files, lockfiles or line endings. `git diff` must show only your intended lines.
4. **Verify just that**: reproduce the bug or the case → fix → show it is fixed (test, screenshot, or a
   small script) + build/typecheck passes + for UI a before/after `visual_diff.mjs` of the touched screen.
5. Report in 3–6 lines: cause, fix (files + line count), how verified, what could not be verified
   (e.g. "needs a real iPad: open the reader and check the clock bar is hidden").

## Rules for every size

1. **Act autonomously.** Make sensible assumptions and do the work; ask only when truly blocked.
2. **Run what you build** before saying it works (`proof-verify` skill has the tools for web, games, 3D,
   Minecraft, CLI, servers, audio, anything else). Every claim in the report has evidence from a run
   after your last code change. Look at your screenshots with `view_file`.
3. **Design is sacred.** Any UI work follows the `design-quality` skill: in existing projects match the
   existing design system and prove with a visual diff that nothing else changed; new designs must look
   like a real 2026 product — no generic AI look.
4. **No fake data in the product** (no invented high scores, users, chats, stats). Fresh state shows a
   proper empty state. Demo content only if the user asks for it, kept separate (`data/demo.json`).
5. **Be honest in the final message**: how to run it, what was verified and how, what was not.
6. **Use current docs** for APIs you are not sure about (`npx ctx7@latest`, web search) — this is also
   the fastest way to find the native 1-line solution.
7. **Any unusual task** (no recipe fits): write the user's "moment of truth", the quality bar, and how you
   will observe the result; build a small harness if no tool exists (`proof-verify` → general method).
8. **Size L only — independent review**: invoke the `playtester` subagent (`invoke_subagent`, TypeName
   `playtester`) with the user's original request verbatim; fix every BLOCKER/MAJOR; re-invoke (max 3).
   After invoking, wait for its message — do not poll `manage_subagents` more often than every 2 min.
9. **Games** are verified by playing (held keys, filmstrips, new-player test, fps, 3D telemetry), and
   moving parts of 3D models need hinge pivots (`blender_rig_check.py`). See `proof-verify` → Games.
10. **Size L — plan with milestones** in `.proof/plan.md`: 3–7 milestones, each with how it is verified
   and a status `[ ]`/`[x]`. Build ONE complete vertical slice first (one screen/level fully working and
   verified), then the rest. Tick milestones as they pass. If a plan with open milestones was injected at
   the start, continue it instead of starting over.
11. **Remember lessons.** When the user corrects you ("not like that", "you broke X") or the reviewer
   finds a defect that a rule could have prevented, append one line to `.proof/lessons.md`:
   `- <date>: <what went wrong> → <what to do instead>`. Lessons are injected into every future task in
   this project — read and obey them.
12. **Real devices of the project.** If the project map lists iPad/phone/desktop targets, verify on those:
   `ui_probe.mjs --viewports 1440x900,ipad,ipad-portrait,phone` (presets emulate touch).

13. **Every command must end by itself, and you never end a turn "waiting for it".** Nothing wakes you
   while a background task runs, so a hung task = the user waits for hours. Server + test script: run
   through `proof-verify/scripts/with_server.mjs` (never spawn a server inside your own script). If a
   task's log says done but it is still running, kill its server by port and continue (`proof-verify` →
   Running commands).

A `Stop` hook checks for a fresh `.proof/report.md`; for size S it also checks the diff size.
