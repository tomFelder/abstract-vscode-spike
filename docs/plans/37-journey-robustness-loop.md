# Plan 37 - Journey robustness: make the aha path survive one step off the golden path

> **For agentic workers:** implement with `superpowers:subagent-driven-development`; small, live-verified, stacked PRs off `main`. This is a **build loop** - it fixes the findings plan 34 assessed; it does not re-grade.
> Context of record: the prioritised fix list and gate check in [34-verify/journey-grades.md](34-verify/journey-grades.md) §iteration-4; the aha-path specs in [20-journey-specs-aha-path.md](../20-journey-specs-aha-path.md); the gate requirements in [18-beta-plan.md](../18-beta-plan.md) §2.3; the principles in [16-principles.md](../16-principles.md) (P0 trust, P3/engine review-routing, journey-completeness, "spec the merge").

**Goal:** Every aha-path journey survives the standard off-path probes, not just the golden path. Approved work survives a reload; a model outage always names itself; the aha-path GAPs (1w, 1x, the 1b "From sources" and 1d file ops) get their smallest walkable v1. When this loop closes, doc 18 §2.3 requirements R2/R3 are met and R4's survivability blocker (X1) is gone.

**Why this exists:** plan 34 walked all 26 journeys and found the app is a golden-path alpha - one step off the path and it falls over. The single severity-1 is X1 (approved work lost on reload); the sharpest trust breach is a model outage on the fan-out path rendering identically to "no changes needed". This loop clears the fix list plan 34 emitted, in its priority order.

## Hard rule: build to the spec, don't re-scope

Each fix is validated against its acceptance-criteria checkbox in [20-journey-specs-aha-path.md](../20-journey-specs-aha-path.md) - not against a fresh interpretation. Where the spec marks a surface **[minimal v1]** (1d, 1w, 1x), build exactly that floor; deferred frames stay deferred and must not appear as dead affordances. No new review machinery: everything routes through the existing review engine (P3).

## Global constraints

- **Persistence is the engine's job, at the product layer.** The X1 cure is built on our surfaces (PM history + lock + audit), portable to the cloud rebuild ([16](../16-principles.md) §3), not on deep VS Code internals.
- **Spec the merge, not just the feature.** map-D7 (stacking/supersede), map-D8 (fold-in), map-D22 (edit-during-run coexistence) are merge contracts; each is specified in [20](../20-journey-specs-aha-path.md) §1e and must be tested so no concurrent path becomes a data-loss bug (the decision-68 lesson).
- **Real data only.** No fabricated feeds, counts or versions on any new surface (the X2 lesson); an empty state is an empty state, an error names its source and affected docs ([16](../16-principles.md) §3).
- **Instrument as you build.** New surfaces emit their [15-metrics-and-instrumentation.md](../15-metrics-and-instrumentation.md) §3.1 events from day one; events not yet in the dictionary are type-registered for plan 36 to wire, per each spec's analytics section.
- **Ledger discipline.** Our-surface only expected; any core patch logged in [03-merge-tax-ledger.md](03-merge-tax-ledger.md). F2 (stock-Copilot removal) is a shell-integrity item and follows the plan-33 `check-seams.sh` pattern.
- Tabs; nls strings; Australian English; no em dashes. `typecheck-client` + `valid-layers-check` clean per PR.

## Iteration plan

Iterations follow the fix-list tiers ([34-verify/journey-grades.md](34-verify/journey-grades.md) §iteration-4(b)): persistence/X1 first, then aha-path robustness, then trust integrity, then the MISSING minimal surfaces.

### Iteration 1 - Persistence: the severity-1 cure (Tier 0)

- **F1** - approved changes persist across a reload. Approve writes applied text to the document on disk and records the version in the lock, atomically; reload re-reads the persisted document, History and the Saved · vN chip. New docs (1b), snapshots and the chip (1h) all persist. Validate against [20](../20-journey-specs-aha-path.md) §1e "persistence contract" + §1h + §1b acceptance criteria.
- **Desktop confirmation** (being checked separately): if the desktop build already lands writes on disk, F1 still owns the web build's in-memory-only writes and the reload-reread contract; the fix must make approved work survive a reload in **both** builds under test.
- Gate: live E2E in web and desktop - approve → reload → the edit, History and chip all survive; the on-disk file reflects the approve. This one iteration unblocks the persistence caveat noted across 1f/1i/1j/1k/1t/1u.

### Iteration 2 - Aha-path robustness: the cheap off-path fixes (Tier 1)

- **F2** remove/re-route the stock Copilot chat tab (only the Abstract rail is reachable). **F3** keep the typed name for a blank document. **F4** stop dumping the internal template brief into the rail. **F5** replace the fixed "85% confidence" sub-line with a real signal or the label alone. **F6** Cmd+Z reverts across an approve. **F7-F10** the 1a open-folder fixes (hierarchy preserved, filename fallback for odd headings, non-md in a SOURCES section, .doc/.docx marked "not yet imported"). **F11** the 1g doc-header autonomy dial reusing the existing agent policy control (P2). **F12-F13** the 1p freshness consistency + hover peek + "then vs now" + fallback marking.
- Validate each against its §1a/1b/1e/1f/1g/1h/1p acceptance criteria.
- Gate: each probe that broke in the walk now passes live; screenshots to `37-verify/`.

### Iteration 3 - Trust integrity: the silent-outage cure (Tier 2)

- **F14** - a model outage on the fan-out/agent-run path names itself and never renders as "no change". Match the single-doc rail's reference standard ([20](../20-journey-specs-aha-path.md) §1e error state): a named error, a failed-doc list, surgical retry of only the failed docs. Under beta model access, a hit budget cap pauses gracefully per map-D15 ([18](../18-beta-plan.md) §2.1), never fatal.
- Gate: kill the backend mid fan-out - the run reports the outage by name with a retry-failed-only affordance, and never shows "0 changes proposed / no change" for an outage. Screenshot to `37-verify/`.

### Iteration 4 - The MISSING minimal surfaces (Tier 3)

- **F15** 1w Project Home landing [minimal v1] - land here not the editor; while-you-were-away feed (real data, honest empty state); all-clear (map-D14); whole-project chat composer (map-D21/D24); empty-project front door (cures the 1a empty-folder dead-end). **F16** 1d provenance-safe file ops [minimal v1] - context menu with Rename/Delete/Add-to-chat; map-D6 warn-and-orphan on delete; atomic lock moves with Undo. **F17** 1b "From sources…" third birth through the review engine (map-D4). **F18** 1x from-examples template wizard [minimal v1] - 3-10 docs → named commonalities through the review grammar → a proposed skill.md → joins the ＋ New picker.
- Validate each against its §1w/1d/1b/1x [minimal v1] acceptance criteria; deferred frames stay absent (not dead affordances).
- Gate: each surface is walkable end to end on real files with honest empty/error states; screenshots to `37-verify/`.

## Acceptance criteria

- [ ] **F1**: approved work survives a reload in web and desktop; on-disk file, History and chip all reflect the approve (Tier 0). _(iter 1)_
- [ ] Tier-1 off-path fixes F2-F13 each pass the probe that broke in the walk, against their §20 acceptance criteria. _(iter 2)_
- [ ] **F14**: a fan-out model outage names itself with a failed-doc list and surgical retry; never "no change". _(iter 3)_
- [ ] The aha-path MISSING surfaces (1w, 1d, 1b "From sources", 1x) each reach their [minimal v1] floor, walkable on real files. _(iter 4)_
- [ ] Doc 18 §2.3 R2 and R3 are met for the aha path; R4's survivability blocker (X1) is gone. Re-run the §2.3 gate check and record the new verdict.
- [ ] Zero fabricated data on any new surface; every merge contract (D7/D8/D22) has a test; ledger updated for any core patch.

## Verify approach

Live E2E per iteration (chrome-devtools MCP for web; the launch/run skills for desktop where a fix needs real folders/OS dialogs), with screenshots to `docs/plans/37-verify/`. Re-walk the specific probes that failed in [34-verify/journey-grades.md](34-verify/journey-grades.md) and confirm each now passes; the merge contracts get snapshot-style tests ([16](../16-principles.md) §3). The closing act is a re-run of the doc 18 §2.3 gate check with the updated verdict, so the beta-gate status is evidence, not opinion.
