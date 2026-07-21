# Bundle 44-a "tokens + elevation" - VALIDATION ROUND 1 raw measurements

Adversarial validator, fresh eyes. Every px/hex below is `getComputedStyle` / `getBoundingClientRect` on the live web build (`code-web.sh ./living-docs-sample`, bare `http://localhost:8080/`), not eyeballed. Spec tolerances: colours exact hex; lengths/radii +/-1px; shadows exact strings (plan 43 section 3.6). The doc wins over the mock.

Full JSON dumps: `measurements-1440.json`, `measurements-1760.json`. Screenshots: `editor-1440-validate.png`, `editor-1760-validate.png`, `mock-editor-1440.png`.

## Checks (re-run by the validator, not trusting the implementer)

| Check | Outcome |
|---|---|
| `npm run typecheck-client` | clean, exit 0 |
| `npm run valid-layers-check` | clean |
| `./scripts/check-seams.sh` | OK - all seams intact (incl. seam 9), exit 0 |
| `./scripts/test.sh --grep "livingDocs"` | 310 passing, 0 failing |
| seam-9 bite test | perturbed `#EDEFF3`->`#EDEFF4` in elevation.css -> `check-seams.sh` exit 1 naming `[elevation-tokens]`; restored -> exit 0; worktree clean |

## P1.1 - chrome #EDEFF3 on every surface

Measured `rgb(237, 239, 243)` = #EDEFF3 on BOTH the workbench root (`.monaco-workbench`) and the floating grid backdrop (`.floating-panels > .monaco-grid-view`), on all five surfaces:

| Surface | wb root | grid backdrop |
|---|---|---|
| Home | rgb(237,239,243) | rgb(237,239,243) |
| Templates | rgb(237,239,243) | rgb(237,239,243) |
| Knowledge | rgb(237,239,243) | rgb(237,239,243) |
| Agents | rgb(237,239,243) | rgb(237,239,243) |
| Editor | rgb(237,239,243) | rgb(237,239,243) |

VERDICT: PASS.

## P1.2 - three floating cards, 12px gaps + 12px frame insets (+/-1px)

Measured relative to the grid-view frame (identical at 1440x900 and 1760x1000):

| Predicate | Measured | Expected | Pass? |
|---|---|---|---|
| tree-rail -> editor gap | 12px | 12 +/-1 | PASS |
| editor -> frame-right (aux collapsed) | 12px | 12 +/-1 | PASS |
| tree-rail top inset | **0px** | 12 +/-1 | **FAIL** |
| editor top inset | **0px** | 12 +/-1 | **FAIL** |
| tree-rail bottom inset | **6px** | 12 +/-1 | **FAIL** |
| editor bottom inset | **6px** | 12 +/-1 | **FAIL** |
| tree-rail left inset | 88px (nav occupies x6-82; rail-to-nav = 6px) | 12 +/-1 | FAIL as-written (nav neighbour, not frame) |

Three cards render (tree rail, editor; aux bar card-styled but collapsed - see P1.3 note). Inter-card gap and right inset are exact. TOP (0px) and BOTTOM (6px) frame insets are outside 12 +/-1px on both viewports. The implementer disclosed this as a "documented +/-6px note" (top closes in 44-b's header; bottom is floating-panels' content-synced margin). Per the validator brief, any edge outside 12 +/-1px is a defect against P1.2 as written.

VERDICT: FAIL (top + bottom insets).

## P1.3 - radius 14, border #E9EAEE, rails #FBFCFD, editor #FFFFFF

| Card | radius | border | bg |
|---|---|---|---|
| tree rail (sidebar) | 14px | rgb(233,234,238)=#E9EAEE | rgb(251,252,253)=#FBFCFD |
| editor (paper) | 14px | rgb(233,234,238)=#E9EAEE | rgb(255,255,255)=#FFFFFF |
| right rail (auxbar, collapsed) | 14px | rgb(233,234,238)=#E9EAEE | rgb(251,252,253)=#FBFCFD |

Right rail could NOT be revealed live in this bundle (Open Chat / Maximize Secondary Side Bar / Cmd+Shift+\ all left aux width 0 - the right-rail toggle is pin 2 / bundle 44-b, not this bundle; quiet-shell keeps it collapsed on cold start). Its card SKIN is confirmed via computed style at width 0. All measured values exact.

VERDICT: PASS (styling exact on all three; aux visibility not reachable in this bundle - not a 44-a criterion).

## P1.4 - shadows

| Card | Measured box-shadow | Expected |
|---|---|---|
| tree rail | rgba(20,22,28,0.22) 0px 8px 28px -14px, rgba(20,22,28,0.05) 0px 1px 2px 0px | shadow-rail + e1 |
| editor | rgba(20,22,28,0.26) 0px 12px 36px -16px, rgba(20,22,28,0.05) 0px 1px 2px 0px | shadow-editor + e1 |
| right rail | rgba(20,22,28,0.22) 0px 8px 28px -14px, rgba(20,22,28,0.05) 0px 1px 2px 0px | shadow-rail + e1 |

Exact match. VERDICT: PASS.

## P1.5 - .monaco-editor-background opaque #FFFFFF

The living-docs product path renders a webview (iframe), NOT Monaco: `document.querySelectorAll(".monaco-editor-background").length === 0` on every reachable surface, including after opening the `metrics.csv` source. So the LITERAL predicate (that element computing to #FFFFFF) is UNVERIFIABLE live - the element does not exist.

What IS verifiable about "no transparency under the paper":
- editor part (the paper card) computes `background-color: rgb(255,255,255)` = opaque #FFFFFF.
- the webview iframe body is transparent (`rgba(0,0,0,0)`) BUT sits over the opaque white card, so the paper reads opaque white to the user.
- the editor `::after` separator-shadow overlay is correctly suppressed to `none`.
- elevation.css lines 120-124 pin `background-color: #FFFFFF !important` on `.monaco-editor`, `.monaco-editor-background` and `.margin`, so any real text editor opened on the paper is guaranteed opaque.

The anti-transparency INTENT is met (paper is opaque white); the exact `.monaco-editor-background` computed value cannot be measured because Monaco never mounts on the product path.

VERDICT: PASS-by-construction (intent met + CSS rule present); literal element unmeasurable live.

## P1.6 - sashes still work, no dead zone > 12px gap

Active vertical sash between tree rail and editor: x-centre 346 (inside the 340->352 12px gap), width 4px, `disabled:false`, `pointer-events:auto`. Live drag (mousemove/down/move-move-move/up, +60px): tree-rail width **252 -> 312px**, then dragged back **312 -> 252px**. Resize tracks the drag exactly. Sash hit width 4px < 12px gap -> no dead zone wider than the gap.

VERDICT: PASS.

## P1.7 - at most ONE new core CSS seam, logged + seam-gated

`git diff origin/main...v2/shell-a --stat`: files outside the sanctioned cheap tiers (styleOverrides CSS, theme json, ledger docs, scripts, QA png, stylelint known-variables) touched = **0**. No core files (`browser/parts`, layout, part internals) changed. Ledger row V2-1 = "NOT TAKEN - 0 core" recorded. `check-seams.sh` seam 9 asserts: elevation.css gates on `.floating-panels`; the core feature still exists in floatingPanels.css; the four pinned tokens (#EDEFF3, #E9EAEE, both shadow strings) stay pinned. Bite test proven (perturb -> exit 1, restore -> exit 0).

VERDICT: PASS (zero core seams; logged; seam-gated; assertion bites).

## Overall verdict: FAIL

Single defect: P1.2 top + bottom frame insets (0px / 6px vs 12 +/-1px). Everything else PASSES numerically.
