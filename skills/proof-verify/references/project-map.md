# Project map — template and how to build it

`.proof/project-map.md` is the agent's long-term memory of an existing project. It is injected into
every new conversation in this workspace, so it must be **accurate, compact (80–150 lines) and about
WHERE things are**, not a copy of the code. Write it once (5–8 min), then keep it current: when a task
adds a screen/module or you find a section is wrong, fix that line.

## How to build it (fast)

1. Read the project's own docs first and respect them: `AGENTS.md`, `GEMINI.md`, `README*`, `LAB.md`,
   `docs/`, `CONTRIBUTING`. Rules in them override your habits.
2. `package.json` / `pyproject` / `build.gradle` etc.: stack, scripts (dev/build/test/lint), key libraries.
3. Folder tree, 2–3 levels, without `node_modules`/build output (`list_dir`, or
   `rg --files app/src | head -300`).
4. The entry points: router/routes file, main layout/navigation, app root, global store, theme/tokens
   file, API/client layer, platform layer (Electron/Capacitor/etc.).
5. Skim 3–5 main screens just enough to say what each does and which shared pieces it uses.
6. Write `.proof/routes.txt` (one route per line) — `route_tour.mjs` uses it to screenshot every screen.
Do not read every file. Use `grep_search` to answer "where is X".

## Template

```markdown
# Project map — <name>
Updated: <date> · by: <agent> · verify with: <the command that runs/builds it>

## What it is
<2–4 sentences: what the product does, for whom, platforms (web / Windows Electron / iPad Capacitor…),
 main user journeys.>

## Stack & commands
- Stack: <framework, language, styling, state, router, key libs>
- Dev: `<cmd>` (URL/port) · Build: `<cmd>` · Typecheck/Lint/Test: `<cmds>`
- How to test UI locally: <guest mode / mock data / localStorage keys / test accounts in seed files>

## Structure (folder → responsibility)
- `app/src/pages/` — route screens (one file per route)
- `app/src/components/` — shared UI pieces
- …

## Features → where they live
| feature / screen | route | main files | notes |
|---|---|---|---|
| Watch anime | /watch/:alias/:ordinal | pages/Watch.tsx, components/Player.tsx | fullscreen + status bar in lib/platform.ts |
| …

## Screens for route_tour (every route, with real ids for detail pages)
- Router: <hash or path>; get past the gate with: <e.g. [{"click":"text=Смотреть как гость"}]>
- Routes: `/`, `/catalog`, `/title/<real-alias>`, `/settings`, …  (also saved as `.proof/routes.txt`)
- Target devices: <desktop / iPad / phone> → ui_probe `--viewports 1440x900,ipad,ipad-portrait,phone`

## Shared building blocks (reuse these instead of writing new ones)
- Hooks/helpers: <name — what it does — file>
- Stores/state: <store, persistence keys>
- UI kit: <Button/Card/Sheet components — file>

## Design system
- Tokens/theme: <file(s)>; palettes: <file>; fonts: <family>; radius/spacing habits; icon set (+ size/stroke)
- Look & feel in one line (e.g. "dark, teal accent, rounded-2xl cards with ring-white/5, Manrope")

## Data & integrations
- APIs/backends, auth, sync, offline storage, platform bridges (Electron IPC, Capacitor plugins)

## Conventions
- Language of UI texts, naming, file layout, line endings, commit style, things the docs insist on

## Do not touch / gotchas
- Generated files (e.g. `src/generated/licenses.json` is rewritten by `npm run build` — restore it)
- Fragile areas, platform quirks, known workarounds
```
