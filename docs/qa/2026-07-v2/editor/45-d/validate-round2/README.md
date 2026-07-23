# 45-d fit and finish - validation round 2 (focused, adversarial)

Focused re-validation of the P10.1 fix on bundle 45-d (PR #243, loop `(#224)`), after round 1's lone FAIL: the referenced drawer row rendered amber `#FEF6E9` regardless of state, where pin 10 (`docs/plans/43-editor-v2-spec.md`, `accent-tint` = `#F4F5FD`) requires accent-tint for the referenced/latest row and reserves amber for the CHANGED/drift vocabulary only. Fix head `55e97fcc5c7` (`livingDocRender.ts`, CSS-only): `.srcdrawer tr.sel` -> accent-tint `#F4F5FD` + accent-ink `#4650B8` inset rail; changed-cream `#fffaf1` kept separate; `tr.sel.changed` made deterministic (changed background wins, accent rail retained).

P10.2 / P10.3 were PASS in round 1 and are not re-litigated here. This round re-proves P10.1 in both states on the compiled web build, headless Chromium 1440x900 driving the real `Board Note.md`, `getComputedStyle`/`getBoundingClientRect` on the live webview. Broker down for the unit tests.

## Verdict: PASS (3/3)

The fix holds in every leg. The referenced row is now accent-tint in the fresh state, amber is gone from it, the changed state keeps its own truthful cream + then->now, and a referenced-and-drifted row reads correctly as cream field + retained accent rail.

## Static checks (broker down)

| Check | Result |
|---|---|
| `typecheck-client` | exit 0 |
| `test.sh --grep "livingDoc"` | 360 passing, 0 failing |
| `test.sh --grep "LivingDocs"` (perf + scale) | 8 passing, 0 failing |

## LIVE - P10.1 both states (the round-1 defect, re-adjudicated)

Measured on the live webview, real `Board Note.md`, real source drawer.

### Fresh / undrifted (the exact defect from round 1)

Clicked a fresh bound figure (`metrics.mrr.prev` = `$41.2k`, and `metrics.mrr` = `$48.6k` - both match the latest `metrics.csv`, so undrifted):

- Referenced row `tr.sel` (resolved table): `background rgb(244,245,253)` = **`#F4F5FD`** (accent-tint), inset rail `rgb(70,80,184)` = **`#4650B8`** (accent-ink), `font-weight 600`, `changed` class absent.
- CSV-grid latest row `tr.sel`: same **`#F4F5FD`** + **`#4650B8`** rail.
- `anyChanged: false`. No amber anywhere on the referenced row. **The round-1 FAIL is fixed.**
- Drawer height **52%** of viewport, `z-index 25`. Single editor group (`.editor-group-container` count = 1) - no second group spawned by the figure click.

### Drifted / changed

Drifted the source truthfully end-to-end: edited `metrics.csv` week-24 `mrr` `48600 -> 59900` on disk, reloaded so the real freshness recompute re-read the source; `metrics.csv` flipped to **stale** in the Sources rail. Re-opened the drawer on the `metrics.mrr` figure:

- Referenced-AND-changed row `tr.sel.changed` (`metrics.mrr`): `background rgb(255,250,241)` = **`#fffaf1`** (changed cream, NOT amber), inset rail `rgb(70,80,184)` = **`#4650B8`** RETAINED, text `metrics.mrr $48.6k -> $59.9k`. Reads as "referenced and drifted" exactly as the fix's `tr.sel.changed` rule promises: changed background wins, accent rail kept.
- Non-referenced changed row (`metrics.mrr.delta`, class ` changed`): cream `#fffaf1`, no rail (correct - changed but not the referenced row), `+18% -> +45%`.
- then->now spans present (`.sp-then`/`.sp-now`): `$48.6k -> $59.9k`, `+18% -> +45%`. Drift-hint banner present.
- Drawer still `52%` / `z-index 25`, single group.

### Restore

Restored `metrics.csv` to `48600`; re-opened the drawer: referenced row back to `tr.sel` only, **`#F4F5FD`** + `#4650B8`, `anyChanged: false`, grid latest row `48600`. No lingering drift.

## P10.1 other legs re-measured (no drift from the CSS edit)

- Figure atom: `color rgb(70,80,184)` = **`#4650B8`**; `border-bottom 2px dotted rgb(154,162,224)` = **`#9AA2E0`**; `font-weight 500`; `contenteditable="false"`; 6 bound figures. Identical to round 1.
- Drawer: **52%** height, `z-index 25`. Identical to round 1.

The CSS-only edit touched only the two drawer-row rules; the figure atom and drawer geometry are unchanged.

## Both-state colour numbers (summary)

| State | Referenced-row background | Referenced-row rail |
|---|---|---|
| Fresh / undrifted | `#F4F5FD` (accent-tint) | `#4650B8` (accent-ink) |
| Drifted / changed | `#fffaf1` (changed cream) | `#4650B8` (accent-ink, retained) |

## Screenshots

- `00-boot-1440.png` - boot, editor on Board Note.
- `fresh-referenced-row-accent-1440.png` - drawer open, fresh state, `metrics.csv` synced (referenced row measures `#F4F5FD` + `#4650B8`).
- `changed-thennow-preserved-1440.png` - drawer open after the live drift, `metrics.csv` stale (changed rows keep cream + then->now; referenced-and-drifted row keeps the accent rail).
