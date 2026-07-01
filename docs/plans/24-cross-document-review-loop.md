# Plan 24 — Cross-document review surface (step through the whole project)

> **For agentic workers:** implement with `superpowers:subagent-driven-development`. Stacked PRs
> off `main`, live-verified. Spec of record: [[20-abstract-ui-redesign-handoff]] (Parts B, C5,
> E row 6c). Handoff wins over pixels. **New surface**, but it **reuses the existing review
> engine** - do not rebuild approve/reject.

**Goal:** Build the dedicated cross-document review view (C5): a doc-nav rail listing every
document with changes and review progress, a centre column that steps through one document's
changes as cards carrying **source + confidence**, and a sticky action bar for batch-accept and
"next document". This is where a project-wide run (plan 23) lands.

**Architecture:** A new full-area `ScreenEditor` screen (e.g. screen id `'review-project'`) in
`screenRender.ts`, driven by the **existing** living-docs review model: the same pending changes,
grouped by document, and the same service methods the rail already uses -
`approve`/`reject`/`approveAll(docId)`/`rejectAll(docId)`/`approveAllPending`
(`reviewRailView.ts` is the reference consumer). This surface is a second *presentation* of that
model at project scale; the rail (C6 Review) stays exactly as is. Our-surface; no core patch
expected.

## Global constraints (from the spec)

- **Reuse the engine.** No new approve/reject logic - call the existing service methods. The change
  model already exists; this plan renders it, it does not re-derive it.
- **Real data only.** Documents, changes, source lines, and confidence come from real pending
  changes. Confidence maps the engine's existing signal to the two comp states: `● High`
  (`ok`/accent) and `◐ Inferred` (`attention`, "needs your eyes"). If the engine only has a
  numeric confidence, map a threshold to High vs Inferred and log the mapping (decision entry).
- Tokens verbatim from Part B; doc-nav 292px; confidence chips use `ok`/`accent` and `attention`.
  No em dash; Australian English.
- `typecheck-client` + `valid-layers-check` clean. Screenshots → `docs/plans/24-verify/`.
- Every PR: before/after + side-by-side vs the "Cross-doc review" region of
  `Abstract - UI Redesign.dc.html`.

## Target (C5), exact

- **Left doc-nav rail (292px):** a header count `N docs · M changes`, a progress bar, then a list
  of documents each with a status glyph - `✓ reviewed` / `● current` / `○ pending` - and its
  change count. Clicking a document makes it the current one in the centre column.
- **Centre review column:** the current document's title, then one **card per change**: the change
  shown **in context**, a source chip `decision · line NN`, a confidence chip `● High` /
  `◐ Inferred`, and **Accept / Tweak / Reject** actions per change (Accept→`approve(id)`,
  Reject→`reject(id)`; Tweak = open the change for inline edit / focus the doc, reuse plan-19
  navigate-to-inline where possible).
- **Sticky doc action bar (bottom):** `Accept all N here` (→ `approveAll(docId)`) and
  `Next: <doc> →` (advance to the next document with pending changes). A project-level
  `Accept all remaining` is legitimate here too (→ `approveAllPending`).

## Decision to settle in iteration 1

- **D24-A - confidence mapping.** Confirm how the engine's confidence becomes `● High` vs
  `◐ Inferred`. Recommend: a change flagged by the engine as inferred/meaning-change with lower
  confidence → `◐ Inferred`; otherwise `● High`. Log the exact rule.

## Iteration plan (each iteration = one stacked PR off `main`)

1. **Screen scaffold + doc-nav rail.** Register `review-project`; render the 292px rail from real
   pending changes grouped by document, with counts, progress bar, and ✓/●/○ status. Settle D24-A.
2. **Centre review column - change cards** for the current document: change in context + source
   chip `decision · line NN` + confidence chip. Read-only first (correct data, correct chips).
3. **Per-change actions** Accept / Tweak / Reject wired to the existing service methods; the rail's
   own state stays in sync (both surfaces reflect the same model).
4. **Sticky action bar:** `Accept all N here` + `Next: <doc> →` (advance current) +
   `Accept all remaining`; a clear "all reviewed" end state when nothing is pending.
5. **Wire the entry from plan 23:** the fan-out's **Review across the project →** opens this screen
   on the first document with changes (replace the interim Review-rail route).
6. **E2E:** from a plan-23 run over `living-docs-sample-isms/`, click **Review across the project**,
   step doc → doc accepting/rejecting, use `Accept all here` and `Next`, reach the reviewed end
   state. Before/after shots; confirm the rail still works independently.

## Acceptance criteria (verified live, then design-matched)

- [ ] Doc-nav rail (292px) shows `N docs · M changes`, a progress bar, and ✓/●/○ per doc with
      counts, all real. _(iter 1)_
- [ ] Centre cards show the change in context + `decision · line NN` source chip + `● High` /
      `◐ Inferred` confidence chip. _(iters 2, D24-A)_
- [ ] Accept / Tweak / Reject per change and `Accept all here` / `Next` / `Accept all remaining`
      all drive the **existing** engine; the rail stays in sync. _(iters 3-4)_
- [ ] Plan 23's "Review across the project →" lands here on the first changed doc. _(iter 5)_
- [ ] The C6 Review rail is unchanged and still fully works. _(observed throughout)_
- [ ] `typecheck-client` + `valid-layers-check` clean; **0 core patches**.
- [ ] Screen scores ≥ 90% vs the "Cross-doc review" region of `Abstract - UI Redesign.dc.html`.

## Verify approach

`npm run watch`; `./scripts/code-web.sh ./living-docs-sample-isms` (:8080) + OpenRouter proxy
:8090; chrome-devtools drives the webview. Produce real pending changes via a plan-23 whole-project
run, then review them here. Design-match loop as in plan 21 (→ ≥ 90%, log to
`docs/design-audit/redesign-log.md`). Log decisions (D24-A) from the current tail of
`docs/07-decision-log.md`.

---

## Kickoff: driven by the master loop prompt (`docs/plans/RUN-abstract-redesign-loop.md`).
