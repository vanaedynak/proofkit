# ui_probe scenario steps (`--steps .proof/steps.json`)

**Always write a scenario** (`.proof/steps.json`) that walks the user's actual features with real
data, because a page with no content hides most bugs. Each step is an object; keys run in this order:

| key | meaning |
|---|---|
| `name` | label for the report |
| `viewport` | `"375x812"` — resize |
| `setFiles` | `["#fileInput", ["fixtures/a.mp4","fixtures/b.mp4"]]` |
| `click` / `dblclick` / `hover` | CSS selector |
| `fill` / `select` | `["#q", "text"]` |
| `press` | `"Space"`, `"ArrowRight"`, `"KeyF"`, `"Control+S"` |
| `clickAt` | `["#progress", 0.75]` — click 75% along an element |
| `drag` | `["#progress", 0.1, 0.9]` — drag along an element |
| `wait` | ms |
| `waitFor` | JS expression to wait until truthy |
| `eval` | JS expression; value recorded in report |
| `expect` | JS expression that MUST be truthy — this is your assertion |
| `screenshot` | name; saves `.proof/ui/step-NN-name.png` |
| `reload` | `true` — reload the page (test persistence: localStorage, settings) |
| `expectText` | text that must be visible on the page (case-insensitive) |
| `repeat` / `every` | with `press`: press N times, `every` ms apart (e.g. hard-drop until game over) |
| `mouseMove` | `[0.5, 0.2]` — move the mouse to 50%/20% of the viewport (steering, aiming) |
| `mouseDown` / `mouseUp` | `true` or `"right"` — hold/release a mouse button (shooting, dragging) |
| `hold` | `"KeyW"` or `["KeyW","ArrowLeft"]` — keep keys DOWN during this step (`ms`, default 1000) |
| `filmstrip` | `true` or `{"frames":6,"every":250}` — capture frames while keys are held → `step-NN-<name>-film.png` contact sheet; all-identical frames = `frozen-frames` problem |
| `fps` | ms to measure real frame rate (GPU is used); below `minFps` (default 30) = `low-fps` problem |
| `scene3d` | `true` — 3 s of 3D telemetry in this state: fps, which scene objects the camera sees (fails on nothing-in-view / NaN / frozen render) |
| `expectChange` | JS expression read before and after the step; fails if unchanged — proves an input did something (`"window.__game.player.y"`) |

Order inside one step: reload → viewport → click/dblclick/hover → fill/select → press → setFiles →
clickAt/drag → mouseMove/Down/Up → hold (+filmstrip while held) → fps → release keys → wait → waitFor →
expectChange → eval → expect → expectText → screenshot. If an `eval` performs an
action whose result needs time (animation, network), put the check in the NEXT step with its own `wait`.

Use `text=Играть` style selectors for buttons by their label. After clicking something that animates
(screen transitions, modals), `wait` long enough (≥ the CSS transition) before asserting.

Example (video player):
```json
[
  {"name":"load 2 files","setFiles":["input[type=file]",["fixtures/a.mp4","fixtures/b.mp4"]],
   "expect":"document.querySelectorAll('.playlist-item').length===2"},
  {"name":"play","click":"#playBtn","wait":400,"expect":"!document.querySelector('video').paused"},
  {"name":"seek by click","clickAt":["#progress",0.5],"expect":"Math.abs(document.querySelector('video').currentTime/document.querySelector('video').duration-0.5)<0.1"},
  {"name":"space pauses","press":"Space","expect":"document.querySelector('video').paused"},
  {"name":"next track","click":"#nextBtn","expect":"document.querySelector('.playlist-item.active')===document.querySelectorAll('.playlist-item')[1]"},
  {"name":"mobile layout","viewport":"375x812","screenshot":"mobile","expect":"document.documentElement.scrollWidth<=375"}
]
```

Make test fixtures instead of skipping features that need data:
`ffmpeg -f lavfi -i testsrc=duration=5:size=640x360:rate=30 -f lavfi -i sine=duration=5 -shortest fixtures/a.mp4`
(images: `ffmpeg -f lavfi -i testsrc=size=512x512 -frames:v 1 fixtures/img.png`; JSON/CSV: write small files).

**Custom browser tests** (multi-user chat/multiplayer, complex flows the step runner can't express):
write a Node script that imports Playwright from the skill — no npm install, no NODE_PATH, no env vars:
`import { launch } from 'file:///{{PROOFKIT_DIR}}/skills/proof-verify/scripts/pw.mjs';`
`launch()` opens the installed Edge/Chrome. A ready two-user template (alice + bob in separate
contexts, PASS/FAIL lines, screenshots, results JSON): `scripts/e2e_two_users.example.mjs` — copy it to
`.proof/e2e.mjs` and adapt. Start servers with your background command tool, not with `$env:` tricks.
