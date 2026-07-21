# Validation round 2 - bundle 44-a (tokens + elevation), PR #218

Fresh-eyes adversarial re-validation of the round-2 fix for defect P1.2 (frame insets) plus a full regression pass over the round-1 ticked criteria. Every px/hex below is `getBoundingClientRect` / `getComputedStyle` on the live web build (bare `http://localhost:8080/`, session `shell-44a-validate2`), driven headless via Playwright/Chromium at 1440x900 and 1760x1000.

## Static checks (re-run, not trusted)

| Check | Outcome |
|---|---|
| `npm run typecheck-client` | clean, exit 0 |
| `npm run valid-layers-check` | clean, exit 0 |
| `./scripts/check-seams.sh` | OK - all seams incl. 9 + 9b, exit 0 |
| `./scripts/test.sh --grep "livingDocs"` | 310 passing, 0 failing |

### Seam 9b bite test (cp-backup / restore, never git checkout)

| Perturbation | Expected | Result |
|---|---|---|
| `FLOATING_PANEL_MODERN_FRAME_INSET = 12` -> `= 10` (layoutService.ts) | exit 1 `[frame-inset-constant]` | exit 1, fired |
| remove the `... * 2` usage in editorPart.ts (import kept) | exit 1 `[frame-inset-editor]` | exit 0, did NOT fire (see note) |
| `margin-top: var(--vscode-spacing-size120` -> `sizeXXX` (elevation.css) | exit 1 `[frame-inset-css]` | exit 1, fired |
| restore all three | exit 0, worktree clean | exit 0, `git status` clean |

Note: the `frame-inset-editor` / `frame-inset-panecomposite` legs assert the symbol is *present in the file*, not that it is *consumed*. Because editorPart still imports `FLOATING_PANEL_MODERN_FRAME_INSET`, removing only the line-1401 usage leaves the import and the grep still matches. This is a soft assertion-robustness gap, not a P1.7 defect: the seam is logged and asserted, the primary drift risks (constant value, CSS margin) both bite loudly, and a genuinely orphaned import would be caught by TS unused-import / lint. Recorded for the record; does not fail P1.7.

## P1.2 - the fix (frame insets + inter-card gaps), both viewports

Grid (frame) = `.monaco-workbench.floating-panels > .monaco-grid-view`.

| Edge / gap | 1440x900 | 1760x1000 | Target |
|---|---|---|---|
| sidebar top inset | 12 | 12 | 12 +/-1 |
| sidebar bottom inset | 12 | 12 | 12 +/-1 |
| editor top inset | 12 | 12 | 12 +/-1 |
| editor bottom inset | 12 | 12 | 12 +/-1 |
| editor right inset (right rail collapsed) | 12 | 12 | 12 +/-1 |
| inter-card gap (sidebar->editor) | 12 | 12 | 12 +/-1 |

Round-1 defect (top 0px / bottom 6px) is CLOSED. Left inset stays nav-relative (rail at x=88, right of the 76px labelled nav) - not a frame edge, same read as round 1.

### Surface spot-checks (1440x900), editor card insets

| Surface | top | bottom | right | chrome |
|---|---|---|---|---|
| Home (no rails, single white card) | 12 | 12 | 12 | rgb(237,239,243) |
| Agents (no rails, single white card) | 12 | 12 | 12 | rgb(237,239,243) |

## Regression of ticked boxes

### P1.1 chrome #EDEFF3 - all five surfaces
Editor, Home, Agents, Templates, Knowledge -> `rgb(237, 239, 243)` = #EDEFF3 on `.monaco-workbench`. PASS, no regression.

### P1.3 card radius / border / bg
- radius 14px; border rgb(233,234,238) = #E9EAEE, 1px; both cards, both viewports.
- rail (sidebar) bg rgb(251,252,253) = #FBFCFD.
- editor (paper) bg rgb(255,255,255) = #FFFFFF.
PASS, no regression.

### P1.4 shadows (exact strings)
- rail: `rgba(20, 22, 28, 0.22) 0px 8px 28px -14px, rgba(20, 22, 28, 0.05) 0px 1px 2px 0px` = shadow-rail + e1.
- editor: `rgba(20, 22, 28, 0.26) 0px 12px 36px -16px, rgba(20, 22, 28, 0.05) 0px 1px 2px 0px` = shadow-editor + e1.
PASS, no regression.

### P1.5 paper opacity
`.monaco-editor-background` NOT in DOM (living-doc product path is a webview, not raw Monaco - same as round 1). Editor card bg is opaque rgb(255,255,255); elevation.css pins `#FFFFFF !important` on the Monaco selectors. PASS by construction, no regression.

### P1.6 sash drag (seam touched layout code - actually dragged)
Vertical sash at x=346 (inside the 12px gap), disabled=false, pointer-events=auto. Real mouse drag: sidebar width 252 -> 312px, then back to 252px. Resize works, no dead zone wider than the 12px gap. PASS, no regression.

## P1.7 - seam audit

`git diff origin/main...v2/shell-a --name-only -- src/vs/`:
- `services/layout/browser/layoutService.ts` (core) - new `FLOATING_PANEL_MODERN_FRAME_INSET = 12` constant
- `browser/parts/editor/editorPart.ts` (core) - consumes it in `layout()` (gated `isFloatingPanelsEnabled()`, line 1381)
- `browser/parts/paneCompositePart.ts` (core) - consumes it in `getFloatingInset()` (early-returns when off, line 652)
- `contrib/styleOverrides/browser/media/elevation.css` (styleOverrides cheap tier) - matching 12px margin-top/bottom
- `contrib/styleOverrides/browser/styleOverrides.contribution.ts` (styleOverrides cheap tier) - module wiring

Exactly ONE core seam: one constant + two consumers + the matching CSS margin. Both consumers are gated behind `isFloatingPanelsEnabled()` (fail-soft: Modern UI off = stock layout, zero change). Wave budget is 2 (decision 169); this spends 1, leaving V2-2 for 44-b.

Ledger row V2-1 reads "PENDING-merge - 1 core seam (plan 44-a, PR #218, round 2)" with the seam files, CSS-only-first rationale, fail-soft note, 44-b header interaction, and re-pin check (seam 9 + 9b). check-seams seam 9b asserts the constant, both consumers, and the CSS margin. PASS.
