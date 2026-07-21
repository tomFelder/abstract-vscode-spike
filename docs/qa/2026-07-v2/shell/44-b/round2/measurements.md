# 44-b "the header" - FIX ROUND 2 measurements (P2.3 + P2.4)

Implementer fix round for PR #219 (#216). Web build, `TMPDIR=/tmp ./scripts/code-web.sh ./living-docs-sample` on :8080, driven with playwright-core (full Chromium build 1194), viewport 1440x900. Cold start lands on the editor surface (Appendix.md); the service worker is registered on first load, then a reload boots the full workbench (same as the validator's method).

Raw traces committed alongside this file: `animation-trace.json` (frame samples), `persistence-trace.json` (state across reloads).

## Automated checks (all clean)

- `npm run typecheck-client` - clean (exit 0).
- `npm run valid-layers-check` - clean (exit 0).
- `./scripts/check-seams.sh` - OK, all shell seams intact (exit 0). No new core seam: still 2/2 (44-a frame inset + 44-b header height). The animation is CSS-only; persistence is service-only (`IStorageService`).
- `./scripts/test.sh --grep "livingDocs"` - **309 passing, 0 failing** (307 baseline + 2 new pure-logic tests for P2.4 in `railVisibility.test.ts`).

## P2.3 - collapse/expand animation (~150ms ease width + fade)

Frame-sampled the collapsing/expanding `.split-view-view` (the grid view hosting each rail part) across requestAnimationFrame; read the computed `transition-duration`.

| Trace | transition-duration | width path | opacity path | anim span (frames) | verdict |
|---|---|---|---|---|---|
| tree collapse | `0.15s, 0.15s` (width, opacity) | 264 -> 0 | 1 -> 0 | ~133ms, 17 intermediate frames | PASS |
| right collapse | `0.15s, 0.15s` | 392 -> 0 | 1 -> 0 | ~140ms, 18 frames | PASS |
| tree expand | `0.15s, 0.15s` | 0 -> 264 (prior width restored) | 0 -> 1 | ~129ms, 17 frames | PASS |
| right expand | `0.15s, 0.15s` | 0 -> 392 (prior width restored) | 0 -> 1 | ~141ms, 18 frames | PASS |

The R1 defect was a single-frame snap `[252,0,0,...]` with transition-duration 0s. After the fix the width eases smoothly through ~17-18 intermediate values while opacity fades in lockstep; computed transition-duration is exactly 0.15s on both properties. The measured visible span (129-141ms) is the frame-sampled easing window; the computed duration is 150ms, within the +/-20ms tolerance (plan 43 section 3.6: duration/easing by inspection + one live observation, no frame-perfect assertions).

Example tree-collapse samples (t ms, width px, opacity): (36,264,1.00) (44,254,0.96) (60,205,0.78) (77,140,0.53) (94,88,0.33) (119,39,0.15) (144,13,0.05) (172,0,0.00). See animation-trace.json for the full series.

### Drag safety
While a sash in the rail's split view is `.active` (dragging), the transition is disabled, so resizing tracks the pointer with no easing lag; only the toggle animates. Verified by inspection of the computed rule and by dragging (expand-restores-prior-width traces above show the dragged/default width is preserved, not clobbered).

## P2.4 - collapsed state persists per-workspace across a REAL hard reload

`persistence-trace.json` - full-navigation reload (`page.goto`, not soft), WORKSPACE-scoped storage.

| Step | tree visible / width | right visible / width |
|---|---|---|
| both open | true / 264 | true / 392 |
| collapse both | false / 0 | false / 0 |
| **hard reload** | **false / 0** | **false / 0** |
| expand both | true / 264 | true / 392 |
| **hard reload** | **true / 264** | **true / 392** |

Both rails, both states, survive a real hard reload. The R1 defect (tree rail returned to 264 OPEN after reload) is fixed. Screenshots: `both-open`, `both-collapsed`, `collapsed-after-hard-reload` (the last re-confirms both stay collapsed post-reload).

Storage keys are EXACTLY the spec's section 3.5 names, `StorageScope.WORKSPACE` / `StorageTarget.MACHINE`:
- `livingDocs.v2.treeRailCollapsed`
- `livingDocs.v2.rightRailCollapsed`

The legacy profile-scoped `livingDocs.reviewRailManualChoice` is migrated into `livingDocs.v2.rightRailCollapsed` on first read and then removed, so there is a single source of truth for the right rail's explicit user choice. The plan-42 quiet-shell semantics are preserved: an UNSET `rightRailCollapsed` key means "no explicit choice" and the has-something-to-say default applies; a stored value records the user's explicit collapse/open and wins on entry (a pending proposal no longer force-opens - the badge dot surfaces it, P2.5, unchanged).
