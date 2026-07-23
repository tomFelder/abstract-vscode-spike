# Screens2 49-c - validator round 1 (#239)

Adversarial validation of PR #242 (bundle 49-c "Activity ledger", plan 49, Abstract Editor v2 wave - the wave's last screen bundle). Fresh eyes, refute-not-confirm. The implementer's honest A3.3 gap (the live WAITING landing not exercised end-to-end because staging a pending meaning change needs the model) was the primary target and is now closed with live evidence.

## Environment

Worktree `abstract-v2-screens1`, branch `v2/screens2-c` at head `f8d6fce24dc`. Node 24.15.0; `npm run transpile-client`; `TMPDIR=/tmp ./scripts/code-web.sh ./living-docs-sample --port 8083` (bare URL). Model broker `scripts/lwd-model-broker.sh` on `127.0.0.1:8090`, backend `openrouter` (model `openai/gpt-4.1-mini`), key from `~/.config/lwd-openrouter.key`, reached via the default `livingDocs.modelProxyUrl`. Driven headless via playwright-core against the pinned Chromium.

Env note (same as 47-a): the transpile build does not emit the concatenated `workbench.web.main.css` (a 404 in the log) and the extension `dist/browser/*.js` warnings appear; the per-module CSS still loads through the dev ESM loader so the shell renders fully styled. A transpile-vs-compile quirk, not a defect. Analytics `/event` POSTs from the browser origin log a CORS line; the model route `/v1/messages` sets CORS and works (200), and analytics is fire-and-forget - harmless.

## Static checks (all clean, broker down for the unit run)

- `typecheck-client`: clean (exit 0).
- `valid-layers-check`: clean (exit 0).
- `check-seams.sh`: OK - all shell seams intact.
- `test.sh --grep livingDoc`: **360 passing, 0 failing** (matches the KR.1 claim of 360).

Test-count accounting: the new work adds **7** tests (5 in `livingDocLedger.test.ts` + 2 in `screenRender.test.ts`), not "6" as the implementer's comment says. 353 prior + 7 = 360. The total is real and green; the "6" is a cosmetic mis-count in the commit message, not a code defect.

## Read-only grep (the loop's emphasised target)

`livingDocLedger.ts` `buildActivityLedger` + `getActivityLedgerInputs` were grepped for store/write/mutate/set/fire/approve/reject/splice/pop calls. Every hit is either a comment, a string literal (`'rejected'`, `'restore'`, the `at`/`kind` keys), or a `rows.push()` on the function's own local return array. There is **no write to orchestrator or lock state** from either. `getActivityLedgerInputs` is `.map`/`.filter` over existing collections only. **Read-only confirmed - no defect.**

## Ledger truthfulness - the row->event trace (done live, myself)

Ground truth in the sample as it ships: `Board Note.lock.json` has `"audit": []`, and `agents.json` defines 5 idle agents with **no run log**. The orchestrator seeds no runs (runs are only appended by real execution, `agentOrchestrator.ts:385`). So a freshly loaded sample produces a **genuinely empty ledger** - I confirmed this live (see below). Rows therefore cannot be fabricated; they appear only after real events. I generated each event myself and watched the corresponding row appear:

1. **Empty state (honest).** On entry, below the 49-b cards: `ACTIVITY` label, then a radius-13 box reading "No agent or review activity yet. When an agent runs or you approve a change, it lands here." Zero rows. (`agents-empty-ledger.png`)

2. **WAITING row <- live pending meaning change.** In Chat on the Weekly Operating Summary I submitted the 47-a prompt ("Rewrite the Commentary paragraph so it says growth is accelerating sharply this quarter, not steady"). `POST /v1/messages` -> 200; the model returned a genuine `meaning-change` proposal (EDIT Commentary / Line 6, Apply/Reject, Review badge -> 1). Navigating to Agents, the ledger grew exactly one row: "now - A meaning change is waiting on your call in **Weekly Operating Summary . line 6** - WAITING" with the amber dot. This row traces to the live pending set. (`agents-waiting-row.png`)

3. **Applied row <- real lock-audit entry.** I clicked Apply on that same change (real approve path). The WAITING row vanished (pending drained) and a new row appeared: "**10:02** - Approved a change in Weekly Operating Summary . line 6 - **by you**" with the green dot. This row traces directly to the audit entry my approve wrote - the SAME stream the History tab reads. (`agents-applied-row.png`)

Every rendered row corresponded to a real event I caused. No row appeared without a source event. **Truthfulness confirmed - no fabrication.**

## A3.3 - the implementer's gap, CLOSED live

The deep link was exercised end-to-end in two paths, both landing correctly:

- **Doc open.** Clicking the WAITING row fired `data-msg="ledgerReview"` carrying `arg=Weekly Summary.md`, `block=b-5`. The doc opened on the **Review** tab scrolled to the Commentary block with the meaning-change highlighted + "Approve & apply". (`deeplink-open-doc-review.png`)
- **Doc torn down (the closed-doc path).** After staging, navigating to the Agents screen **tore down the doc webview** (the "Ask AI" toolbar was gone from every frame - the doc editor no longer mounted). Clicking the WAITING row **re-mounted** the doc on the Review tab scrolled to the block. This is the 46-c panel-replay seam surviving the closed-doc path. (`deeplink-closed-doc-reopen.png`)

Note on the tab-close route: this Abstract fork hides the editor tab strip (`.tabs-container .tab` is empty in the DOM), so a doc cannot be closed via a tab X in the headless harness. The screen-switch teardown above is the equivalent and stronger proof (the webview is genuinely destroyed, then re-created by the deep link).

Handler-identity claim verified in code: `screenEditor.ts` `case 'ledgerReview'` (L850-851) is byte-identical to `case 'reviewNeedsYou'` (L843-844) - both `this._livingDocs.reviewBlock(URI.parse(message.arg), message.block || undefined)`, the validated path. The unit layer (`screenRender.test.ts`) asserts the emitted attributes `data-msg="ledgerReview" data-arg="file:///ws/weekly.md" data-block="b-6"`.

## A3.1 live numerics

WAITING pill: text "WAITING", color `rgb(138,109,26)` = **#8A6D1A**, bg `rgb(253,250,242)` = **#FDFAF2**, border `1px solid rgb(228,220,203)` = **#E4DCCB**, mono JetBrains 10px, radius **999px** (pill).
Status dot: **7px x 7px**, radius 999px; amber `rgb(201,154,46)` = **#C99A2E** (waiting) and green `rgb(44,129,89)` = **#2C8159** (applied) both observed live; the grey admin hex `#D5D8DE` is in `LEDGER_DOT` source. All three hexes present.
Timestamp col: **width 52px**, mono JetBrains 10.5px, color `rgb(163,168,178)` = **#A3A8B2**; "now" for the live WAITING row, calendar stamp "10:02" for the dated applied row.
Ledger box: border-radius **13px**, border 1px solid #E9EAEE. ACTIVITY label: mono 10px, letter-spacing 1.2px, #A3A8B2.
Badge treatments observed: WAITING pill (amber), "by you" (mono, #A3A8B2), and "auto-applied . reversible" is asserted in the unit snapshot for the auto-applied/figure-refresh tier.

## A3.2 / A3.4 - real stream + bounding

A3.2: rows derive from the real event/audit stream (orchestrator runs + lock audits) + the live pending set, proven by the trace above and by the honest empty state on the event-free sample. `getActivityLedgerInputs` reads exactly those three collections.
A3.4: the cap (`LEDGER_CAP = 50`) + truncation flag + honest "Older activity lives in each document's History." line are proven by the unit test (`LEDGER_CAP + 5` runs -> `count: 50, truncated: true`, and a skipped run is excluded) and the render test's `truncationLine` assertion. **Honest limitation:** the live sample cannot produce >50 events without ~50 model round-trips, so the truncation line was NOT exercised live; the unit + render tests are the evidence. Address strings are display-time ("- line N", computed from block ordinal at render), and a deleted block degrades to the bare title (unit-proven, `blockId 'gone' => label 'Weekly Summary'`).

## KR.1 regression (unchanged beneath the skin)

- 49-b cards intact ABOVE the ledger: all 5 agent cards render with policy tables, model chip "openai/gpt-4.1-mini", Edit policy, toggles, "New agent" tile. (`agents-applied-row.png`)
- Knowledge screen renders ("All sources synced / + Add Source").
- Agent toggle works: clicking `pauseAgent` flipped an agent to "paused" - orchestrator state unbroken by the ledger.
- Sample tree left byte-clean (`git status --short living-docs-sample/` empty; the approve wrote only to the web synthetic FS).

## Diff audit

Only ledger-additive changes: `common/livingDocLedger.ts` (new pure read model), `livingDocsService.ts` (+ read-only `getActivityLedgerInputs`, no existing signature touched), `screenRenderAgents.ts` (renderer), `screenRenderShell.ts` (state fields `ledger`/`ledgerNow`), `screenEditor.ts` (the `ledgerReview` case + `ledgerNow` capture), `common/livingDocs.ts` (interface entry), + the two test files. Zero core seams (check-seams OK).

## Verdict

**PASS.** A3.1-A3.4 and KR.1 all verified with live evidence; the implementer's A3.3 no-live-evidence gap is closed on both the doc-open and the doc-torn-down paths. Read model is provably read-only; every rendered row traced to a real event I generated. Only non-blocking nit: the commit message says "6 new tests" where there are 7 (total 360 is correct).
