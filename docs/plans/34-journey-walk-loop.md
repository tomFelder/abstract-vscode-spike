# Plan 34 - The journey walk: grade every journey, off-path included

> **For agentic workers:** run with `superpowers:subagent-driven-development`; this is an **assessment loop, not a build loop** - it produces evidence and specs, not fixes.
> Context of record: [18-beta-plan.md](../18-beta-plan.md) §2.3 and §5 step 1; the journey inventory and re-baselining rule in [13-journey-map-ratification.md](../13-journey-map-ratification.md) §6; the map itself at [journey-map-v4.dc.html](../journey-map-v4.dc.html); the walkability principle in [16-principles.md](../16-principles.md) §3.

**Goal:** An honest, evidence-backed grade for every journey 1a-1z (plus candidate 2b/2c behaviour where it exists), walked end to end **including off the golden path**, producing: the re-baselined BUILT/PARTIAL/GAP truth, per-journey specs with acceptance criteria for the aha-path journeys, and the prioritised fix list that becomes plan 37.

**Why this exists:** plans 26-33 are merged, yet the founder's lived assessment is "broken alpha - one step off the golden path and it falls over". Plan-completion is not journey-completion; this loop measures the gap instead of guessing at it.

## Hard rule: assess, don't fix

Nothing is fixed during the walk - no matter how tempting the one-liner. Every failure is logged with a repro, a severity and a screenshot. The output IS the work list; fixing-while-walking destroys the honesty and the speed of both.
(Sole exception: a broken build that prevents walking at all may be repaired, logged as environment work.)

## Prerequisites

- Web build serving (`./scripts/code-web.sh ./living-docs-sample`) driven via chrome-devtools MCP; desktop build for the journeys that need real folders and OS dialogs (1a native picker, T3 mixed formats).
- **A working model backend is required** - roughly half the journeys involve a live model call. The OpenRouter dev backend (doc 10) must have a funded key configured before starting; the plan-31 validator was blocked exactly here. If no backend is reachable, stop and report rather than grading model journeys as broken.
- Three test folders: the shipped sample (golden path), a **fresh empty folder** (empty states), and a **messy real-world folder** the walker assembles first (15-30 files: nested subfolders, a `.docx`, a `.doc`, an image, a CSV, some `.md` with odd formatting) for the off-path truth and the T3 probe.

## The grading rubric

Each journey gets one grade plus notes:

| Grade | Meaning |
|---|---|
| **WALKABLE** | End to end without falling over, including the standard off-path probes; may be plain, may have polish gaps |
| **FRAGILE** | Golden path works; one or more off-path probes break it (error swallowed, dead-end, wrong state, data loss) |
| **BLOCKED** | Cannot be completed even on the golden path |
| **MISSING** | The journey's surface does not exist yet |

Standard off-path probes, applied to every journey where they make sense: empty state (no docs / no sources / no proposals), cancel mid-flow, invalid input, the model backend erroring or timing out, a second rapid repeat of the action, navigating away mid-operation and back, and (for anything writing) whether the result survives an app restart. Any **data-loss** finding is automatically severity-1 regardless of grade.

## Iteration plan

### Iteration 1 - Environment + groups A and B (the aha path)

- Stand up web + desktop + model backend + the three folders; record the setup in `34-verify/environment.md`.
- Walk group A (1a, 1b, 1c, 1d, 1w, 1x) and group B (1e, 1f, 1g, 1h) against all three folders. These groups carry the beta gate's aha path - probe them hardest.
- Include the T3 probe (mixed-format folder open) and record what actually happens to `.doc`/`.docx` today.
- Output: `34-verify/journey-grades.md` started - one section per journey: grade, probe results, repro steps for every failure, screenshots.

### Iteration 2 - Groups C, D, E, F + candidates

- Walk 1i-1l (across documents), 1m-1p + 1y (context & trust), 1q-1t + 1z (living documents), 1u-1v (work goes out).
- Where a journey's decision defers scope (D16 table-not-graph, D18 light audit, D20 no scheduled generation), grade against the **decided** v1 scope, not the map's fullest frame - the decisions in doc 13 §2 are the spec.
- Probe candidate behaviour that should already partially exist: 2c ask-the-project (D24 says critical v1), 2b first-run orientation (does anything orient today?).
- Output: `journey-grades.md` complete for all 26 journeys; a one-screen summary table at the top (journey · grade · severity-1 count).

### Iteration 3 - Specs for the aha-path journeys (map brief task ②, scoped)

- For every group A + B journey plus 1p (provenance peek) and the D26 onboarding flow: write the detailed spec - steps, states, empty/error cases, and **per-journey acceptance criteria** a build can be validated against.
- Specs land as `docs/20-journey-specs-aha-path.md` (one section per journey, following the map's frame structure); each spec cites its journey id, its governing decisions (map-D numbers), and the walk findings it must cure.
- Non-aha-path journeys do not get specs this loop - they get their walk findings only; specs follow when their fix loop is scheduled.

### Iteration 4 - The verdicts

- **Re-baselined chip table**: journey → old map chip → walked grade, appended to `journey-grades.md` and proposed as an update note for doc 13 §6 (do not edit docs 13-19 directly if the formatting reflow is still in flight; deliver the table and let it be folded in after).
- **The prioritised fix list**: every FRAGILE/BLOCKED/MISSING finding, ordered by (1) severity-1 data loss first, (2) aha-path before everything, (3) cheapest-first within a tier. This list, plus the iteration-3 specs, is the raw material for **plan 37 - journey robustness**; draft that plan's iteration skeleton as the final act.
- **Gate check**: an explicit yes/no per beta-gate requirement in doc 18 §2.3 ("every GAP on the aha path at least partially filled; every PARTIAL on that path off-path-fixed") - stated as what remains, not as opinion.

## Acceptance criteria

- [ ] All 26 journeys graded with evidence (repro + screenshot per failure); no journey graded from reading code alone. _(iters 1-2)_
- [ ] Every severity-1 (data loss) finding has a minimal repro recorded. _(iters 1-2)_
- [ ] Aha-path specs written with per-journey acceptance criteria, citing decisions and findings. _(iter 3)_
- [ ] Re-baselined chip table + prioritised fix list + plan-37 skeleton delivered; doc 18 §2.3 gate check answered. _(iter 4)_
- [ ] Zero product code changed by this loop (environment repairs excepted and logged).

## Verify approach

This loop IS verification; its own check is evidence discipline: every grade traces to a recorded walk (screenshot or replay), every failure has a repro someone else could run, and the summary table matches the per-journey sections. Spot-audit three journeys' evidence before calling an iteration done.
