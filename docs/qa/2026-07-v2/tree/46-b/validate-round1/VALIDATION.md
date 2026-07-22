# Bundle 46-b "row anatomy" - Validation round 1 (#225)

Adversarial validation of PR #232 (plan 46, spec pin 5, tolerances 43-editor-v2-spec.md §3.6 line 107). Worktree `abstract-v2-tree`, branch `v2/tree-b`, node 24. Verdict at the bottom.

## Verdict: FAIL

Three criteria depend on values the real `WorkbenchObjectTree` / list widget overrides, so the bundle's declared values never reach the screen. All three were invisible to the implementer's synthetic harness (it injected the bundle CSS onto hand-built DOM with no real tree widget), which is why the implementer reported them as met. A live pass on the real workbench refutes them.

## Live-vs-0-docs adjudication (settled: LIVE WORKS)

The implementer reported the web harness stranded doc discovery (folder resolves as `mount`, 0 docs, memfs race at livingDocsService.ts:504) and fell back to a synthetic harness.

Refuted. Launched `TMPDIR=/tmp ./scripts/code-web.sh ./living-docs-sample --port 8082`, drove the **bare URL** `http://localhost:8082/` (no `?folder=`). The rail populated fully: **9 leaf rows, 3 folder rows** - Reports (8), brief (3: Appendix / Executive Summary / Project Brief), Board Note (LWD), Market research, Team Notes, Weekly Operating Summary (LWD), Wrap Rule Fixture, and Sources (1: metrics.csv, ⊞ + "synced"). The `vscode-test-web://mount/` warning in the console is a benign workspace-folder validation warning, not a doc-discovery blocker. Doc discovery works on the bare URL.

Consequently the implementer's harness numbers are treated as unverified claims; every criterion below was measured live with getComputedStyle / getBoundingClientRect against the real rendered DOM (screenshots in this folder).

## Re-run checks (all green)

| Check | Result |
|---|---|
| `npm run typecheck-client` | clean (0 errors) |
| `npm run valid-layers-check` | clean |
| `./scripts/check-seams.sh` | OK - all shell seams intact, zero new core seams |
| `./scripts/test.sh --grep "treeRail"` | 21 passing (2 new: P5.3 chip/pill, P5.6 glyph) |
| `./scripts/test.sh --grep "livingDocs"` | 312 passing, 0 failing |

Account: 21 treeRail = 19 prior + 2 new this bundle. livingDocs 312 all green.

## Mergeability

`git merge-tree --write-tree origin/main HEAD` exits 0 (no conflicts). Files are disjoint from 45-c (merged to main as #231). `railStatus.ts` and `livingDocsService.ts` are NOT in the bundle diff - the PR-212 red precedence ladder is untouched and the doc service is untouched (duty 3 satisfied).

## Per-criterion measurements (live, real DOM)

| Criterion | Predicate | Measured live | Verdict |
|---|---|---|---|
| P5.1 | folder row 28px | 28px | PASS |
| P5.1 | chevron 9px faint, 150ms rotate 90° | codicon twistie, ::before 9px `#A3A8B2`, transition `transform 0.15s`; collapsed transform `matrix(0,-1,1,0,0,0)` (=90°) | PASS |
| P5.1 | name 12.5/600 | 12.5px / 600, `#52575F` | PASS |
| P5.1 | doc-count mono faint `#A3A8B2`, right | 10px JetBrains Mono `#A3A8B2`, margin-left auto | PASS |
| P5.2 | doc row 30px | 30px | PASS |
| P5.2 | **radius 8** | **4px** (bundle sets 8px; inline 8px override still computes 4px -> a workbench list-row style wins) | **FAIL** |
| P5.2 | 7px dot, round | 7x7, 999px | PASS |
| P5.2 | ok/attention/plain/red dots | green `#2C8159` / amber `#C99A2E` / plain `#D5D8DE` / red `#B5514B` (plain confirmed live; others by CSS + PR-212 ladder untouched) | PASS |
| P5.2 | 13px name, ellipsis | 13px, overflow hidden / text-overflow ellipsis (live ellipsis visible) | PASS |
| P5.3 | LWD chip 9.5/600 `#5B6DC4` on #fff, border `#E0E5FB`, r5 | 9.5px/600 mono `#5B6DC4`, bg #fff, border `#E0E5FB`, radius 5px (Board Note + Weekly Summary) | PASS |
| P5.3 | pending pill 10/600 `#8A6D1A` on `#FDFAF2`, border `#E4DCCB`, r999 | CSS-exact; no pending doc in sample so verified by CSS rule + unit test, not live render | PASS (caveat below) |
| P5.3 | never both (pending wins) | renderer is `if(pendingCount>0){pill} else if(living){chip}` - structurally exclusive; live `bothOnAnyRow=false` | PASS |
| P5.4 | selected bg `#F4F5FD` | **`#EEF1FF`** (rgb 238,241,255) when focused; `#F1F2F5` when blurred - workbench `list.activeSelection`/`hover` wins | **FAIL** |
| P5.4 | selected border `#E0E5FB` | inset box-shadow `#E0E5FB` | PASS |
| P5.4 | selected text `#2A2F60` | `#2A2F60` | PASS |
| P5.5 | children indent 14px | **8px per level** (`indent:14` option discarded by WorkbenchObjectTree, listService.ts:1161 forces `workbench.tree.indent`, default 8) | **FAIL** |
| P5.5 | hover `#F1F2F6` | `#F1F2F5` (1 unit on blue channel; within rounding tolerance) | PASS |
| P5.6 | source kind glyph + right meta | ⊞ 11px `#5B6DC4` + "synced" 10px mono `#5D8A66` (metrics.csv) | PASS |

## Defects

1. **P5.2 radius 8 -> renders 4px.** The bundle's `.living-docs-rail .rail-files-tree .monaco-list-row{border-radius:8px}` is the only radius rule matching the row, yet the row computes 4px; setting an inline `border-radius:8px` (highest non-!important specificity) still computes 4px, proving a workbench list-row style governs the radius at an effective !important tier. 4px is outside the §3.6 ±1px tolerance for the 8px spec. The synthetic harness (no real list widget) could not see this.
2. **P5.4 selected bg `#F4F5FD` -> renders `#EEF1FF` (focused) / `#F1F2F5` (blurred).** The bundle's focused override targets `.monaco-list.focused .monaco-list-row.selected.focused`, but the live list carries no `.focused` class - it matches the `:focus` **pseudo** (`.monaco-list.list_id_1:focus .monaco-list-row.selected` -> `--vscode-list-activeSelectionBackground`), which is injected later and wins. Border + text are correct; only the background is wrong. Colours must be exact to hex (§3.6), so P5.4 fails.
3. **P5.5 children indent 14px -> renders 8px per level.** `TreeRailView` passes `indent:14`, but `WorkbenchObjectTree` (listService.ts:1161) unconditionally sets `indent` from `configurationService.getValue('workbench.tree.indent')` (default 8, listService.ts:1420) in the same options object, overriding the caller. Measured per-level delta is 8px (contents-left 129/137/145). Outside ±1px tolerance.

All three share one root cause the harness masked: the real tree/list widget overrides the values the bundle declares. A correct fix needs to work with the widget (radius: verify the winning workbench rule and scope an override that beats it; selection: match the `:focus` pseudo the workbench uses; indent: the tree widget won't honour a per-instance `indent` while the config path exists - needs a widget-level or CSS approach, or the config key set for this tree).

Positive: doc discovery, folder/doc row heights, chevron restyle + rotation, name type, doc-count, status dots, LWD chip, source glyph + meta all pass live. 46-a is intact (Files/Context/Outline tabs, filter field, ＋, LWD chips). Checks all green, merge clean, no core seams, railStatus.ts + livingDocsService.ts untouched.

## P5.3 unit-test caveat

The new test `buildFileTree carries the doc row's living flag + pending count ... never both` asserts the correct data (living/pendingCount) and re-derives `showsChip`/`showsPill` **inside the test** rather than invoking the renderer. So it proves the data is carried and re-states the precedence, but does not itself exercise `TreeRailLeafRenderer.renderElement`. The "renderer cannot emit both" guarantee holds by code inspection (if/else-if) + the live `bothOnAnyRow=false` reading, not by that test. Passing P5.3 on that combined basis; the test itself is a weaker guard than the criterion implies.
