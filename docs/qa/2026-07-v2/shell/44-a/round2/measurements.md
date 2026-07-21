# Bundle 44-a round 2 - frame-inset fix (P1.2)

Live measurement of the v2 elevation model after taking the sanctioned core seam (plan 43 §6 seam 1: part margins for the elevation model). Bare URL `http://localhost:8080/`, session `shell-44a-r2`, headless chromium (`playwright`), `deviceScaleFactor: 2`. Every number is `getBoundingClientRect` rounded to the nearest px; insets are measured relative to `.monaco-workbench.floating-panels > .monaco-grid-view` (the card-stack container), matching the round-1 validator's repro. Raw dump: `measurements-both.json`.

## The defect (round 1) vs the fix (round 2)

| Frame edge | Round 1 (defect) | Round 2 (fixed) | Target |
|---|---|---|---|
| top inset (sidebar + editor) | **0px** | **12px** | 12 ±1 |
| bottom inset (sidebar + editor) | **6px** | **12px** | 12 ±1 |
| right inset (editor, no aux) | 12px | 12px | 12 ±1 |
| inter-card gap (sidebar -> editor) | 12px | 12px | 12 ±1 |

Left inset is nav-relative (the tree rail sits at x=88, immediately right of the labelled activity-bar nav), not a frame edge - unchanged and not counted against P1.2 (same as the round-1 validator's read).

## Editor surface

### 1440 x 900
- sidebar (tree rail): topInset **12**, bottomInset **12**, width 252
- editor (paper): topInset **12**, bottomInset **12**, rightInset **12**
- inter-card sidebar -> editor: **12**
- chrome (grid bg + workbench bg): `rgb(237, 239, 243)` = **#EDEFF3**
- screenshot: `editor-1440.png`

### 1760 x 1000
- sidebar: topInset **12**, bottomInset **12**, width 252
- editor: topInset **12**, bottomInset **12**, rightInset **12**
- inter-card sidebar -> editor: **12**
- chrome: `rgb(237, 239, 243)` = **#EDEFF3**
- screenshot: `editor-1760.png`

The right rail (auxiliary bar) is collapsed to width 0 on the Editor surface (its toggle is pin 2 / bundle 44-b, not this bundle - same state the round-1 validator recorded), so its live inset is out of scope for this bundle's criteria.

## Home surface (spot-check, 1440 x 900)

Opened via the Home nav item. The Home dashboard renders in the editor card ("Good morning, Tom").
- editor (paper): topInset **12**, bottomInset **12**, rightInset **12**
- chrome: `rgb(237, 239, 243)` = **#EDEFF3**
- screenshot: `home-1440.png`

All four frame edges read 12 ±1 px on both viewports and on the screen surface. Defect P1.2 is closed.

## The seam

- `src/vs/workbench/services/layout/browser/layoutService.ts` - new constant `FLOATING_PANEL_MODERN_FRAME_INSET = 12`.
- `src/vs/workbench/browser/parts/editor/editorPart.ts` - `layout()` reserves `FLOATING_PANEL_MODERN_FRAME_INSET * 2` on the height axis (replacing the single 6px bottom margin) so editor content is not clipped by the wider top+bottom gutter.
- `src/vs/workbench/browser/parts/paneCompositePart.ts` - `getFloatingInset()` reserves `FLOATING_PANEL_MODERN_FRAME_INSET` top + bottom for the side/aux rails (replacing the flush 0px top).
- `src/vs/workbench/contrib/styleOverrides/browser/media/elevation.css` - matching `margin-top` / `margin-bottom` of `var(--vscode-spacing-size120, 12px)` on the three cards, overriding the stock flush top + 6px bottom from core `floatingPanels.css`.

Gated on `isFloatingPanelsEnabled()` (== the `MODERN_UI` setting == when `.style-override` + `.floating-panels` apply). Fail-soft: Modern UI off -> stock layout unchanged. Re-pinned by `check-seams.sh` seam 9b.
