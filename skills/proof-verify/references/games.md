### Games (browser / three.js / canvas) — PLAY it, don't just click the menu
Clicking menu buttons proves nothing about the game. A past run passed 13/13 "UI steps" while the plane's
tail surfaces flew off the body in flight and the game was barely playable. Do this:
0. **Automatic telemetry**: every `ui_probe.mjs` run on a page with a canvas measures fps for 3 s and,
   for three.js, lists which scene objects are in the camera view (`[canvas]` / `[3D]` lines; problems
   `low-fps`, `not-rendering`, `nothing-in-view`, `nan-transform`; JS errors are always caught). Give
   your main objects names (`player.name = 'Player'`) so the list is readable; add `"scene3d": true`
   to steps where something must be on screen (after spawn, in close-up, after respawn).
1. **Expose test state**: `window.__game = { state, player, score, ... }` (read-only references, keep
   it in production — harmless). Then assertions can read real game state.
2. **Play scenario** (`.proof/steps.json`): start the game, then for each control: `hold` the key /
   `mouseMove` for 1–2 s with a `filmstrip`, and `expectChange` the state it should affect
   (`"Math.round(window.__game.player.position.y)"`). Cover: every control, scoring, taking damage,
   losing (game over screen), restart, pause. Add one `fps` step during heavy action (want ≥ 50).
   **Outcomes only through real input**: scoring, killing an enemy, losing, winning must be produced
   by held keys/mouse in the scenario, never by calling game internals from `eval` (`damageEnemy()`,
   `takeDamage()`, `score=`). The probe flags such evals as `faked-outcome`.
   **New-player test**: (a) start and touch nothing for 30 s → must still be alive; (b) a simple
   strategy with real input (steer toward nearest target + shoot) for 60 s → must score. Failing either
   = the game is too hard for the user, fix difficulty (enemy accuracy/aggression, grace period,
   auto-level, aim assist, health) before anything else.
3. **Close-up check of animated parts**: add a debug key or URL flag (`?cam=closeup`) that puts the
   camera near the player model, then `hold` each control and filmstrip it: wheels/propellers/control
   surfaces/limbs must rotate IN PLACE, attached to the body. Open the filmstrips and look.
4. **Playability review** (write answers in the report, fix every "no"):
   - First 10 seconds: is it obvious what to do (short on-screen hint), and can the player start
     without reading a manual? Defaults playable with keyboard+mouse, no pointer-lock required.
   - Controls responsive and forgiving (no instant crash/stall in the first 30 s for a new player;
     assist/auto-level for flight/driving games; sensitivity sane; invert option only as an option).
   - Camera: player and threats always readable; no clipping into terrain; not too close/far.
   - The player always knows where to go: off-screen arrows/radar to enemies and goals; enemies
     find the player within ~10 s if the player wanders.
   - No dead states: never stuck against the ground/wall/boundary with a blank or frozen view (an
     invisible floor clamp is not a fix — gently pull up / bounce / show a warning, or crash & respawn).
   - Test with the player doing something "wrong" for 20 s (holding dive, flying away, spinning) and
     look at the filmstrip: the screen must stay understandable.
   - Feedback: hits, damage, pickups, score changes are seen AND heard; game over explains why.
   - Goal and progression: a clear objective, rising difficulty, win/lose conditions, restart in 1 key.
   - Performance ≥ 50 fps on the user's machine (check the GPU with `nvidia-smi`); no memory growth (bullets/particles recycled).
5. Invoke the `playtester` subagent (see rules) — fresh eyes find what you got used to.
