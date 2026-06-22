# Living Documents - design alignment loop v3 (pixel-finish + close G4, clean session)

You are taking the **Opportunity OS / Living Documents** shell from "**feels like the comp (~82%)**" to
"**indistinguishable from the comp (>= 97%)**". The v2 loop (plan 11, **PR #15, merged**) made the shell
calm, single-surface, and opinionated - it killed the split-pane abrasion, built the left tree-rail +
76px labeled icon-nav, calmed the header, removed IDE chrome, killed the dev toasts, and added inline
bound-figure highlighting. **Your job now is the last mile: pixel-finish every surface and fully close
the one remaining gate (G4).** Read this whole doc before starting; it carries the v2 state so you do
not re-litigate settled calls or repeat dead ends.

## Where v2 landed (do NOT redo these - they are done and on `main`)

Overall **~82%**, **5 of 6 hard gates fully pass**, live click-through clean. Per surface (v2 final):
left rail/nav **90**, Knowledge **88**, doc editor **88**, header **85**, Templates/Agents/Present **85**,
Home **80**, Context **78**, source-peek **78**, right rail **75**, interaction grammar **70**.

Done in v2 (see `docs/design-audit/log.md` v2 section + decision log 19-29):
- **G1** source-peek + Sync-across are **in-surface** (no editor split / blank pane) - `getSourcePeek` +
  the doc-webview pane (`livingDocRender.ts`, `livingDocEditor.ts`).
- **G2** the doc header is the comp's **single calm 48px bar**; formatting moved to a **floating
  selection toolbar**; the sync pill is the refresh.
- **G3** the **tabbed tree-rail** (`treeRailView.ts`: Files/Context/Outline/Search + folder tree) +
  the **76px labeled icon-nav** (`ACTIVITYBAR_WIDTH 48->76` core patch + `studio.css` labels).
- **G5** the **30px detached gutter** + **inline blue bound-figure highlighting** (`renderBoundParagraph`).
- **G6** the dev-build ext-activation toasts are gone (`builtinExtensionsScannerService.ts` 3-id denylist).
- **2 core patches total** (the builtin denylist + the activity-bar width); everything else is
  contributions + `styleOverrides` CSS. The fork de-IDEs cheaply - keep the fork (Q3).

## The goal + acceptance criteria (v3)

> **Goal:** the running app is **>= 97% aligned** to the Agentic Workbench comp (UX/UI/IA/visual), **all
> SIX hard gates FULLY pass** (no "mostly"), and the live click-through is clean. Hold v1 functionality
> (plan 09) and the v2 shell behaviour - this is finish work, not a rebuild.

**v3 is reached when ALL of these are true:**

- **Overall alignment >= 97%** - mean across the 12 surfaces, each scored 0-100 on Layout / Styling /
  Components / IA / Interaction-UX (same rubric as v2 so the trajectory is comparable).
- **Every surface >= 95** - no surface left behind; the lowest v2 surfaces (interaction 70, right rail
  75, source-peek 78, Context 78, Home 80) need the most lift.
- **Every hard gate FULLY passes** (these are the v2 gates; G4 must now go from "mostly" to full):
  1. **G1** - no split editor groups / no blank panes (hold).
  2. **G2** - calm single 48px header (hold; finish the pixel match).
  3. **G3** - the tree-rail + 76px labeled icon-nav (hold; finish the pixel match, incl. the nav label
     set / active-item treatment).
  4. **G4 - FULLY remove IDE optionality (the one open gate).** The surfaced chrome is already gone; now
     remove the **last reachable optionality**: the **command palette keybinding** (`Ctrl/Cmd+Shift+P`,
     `F1` - Quick Open in command mode must not open) and the **draggable pane sashes** (the
     sidebar/editor/auxiliary-bar dividers must not be user-resizable - "no draggable panes/panels").
     Also sweep for any other leak: "reopen editor with", editor context menus offering IDE actions,
     drag-and-drop of views. **Remove, don't just hide.** These are core-owned - core patches are
     allowed (log each in `plans/03-merge-tax-ledger.md`).
  5. **G5** - detached gutter + inline figures + doc/rail pixel-aligned (hold; finish the pixel match).
  6. **G6** - nav never blanks + no dev toast (hold).
- **A clean live click-through** with none of the above regressing.

Stop when **overall >= 97% AND every hard gate fully passes AND the click-through is clean**, or after
**15 iterations** (raised from 10 so you can confidently clear 95%).

## The loop (per iteration)

1. **Iteration 1 is a re-audit (no code).** Re-verify every surface live against the comp and refresh
   `docs/design-audit/v3-inventory.md` (Exists-today vs Design-intends + a per-surface score + a ranked
   gap list). Seed it from the v2 final scores above. The shell is more finished than a glance suggests
   - verify before assuming a gap.
2. **Each later iteration:** pick the single highest-impact unmet gap (lowest score x most central; the
   **G4 closure** and the **right rail (75)** are the top two). Brainstorm briefly if non-trivial, then
   build. **TDD** (`superpowers:test-driven-development`) for real logic; for pure pixel/visual work add
   a structural/snapshot assertion where meaningful and lean on the live click-through.
3. **Verify live in the web build** via the chrome-devtools MCP, and **re-check every hard gate for
   regressions** (especially: did anything reintroduce a split/blank pane, a toast, or IDE chrome?).
4. **Post the proof to the PR conversation, not just the repo.** After verifying, **commit the
   before/after PNGs** under `docs/design-audit/shots/v3-iterNN/` (so they have a raw URL) **AND post a
   PR comment** (`gh pr comment <n> --body ...`) that **embeds the before/after images** (reference them
   by their committed raw URL, e.g. `https://raw.githubusercontent.com/<owner>/<repo>/living-docs-design-v3/<path>`)
   **with 2-4 lines of commentary** - what changed, the score delta, any gate flip. **Tom reviews in the
   conversation**, so every iteration must leave a reviewable comment with pictures; do not rely on
   buried committed files. (This is a standing preference.)
5. **Documentation stays CLEAN.** Do NOT let `design-audit/log.md` balloon - it is already long. Start a
   fresh **`docs/design-audit/v3-log.md`** with a concise rolling state: a score-trajectory table + a
   short per-iteration entry (what changed, gate status, score deltas, the PR-comment link). Keep the
   v2 `log.md` as the archived history; link to it, don't duplicate it. Append decisions to
   `../07-decision-log.md`, design-intent changes to `../06-design-notes.md`, and any core patch to
   `03-merge-tax-ledger.md` (tier + justification).
6. **`typecheck-client` clean + tests green**, then **one commit per iteration; push**.
7. **Re-score.** Stop at the v3 bar (>= 97% + all gates full + clean click-through) or after 15
   iterations; then post a final design-readiness summary as a PR comment (with the final shots).

## Setup

- Repo `/Users/tommy/Sites/abstract-vscode-spike`. **Branch `living-docs-design-v3` off `main`** (which
  now carries the v2 shell from merged PR #15). Open ONE `living-docs-design-v3` PR; commit each
  iteration; **post per-iteration before/after screenshots + commentary as PR comments** (step 4).
- **Start the model proxy** before model-dependent click-throughs: `./scripts/lwd-anthropic-proxy.sh`
  (Anthropic OAuth - needs Console credits), or
  `LWD_BACKEND=openrouter OPENROUTER_API_KEY_FILE=~/.config/lwd-openrouter.key ./scripts/lwd-anthropic-proxy.sh`
  for the cheap dev backend. `curl -s localhost:8090/healthz` should return `{"ok":true}`.
- Node 24: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.15.0`.
- `npm run watch` (own long-lived bg process; restart it if `watch-client-transpile` dies after a rapid
  edit). `npm run typecheck-client` to type-check `src/`. Tests:
  `./scripts/test.sh --grep "LivingDoc|AgentOrchestrator|screenRender|Present modal|livingDocs|treeRail|ActivitybarPart"`
  (runs against `out/` - wait for watch to recompile; grep the watch log for "Finished compilation").
- Run + drive: `./scripts/code-web.sh ./living-docs-sample` -> http://localhost:8080, driven with the
  **chrome-devtools MCP** (open the base URL; `?folder=` does NOT work). Save screenshots inside the
  repo (`docs/design-audit/shots/`). **Clear IndexedDB + reload** between checks to get a pristine state
  (the web build caches the builtin scan + theme + layout sizes; a stale split-group from a prior
  session otherwise persists).
- **Design reference (DesignSync):** project **"Agentic Workbench"** `d198ca07-9eef-4d05-96e1-b383e6c19c03`,
  file **`Living Documents - Workbench.dc.html`** (inline styles = the pixel spec; its `screenshots/`
  are rendered-state references).

## Hard-won lessons (carry from v1+v2 - do not relearn)

- **chrome-devtools cannot reach into the webview iframe** (cross-origin) - you can't programmatically
  select text or read the webview DOM from the top frame. Verify webview-internal behaviour (e.g. the
  selection toolbar, a figure click) by structural unit assertion + a screenshot, not by driving it.
- **The grid fixes part widths** - a CSS `width` override on `.part.activitybar` overlaps its neighbour
  (the grid still reserves the old width). Widths come from the part's min/max (core constants) or
  `IWorkbenchLayoutService.setSize` *after* the part is revealed + a layout tick.
- **Hygiene (husky precommit):** tabs only; **no non-ASCII in source** (HTML entities in webview HTML,
  `\uXXXX` in TS strings - the Edit tool may silently strip a control char, so set tricky literals via a
  script and grep the file for non-ASCII before committing); single space before `//`; no raw
  `setInterval`/`setTimeout` (use `disposableTimeout`); `querySelector` is allowed only inside webview
  `<script>` strings. End commits with
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **`@vscode/test-web` serves CACHED file reads** - edit a source in-app to see a sync change, not
  externally.
- The v2 figure-highlight path tokenizes `[value](bind:key)` before the sanitizing Markdown renderer and
  swaps the token for a styled span after (so no raw HTML is injected) - reuse that pattern for any
  webview HTML that must survive `renderMarkdown`.

## v3 backlog (priority order)

1. **Close G4 fully (the only open gate).** Remove the command-palette keybinding (`Ctrl/Cmd+Shift+P`,
   `F1`; and Quick Open's `>` command mode) and make the layout sashes non-draggable (no resizable
   panes). Sweep for other leaks (reopen-with, editor context menu, view drag-drop). Core patches
   allowed + logged. Re-verify nothing else regresses.
2. **Right rail content pixel-pass (75 -> 95).** Chat thread / Review cards / History to the comp's exact
   spacing, type, and colors; decide the **Skills** 4th tab (keep as a justified departure or fold it).
3. **Source-peek content (78 -> 95).** Render the comp's **raw CSV grid** (week/date/mrr/signups/churn/
   active rows with the latest row highlighted) in the in-surface pane, not just the bound-key table.
4. **Per-surface pixel finish to >= 95:** Home (80), Context (78), header (85), Templates/Agents/Present
   (85), doc editor (88), Knowledge (88) - typography, spacing, colors, and the comp's exact components.
5. **The activity-bar stub-launcher wrinkle:** when a screen nav item (Templates/Knowledge/Agents) is
   active, the sidebar shows a stub launcher view instead of keeping the tree-rail. Make the tree-rail
   persist (the comp keeps it) - the nav items should open the screen in the main area without swapping
   the sidebar away from the tree-rail.
6. **Minor finishes:** preserve bold/italic inside a bound paragraph in the highlight path; reconcile the
   icon-nav label set vs the comp's literal Home/Editor/Review; the per-agent canvas pixel pass.

## How to run this (paste into the fresh session, after PR #15 is merged)

```
/goal Take Living Documents from ~82% to >=97% design alignment with the "Agentic Workbench" comp (per docs/plans/12-design-alignment-v3-loop.md): pixel-finish every surface to >=95 and FULLY close the last open gate G4 (remove the command-palette keybinding + make the pane sashes non-draggable - remove, don't hide). Hold v1 functionality and the v2 shell. Core patches allowed where the design needs them, logged in the merge-tax ledger. Every iteration must post before/after screenshots + commentary as a PR comment (Tom reviews in the conversation), keep the docs clean (a fresh concise docs/design-audit/v3-log.md), and re-check every hard gate for regressions. Tracked in docs/design-audit/.

/loop Run one v3 design-alignment iteration per docs/plans/12-design-alignment-v3-loop.md. Iteration 1: re-audit only - build docs/design-audit/v3-inventory.md (Exists-today vs Design-intends + scores + ranked gaps, seeded from the v2 finals), no code. Later iterations: pick the highest-impact unmet gap (G4 closure + the right rail first), brainstorm if non-trivial, build it (TDD for logic; core patches allowed, logged in plans/03-merge-tax-ledger.md), verify live via chrome-devtools MCP AND re-check every hard UX gate for regressions, update the decision log (07) + design notes (06) + v3-inventory + a clean v3-log, commit one change on the living-docs-design-v3 PR, AND post that iteration's before/after screenshots embedded in a PR comment with commentary. Stop when overall >=97% AND every hard UX gate fully passes AND the live click-through is clean, or after 15 iterations.
```

`/loop` with no interval self-paces (one iteration per turn). **Iteration 1 is the re-audit** (no code).
Documentation + a reviewable PR comment (with pictures) are part of every iteration's definition of
done - the loop is not complete until the docs are clean and the conversation shows the proof.

## After the loop
Post a final readiness summary **as a PR comment** (per-surface before -> after, each gate pass/fail ->
pass, anything still deferred, the keep-fork-vs-greenfield read) with the final shots embedded; ensure
`v3-inventory.md` + `v3-log.md` reflect the shipped state; confirm the decision log, design notes, and
merge-tax ledger are current; update the `living-docs-*` memories with where the v3 shell stands.
