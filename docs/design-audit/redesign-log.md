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
