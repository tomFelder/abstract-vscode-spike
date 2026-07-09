# Plan 34 - Journey walk (does the north star actually happen?)

> **For agentic workers:** implement with `superpowers:subagent-driven-development`.
> Small, live-verified, stacked PRs off `main`.
> Context of record: the north-star narrative in [12-north-star-and-future-features.md](../12-north-star-and-future-features.md) §1 (the script this loop replays); the surfaces table and findings in [11-product-review-2026-07.md](../11-product-review-2026-07.md) §1-3; ledger rules in [03-merge-tax-ledger.md](03-merge-tax-ledger.md).

**Goal:** Priya's Monday morning actually happens in the running app. Every core end-to-end journey - not each feature in isolation, but the whole walk and every transition between surfaces - completes live, calm, and truthful, from the greeting to the recorded receipt. This is the first loop that assumes plans 26-33 are all merged; its job is to walk the seams between them that no single feature plan owned, score each step, and close whatever the walk exposes.

**Architecture:** A review-and-polish loop, not a feature loop. Almost entirely our-surface fixes at the cheapest tier (settings → theme → styleOverrides-CSS → additive-contribution → core-patch), in keeping with the ledger's discipline. The value is the *walk*: driving each journey end-to-end in the live build, capturing a numbered filmstrip, scoring every surface and every transition, and fixing the defects the seams reveal. No new feature is introduced here; anything that turns out to need real feature work is logged as a finding and routed to a future plan rather than half-built in this loop.

**Tech stack:** whatever surface the walk lands on - `screenRender.ts`/`livingDocRender.ts`, `reviewRailView.ts`, `treeRailView.ts`, `livingDocEditor.ts`, `screenEditor.ts`, `livingDocs.contribution.ts`, `studio.css`; chrome-devtools for the live drive; filmstrips and scorecards under `docs/plans/34-verify/`.

## Global constraints

- **Real data only.** The walk is the product: no step may pass on a fabricated count, a stubbed version, a dead button, or a leaked IDE artefact. A journey that only completes because a surface lies is a failed journey, logged as such.
- **Everything routes through the review engine.** The walk exercises the existing approve path; it never adds a new write/apply path to make a step work.
- **Fix, don't rebuild.** In-scope fixes are our-surface polish (copy, state, transition, empty/idle/failure states, calm-shell leaks). Anything that needs genuine feature work is a finding routed to a future plan, not built here.
- **Ledger discipline.** Every change logged with its tier in [03-merge-tax-ledger.md](03-merge-tax-ledger.md); core patches fail-soft only; budget for this loop: **0 new core patches** (a walk-and-polish pass should need none - if one seems required, stop and record it as a finding).
- Do not regress the calm shell (16), multi-doc working set (18), editor-led review (19), the redesign surfaces (21-25), or the plan 26-33 features.
- Tabs; nls strings; Australian English; no em dashes; title-style caps on labels.
- `typecheck-client` + `valid-layers-check` + `check-seams` clean per PR; filmstrips to `docs/plans/34-verify/`.

## The journeys (walk list)

Each journey is a script drawn from the north star (doc 12 §1) and the surfaces it must cross (doc 11 §1). A walk passes only when every step and every *transition between steps* is real and calm.

| # | Journey | The script (north star) | Surfaces crossed | Plans it integrates |
|---|---|---|---|---|
| J1 | **Daily approval loop** | Land on Home → "two documents need you" → open one → read the meaning-change diff in the document, with source row + rationale + confidence → tweak one word → accept → History records "refresh · N figures auto-applied · M meaning changes" → the `Saved · vN` chip is truthful | Home, editor, in-editor review, gutter, History tab, version chip | 26, 31 |
| J2 | **Data refresh + provenance** | Change a source value on disk → refresh → figures auto-derive and auto-apply → only the meaning changes wait → source-peek from a bound number opens the exact CSV row / API field → every bound atom answers "from `metrics.csv`, synced 2 h ago" on hover | sources, refresh, gutter, source-peek drawer, freshness affordance | 29, 26 |
| J3 | **Cross-document fan-out** | One instruction across the project → the swarm grid + decisions column fill from real run data → the turn streams and can be cancelled → all proposals land in one cross-doc review rail → Accept / Tweak / Reject per change with source + confidence → policy gates auto-apply vs review → History spans the batch | fan-out run screen, streaming turn, cancel, cross-doc review, Tweak, orchestration policy | 27, 31, 32 |
| J4 | **On-ramp: templates + knowledge** | New document → the name-or-template sheet (not a blank file) → pick a template → Generate-draft runs through the review engine → Knowledge holds the real source library → bind a source, see its freshness and its fan-in | new-document sheet, Templates screen, Knowledge screen, review engine | 28, 29 |

## Iteration plan

Each iteration walks one journey end-to-end in the live build, produces a filmstrip + a scorecard, then fixes the in-scope defects the walk exposed.

### Iteration 1 - Walk J1 (daily approval loop)

- Drive the north-star script in the web build against the ISMS sample (or the sample whose data is freshest): Home greeting → NEEDS YOU card → open doc → in-editor meaning-change review → tweak → accept → History → version chip. Screenshot every step and every transition as a numbered filmstrip (`34-verify/j1-NN-*.png`).
- Score each surface and each transition 0-100 against the script (does the step happen, is it calm, is it truthful); record in `34-verify/j1-scorecard.md` with a defect list (severity: blocks-journey / breaks-calm / polish).
- Fix the in-scope defects our-surface (transition jank, missing rationale/confidence framing, an untruthful chip, a capped History). Route anything needing feature work to a finding.
- Gate: J1 completes end-to-end with no fabricated or dead step; filmstrip + scorecard committed; blocks-journey and breaks-calm defects fixed or explicitly routed.

### Iteration 2 - Walk J2 (data refresh + provenance)

- Edit a bound source value on disk, refresh, and walk the auto-apply vs meaning-change split, then follow provenance from a bound number to its exact source row and check the hover freshness signal. Filmstrip `j2-NN-*`.
- Score + defect list as above; fix shallow-provenance polish and freshness affordance gaps that are our-surface; route deeper source-resolution gaps to a finding.
- Gate: a source change flows to a truthful review with working source-peek and a real freshness signal; filmstrip + scorecard committed.

### Iteration 3 - Walk J3 (cross-document fan-out)

- Run one instruction across the project sample; watch the swarm grid + decisions column populate from real run data; confirm the turn streams and cancel works; walk the unified cross-doc review with Accept / Tweak / Reject and confirm policy gating; check History spans the batch. Filmstrip `j3-NN-*`.
- Score + defect list; fix streaming/cancel affordance polish, Tweak framing, and review-rail transition gaps our-surface; route orchestration-policy gaps to a finding.
- Gate: the fan-out journey completes with visible streaming, a working cancel, a real Tweak, and a batch-spanning History; filmstrip + scorecard committed.

### Iteration 4 - Walk J4 (templates + knowledge on-ramp)

- From a fresh project, create a document via the name-or-template sheet, generate a draft through the review engine, then open Knowledge, bind a source, and confirm freshness + fan-in. Filmstrip `j4-NN-*`.
- Score + defect list; fix on-ramp and library polish our-surface; route missing template/knowledge feature depth to a finding.
- Gate: a new user can start from a template and reach a bound, reviewable draft with no "Soon" stub in the path; filmstrip + scorecard committed.

### Iteration 5 - Cross-journey calm sweep + the walk scorecard

- Walk the four journeys back-to-back and audit the *transitions between journeys* and the shared states they all pass through: empty/idle/failure states, the nav between surfaces, back-navigation, and any calm-shell leak that only shows mid-journey (title bar, crumb naming, stray chrome).
- Produce `34-verify/journey-scorecard.md`: a per-journey and per-transition score with the north-star script quoted alongside, plus a single "does the north star happen" verdict and the routed-findings list (each with a target plan).
- Gate: every journey scores at or above the agreed bar (recommend >= 90, matching the redesign surfaces); the scorecard names every remaining gap and where it is routed; `typecheck-client` + `valid-layers-check` + `check-seams` clean.

## Acceptance criteria

- [ ] J1-J4 each walked end-to-end in the live build, each with a committed filmstrip and scorecard, each completing with zero fabricated / dead / leaked steps. _(iters 1-4)_
- [ ] Every blocks-journey and breaks-calm defect is fixed our-surface or explicitly routed to a named future plan with a finding. _(iters 1-5)_
- [ ] The cross-journey sweep audits inter-surface transitions and shared empty/idle/failure states; `journey-scorecard.md` carries a per-journey score >= the agreed bar and a "does the north star happen" verdict. _(iter 5)_
- [ ] 0 new core patches (or the single exception recorded as a finding, not taken); ledger updated for any tiered change. _(iters 1-5)_
- [ ] `typecheck-client` + `valid-layers-check` + `check-seams` clean.

## Verify approach

Web :8080 is the primary stage; drive every journey with chrome-devtools, capturing a numbered filmstrip per journey (mirror the `25-3-sweep-*.png` naming, namespaced `j1`/`j2`/`j3`/`j4`). A desktop pass covers any step whose calm/leak behaviour differs from web (window title, native menus mid-journey). The scorecards are written as the walk goes, with the north-star script quoted next to each score so the verdict is auditable from the verify folder alone. Ledger and finding-routing updates land in the same PR as the change or verdict they record.
