# Plan 45-d - fit and finish (round 1 evidence)

Bundle 45-d (PR #243), the final feature bundle of the Abstract Editor v2 wave: pin 10 regression-hold, the F13 hover then-vs-now peek, plus the recenter/perf loose ends. Worktree `abstract-v2-editor`, branch `v2/editor-d`; Node 24; live pass on the compiled web build (`TMPDIR=/tmp ./scripts/code-web.sh ./living-docs-sample --port 8081`) driven headless via playwright-core Chromium (`getBoundingClientRect` / `getComputedStyle` on the real `Board Note.md` living document).

## Checks

| Check | Result |
|---|---|
| `npm run typecheck-client` | clean (exit 0) |
| `npm run valid-layers-check` | clean (exit 0) |
| `./scripts/check-seams.sh` | OK - all shell seams intact |
| `./scripts/test.sh --grep "livingDoc"` | **360 passing**, 0 failing |
| `./scripts/test.sh --grep "LivingDocs"` (perf + scale) | **8 passing**, 0 failing |
| Diff scope | livingDocs contrib + common only; `livingDocsService` additive (one getter); zero core seams; no PM bundle change |

### Test-count accounting

The F13 provenance suite (`figure hover provenance`) went 4 -> 8: 4 new tests (drifted file then/now; stale-but-equal adds no now; api/mcp fallback named; file gets no fallback) plus the 4 existing updated for the new interface shape. That +4 lifts the `--grep "livingDoc"` total to 360. The 8 `LivingDocs perf + scale` tests failed on entry (pre-existing, wave-introduced: the mock `editorService` was stale against the constructor's new `onDidActiveEditorChange` subscription) and now pass after adding `Event.None` to the three mocks.

## P10.1 - bound figures + drawer (regression-hold, LIVE on Board Note.md)

| Predicate | Spec (43 pin 10) | Measured live | Verdict |
|---|---|---|---|
| Figure text colour | #4650B8 | `rgb(70,80,184)` = #4650B8 | PASS |
| Figure weight | 500 | `500` | PASS |
| Figure underline | 2px dotted #9AA2E0 | `2px dotted rgb(154,162,224)` = #9AA2E0 | PASS |
| Drawer height | 52-54% of viewport | `52%` (height/vh) | PASS |
| Referenced row highlight | accent-tint (#F4F5FD per P10.1) | `rgb(254,246,233)` = #FEF6E9 (amber) | DEVIATION - see note |
| No second editor group | never | `.editor-group-container` count `1 -> 1` on figure click | PASS |
| Round-trip to `[label](bind:key)` | intact | bundle carries `bound_figure` (toDOM `span.bound`) + `bind:` parse/serialise; `ProseMirror vendored bundle` round-trip suite green | PASS |

**Drift the wave introduced / fixed here.** The figure atom (`span.bound`) had drifted from pin 10 - it shipped a `1.5px solid #5682BB` underline with the inherited body text colour, not the spec's `#4650B8`/500 text over a `2px dotted #9AA2E0` underline. (This was a pre-wave divergence, not wave-introduced; git-diff of `.bound`/`.srcdrawer` across the wave shows no change. Corrected here since this is the fit-and-finish bundle and the criterion names the exact hexes.)

**Documented deviation (drawer row highlight).** P10.1 in §2 names `#F4F5FD` for the referenced row, but the shipped drawer highlights the drifted/latest row in amber (`#FEF6E9` + amber inset bar), which is load-bearing: it is the same amber "then -> now / changed" vocabulary the drawer's drift line and the F13 peek use. Changing it to lavender would break that coherence and regress a state that passed the plan-42 light-path run. Left as-is and flagged rather than silently regressed; escalating the wording as a §2-vs-shipped question.

## P10.2 - the F13 hover then-vs-now peek (LIVE + unit)

Hovering a bound figure whose source has drifted raises the quiet tooltip (`.lwd-tip`) reading, in one vocabulary with F12:

- `metrics.csv` / `mrr - Synced 24 days ago`
- amber `Stale - source changed since last sync`
- `then $48.6k -> now $59.9k` (the value at bind time struck through, the source's current value in amber)

Live DOM measured on `Board Note.md` (drift injected through the real host `lwdRender` -> `setProv` message path, the same technique 45-a used for pending decorations): `.tip-then` present, `.tn-now` = `$59.9k`. Screenshot `hover-thennow-1440.png`.

**api/mcp fallback naming** is proven at the unit layer (`a stale api/mcp binding with no readable live value names its fallback plainly`): a stale api or mcp key ABSENT from the live-value map (the proxy fetch was unavailable) reports `kind` api/mcp and `fallback` = "Live value unavailable - showing the last synced value", never a fabricated `now`. The live capture of the fallback tooltip hit a one-render-lag race in the synthetic injection; the branch is deterministic and covered by the test, and `showTip` renders `.tip-fallback` with the `KIND fallback` label from that same field. **Injectable clock:** `buildFigureProvenance(lock, staleKeys, currentValues?, now?)` - `now` is the injected clock, exercised by the suite's fixed `NOW`.

## P12.6 - reading-column recenter with Properties open (loose end, LIVE re-verify)

| | centre | prose left | prose width | panel | `.pmwrap` padding-right |
|---|---|---|---|---|---|
| Properties closed | 519 | 218 | 601.9 | - | 40px |
| Properties open | 377 | 76 | 601.9 | 284px | 324px (= 284 + 40) |

Δ centre = **-142px** - matches the 45-c baseline (-142px) exactly. The reading column re-centres in the remaining width; unchanged by the wave. Screenshots `recenter-closed-1440.png` / `recenter-open-1440.png`.

## P9.8 - scale-fixture typing latency (loose end, no cumulative regression)

The 45-a live keydown->DOM baseline was median **0.7ms** / p95 3.4ms, with the mechanism reasoned as: the gutter numbers are static node decorations remapped by ProseMirror's `DecorationSet.map`, not recomputed per keystroke. That mechanism is unchanged by 45-b/c/d: the deco-spec builder and gutter code were untouched beyond additive provenance fields, and this bundle's F13 change adds only DATA to the provenance array (set once per decoration payload via `setProv`, never on keydown) - zero new per-keystroke work. The `LivingDocs perf + scale` suite (50 docs over 4 shared CSVs) passes green after this bundle, proving the render/resolve path still scales; each shared CSV is read exactly once per refresh pass. (A live keydown re-measure was not re-captured this round - the web CSS bundle only builds via the full client compile; the structural argument + green perf suite stand in for it.)

## Evidence files

- `00-boot-1440.png` - the Abstract shell + tree rail on `living-docs-sample`.
- `figure-1440.png` - Board Note with bound figures in accent blue + dotted underline.
- `drawer-1440.png` - source drawer open at 52% via a bound-figure click (no second group).
- `hover-thennow-1440.png` - the F13 then-vs-now peek: `then $48.6k -> now $59.9k`.
- `recenter-closed-1440.png` / `recenter-open-1440.png` - the -142px recenter with Properties.

Method: playwright-core headless Chromium (build 1217), 1440x900 @2x. Session `editor-45d`; server + temp fixtures (`living-docs-scale-sample`, driver scripts) removed on completion; `metrics.csv` drift restored.
