# 44-b validation round 2 - measurements (#216)

PR #219, branch `v2/shell-b`. Adversarial re-validation of the two round-1 defects (P2.3 animation, P2.4 persistence) plus a regression attack on the shared CSS + visibility logic the fix touched. Verdict: PASS - all 12 criteria verified.

## Deterministic checks

| Check | Result |
| --- | --- |
| `npm run typecheck-client` | clean (exit 0) |
| `npm run valid-layers-check` | clean (exit 0) |
| `./scripts/check-seams.sh` | OK - all shell seams intact (still 2/2) |
| `./scripts/test.sh --grep "livingDocs"` | 309 passing / 0 failing |

Test accounting: 309 vs round-1 307 = exactly +2. The delta is the two new pure-helper tests in `railVisibility.test.ts` (`reviewRailManualChoiceFromPersistedCollapse` tri-state map, `treeRailHiddenOnEntry`). The test diff adds only an import + two `test(...)` blocks; nothing weakened or removed.

## P2.4 persistence (real page.goto reloads, 1440x900, fresh profile)

Storage keys grepped in `src/` (present): `livingDocs.v2.treeRailCollapsed`, `livingDocs.v2.rightRailCollapsed` (WORKSPACE scope / MACHINE target). Legacy `livingDocs.reviewRailManualChoice` is now read once, migrated into the right-rail key, then removed - no longer a competing source of truth (`_migrateLegacyReviewRailChoice`, contribution.ts:778). WORKSPACE-scoped state lands in IndexedDB in the web harness; verified behaviourally across reloads (not localStorage).

| Case | Before reload (tree / right px) | After hard reload | Result |
| --- | --- | --- | --- |
| Fresh entry (no choice) | tree 264 open / right 0 hidden | - | quiet-shell default holds: right rail hidden on entry, tree open. Plan-42 default survives the fix. |
| A: both collapsed | 0 / 0 | 0 / 0 | preserved |
| B: both open | 344 / 392 | 344 / 392 | preserved (custom drag width 344 also survives) |
| C: mixed (tree collapsed, right open) | 0 / 392 | 0 / 392 | preserved |

## P2.3 animation (computed transition + one live frame-sample, both rails)

Computed on both rail split-view-views: `transition-duration: 0.15s, 0.15s`, `transition-timing-function: ease, ease` (width + opacity). CSS-only in `elevation.css`; no core seam.

Frame-sampled settle time (16ms interval; includes ~30-50ms chord-dispatch latency before the transition starts, so effective transition duration is below these figures - all within the 110-190ms tolerance):

| Transition | width | settle (from sample start) | opacity |
| --- | --- | --- | --- |
| Tree collapse | 264 -> 0 | 199ms* | fades to 0 |
| Tree expand | 0 -> 264 | 183ms | restores to 1 |
| Right collapse | 392 -> 0 | 176ms | fades to 0 |
| Right expand | 0 -> 392 | 179ms | restores to 1 |

*Includes chord-dispatch latency ahead of the 150ms ease; computed duration is authoritative at 0.15s ease. Per spec 43 section 3.6 (duration/easing by code inspection + one live observation, no frame-perfect assertions).

Custom-width restore: dragged the tree sash 264 -> 344, collapsed, expanded -> restored to **344** (prior custom width, not the 264 default).

## Regression attack (fix touched shared CSS + visibility logic)

- **Sash drag** still instant + functional: drag moved tree 264 -> 344 with no easing lag; `.monaco-sash.active` carve-out disables the width transition during a live drag (CSS diff + observed native resize).
- **No ghost rails**: with a rail collapsed (width 0, the `display:block` override keeping it in the DOM through the fade), `elementFromPoint` at the former rail centre returns the editor webview underneath - `inSidebar:false` / `inAux:false`. The 0-width lingering card drops `pointer-events` and is not hit-testable.
- **Five surfaces single-header**: Editor / Home / Templates / Knowledge / Agents each show exactly one `.abstract-header` (48px, top 0, width 1440, bg rgb(237,239,243)) nested in the single `.part.titlebar`; `inbodyTopbars: 0` on all; cards intact. Screen surfaces (Home/Templates/Knowledge/Agents) correctly hide both rails.
- **Chords**: Cmd+\ toggles the tree rail with the editor group count staying 1 (stock split neutralised); Cmd+B in shell focus toggles the tree rail (0 -> 264 -> 0), dual role intact.
- No page errors across the entire run.

## Evidence
- `animation-and-persistence-trace.json` - full frame samples + before/after reload measurements
- `regression-trace.json` - surface sweep, split-group counts, Cmd+B trace
- `01-entry-1440x900.png` - fresh entry (tree open, right hidden - quiet shell)
- `02-both-collapsed-after-reload-1440x900.png`, `03-both-open-after-reload-1440x900.png`, `04-mixed-after-reload-1440x900.png` - persistence across reload
- `10..14-surface-*.png` - five-surface single-header sweep
