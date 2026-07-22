# Rail 47-a - validator round 1 (#236)

Adversarial validation of PR #237 (plan 47, Abstract Editor v2 wave). Fresh eyes; the implementer's three honest gaps - a live Review badge WITH a non-zero count, address-click scrolling the editor, and the PV.1 collapsed-dot composition - were the primary target and are all now closed with live evidence.

## Environment

Worktree `abstract-v2-rail`, branch `v2/rail-a` at `d7435fc454b`. Node 24.15.0; `npm run transpile-client`; `TMPDIR=/tmp ./scripts/code-web.sh ./living-docs-sample --port 8082` (bare URL). Model broker `scripts/lwd-model-broker.sh` on `127.0.0.1:8090`, backend `openrouter` (model `openai/gpt-4.1-mini`), reached via the default `livingDocs.modelProxyUrl`. Driven headless via playwright.

Env note: the transpile build does not emit the concatenated `workbench.web.main.css` (a 404 in the log), but the per-module CSS (incl. `studio.css`) loads through the dev ESM loader, so the shell renders fully styled - the missing bundle is a transpile-vs-compile quirk, not a defect.

## Staging method that worked

Avenue (1) - a real model-backed chat meaning-change edit. In the Chat composer on the Weekly Operating Summary, the prompt "Rewrite the Commentary paragraph so it says growth is accelerating sharply this quarter, not steady" produced a genuine `meaning-change` proposal from the model in ~6s. This staged one pending change (Review count 1), a clickable `Line 6` citation on both the chat card and the Review card, the inline meaning-change widget in the editor, and the collapsed-rail dot. No synthetic/DOM-injected state was used. The sample tree is left byte-clean (metrics.csv identical to backup; the approve wrote only to the web synthetic FS).

## Static checks (all clean)

- `typecheck-client`: clean (exit 0).
- `valid-layers-check`: clean (exit 0).
- `check-seams.sh`: OK - all shell seams intact.
- `test.sh --grep livingDoc`: **340 passing, 0 failing** (matches the claim; +1 is the new `revealBlockAddress` test asserting ordinal resolution, `lastOpenedView === undefined` no-tab-switch, and graceful degrade to -1).

## Diff audit

Only `livingDocsService.ts` (+13, one navigate-only `revealBlockAddress`), `common/livingDocs.ts` (+10, the interface entry), `reviewRailView.ts` (+98/-20), and the test file. The service method fires the same `_onDidRequestRevealBlock` seam as `reviewBlock` but never calls `focusPanel` and never approves. Grep of the diff shows approve/reject/analytics identifiers appear only in new comments/method names, never in modified logic. Zero core seams. `studio.css` (the collapsed dot) was untouched by 47-a (came from #220).

## Live numeric evidence

P13.2 strip: `height 44px`; labels exactly `["Chat","Review","History"]`; no Skills tab.

P13.3 tabs: active chip h=**28px**, bg `rgb(255,255,255)`, color `rgb(26,28,32)` (#1A1C20), fw **600**, fs **12.5px**, shadow `rgba(20,22,28,.05) 0 1px 2px` (e1), radius **8px**; idle color `rgb(134,139,149)` (#868B95), fw **500**, fs 12.5px.

P13.4 badge WITH live count (staged, count=1, on the Review tab): text "1", `min-width 16px`, rendered 16x16, bg `rgb(201,154,46)` = **#C99A2E**, color white, fw **600**, fs **10px**, radius **999px**. Hide-at-zero re-confirmed live twice: zero-pending on entry (no badge), and after a real Approve the badge went from "1" to gone.

P13.5 addresses: the chat meaning-change card and the Review card each render `button.ldr-card-addr` reading "Line 6". Clicking either fired the reveal - the `lwd-focus-flash` class landed on ProseMirror child index 5 (the inline meaning-change widget for the Commentary block, `top 410px`, in-view) in the doc webview. The doc fits the viewport so scrollTop delta is ~0; the flash-on-correct-block is the definitive navigation proof, and it never switched the rail tab.

P13.6 transcript anatomy (screenshot 01): user bubble (accent-tint), tool-call mono block (`Read metrics.csv, market-research.md`, `Proposed edit: Commentary`), meaning-change card (`EDIT Commentary Line 6` with Apply/Reject), the "1 change waiting on you" group (Approve all / Reject all / Review each), and the C6 composer (+ Skill / @ Mention / Included model / send).

PV.1 composition (screenshot 08): OPEN -> tab badge "1", header dot `display:none`. COLLAPSED -> panel gone, `.abstract-header-badge` `display:block`, 8x8, bg `rgb(201,154,46)` (#C99A2E), pinned top-right (x=1574,y=12) on the rail toggle. Mutually exclusive, both driven by `getAllPending()`.

PV.2 (screenshots 06/07): clicking Apply on the staged card dropped the Review count 1 -> gone (real approve path, unchanged). History then rehydrates: VERSION HISTORY for the doc, Save version, Current (live), and the just-approved change listed as an "Approved" entry (`model - moments ago`).

## Skills-capability walk (screenshot 05)

Every live capability from the #236 inventory is reachable via + Skill. The menu rendered:
- `Run Strategy agent - Ready` (model-backed, ready since the broker is up) - run path.
- `Re-run Financial agent - Pass` (Re-run because it passed) - run path, status annotated.
- `Run Formatting agent - Flag` - run path.
- `Apply fix for Formatting agent` - the fix path (Formatting flagged + fixable). This was the ONE capability the old + Skill menu lacked; now folded in.

Status (Ready / Pass / Flag) is annotated in each row label. The two decorative items (`RUN ON EXPORT`, `Add skill from library`) were re-checked in source: `reviewRailView.ts:1451,1453` carry no `data-*` hook and the `_appendChecks` delegation (714/719) handles only `data-skill-run`/`data-skill-fix` - behaviourless, correctly not resurrected.

## Verdict

PASS. All of P13.1-P13.6 and PV.1-PV.2 verified, with the implementer's three no-live-evidence gaps closed via a real model-backed proposal. No defects.
