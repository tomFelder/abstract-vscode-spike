# Plan 42 L3 - adversarial validation (issue #199)

**Verdict: PASS** (with 2 advisory defects, both pre-existing / non-blocking).

**Date:** 2026-07-20
**Branch:** `light-path/l3-markdown-first` (worktree `/Users/tommy/Sites/abstract-lp-l3`), rebased onto origin/main (post L1 #202 + L2 #205).
**Validated commit:** `ab65cc3` (docs) on top of `3fe7931` (feature).
**Validator:** fresh-eyes adversarial pass, own session `lp-l3v`, own fresh empty seed profiles + workspaces under /tmp.

## Checks (all independently re-run)

| Check | Result |
| --- | --- |
| One-shot `npm run compile` (post-rebase, stale out/) | exit 0 |
| `npm run typecheck-client` | clean, 0 errors |
| `./scripts/test.sh --grep "livingDocs"` | 147 passing, 0 failing |
| `./scripts/test.sh --grep "LivingDocsService"` | 141 passing, **1 failing = the allowed pre-existing #203** (`a fan-out with the model down...`), identical on main. No new failures. |
| `npm run valid-layers-check` | clean (exit 0) |
| `./scripts/check-seams.sh` | OK - all shell seams intact, 0 core patches |
| Diff confinement | all src changes under `src/vs/workbench/contrib/livingDocs/` |
| Co-author lines | none |
| Tabs / space-indent | tabs only, clean |
| Trust grammar (approve / `_persist` / `_lockStore.write` / audit.push / claims) | **zero added/changed lines in the diff** - byte-for-byte unchanged |
| L2 regions (composer / inline-choice / sendChatMessage) untouched | confirmed - reviewRailView.ts has a single hunk at line 440 (Review empty state), far from the composer region (134-277) |

## AC verified LIVE

Driven with @playwright/cli (top-level rails) + raw CDP `Input.dispatchMouseEvent`/`dispatchKeyEvent` into the living-doc editor OOPIF (webview -> nested content iframe).

- **(a) create + edit + save a plain doc -> zero artefacts.** Typed `VALIDATOR-TYPED-LINE` into `ideas.md` (plain), Cmd+S. Content persisted (58 bytes); `find /tmp/lp-l3v-docs -name "*.lock.json"` returned **nothing**. (v2-plain-editor-entry.png)
- **(b) entry-path copy sweep clean.** Top-level workbench DOM + editor OOPIF scanned for `Living Document / lock / birth sheet / All sources synced / bound sources / Refresh from sources` - **all false** on the plain-doc entry path. Plain editor breadcrumb reads the file path (`A / lp-l3v-docs / Ideas / ideas.md`), no pill. Context tab: **"Connect a data source to keep figures in this document up to date."** Review tab (default-open pre-L4): **"No changes waiting. When the agent proposes an edit, it lands here for you to review."** Home top bar: brand + Present, **no sync pill**. (v1, v2, v3, v8)
- **(c) bind a source -> silent lock + History/provenance.** Created `bound.md` with `context: [research.md]` frontmatter; on open, `bound.lock.json` appeared **silently** (context entry + reviewedHash + reviewedAt) with **no dialog/toast** (notifications array empty). Editor then showed the earned "All sources synced" pill + the "Bound figures... trace it back to the source... meaning-changes wait in the Review rail" provenance hint. Context listed `research.md / current`. History: "VERSION HISTORY - BOUND REPORT / Save version / No versions yet...". (v4, v5, v6)
- **(d) rails truthful in both states.** Plain: no pill, "Connect a data source", "No changes waiting". Living: earned pill, referenced-files list, live version history. Both honest; no fabricated state either way.

Other trigger (**accept an agent edit**) verified by **code inspection + existing test**, not live - see Defect 1.

## Attack edge cases

- **Doc with frontmatter sources open on a fresh profile -> living immediately, no ceremony gap.** `bound.md` was living on its very first open (silent lock, earned pill) - no plain-then-upgrade flicker. PASS.
- **Pill omitted on a plain-only project.** Second fresh instance on a plain-only workspace (`hello.md`): Home top bar shows **no "All sources synced" pill** (`projectHasLivingSurface` correctly false). On the project with a living doc, the pill showed. Truthful in both directions - live-verified. (v8) PASS.
- **`isLiving` refactor behaviour-identical.** Main's `fm.sources.length > 0 || fm.context.length > 0 || hasBinds` maps exactly onto `docHasEarnedLiving({hasFrontmatterSources, hasFrontmatterContext, hasBindLinks, hasSiblingLock:false})`. Pure faithful extraction. The `hasSiblingLock:false` hardcoding in the parser is correct at every `parseLivingDoc` call site: the parser cannot see disk, and the lock is read separately via `_lockStore.read` in `_loadState`. PASS.
- **Sibling `.lock.json` without frontmatter -> reads PLAIN (not living).** See Defect 2. Behaviour-identical to main; not a regression.
- **See It Work demo unbroken.** The demo card ("See a 90-second demo") renders on Home post-L1; no demo/`generateDemoReport` line changed in the diff (only the top-bar sync-pill logic in screenRender.ts). Verified by diff inspection; the demo card is live-present on Home.

## Defects

### 1. (Advisory, non-blocking) The "accept an agent edit -> lock appears / living" trigger does not exist as the plan/report describe it.
- **Repro / evidence:** existing test `chat works on a PLAIN doc (decision 48)` (livingDocsService.test.ts:1547) asserts that approving a generated insertion on a plain doc leaves `isLiving === false` ("accepting chat content does NOT turn a plain doc into a living one"). Proposal generation is gated on `isLiving` (livingDocsService.ts:909/913) and `_bootstrapLock` early-returns unless the doc declares binds/context (:2207). So on the entry path, only **source binding** earns living; the agent-edit path is governed by ratified **decision 48** and deliberately keeps the doc plain.
- **Suspected cause:** the plan text ("bind a source OR accept an agent edit -> lock appears") and `docHasEarnedLiving`'s JSDoc ("the first agent edit is accepted (which writes the sibling lock)") describe a trigger that decision 48 supersedes. The implementer correctly did NOT wire this (it would touch the trust grammar), but the **findings.md report over-claims** by implying both triggers are equivalent and live.
- **Disposition:** advisory. The implementer respected the untouchable trust grammar; the AC's source-bind path is fully met. Recommend a one-line correction to the report/PR body noting the agent-edit trigger is decision-48-governed (plain stays plain), not a silent living upgrade.

### 2. (Advisory, non-blocking) `docHasEarnedLiving`'s `hasSiblingLock` branch is dead production code.
- **Repro / evidence:** grep shows `hasSiblingLock: true` is passed **only** in `livingUpgrade.test.ts:30`. Every production `parseLivingDoc` call site (incl. `_isLivingDocFile`:2087, `_loadState`:2175) uses `hasSiblingLock: false`. A doc with a sibling `.lock.json` but no frontmatter therefore reads as **plain**, contradicting the module's own doc comment and the plan's "still living per the rule".
- **Suspected cause:** the predicate names an upgrade trigger (sibling lock) that the codebase never actually consults for living-state determination - both on main and this branch. It is aspirational abstraction, not wired.
- **Disposition:** advisory. Behaviour-identical to main (no regression); the extra facts field is harmless and unit-tested. If the sibling-lock trigger is genuinely wanted, a future slice must wire a call site that passes `hasSiblingLock: true` (e.g. `_isLivingDocFile` consulting `_lockStore` existence) - out of scope for L3.

## What I verified live vs by inspection
- **Live:** AC (a) plain typing/save + zero artefacts; AC (b) full copy sweep (top frame + editor OOPIF); AC (c) source-bind silent lock + Context + History; AC (d) both-state rails; pill omitted on plain-only project; frontmatter-source doc living on first open.
- **By inspection/test:** agent-edit trigger (decision 48 test); `isLiving` refactor equivalence vs main; sibling-lock orphan case; trust-grammar byte-equality; L2-region non-touch; demo path non-touch; string localization (nls.localize + double quotes) in all three changed strings.

## Cleanup
- Killed both Code OSS instances (pids 15113, 49955) and closed the playwright sessions.
- Removed temp workspaces/seeds under /tmp and the temp CDP helper scripts from the worktree.
