---
name: design-quality
description: >-
  Use for ANY work that changes how a UI looks: a new app/site/screen, a theme or redesign, a new
  logo or app icon, a new component, or even a small UI fix inside an existing product (player, reader, dashboard). Two modes:
  PRESERVE (editing an existing product — keep its design system intact, prove nothing else changed
  with before/after visual diff) and CREATE (new design or explicit redesign — 2026 product-level
  quality, no generic "AI slop" look). Includes an anti-slop list and a scored self-critique.
---

# design-quality — look like a real 2026 product, never break an existing design

The user cares about design more than anything. An ugly or generic result, or an existing design
that got damaged by a "fix", is a failed task even if everything works.

## First: which mode?

- **PRESERVE** — the project already has a UI and the task is a fix, a feature or a tweak. Default for
  any existing project. Even if you would design it differently, you match what is there.
- **CREATE** — new product, or the user explicitly asks for a new design/theme/redesign/"make it
  beautiful". Only then may you introduce a new visual language.

## PRESERVE mode (existing product)

1. **Learn the design system before touching UI.** Find and read: CSS variables / theme files /
   Tailwind config / palette files, the 2–3 components closest to what you will build (buttons, cards,
   sheets, lists). Write 3–5 lines in your notes: colors (tokens), font + sizes, radius, spacing,
   shadow/border style, motion. Reuse those tokens and components — never hard-code new colors,
   fonts, radii or shadows next to existing ones.
2. **Baseline screenshots BEFORE editing** of the screens you will touch plus 1–2 neighbouring screens:
   `node <proof-verify>/scripts/ui_probe.mjs --url <dev-url> --freeze --out .proof/before [--steps nav.json]`
3. Make the change. Touch only what the request needs: no restyling, renaming, reordering, "while I'm
   here" improvements, new hotkeys or new settings that were not asked for.
4. **After screenshots + diff**:
   `ui_probe.mjs ... --freeze --out .proof/after` then
   `node <proof-verify>/scripts/visual_diff.mjs .proof/before .proof/after`
   Use the SAME steps file and the SAME test data for before and after, so file names match (the diff
   compares files with equal names; content that only moved down/up is ignored automatically).
   Open every `-diff.png`. Every red area must be the intended change. Anything else changed → revert
   that part. Put the diff summary in the report — "diff: yes" without `-diff.png` files is not evidence.
5. New element (button, panel, badge)? It must look like it shipped with the product: same tokens,
   same component, same icon set and stroke width, same spacing rhythm. Compare it side by side with
   its neighbours in the screenshot.

## CREATE mode (new design / redesign)

0. **Directions before code.** Make 2–3 clearly different directions for ONE key screen first — as a
   static HTML mockup or an image from your image tool — screenshot them side by side, score them with
   the self-critique table, and pick the best (or show them to the user with `ask_question` when the
   choice is a matter of taste, e.g. a new theme or logo). Changing a mockup costs a minute; changing
   a theme across 30 screens costs an hour.
1. **Direction in 5 lines** (in `.proof/checklist.md`): who uses it and in what mood; 2–3 concrete
   current references to emulate *for specific qualities* (e.g. "Apple TV app — poster rows & focus
   states; Linear — density & restraint; Arc/Raycast — command UX; Spotify 2025 — now-playing view;
   Crunchyroll — anime catalog"); palette; type; signature detail (the one thing people remember).
2. **Tokens first** (CSS variables): background, surface 1–3, border, text primary/secondary/muted,
   ONE accent (+ hover/pressed), success/warn/danger. Build neutrals as a ramp (OKLCH is ideal) with
   real contrast (body text ≥ 4.5:1). Type scale with 5–6 steps (e.g. 12/14/16/20/28/40), 1 family
   (2 max), weights 400/500/600. Spacing on a 4 px grid (4/8/12/16/24/32/48). One radius family
   (e.g. 8 for controls, 12–16 for cards). Elevation by subtle borders + soft large shadows, not glow.
3. **Content first**: real-looking content for the domain (posters/artwork, proper titles, durations,
   avatars) — generated with your image tool or SVG when needed, never grey boxes or lorem ipsum.
4. **Every interactive element has states**: hover, pressed, focus-visible ring, disabled, loading;
   lists have empty and error states; motion 150–250 ms ease-out (springs for sheets), respects
   `prefers-reduced-motion`.
5. **Layout**: one dominant element per screen, clear hierarchy, generous but consistent spacing,
   content aligned to a grid; on iPad/phone — native-feeling: safe areas, ≥ 44 px touch targets,
   bottom/edge-reachable controls, no hover-only actions.

## Themes and redesigns of an existing app — check EVERY screen

A theme touches every screen, so checking the 2–3 you edited is not enough:
1. Take the screen list from the project map (routes + how to get past login/guest screens).
2. Before changing anything: `node <proof-verify>/scripts/route_tour.mjs --url <dev-url> --routes .proof/routes.txt
   [--hash] [--setup setup.json] --viewports 1440x900,ipad,375x812 --freeze --out .proof/tour/before`
   (run it twice: screens that differ between the two runs show live data — judge those by eye).
3. After: same command with `--out .proof/tour/after`, then `visual_diff.mjs .proof/tour/before .proof/tour/after`.
   Open the diffs of every screen: the new theme must be applied everywhere consistently — no screen left
   in the old colours, no unreadable text, no broken layout.
4. `ui_probe.mjs` reports `low-contrast` text. In an existing product only contrast problems YOUR change
   introduced count (compare with the before run); do not recolour the brand's existing elements unless
   the task is to change the theme.

## Icons and logos

An icon is seen at 16–64 px far more often than at 1024 px.
1. Make 3–4 genuinely different candidates (SVG by hand for geometric marks, or your image tool), each
   one simple: one bold silhouette, ≤ 3 colours, no thin lines, no small text, works without its glow.
2. Check each: `node <proof-verify>/scripts/icon_check.mjs candidate.svg --label v1` — open every sheet:
   recognisable at 16 and 32 px? visible on dark AND light? holds up next to other icons on the iPad
   home screen? Fix or drop candidates that fail, pick the best, say why.
3. Export everything: `icon_check.mjs final.svg --export <dir> --ios-bg <brand background>` → `.ico` for
   Windows/Electron, `AppIcon-1024.png` (opaque, square full-bleed — iOS applies its own rounded mask),
   `apple-touch-icon.png`, favicon, maskable PWA icon, PNG sizes.
4. Wire it into EVERY place the project uses (find them: `rg -n "icon|favicon|apple-touch" --glob "!node_modules"`):
   favicon/manifest in `public/`, Electron build icon, Capacitor/iOS asset catalog, in-app logo components,
   splash screens. Old icon files left in some place = the user still sees the old icon there.

## Anti-slop list — never ship these (they scream "AI made this")

- Purple→blue/pink gradients as the default identity; gradient text on headings; neon glow on
  everything; glassmorphism on every surface.
- Emoji used as icons in a polished UI (use one SVG icon set, e.g. Lucide, consistent stroke).
- The generic template: centered hero + "3 feature cards with icons" + gradient button, unless asked.
- Everything rounded-2xl with the same shadow; borders AND shadows AND gradients on one card.
- Sidebar of plain text tabs with square grey tiles; dashboards of identical cards.
- Fake stats/testimonials/users ("10k+ happy users", "John D."), lorem ipsum, placeholder posters.
- Random accent colors per section; more than one accent; low-contrast grey-on-grey text.
- Huge empty areas or the opposite: everything crammed with no hierarchy.
- Default browser controls (raw `<input type=range>`, default select) in a styled product.
- Inconsistent icon sizes, misaligned baselines, text touching edges, uneven gaps.

## Self-critique (required before reporting) — score from screenshots, 1–5 each

| criterion | question |
|---|---|
| Hierarchy | Is it obvious in 1 second what matters most on each screen? |
| Typography | Clear scale, comfortable line length/height, no orphan sizes? |
| Spacing & alignment | Consistent rhythm, everything on a grid, nothing touching? |
| Color restraint | Neutrals + one accent, real contrast, no slop gradients? |
| Consistency | Same components/icons/radii everywhere; new parts match old ones? |
| States & motion | Hover/focus/pressed/empty/loading present and smooth? |
| Content realism | Looks like a real product with real content? |
| Originality | Would a designer call it generic AI output? (5 = clearly designed) |

Any score below 4 → fix and re-screenshot. Put the table (with one-line reasons) in the report.
In PRESERVE mode, add: "Visual diff: only intended areas changed — yes/no".
