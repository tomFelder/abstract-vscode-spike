# Plan 45-d - fit and finish (round 2 evidence)

Round 2 closes the single unticked box from round 1's validate pass: **P10.1**, the source drawer's referenced-row highlight. Round 1 shipped the referenced row in amber (`#FEF6E9` + amber inset rail) and documented it as a deviation, arguing the amber was load-bearing for the drift/changed vocabulary. That reasoning conflated two distinct states. Pin 10 (plan 43 §2) requires the *referenced* row in accent-tint `#F4F5FD`; amber belongs only to the *changed/drift* state (`tr.changed` cream + then->now). This round separates them.

Worktree `abstract-v2-editor`, branch `v2/editor-d`; Node 24; live pass on the compiled web build (`TMPDIR=/tmp ./scripts/code-web.sh ./living-docs-sample --port 8081`, session `editor-45d-r2`) driven headless via playwright-core Chromium (build 1217), `getComputedStyle` on the real `Board Note.md` living document, 1440x900 @2x.

## The fix

`livingDocRender.ts` STYLE block, two rules:

- `.srcdrawer tr.sel td` (the referenced/latest row, shared by the bound-figure list AND the CSV grid latest row): `background:#fef6e9` + amber `oklch(0.66 0.16 45)` inset rail -> **`background:#F4F5FD`** (accent-tint) + **`#4650B8`** (accent-ink) inset rail. `font-weight:600` kept. This matches the canonical selected-row treatment used across the surface (Files rail, plan 43 pin 4; and `livingDocSourceEditor.ts` already uses `#F4F5FD` for its grid latest row) - the drawer was the lone amber outlier.
- `.srcdrawer tr.changed td` unchanged in colour (`#fffaf1`), but the selector is extended to `.srcdrawer tr.changed td,.srcdrawer tr.sel.changed td` so the **both-referenced-and-changed** case is deterministic regardless of source order.

No markup change: the `sel` / `changed` classes emitted at `livingDocRender.ts:1159` / `:1168` are untouched, so the render tests that assert on the class markup still hold.

### Both-referenced-and-changed decision

When a row is *both* referenced (`sel`) and drifted (`changed`), the **changed cream background wins** while the **accent-ink inset rail from `.sel` is retained**. Rationale: two competing backgrounds (accent-tint vs cream) would clash and muddy the read; the truthful "this data drifted" signal is the more important message, so the cream field dominates, and the accent rail still marks the row as the referenced one. Net reading: cream field + accent rail + the then->now amber cell - all three truths co-exist without conflict. (In the current fixture this combination does not naturally arise - the referenced `sel` row is the `.prev` binding, which does not drift - so the CSS is the guarantee, exercised by construction rather than by this run's live capture.)

## Live proof - fresh state (referenced row = accent-tint)

CSV latest row matches the lock (no drift). Clicked a fresh bound figure on `Board Note.md`; measured the drawer's `tr.sel` rows:

| Row | `background-color` | inset rail (`box-shadow`) | `font-weight` |
|---|---|---|---|
| CSV grid latest row (`24 ... 48600 427`) | `rgb(244,245,253)` = **#F4F5FD** | `rgb(70,80,184) 2px inset` = **#4650B8** | 600 |
| Bound-figure referenced row (`metrics.mrr.prev $41.2k`) | `rgb(244,245,253)` = **#F4F5FD** | `rgb(70,80,184) 2px inset` = **#4650B8** | 600 |

`changedRows: []` - nothing amber, nothing struck. Screenshots `fresh-referenced-row-accent-1440.png` (BOUND FIGURES section) and `fresh-drawer-grid-1440.png` (grid).

## Live proof - drifted state (changed row keeps then->now)

Drifted `metrics.csv` latest row (mrr 48600->59900, signups 427->512), reopened the drawer. The referenced `sel` row stays accent-tint; the drifted rows carry the intact changed treatment:

| Row | `background-color` | then | now | now colour | arrow |
|---|---|---|---|---|---|
| `metrics.mrr` | `rgb(255,250,241)` = **#fffaf1** | `$48.6k` (struck) | `$59.9k` | `rgb(138,90,18)` = #8a5a12 | yes |
| `metrics.mrr.delta` | #fffaf1 | +18% | +45% | #8a5a12 | yes |
| `metrics.signups` | #fffaf1 | 427 | 512 | #8a5a12 | yes |
| `metrics.signups.delta` | #fffaf1 | +37% | +64% | #8a5a12 | yes |

The "A linked source changed since the last sync" banner + "Sync figures" CTA + `metrics.csv` "stale" rail dot all present; the drawer's "▲ then -> now" drift hint sits above the table. Screenshots `changed-thennow-preserved-1440.png` (BOUND FIGURES section) and `changed-drift-banner-1440.png` (banner). CSV restored to origin after the run.

## Checks

| Check | Result |
|---|---|
| `npm run typecheck-client` | clean (exit 0) |
| `./scripts/test.sh --grep "livingDoc"` | **360 passing**, 0 failing |
| `./scripts/test.sh --grep "LivingDocs"` | **8 passing**, 0 failing |
| Diff scope | one file (`livingDocRender.ts` STYLE), CSS-only; no markup, no bundle, no core seam |

No test pinned the old amber `#fef6e9` for the drawer sel row (the render tests assert on the `sel`/`changed` class markup, not the colour), so none needed updating.

## Evidence files

- `fresh-referenced-row-accent-1440.png` - fresh state: BOUND FIGURES, `metrics.mrr.prev` referenced row in accent-tint, all values plain.
- `fresh-drawer-grid-1440.png` - fresh state: the metrics.csv grid in the drawer.
- `changed-thennow-preserved-1440.png` - drifted state: BOUND FIGURES with then->now on the 4 drifted rows, referenced row still accent-tint.
- `changed-drift-banner-1440.png` - drifted state: the "linked source changed" banner + Sync figures + stale rail dot.
