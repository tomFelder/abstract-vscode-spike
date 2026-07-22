# Bundle 46-b "row anatomy" - IMPLEMENT round 2 (#225)

Fix round 2 of PR #232 (plan 46, spec pin 5, tolerances 43-editor-v2-spec.md §3.6 line 107). Branch `v2/tree-b`, worktree `abstract-v2-tree`, node 24. Addresses the three FAIL criteria from validation round 1 (P5.2 radius, P5.4 selection bg, P5.5 indent) plus the P5.3 unit-test caveat. Every fix re-verified LIVE on the real workbench (bare URL `http://localhost:8082/`, real `WorkbenchObjectTree`), refuting the round-1 "0 docs" claim as the validator already settled.

## Root cause (shared by all three defects)

The real list/tree widget overrides the values the bundle declared. Round 1's synthetic harness (bundle CSS on hand-built DOM, no widget) masked all three:

- **Radius** - the workbench controls-tier clamp `styleOverrides .../roundedCorners.css` sets `.style-override .monaco-list .monaco-list-row{border-radius:var(--vscode-cornerRadius-small)!important}` (4px) at the `!important` tier, beating a bare 8px declaration.
- **Selection bg + hover** - the list widget generates per-instance rules (`.monaco-list.list_id_N:focus .monaco-list-row.selected` and the hover variant) that read the `--vscode-list-*` CSS variables (`defaultStyles` maps them via `asCssVariable`). A row-level `background` in the bundle loses to those more-specific generated rules.
- **Indent** - `WorkbenchObjectTree` discards the per-instance `indent:14` option and forces `configurationService.getValue('workbench.tree.indent')` (default 8, `listService.ts`).

## Fixes (per defect)

1. **P5.2 radius** - added `!important` to the rail's own `.living-docs-rail .rail-files-tree .monaco-list-row{border-radius:8px}` (owned injected CSS). Equal `!important`, higher specificity than the controls clamp -> the 8px wins. Did NOT touch `roundedCorners.css`.
2. **P5.4 selection bg** - override the list colour VARIABLES scoped to `.living-docs-rail .rail-files-tree`: `--vscode-list-activeSelectionBackground` + `--vscode-list-inactiveSelectionBackground` = `#F4F5FD` (spec has no focus distinction, so BOTH states match), `--vscode-list-active/inactiveSelectionForeground` = `#2A2F60`, and the focus outlines neutralised so the widget's ring never fights the `#E0E5FB` inset-shadow border. The widget's own `:focus`/inactive rules then render the spec colour. Kept the border + text predicates.
   - Follow-on: pinned `--vscode-list-hoverBackground` = `#F1F2F6` the same way (the widget's generated `:hover:not(.selected):not(.focused)` rule was rendering the theme's `#F4F6FF`, not the bundle's losing `:hover` rule). Removed the ineffective row-level `:hover` declaration.
3. **P5.5 indent** - added `workbench.tree.indent: 14` to the fork's configuration DEFAULTS in `livingDocs.contribution.ts` (routed via orchestrator, plan 44 ownership). Settings-tier, additive, 0 core. The calm shell deregisters every stock IDE tree container (Explorer/Search/SCM/Extensions), so the Files rail is effectively the only visible tree the value reaches. Left the per-instance `indent:14` option in place as documentation of intent (the widget ignores it).
4. **P5.3 test caveat** - rewrote the unit test to drive the REAL `TreeRailLeafRenderer.renderTemplate` + `renderElement` over leaf nodes built by the real `buildTreeRailNodes` pipeline, then read the emitted DOM (`.rail-tree-lwd` / `.rail-tree-pending`). Precedence (pending wins, never both) now holds by the renderer itself, not an in-test re-derivation. A source leaf is also asserted to carry no doc marker.

## Live measurements (real DOM, getComputedStyle / getBoundingClientRect on `http://localhost:8082/`)

| Criterion | Predicate | Round-1 (FAIL) | Round-2 live | Verdict |
|---|---|---|---|---|
| P5.2 | doc/source row radius 8 | 4px | **8px** | PASS |
| P5.4 | selected bg #F4F5FD (list focused, `:focus` pseudo active, listHasDomFocus=true) | #EEF1FF | **rgb(244,245,253) = #F4F5FD** | PASS |
| P5.4 | selected bg #F4F5FD (blurred) | #F1F2F5 | **rgb(244,245,253) = #F4F5FD** | PASS |
| P5.5 | children indent 14/level | 8/level | **14/level** (contents-left 129 / 143 / 157) | PASS |
| P5.5 | hover #F1F2F6 (unselected) | (regressed to #F4F6FF this round) | **rgb(241,242,246) = #F1F2F6** | PASS |

Regression of the round-1 greens (still live-exact):

| Criterion | Live round-2 |
|---|---|
| P5.1 folder rows 28px | Reports / brief / Sources all 28px |
| P5.2 doc rows 30px | all 30px |
| P5.3 LWD chip | Board Note + Weekly Operating Summary carry `.rail-tree-lwd` (live); pending pill covered by the strengthened unit test (no pending doc in sample) |
| P5.6 source glyph + meta | metrics.csv ⊞ + green "synced" |

46-a strip intact: Files / Context / Outline tabs, filter field, ＋ (see `rail-selected-doc.png`).

## Checks

| Check | Result |
|---|---|
| `npm run typecheck-client` | clean (0 errors) |
| `npm run valid-layers-check` | clean |
| `./scripts/check-seams.sh` | OK - all shell seams intact (zero new core seams) |
| `./scripts/test.sh --grep "treeRail"` | 21 passing (P5.3 now drives the real renderer) |
| `./scripts/test.sh --grep "livingDocs"` | 312 passing, 0 failing |

## Evidence

- `rail-selected-doc.png` - expanded Reports tree: LWD chips (Board Note, Weekly Operating Summary), 14px per-level indent, metrics.csv selected (accent-tint #F4F5FD, radius 8) with ⊞ glyph + green "synced".
- `rail-rows-live.png` - folder anatomy (28px, mono counts), 46-a strip.

## Self-assessment

All four defects fixed and verified LIVE on the real widget, not a harness. No core seams (settings-tier config default + owned injected CSS only). `roundedCorners.css` untouched. The one cross-lane change (`workbench.tree.indent`) is the orchestrator-sanctioned plan-44 routed addition. Not ticking merge-readiness - that is the validator's call.
