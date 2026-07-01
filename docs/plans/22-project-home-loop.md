# Plan 22 — Project home dashboard (NEEDS YOU · ALL PROJECTS)

> **For agentic workers:** implement with `superpowers:subagent-driven-development`. Small,
> live-verified, stacked PRs off `main`. Spec of record: [[20-abstract-ui-redesign-handoff]]
> (Parts B, C3, E row 6a). Handoff wins over pixels.

**Goal:** Replace the current Home screen with the redesign's project on-ramp: a greeting, a
prominent **NEEDS YOU** section (up to two cards for the documents that need the user's review),
and a compact **ALL PROJECTS** grid - all read from the **real open folder**, never fabricated.

**Architecture:** Home is rendered by `renderHome` in
`src/vs/workbench/contrib/livingDocs/browser/screenRender.ts:111-159` and shown via the
`ScreenEditor` webview. This plan reshapes that render function and the data it derives from the
living-docs service (pending changes, doc/source counts, recent folders). Our-surface only; no
core patches expected.

## Global constraints (from the spec)

- **Real data only.** NEEDS-YOU cards come from actual documents with pending changes in the open
  folder; counts (`N docs · M sources`) are counted from the real folder. If nothing is pending,
  the NEEDS-YOU section is absent (not a fake card). This continues the plan-17 "drop fake v14"
  rule - never invent an ISMS with 38 changes; show what is truly there.
- **The folder is the project** (decision #39). Empty state (no folder open) = a single calm
  "Open a folder to begin."
- Tokens verbatim from Part B; background = `canvas` `#F8F9FB`; cards on `paper`. No em dash;
  Australian English.
- `typecheck-client` + `valid-layers-check` clean. Screenshots → `docs/plans/22-verify/`.
- Every PR: before/after + side-by-side vs the "Home dashboard" region of
  `Abstract - UI Redesign.dc.html`.

## Target (C3), exact

- **Greeting:** H1 greeting + one summary line (e.g. "N documents need your review across this
  project", derived from real pending state; when nothing pends, a calm "Everything is in sync").
- **NEEDS YOU** (only when there is pending work): up to **2** prominent cards. Each card:
  accent **top-border**, a **pulse dot** (opacity 1↔.35 over 2.4s), the doc/project name, a
  primary **Review** button (opens that doc's review / the cross-doc review of plan 24), and an
  amber **`N TO APPROVE`** chip (`attention` tokens). Pick the two docs with the most pending
  changes.
- **ALL PROJECTS:** a compact grid. Each tile: a **2-letter avatar** (colour from the Part B
  avatar palette, chosen deterministically per project name), the project name, a
  **health/approval badge** (e.g. "In sync" `ok` / "N to approve" `attention`), and a mono line
  **`N docs · M sources`**.
- **Empty state:** no folder open → "Open a folder to begin." (single calm action).

## Decision to settle in iteration 1 (confirm before building the grid)

- **D22-A - what populates ALL PROJECTS when only one folder is open.** The folder is the project,
  so there is normally one. Recommend: show the current project prominently **plus** recent
  folders (from the workbench recently-opened list) as additional tiles, each opening that folder.
  This makes "ALL PROJECTS" truthful (real recent projects) without inventing data. Confirm this
  vs "show only the current project as a single tile". Settle with Tom in iter 1; default to the
  recommendation if unattended.

## Iteration plan (each iteration = one stacked PR off `main`)

### Iteration 1 — Data + NEEDS YOU
- Derive, from the living-docs service, per-document pending-change counts for the open folder and
  the total. Settle D22-A.
- Render greeting + summary line from that real state.
- Render the NEEDS-YOU section: up to two cards for the top docs by pending count, with accent
  top-border, pulse dot, `N TO APPROVE` amber chip, and a primary Review button wired to open that
  document (and later the cross-doc review). Hide the whole section when nothing pends.
- Gate: with `living-docs-sample/brief` + a real agent run that leaves pending changes, Home shows
  a NEEDS-YOU card with the true count and the Review button opens that doc. With a clean folder,
  no NEEDS-YOU section and an "in sync" summary.

### Iteration 2 — ALL PROJECTS grid + empty state
- Render the compact grid per D22-A: avatar (deterministic colour), name, health/approval badge,
  mono `N docs · M sources` (counted from the real folder; sources = files referenced by `bind:`/
  `sources:`/`context:` in the folder).
- Wire each tile to open its folder/project.
- Confirm the no-folder empty state renders "Open a folder to begin." only.
- Gate: grid tiles show true doc/source counts and correct badges; clicking a tile opens the
  project; empty state correct.

## Acceptance criteria (verified live, then design-matched)

- [ ] Home reads from the open folder: greeting + summary reflect real pending state. _(iter 1)_
- [ ] NEEDS YOU shows up to 2 cards (accent border, pulse, `N TO APPROVE` chip, Review button)
      only when work is pending; hidden when in sync. _(iter 1)_
- [ ] ALL PROJECTS grid shows avatar + name + health badge + mono `N docs · M sources`, all real;
      tiles open the project. _(iter 2)_
- [ ] Empty state = single "Open a folder to begin." _(iter 2)_
- [ ] `typecheck-client` + `valid-layers-check` clean; **0 core patches**.
- [ ] Home scores ≥ 90% vs the "Home dashboard" region of `Abstract - UI Redesign.dc.html`.

## Verify approach

`npm run watch`; `./scripts/code-web.sh ./living-docs-sample/brief` (:8080) + OpenRouter proxy
:8090; chrome-devtools drives the webview. To exercise NEEDS-YOU, run a real cross-doc instruction
so genuine pending changes exist, then open Home. Design-match loop as in plan 21 (screenshot →
`DesignSync get_file` the comp → compare vs Part B/C3 → iterate to ≥ 90% → log to
`docs/design-audit/redesign-log.md`). Log decisions (incl. D22-A) from the current tail of
`docs/07-decision-log.md`.

---

## Kickoff: driven by the master loop prompt (`docs/plans/RUN-abstract-redesign-loop.md`).
