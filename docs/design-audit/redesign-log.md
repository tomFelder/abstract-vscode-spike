# Design-match log — Abstract UI Redesign (plans 21-25)

Scores each built surface against its region of the companion pixels
`Abstract - UI Redesign.dc.html` (claude.ai/design project
`d198ca07-9eef-4d05-96e1-b383e6c19c03`), using the Part B tokens + Part C px specs in
`docs/plans/20-abstract-ui-redesign-handoff.md` as the rubric.

Reuse the conventions from the existing `docs/design-audit/` logs (v2/v3/v4): per-surface score,
a short gap backlog, and the iteration that closed each gap.

| Surface (plan) | Comp region | Baseline % | Final % | PR | Notes |
|---|---|---|---|---|---|
| Labeled 76px icon-nav (plan 25 iter 1) | C1 icon-nav / comp "ICON NAV 76px" block | ~85% (nav was hidden on the brief root) | ~93% | (PR pending) | Width/item/glyph/label/panel-bg/order all exact vs the comp (76 / 60 / 18px / 10px·500 / `#F6F7F9` / Home·Editor·Templates·Knowledge·Agents). Editor entry added + opens a Living Document. Deltas are 25.2/later scope. |

## Per-surface gap backlogs

_(appended by the loop as it iterates each surface to ≥ 90%)_

### Labeled 76px icon-nav (plan 25 iter 1) — gap backlog

Measured live at 1440x900 against the comp's "ICON NAV 76px" block (offset ~29202 in
`Abstract - UI Redesign.dc.html`).
Iter-1 acceptance (bar-width + labels + order) is fully met at pixel spec; the open gaps below are
explicitly 25.2 / later scope.

- **Active chip** — the comp's active item is a white chip (`#fff`) with an `accent-hover` (`#4650b8`)
  glyph and an e1 shadow (`0 1px 3px rgba(20,22,28,.08)`). Live still uses the stock activity-bar
  active treatment. _(25.2, iter 3.)_
- **Account + settings pinned bottom** — the comp pins a person + gear glyph at the bottom of the rail.
  Live hides them (studio.css hides the Accounts + Manage global actions). Restoring a calm labeled
  account/settings at the bottom is _(25.2, iter 4.)_
- **Divider after Editor** — the comp draws a 34px x 1px hairline (`#e4e6ea`) between Editor and
  Templates (separating the two "document" entries from the three "surface" entries). Not yet rendered.
  _(backlog; cheap CSS spacer, fold into 25.2.)_
- **Extra Workspace + Explorer icons before Home** — the fork keeps the tree-rail ("Workspace") and the
  native File Explorer as activity-bar containers (deliberate, decision 42), so the live rail shows two
  icons the comp's clean 5-item list does not. The Explorer's label ("Explorer (Shift+Cmd+E)") also
  overflows the 60px item. _(pre-existing; out of plan-25 scope, flag for a nav-tidy pass.)_

### Labeled 76px icon-nav (plan 25 iter 2) — design-match 93%, gap backlog

Measured live at 1440x900 against the comp's "ICON NAV 76px" block in
`Abstract - UI Redesign.dc.html`. Iter 2 closed the three big iter-1 gaps: the **active white chip**,
the **bottom-pinned account/settings**, and the **stray Workspace/Explorer icons** (nav is now exactly
Home . Editor . Templates . Knowledge . Agents). Verified live that the chip TRACKS the active surface
(Home -> Editor moved the chip; glyph `rgb(70,80,184)`=#4650B8, white bg, e1 shadow) and the 264px
tree-rail still renders + a document opens beneath it.

Score: **93%** (up from ~93% on the iter-1 *slice* — now scoring the whole nav: width + labels + order
+ active chip + bottom pins + clean 5-item set, all present and matching).

Remaining gaps (diminishing returns; not worth further core-adjacent effort):
- **Divider after Editor** — the comp draws a 34px x 1px hairline (`#e4e6ea`) between Editor and
  Templates. Not rendered live. ~3%. _(cheap CSS spacer; the activity bar has no per-item separator slot,
  so a robust `::after` on the Editor item is the likely route — a small later polish.)_
- **Inactive glyph colour** — comp inactive glyph is `#868B95`; live computes `#606060` (the inline theme
  foreground). The `#868B95` override is authored but was not reliably present in the loaded CSS bundle at
  verify time (a live `<style>` injection of the exact selector DID apply it, confirming the rule is
  correct) — both are muted greys, visually near-identical. ~2%.
- **Custom SVG glyphs vs codicons** — the comp uses bespoke 1.8px-stroke SVGs; live uses the nearest
  codicons (home / edit / layout / library / sync, + accounts / gear). Pre-existing since 25.1. ~2%.

### Labeled 76px icon-nav (plan 25 iter 3, FINAL) — design-match 96%, both logged gaps CLOSED

Measured live at 1440x900 on `:8080` against the comp's "ICON NAV 76px" block in
`Abstract - UI Redesign.dc.html` (Editor active in both, matching the comp's active state).
Iter 3 was the regression sweep + the design-match finish; it closed the two remaining 25.2 gaps
with two small, scoped `studio.css` rules (0 new core patches):

- **Inactive glyph colour (was ~2%) — CLOSED.** Root cause found: `activityBar.css` paints inactive
  items `--vscode-descriptionForeground` (`#606060`) via an `!important` rule tied with the studio
  override at (0,9,0) specificity, and it lands later in the cascade so it won the tie. Adding the real
  `.composite-bar` ancestor to the studio selector takes it to (0,10,0) and it wins outright. Live now
  computes `rgb(134,139,149)` = `#868B95` (comp) on every inactive glyph + label.
- **Divider after Editor (was ~3%) — CLOSED.** Rendered as a `::before` on the Templates item (the first
  collections item, matched by its stable `codicon-living-docs-templates` class): `34px x 1px` `#E4E6EA`,
  `4px` vertical margin, centred (the item is flex-column-centre). Matches the comp's
  `<div style="width:34px;height:1px;background:#e4e6ea;margin:4px 0">` between Editor and Templates.

Score: **96%** (up from 93%). Remaining ~4% is diminishing-returns / spec-compliant, not chased:
- **Custom SVG glyphs vs codicons** — the comp uses bespoke 1.8px-stroke SVGs; live uses the nearest
  codicons. Pre-existing since 25.1. ~2%.
- **Label font** — comp uses Instrument Sans; live uses `system-ui`. Part B explicitly names `system-ui`
  an acceptable fallback ("the ramp is what matters, not the specific face"), so this is spec-compliant.
- **Active-chip shadow** — live uses the Part-B e1 token `0 1px 2px rgba(20,22,28,.05)`; the comp's inline
  value is `0 1px 3px rgba(20,22,28,.08)`. The handoff (Part B) WINS over the comp pixels, so live is
  correct per spec.

## Plan 25 complete — the labeled 76px nav (Part E row 7) and the whole Abstract UI Redesign loop

The final row of the redesign build-order (`docs/plans/20-abstract-ui-redesign-handoff.md`, Part E) is
landed. Across plan-25 iters 1-3 (the row flagged as "the one item expected to need a core patch"):

- **Regression sweep (iter 3, live at 1440x900 on `:8080`):** Home, Editor, Templates, Knowledge, Agents
  — and the project-scale agent-run canvas (plans 23/24) — all render intact at the 76px nav width; none
  is squeezed. The active chip tracks the surface correctly (Home -> Editor -> Templates -> Knowledge ->
  Agents). Tree-rail and right rail are unaffected by the nav change (the sidebar/aux sizing code was
  never touched by plan 25); they render at ~252 / ~374 px in the browser (modernUI floating-parts inset
  shaves ~12/18px off the configured 264 / 392 `_pinShellWidths` values — a pre-existing shell-chrome
  artifact present since the modernUI overrides, not a plan-25 regression).
- **Nav design-match: 96%** vs comp C1 (>= 90% gate met), both logged gaps closed.
- **0 new core patches** across the entire plan-25 stack (still 5 added core patches total, unchanged
  since v3). The 76px `ACTIVITYBAR_WIDTH` seam was paid once in v2 iter 9; everything else rode on
  styleOverrides CSS + additive contributions. This is direct greenfield-vs-fork evidence (Q3): the item
  singled out as the most likely fresh core patch cost zero new core across three iterations.
- **Desktop real-disk smoke: deferred** (matching decision 71's precedent) — the packaged Electron build
  is impractical to drive from the browser-bound chrome-devtools session, and iter 3 changed only
  appearance CSS. A 2-minute manual desktop check (`./scripts/code.sh ./living-docs-sample/brief`, or the
  `launch` skill, with `TMPDIR=/tmp`) should confirm the 76px labeled nav + active white chip render in
  the packaged workbench, not only web.
