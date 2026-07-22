# Bundle 46-b "row anatomy" - Validation round 2 (#225)

Adversarial re-validation of PR #232 (plan 46, spec pin 5, tolerances docs/plans/43-editor-v2-spec.md section 3.6). Worktree `abstract-v2-tree`, branch `v2/tree-b`, node 24. Round 1 FAILED on P5.2 (radius 4px), P5.4 (selection bg not #F4F5FD) and P5.5 (indent 8px). This round re-measures the three fixes live on the real WorkbenchObjectTree and re-runs every check.

## Verdict: PASS

All six criteria met. The three round-1 defects are fixed and confirmed live on the real widget, and P5.1 (verified but not ticked in round 1) is confirmed and now ticked. No regressions.

## Method

Live measurement on the real workbench, not a synthetic harness. Started `TMPDIR=/tmp ./scripts/code-web.sh ./living-docs-sample --port 8082`, drove the **bare URL** `http://localhost:8082/` headless (Playwright + cached Chrome for Testing 141), read every value with `getComputedStyle` / `getBoundingClientRect` against the real rendered DOM after expanding all folders. The rail populated fully: 3 folder rows (Reports 8, brief 3, Sources 1) + 9 leaf rows across three depths. Screenshots in this folder.

## Re-run checks (all green)

| Check | Result |
|---|---|
| `npm run typecheck-client` | clean (0 errors) |
| `npm run valid-layers-check` | clean |
| `./scripts/check-seams.sh` | OK - all shell seams intact, zero new core seams |
| `./scripts/test.sh --grep "treeRail"` | 21 passing |
| `./scripts/test.sh --grep "livingDocs"` | 312 passing, 0 failing |

The rewritten P5.3 test was read: it now constructs a real `TreeRailLeafRenderer`, calls `renderTemplate` + `renderElement` over leaf nodes built by the real `buildTreeRailNodes` pipeline, and asserts the emitted `.rail-tree-lwd` / `.rail-tree-pending` DOM (chip only for a living doc, pill "2" only for pending, neither for a plain doc or a source). This drives the REAL render path; it no longer re-derives precedence in-test. Confirmed.

## The three fixed criteria (live, real DOM)

| Criterion | Predicate | Round 1 | Round 2 measured live | Verdict |
|---|---|---|---|---|
| P5.2 | doc row radius 8 | 4px | `borderRadius: 8px` on every `.monaco-list-row` (the `!important` rail rule beats the roundedCorners.css 4px clamp) | PASS |
| P5.4 | selected bg #F4F5FD (both states) | #EEF1FF / #F1F2F5 | `rgb(244,245,253)` = **#F4F5FD** focused AND blurred (list without `.focused` / row `selected` only). Rail vars pin active+inactive selection bg to #F4F5FD | PASS |
| P5.4 | selected border #E0E5FB | met | boxShadow `rgb(224,229,251)` = **#E0E5FB** inset, both states | PASS |
| P5.4 | selected text #2A2F60 | met | labelColor `rgb(42,47,96)` = **#2A2F60**; vars pin active+inactive selection fg | PASS |
| P5.5 | children indent 14px/level | 8px | contents-left steps **129 -> 143 -> 157** across aria-level 1/2/3 = **14px per level** (config default `workbench.tree.indent:14`) | PASS |
| P5.5 | hover #F1F2F6 | #F1F2F5 | hovered non-selected row bg `rgb(241,242,246)` = **#F1F2F6** exact (var pinned) | PASS |

## Regression - P5.1 (verified round 1, ticked this round) + P5.6 + strip

| Criterion | Predicate | Measured live | Verdict |
|---|---|---|---|
| P5.1 | folder row 28px | 28px | PASS |
| P5.1 | chevron 9px faint, rotate 90 | twistie ::before 9px `#A3A8B2` (rgb 163,168,178), transition present; collapsed transform = 90 (CSS unchanged this bundle) | PASS |
| P5.1 | name 12.5/600 | 12.5px / 600, `#52575F` (rgb 82,87,95) | PASS |
| P5.1 | doc-count mono faint, right | 10px JetBrains Mono `#A3A8B2`, pushed right (margin-left 128.9px) | PASS |
| P5.6 | source glyph + right meta | metrics.csv: glyph `⊞` 11px `#5B6DC4` (rgb 91,109,196) + "synced" 10px mono `#5D8A66` (rgb 93,138,102), margin-left auto | PASS |
| P5.3 | LWD chip (regression sanity) | Board Note chip: "LWD" 600 9.5px mono `#5B6DC4`, bg #fff, border 1px `#E0E5FB`, radius 5px | PASS |
| 46-a strip | 3 tabs + filter + chips + ＋ | tabs exactly [Files, Context, Outline]; "Filter documents..." input; LWD chips on Board Note + Weekly Operating Summary; ＋ on the strip; body-phrase filter covered by passing unit test | PASS |

## The `workbench.tree.indent:14` default does NOT break other trees

Duty-3 concern. Enumerated every VISIBLE `.monaco-list` in the whole workbench: exactly **one** (`list_id_1`, inside the rail - the Files tree). The calm shell deregisters the stock Explorer/Search/SCM trees, so no other monaco tree receives the config value. The Context and Outline tabs are rendered as custom DOM by the rail (`_renderContext` / `_renderOutline`), NOT tree widgets, so the indent default cannot touch them. Both render correctly live: Context shows the "Add source / Add context" composer, Outline shows the active doc's headings (Appendix - Design Tokens / Colour tokens / Usage notes). No regression.

## Mergeability & scope

Bundle diff touches `treeRailView.ts`, `livingDocs.contribution.ts` (config default), the test, and evidence. `railStatus.ts` and `livingDocsService.ts` are NOT in the diff - the PR-212 red precedence ladder and doc discovery are untouched. `roundedCorners.css` is NOT touched (the radius fix is a scoped `!important` in the rail's own CSS). The indent config is an additive, user-overridable settings-tier default (0 core), routed via orchestrator / plan 44 ownership.

## Console note

Web-mode extension-host registration errors (viewsExtensionPoint / viewDescriptorService / extensionsViewlet, plus 404s for a couple of dev assets) are present but pre-existing and unrelated to this bundle - the same benign web-harness noise noted in round 1. Not a defect of 46-b.
