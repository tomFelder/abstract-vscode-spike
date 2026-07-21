# 44-b "the header" - VALIDATION ROUND 1 raw measurements

Adversarial validator, PR #219 (#216). Web build, Playwright + getComputedStyle/getBoundingClientRect, chromium 1194, viewport 1440x900 @2x unless noted. Server: `TMPDIR=/tmp ./scripts/code-web.sh ./living-docs-sample` on :8080.

## Automated checks

- `npm run typecheck-client` - clean (exit 0).
- `npm run valid-layers-check` - clean (exit 0).
- `./scripts/check-seams.sh` - OK, all shell seams intact (exit 0).
- `./scripts/test.sh --grep "livingDocs"` - 307 passing, 0 failing.
- Seam-10 perturbation: set `ABSTRACT_HEADER_HEIGHT = 35`, check-seams exit **1** with `FAIL [header-height-constant]`; restored to 48, exit **0**; working tree clean. Seam bites.

## 310 -> 307 test accounting (net -3, fully reconciled)

Test declarations (`test(`/`it(`) by file, origin/main -> v2/shell-b:
- `abstractHeaderService.test.ts`  0 -> 1  (+1, new: relays published content, fires once per publish)
- `livingDocRender.test.ts`       (-2 net): removed 4, added 2 inverse assertions
  - REMOVED: "editor top bar carries the user avatar" -> rewritten to assert NO top bar (PH.4)
  - REMOVED: "top bar shows a real file breadcrumb" -> rewritten to assert NO in-page breadcrumb (PH.4)
  - REMOVED: "top bar falls back to the brand crumb" (top bar deleted)
  - REMOVED: "breadcrumb escapes hostile project/title/file names" (security test for the OLD innerHTML top bar; the new header uses `textContent` DOM API - XSS-safe by construction, so the string-escaping test no longer applies)
  - "formatting toolbar" test kept, only its title trimmed ("Present available" dropped since Present left the webview)
- `screenRender.test.ts`          (-2 net): removed
  - "<id> renders the global top bar (brand, crumb, sync pill, Present, avatar)" -> rewritten to "draws no per-webview top bar" (PH.4)
  - "the sync pill is omitted on a fresh project with no living surface" (top bar deleted)
  - "exactly one top bar is rendered per screen" (top bar deleted)

Net: +1 -2 -2 = -3 -> 310 -> 307. Every removed test corresponds ONLY to deleted top-bar/breadcrumb functionality. NO test skipped (grep `.skip/.only/xit/xtest` = none), NONE weakened to pass. VERIFIED CLEAN.

## Core diff / seam budget

Only two files under `src/vs/` outside livingDocs/styleOverrides:
- `platform/window/common/window.ts`: `+ export const ABSTRACT_HEADER_HEIGHT = 48;` (documented fork seam).
- `browser/parts/titlebar/titlebarPart.ts`: `minimumHeight` does `if (isWeb && !this.isAuxiliary) value = Math.max(value, ABSTRACT_HEADER_HEIGHT)`. `isAuxiliary` is a pre-existing field (line 303/337), reused.

Seam count = 2/2 (44-a frame inset + this). No third core coupling. Header mounts via public `IWorkbenchLayoutService.getContainer(mainWindow, Parts.TITLEBAR_PART)` (ActiveNavChip route) - no core patch, no foreign storage key. Ledger row V2-2 filled. Desktop note names the traffic-light inset concretely (`.style-override.mac .abstract-header { padding-left: 78px }`).

## Header measurements (Board Note, a living doc)

| Predicate | Spec | Measured | Verdict |
|---|---|---|---|
| Header height | 48px | 48px | PASS |
| Header width/top | full-width, top 0 | width 1440, top 0 | PASS |
| Header bg | chrome #EDEFF3 | rgb(237,239,243) | PASS |
| Header border-bottom | 1px #E2E4EA | 1px rgb(226,228,234) | PASS |
| Logo tile | 22x22, radius 6, accent, "A" | 22x22, 6px, rgb(91,109,196), "A" | PASS |
| Workspace name | 13.5/600 #1A1C20 | "Living Docs Sample" 13.5px/600 rgb(26,28,32) | PASS |
| `/` separator | #C6CAD2 | rgb(198,202,210) | PASS |
| Breadcrumb tail | 13.5 #868B95, updates on doc+surface | "Board Note"/"Appendix - Design Tokens"/per-surface "Home/Templates/Knowledge/Agents" 13.5px rgb(134,139,149) | PASS |
| Toggles | 2x 28px, hover #E2E4EA | 2x 28x28, aria "Collapse Tree Rail"/"Collapse Right Rail", `:hover{background:#E2E4EA}` in studio.css | PASS |
| Avatar | 27px navy #3B4D8F, "TS" | 27x27 rgb(59,77,143) radius 999px | PASS |

## Per-surface right cluster (PH.3)

| Surface | Expected | Measured pill | Measured action | Verdict |
|---|---|---|---|---|
| Editor (living) | sync pill + Present + avatar | "All sources synced" flex, bg rgb(238,247,240), green dot rgb(44,129,89) | "↗ Present" | PASS |
| Editor (plain md) | pill omitted (truthful) | display:none | "↗ Present" | PASS (spec: pill only once sources bound) |
| Home | sync pill + "＋ Open folder" | "All sources synced" | "＋ Open Folder" | PASS |
| Templates | "＋ New template", no pill | display:none | "＋ New Template" | PASS |
| Knowledge | sync pill + "＋ Add source" | "All sources synced" | "＋ Add Source" | PASS |
| Agents | agent-health pill, no action | "5 agents active" | display:none | PASS |

Mock resolves the Present ambiguity: mock line 45 shows "↗ Present" in the header; line 528 "Header swaps Present for '＋ Open folder'". Editor action = Present is spec-correct.

## PH.4 double-header (OOPIF inspected)

Two webview OOPIF frames (`http://0bcupa...`): `hasTopbar:false, hasPresent:false, hasCrumb:false` each. Main doc: no `.topbar`, no `[data-present-open]` in body. Single header only. PASS.

## Rail interactions

- P2.2 ⌘\: sidebar 252 -> 0 (tree rail toggles); editorGroups stays 1 (NO split). ⌘⇧\: aux 0 -> 374 (right rail toggles); groups stay 1. PASS.
- P2.6 ⌘B (sidebar focused): 332 -> 0 (tree rail toggles). ⌘B is stock `toggleSidebarVisibility`, untouched, so Bold-in-editor is preserved. PASS.
- P2.1 toggles: 28x28, far left/right, hover #E2E4EA (studio.css). PASS.
- P2.5 badge: `.abstract-header-badge` renders 8px, bg rgb(201,154,46)=#C99A2E, radius 999px; show/hide gated `(!rightRailVisible && hasPending && showTogglesOnSurface)`. Force-open retired: `decideReviewRailOpenOnEntry` respects a stored manual collapse even with a pending proposal (unit test "the badge dot surfaces it - P2.5"). Live proposal not stageable in the web harness (no OpenRouter backend running); render path + unit tests verified. ACCEPT.

## DEFECTS

### P2.3 - collapse animation absent (width restore works)
- Expected: "Collapse animates width->0 + fade ~150ms ease; expand restores prior width."
- Measured: transitionDuration on `.part.sidebar`, `.part.auxiliarybar`, `.split-view-view`, grid split container = **0s** (property `all`, timing `ease` but duration 0). Width trace during collapse (16ms samples): `[252,0,0,0,...]` - snaps in one frame, no intermediate values. No `transition`/`animation`/`@keyframes` anywhere in the 44-b diff.
- Expand restores prior width: dragged 252->332, collapsed ->0, expanded ->332. That half PASSES.
- Verdict: PARTIAL FAIL - the ~150ms animation is not implemented.

### P2.4 - collapsed state does NOT persist across reload
- Expected: "Collapsed state persists per-workspace across reload (storage keys per 43 §3.5: `livingDocs.v2.treeRailCollapsed`, `livingDocs.v2.rightRailCollapsed`)."
- Measured: opened Board Note, collapsed BOTH rails (sidebar 0, aux 0), reloaded -> **sidebar back at 252px (OPEN)**. The tree rail did not stay collapsed.
- Root cause: the spec'd keys `livingDocs.v2.treeRailCollapsed` / `livingDocs.v2.rightRailCollapsed` exist ONLY in the spec doc - `grep -rn` across `src/` finds ZERO occurrences. `RailVisibilityContribution._sync()` (livingDocs.contribution.ts:810) unconditionally `setPartHidden(false, Parts.SIDEBAR_PART)` on doc-surface entry ("The left tree-rail always comes up on the editor surface"), with no read of any persisted collapse state. The right rail persists only `livingDocs.reviewRailManualChoice` (PROFILE scope, differently named, not the per-workspace §3.5 key).
- Verdict: FAIL - the tree rail's collapsed state is lost on reload; the mandated per-workspace keys are not implemented.
