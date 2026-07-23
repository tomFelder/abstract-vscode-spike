# 45-d fit and finish - validation round 1 (adversarial)

Validator, fresh eyes, refute-not-confirm. Bundle 45-d (PR #243, loop `(#224)`), the wave's final feature bundle. Criteria = PR #243 body P10.1-P10.3; spec `docs/plans/43-editor-v2-spec.md` pin 10 + `accent-tint` token (line 46 = `#F4F5FD`). Live pass on the compiled web build (`transpile-client`; `TMPDIR=/tmp ./scripts/code-web.sh ./living-docs-sample --port 8081`), headless Chromium 1440x900 driving the real `Board Note.md`, `getComputedStyle`/`getBoundingClientRect` on the live webview. Broker down for unit tests.

## Verdict: FAIL

One defect: the drawer's referenced-row highlight is amber `#FEF6E9` on rows that have NOT changed since bind, where pin 10 requires `accent-tint` `#F4F5FD`. Adjudicated live against the orchestrator's test (amber may stand ONLY if it appears solely on genuinely changed/stale rows). It does not: amber decorates the referenced/latest row regardless of state, and drift has its own separate cream treatment. So amber here is blanket decoration, not a truthful then/now signal - a defect against pin 10 as written.

## Static checks (re-run, broker down)

| Check | Result |
|---|---|
| `typecheck-client` | exit 0 |
| `valid-layers-check` | exit 0 |
| `check-seams.sh` | exit 0 - all shell seams intact |
| `test.sh --grep "livingDoc"` | 360 passing, 0 failing |
| `test.sh --grep "LivingDocs"` (perf + scale) | 8 passing, 0 failing |

## Perf-test-fix audit (the 7 previously-failing perf/scale tests)

Legitimate, not a weakening. The mock diff adds `onDidActiveEditorChange: Event.None` to three `editorService` mocks in `perfScale.test.ts`. Verified against production: `livingDocsService.ts:586` subscribes `onDidActiveEditorChange(() => this._recordDocViewed())` at construction (a since-last-looked side-effect added mid-wave, issue #212). The perf/scale tests assert on source-fetch bounding, cooldowns and re-derivation - none of which depend on the active-editor event FIRING. `Event.None` provides a subscribable no-op that never fires, so it satisfies the constructor's new dependency shape without stubbing away any asserted behaviour; `_recordDocViewed()` still runs once directly at `:588` regardless. `Event` was already imported in the test (line 9). Nothing behavioural was removed.

## P10.1 - bound figures + source drawer (regression-hold)

LIVE on `Board Note.md`:

- Figure atom: `color: rgb(70,80,184)` = **#4650B8** ✓; `border-bottom: 2px dotted rgb(154,162,224)` = **#9AA2E0** ✓; `font-weight: 500` ✓; 6 bound figures. PASS.
- Drawer: measured height **52.00%** of viewport (spec 52-54%) ✓; `z-index: 25` ✓. PASS.
- Never a second group: `.editor-group-container` count `1 -> 1` across figure clicks (single group, repeated clicks). No group spawned. PASS.
- Round-trip: bound atoms carry `data-key` + `data-label` (`metrics.mrr` -> `$48.6k`), `contenteditable="false"`; the `bind:` parse/serialise path (`livingDocMarkdown.ts` `reconcileBindLinks`, `BIND_LINK_RE`) round-trips `[label](bind:key)`; regression-hold suite green. PASS.
- **Referenced-row highlight: FAIL.** See adjudication below.

### Amber adjudication (the open P10.1 question) - VERDICT: FAIL

Tested both states live, per the orchestrator's protocol.

**Unchanged row (fresh binding).** `Board Note`'s `metrics.mrr` = `$48.6k` matches the latest `metrics.csv` row (week 24, mrr 48600), so it is fresh/undrifted. Clicked its figure:
- resolved-table referenced row `metrics.mrr $48.6k`: `class="sel"`, `background: rgb(254,246,233)` = **#FEF6E9** (amber), `changed` class absent, `changedBg: null`.
- CSV-grid latest row (`24 Jun 19 48600 ...`): `class="sel"`, amber `#FEF6E9`, `selHasChanged: false`.
- i.e. the referenced row is amber while nothing has changed. Spec wants `accent-tint #F4F5FD`.

**Changed row (drifted binding).** Drifted `metrics.csv` mrr 48600 -> 59900 in-flight, let the freshness recompute mark `metrics.mrr` stale, re-opened the drawer:
- resolved-table referenced row now `class="sel changed"`, `background: rgb(255,250,241)` = **#fffaf1** (the separate `changed` cream), text `metrics.mrr $48.6k -> $59.9k`.
- CSV-grid latest row still `class="sel"` amber `#FEF6E9` - purely positional (`latestIndex`), independent of drift.

Conclusion: the amber `.srcdrawer tr.sel` (`livingDocRender.ts:293`) is applied by `r.selected` (`:1159`) and by grid `latestIndex` (`:1168`) - i.e. "this row is referenced / is the latest," never keyed to change state. The `changed` state has its OWN treatment (`tr.changed` `#fffaf1`, `:306`). Amber is therefore decoration, not truthful state. This is the orchestrator's FAIL branch: "if amber decorates EVERY referenced row regardless of state, that is a defect against pin 10 as written - FAIL it." The implementer's "amber is the drawer's then/now vocabulary" argument does not hold: the row is amber even when nothing is then/now.

## P10.2 - F13 hover then-vs-now peek + api/mcp fallback

PASS. LIVE:

- Fresh binding (`metrics.mrr` before drift): peek reads `metrics.csv / mrr - Synced 24 days ago`, no then/now, no fallback, no stale line - correct (nothing to compare).
- Drifted binding (after CSV mrr -> 59900): peek reads `Stale - source changed since last sync` then `then $48.6k -> now $59.9k`. Both numbers traced: **then `$48.6k`** = the lock's bind-time `resolved`; **now `$59.9k`** = the current source cell I set. `.tip-then` present, `.tn-now` = `$59.9k`. F12-consistent "Stale - source changed since last sync" vocabulary.
- api/mcp fallback: the sample fixture has NO api/mcp binding (all `metrics.csv` file bindings) - which is exactly why a natural live shot is impossible and the implementer fell back to unit evidence. Reproduced their unit evidence critically: `buildFigureProvenance` (`livingDocPmDecorations.ts:81`) names a stale api/mcp key absent from the live-value map as `fallback = "Live value unavailable - showing the last synced value"`, `kind` = api/mcp, and never populates `now` - verified by the 8 fallback/then-now unit tests (all green, truthful, no `now` fabrication, files get no fallback). ALSO attempted one live render: exercised the real `showTip` markup + the real webview `.tip-fallback` CSS in the live frame with a synthetic api provenance entry; the tooltip rendered `API fallback - Live value unavailable - showing the last synced value`, `hasNow: false`, fallback colour resolved. Render path confirmed live; model builder confirmed by unit + the injectable-clock signature `buildFigureProvenance(lock, staleKeys, currentValues?, now?)`. Honest adjudication: the fallback is truthful at both model and render layers.

## P10.3 - suite + zero new core seams

PASS. All four checks green (above). Diff audit: no files touched outside `contrib/livingDocs/` and `docs/`. The only service change is the additive `getCurrentValues` getter (reads existing `state.current`; one interface method on `ILivingDocsService`, wired into `buildFigureProvenance` from the editor pane). No new core seams. `check-seams.sh` intact.

## Wave regression sweep (last gate before the closing audit)

Clean. All navigable surfaces render live with no breakage and no new console errors attributable to this bundle (the 404 / ERR_CONNECTION_REFUSED / extension-host id errors are the standard web-harness + broker-down noise, present on `origin/main` too):

- Editor: figure atoms, gutter numbers (bound dot on the table line), product tabs (Appendix / Board Note active), toolbar (Paragraph / B / I / list / table / quote / Ask AI / Properties / ephemeral "Changes live only in this tab" chip), tree rail rows + LWD chips + status dots, right rail chat glyph, header "All sources synced" pill + Present.
- Home: "Home / All sources synced / + Open Folder".
- Templates: "Templates / + New template".
- Knowledge: "Knowledge / All sources synced / + Add Source".
- Agents: "Agents / 5 agents active", agent cards with the auto-apply / ask first / never policy grammar, toggles, activity ledger ("runs on model unavailable" honest under a down broker).

## Screenshots

- `00-boot-1440.png` - boot, editor on Board Note.
- `drawer-referenced-row-amber-unchanged-1440.png` - the drawer open on the unchanged `$48.6k` figure (the referenced row measures amber `#FEF6E9`).
- `sweep-agents-1440.png` - Agents screen, wave sweep.
