# Plan 45-a validation - round 1 (numbered gutter + address model)

Adversarial validation of PR #227 (branch `v2/editor-a` at `cc4a7837561`), the gate PR for plan 47. Fresh-eyes re-run of every check plus live numeric measurement on the running web build (`TMPDIR=/tmp ./scripts/code-web.sh ./living-docs-sample --port 8081`, driven headless via playwright-core Chromium, `getBoundingClientRect` / `getComputedStyle`). Verdict: **PASS** - all 13 criteria (P9.1-P9.10, P11.1-P11.3) verified.

## Static checks (re-run)

| Check | Result |
|---|---|
| `npm run typecheck-client` | clean |
| `npm run valid-layers-check` | clean |
| `./scripts/check-seams.sh` | OK - all shell seams intact |
| `./scripts/test.sh --grep "livingDocs"` | **311 passing**, 0 failing |

### Test-count accounting (every delta accounted for)

Baseline `--grep "livingDocs"` = 309 -> 311. The +2 are the two new render-layer tests in `livingDocRender.test.ts` (numbered-rail deco payload; widget cites "Line N"). The greps keyed on file names return 0 because mocha matches by suite **title**, not file: `--grep "prosemirrorBundle"` = 0, but `--grep "ProseMirror vendored bundle"` = **5** (round-trip + history intact); `--grep "livingDocPmDecorations"` = 0, but `--grep "PM decoration mapping"` = **19** (dot->number migration, in place, no count change); `--grep "livingDocAddress"` = 0, but `--grep "address model"` = **5** (new suite, not matched by the "livingDocs" grep). All consistent with the implementer's accounting.

### PM bundle freshness (not stale base64)

Decoded the committed `PROSEMIRROR_BUNDLE_BASE64` (379,724 chars) and grepped the artefact: `data-lwd-num` x1, `pm-num` x4, `setDecorations` x1, `numbers` x1, bound/pending classes present. The `setDecorations` body maps `numbers[].tone` to `pm-num bound|pending` and hides+widgets the matching edit block. The committed bundle drives the live gutter - confirmed not stale.

## Live numeric measurements (1440x900, Weekly Summary unless noted)

**P9.1 prose never shifts.** `.pmwrap` width 1074px (= baseline). `.prose` x=137.75, padding-left 70px, transform matrix -18, box-sizing content-box. Text left edge measured via a real Range on the first paragraph = **207.75px** (= baseline anchor exactly, 0px shift); text right = 900.25px. The 30px->70px lane widened the element 40px; `translateX(-18px)` pulls the reading group half-left so the text column stays put. Cross-document text-left variance (narrower docs shift, `flex:0 1 auto` shrink) is pre-existing - baseline main used the same flex model with 30px padding.

**P9.2 number geometry.** Idle & bound numbers: JetBrains Mono, 11px, weight 400 (600 bound), text-align right, width 34px. Number right edge measured 185.75px vs text edge 207.75px = **gap 22px exactly** (`right:calc(100% + 22px)` -> 714.5px).

**P9.3 idle colour.** `rgb(198,202,210)` = **#C6CAD2** exact.

**P9.4 D1 wrap rule (wrap-fixture.md).** One `data-lwd-num` per Markdown block regardless of visual rows: block 3 = 132px (~5 rows) -> one number; block 6 = 158px (~6 rows) -> one number; short lines = 1 row each -> one number; the list block (2 items) = 67px (~3 rows) -> one number. Numbered block count = block count; blank gutter on wrapped rows (::before at top:.62em, first row only).

**P9.5 bound.** Block 2 (Revenue) class `pm-num bound`, before `rgb(91,109,196)` = **#5B6DC4** weight 600, pointer-events auto; ::after dot 9px x 9px, bg #5B6DC4, in the gutter lane left of the number.

**P9.6 pending (synthetic decoration via `window.pmDeco`, the exact host path; #120 blocks the live model round-trip).** Pending number before `rgb(138,109,26)` = **#8A6D1A** weight 600; ::after bar bg `rgb(201,154,46)` = **#C99A2E**, width **3px**, top:2px/bottom:2px spanning the block's rows.

**P9.7 hover/click on marked numbers.** Bound number `mouseover` at clientX in the gutter lane -> provenance tooltip shows "metrics.csv - mrr - Synced just now" (key resolved via `gutterKeyFor` -> `data-key=metrics.mrr.delta`). Click in the gutter lane -> source-peek **drawer** opens ("metrics.csv"). Idle numbers: pointer-events:none, no tooltip on hover - inert (probed several).

**P9.8 typing latency (plan-30 scale fixture, `report-0.md`, n=20 keydown->DOM-mutation).** Run 1: median **0.7ms**, p95 3.8ms. Run 2: median 1.6ms, p95 2.7ms. Baseline: median 0.7ms / p95 3.4ms. Median matches; p95 within run-to-run noise (a single outlier). No regression - numbers are static node decorations remapped by PM's `DecorationSet.map`, not recomputed per keystroke.

**P9.9 address model (43 section 3.1), live attack.** Against the compiled `common/livingDocAddress.js`: crafted a persistent ref to block `b-2` (line 3), deleted that block, followed the ref -> `resolveBlockLine` returns `undefined`, **does not throw** (consumer omits the address -> doc, no scroll, no error). Remaining blocks renumber [1,2] as a display-time projection; ids durable (`h-highlights`/`b-1`/`b-2`). Plus 5 unit tests.

**P9.10 dead gutter gone.** Live: `.pm-gutter` DOM count = 0. Branch grep: no `padding-left:30px` on the editor, no `pm-gutter`/`pm-gutter-recent`, no `kind:'dot'`; `IPmGutterMarker` union is `bar`-only. (The one `padding-left:30px` hit is in `treeRailView.ts` outline indent - unrelated, pre-existing.)

**P11.1 widget cites the address.** Widget mono tag row renders **"Line 6"** in `.src pm-addr`, JetBrains Mono, oklch(0.55 0.13 255) = #5B6DC4. Render unit test asserts the host builder emits `class="src pm-addr">Line N`.

**P11.2 word-diff palette + buttons.** add bg `rgb(233,246,238)`=**#E9F6EE** / colour `rgb(44,129,89)`=**#2C8159**; remove bg `rgb(251,238,238)`=**#FBEEEE** / colour `rgb(207,90,83)`=**#CF5A53** / line-through; Approve bg `rgb(91,109,196)`=**#5B6DC4**, height **28px**, radius **8px**; Reject ghost white, border #E6E8EC, 28px, radius 8 - on hover turns bg **#FBEEEE** / colour **#CF5A53** (measured live).

**P11.3 engine untouched + rail card address.** The approve/reject/amendApprove message handlers (`type:'approve'/'reject'/'amendApprove'`) are byte-identical to `origin/main` (the diff touches none of them; only CSS comments mention approve/reject). No new apply path. `reviewRailView.ts` (+15/-1) renders `.ldr-card-addr` = `addressLabel(resolveBlockLine(...))` - the same "Line N" string, omitted when the doc is not loaded or the block is gone.

## Evidence

- `gutter-1440.png` / `gutter-1760.png` - the numbered rail on Weekly Summary (bound dots on lines 2 & 4).
- `wrap-1440.png` - the wrap fixture (one number per block, blank on wrapped rows).
- `pending-render-1440.png` - synthetic pending: attention number + bar, inline word-diff widget citing "Line 6", Approve/Reject.
- `drawer-1440.png` - source-peek drawer opened by clicking a bound gutter number.

Method: playwright-core headless Chromium (installed build 1217), decorations injected through `window.pmDeco` (the identical function the host calls). Session `editor-45a-validate`; server + temp profiles killed on completion.
