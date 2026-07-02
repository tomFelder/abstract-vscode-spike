# Plan 25 — Labeled 76px icon-nav (the calm primary nav)

> **For agentic workers:** implement with `superpowers:subagent-driven-development`. Stacked PRs
> off `main`, live-verified. Spec of record: [[20-abstract-ui-redesign-handoff]] (Parts B, C1,
> E row 7). Handoff wins over pixels. **This is the one item expected to need a core patch** -
> take it, keep it minimal, and log it.

**Goal:** Replace VS Code's stock ~48px unlabeled activity bar with the redesign's calm **76px
labeled icon-nav**: Home · Editor · Templates · Knowledge · Agents, with account + settings pinned
at the bottom and a white "chip" active state - so the primary nav reads as a calm document app,
not an IDE.

**Architecture:** The nav is VS Code's **activity bar part**
(`src/vs/workbench/browser/parts/activitybar/`), currently width-locked to 48px in
`activitybarpart.css:6-8`, with the living-docs screens registered as view containers in
`livingDocs.contribution.ts:249-304`. Getting a 76px **labeled** bar fights the upstream
one-icon-per-container model, so expect a **small, contained core patch** to the activity bar part
(width + label rendering + active chip), plus a nav entry for **Editor** (currently only Home /
Templates / Knowledge / Agents are registered - the comp adds Editor).

## Global constraints (from the spec)

- **Core-patch posture:** contrib/`styleOverrides`-first, but take a minimal core patch to the
  activity bar part if that is what a clean 76px labeled bar needs. **Log every core touch** in
  `docs/plans/03-merge-tax-ledger.md` and `docs/07-decision-log.md` (this is direct evidence for
  the fork-vs-greenfield question, Q3). Do not contort the contrib to avoid a clean small patch.
- Tokens verbatim from Part B: nav bg = `panel` `#F6F7F9`; active = white chip + `accent-hover`
  glyph + e1 shadow; label 10px; glyph 18px stroke; item 60px wide within the 76px bar.
- No em dash; Australian English; title-style capitalisation on nav labels.
- `typecheck-client` + `valid-layers-check` clean. Screenshots → `docs/plans/25-verify/`.
- Every PR: before/after + side-by-side vs the shell/nav region of
  `Abstract - UI Redesign.dc.html`; **and** a shot of each secondary surface (Templates /
  Knowledge / Agents) confirming nothing renders squeezed at the new width.

## Target (C1 · icon-nav), exact

- **Width 76px**, bg `panel`. Items **60px** wide, each an **18px** stroke glyph above a **10px**
  label. Order: **Home · Editor · Templates · Knowledge · Agents**. Account + settings pinned to
  the bottom.
- **Active item** = a white chip behind the item, `accent-hover` glyph, e1 elevation.
- **Editor** nav item opens the active/last living document, or a small doc picker if none is
  open (confirm in iter 1).

## Decisions to settle in iteration 1 (before patching core)

- **D25-A - CSS-override vs core patch.** First attempt: widen + label via a scoped
  `styleOverrides`/CSS layer without touching core. If labels + the active chip can't be done
  cleanly that way, take a minimal core patch to `activitybarpart` (width variable + optional label
  slot + active-chip class). Decide and record which path, with the diff, in the ledger.
- **D25-B - what "Editor" opens.** Recommend: the most-recently-active living doc; if none, a doc
  picker scoped to the open folder. Confirm.

## Iteration plan (each iteration = one stacked PR off `main`)

1. **Settle D25-A/D25-B**; spike the width change on the activity bar part and confirm the labeled
   layout is reachable (CSS-only if possible). Register the **Editor** nav entry in
   `livingDocs.contribution.ts` (add to the screen list, order it first-after-Home per the comp).
2. **76px labeled bar:** width 76px, `panel` bg, 60px items, 18px glyph + 10px label, correct order.
   Log any core patch in the ledger as you make it.
3. **Active chip state** (white chip + `accent-hover` glyph + e1) driven by the active screen/editor.
4. **Bottom-pinned account + settings**; confirm keyboard/focus + hover tooltips still work.
5. **Regression sweep:** open Home / Editor / Templates / Knowledge / Agents and the project-scale
   surfaces (plans 22-24) at the new width; confirm none render squeezed and the tree-rail +
   right-rail widths (264 / 392) are unaffected. Before/after shots of each.

## Acceptance criteria (verified live, then design-matched)

- [ ] Nav is 76px, `panel` bg, with labeled items Home · Editor · Templates · Knowledge · Agents in
      order; 18px glyph + 10px label; account + settings pinned bottom. _(iters 1-4)_
- [ ] Active item shows the white chip + `accent-hover` glyph + e1. _(iter 3)_
- [ ] The Editor nav item opens the active/last living doc (or the picker). _(iter 1, D25-B)_
- [ ] No secondary surface renders squeezed at 76px; tree-rail 264 / right-rail 392 unaffected.
      _(iter 5)_
- [ ] `typecheck-client` + `valid-layers-check` clean; **any core patch is minimal and logged** in
      `docs/plans/03-merge-tax-ledger.md` + `docs/07-decision-log.md`. _(D25-A)_
- [ ] Nav scores ≥ 90% vs the shell/nav region of `Abstract - UI Redesign.dc.html`.

## Verify approach

`npm run watch`; `./scripts/code-web.sh ./living-docs-sample/brief` (:8080); chrome-devtools drives
the workbench (the nav is workbench chrome, not inside the webview - screenshot the whole window).
Because this touches core layout, also run a **desktop real-disk smoke** for the final iteration
(`TMPDIR=/tmp` via `code.sh`) to confirm the bar renders in the packaged workbench, not only web.
Design-match loop as in plan 21 (→ ≥ 90%, log to `docs/design-audit/redesign-log.md`). Record the
core-patch decision (D25-A) and ledger entry from the current tail of `docs/07-decision-log.md`.

---

## Kickoff: driven by the master loop prompt (`docs/plans/RUN-abstract-redesign-loop.md`).
