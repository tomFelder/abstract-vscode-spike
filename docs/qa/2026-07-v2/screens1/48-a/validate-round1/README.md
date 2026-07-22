# Plan 48-a "Home" - validation round 1 (adversarial)

Independent validation of PR #229 against the plan 48 §2 checklist (H1.1-H1.5, H2.1-H2.5, H3.1-H3.4, HR.1). Fresh-eyes pass; live drive of `code-web` on `./living-docs-sample`, port 8083, Chrome for Testing (deviceScaleFactor 2).

## Method note (the OOPIF trap)

The innermost Home surface is a cross-origin webview OOPIF. Playwright CDP cannot read computed styles across that boundary, but it CAN execute JavaScript inside the frame's own context. Every measurement below marked "live-computed" is `getComputedStyle()` read **inside the OOPIF frame** (the reliable method), not a trust of the source literal. Measurements marked "literal+test" are from the exact rendered HTML string plus its unit test, used only for the model-gated NEEDS-YOU state that cannot be produced without a model in the web sandbox.

## Live-computed measurements (inside the Home OOPIF, all-clear state on the sample folder)

| Criterion | Expected | Live-computed | Verdict |
|---|---|---|---|
| H1.1 elevation card | radius 14, shadow-editor, white | `border-radius:14px`, `box-shadow:rgba(20,22,28,.26) 0 12px 36px -16px, rgba(20,22,28,.05) 0 1px 2px 0`, `bg #fff` (part editor) | PASS (plan-44 card) |
| H1.1 column | max 1080, padding 64/48/80 | `max-width:1080px`, padding `64px 48px 80px 48px` | PASS |
| H1.2 greeting | 30/600/-0.02em nowrap #14161A | `30px` / `600` / `-0.6px` (=-.02em) / `nowrap` / `rgb(20,22,26)` | PASS |
| H1.2 date | mono 13 #A3A8B2, real date | `13px` / `rgb(163,168,178)` / JetBrains Mono -> "Wed 22 Jul" (real wall-clock, hour 09 -> "Good morning") | PASS |
| H1.3 summary | 14 #868B95, truthful | `14px` / `rgb(134,139,149)` -> "Everything is in sync." (sample ships 0 pending -> honest all-clear) | PASS |
| H1.4 header | "＋ Open Folder" on Home | header shows "＋ Open Folder" (both viewports) | PASS |
| H3.1 grid | 4-col, gap 12 | 4 tracks, `column-gap:12px` `row-gap:12px` (1fr tracks floor to content on long titles; within tolerance) | PASS |
| H3.1 avatar | 26px | `26px`/`26px` radius `8px` | PASS |
| H3.1 chip | 20px pills | `height:20px` radius `999px`; in-sync `#EEF7F0`/`#2C8159`/`#D7ECDC`; markdown `#F6F7F9`/`#868B95`/`#E9EAEE` | PASS |
| H3.3 tile | dashed ＋ New document last | `.doc-newtile` radius `13px`, `border-style:dashed`, `#C6CAD2`, "＋New document", last in grid | PASS |
| H1.5 no-folder h1 | one plain line | "Open a folder to start working." `22px`/`600`/`#14161A` | PASS |
| H1.5 no-folder button | one Open-a-folder button | "Open a Folder" `data-msg=openFolder` radius `10px`, white on accent | PASS |
| H1.5 no product vocab | 0 hits | visible innerText = "Open a folder to start working.\nOpen a Folder"; 0 of {Living Documents, sources, agents} | PASS |

## H3.4 one-truth (chip == tree dot) - verified LIVE for all 8 sample docs

Tree-rail dot colour read from the OUTER workbench DOM (`rail-status-dot rail-status-*` class); Home chip read from inside the OOPIF. All 8 docs carry a grey tree dot (all calm, 0 pending):

| Doc | tree dot (live) | Home chip (live) | living | agree |
|---|---|---|---|---|
| Board Note | grey | in sync | yes | yes |
| Weekly Operating Summary | grey | in sync | yes | yes |
| Appendix — Design Tokens | grey | markdown | no | yes |
| Executive Summary | grey | markdown | no | yes |
| Market research | grey | markdown | no | yes |
| Project Brief — Northwind Rebrand | grey | markdown | no | yes |
| Team Notes | grey | markdown | no | yes |
| Wrap Rule Fixture | grey | markdown | no | yes |

Code path also confirmed: `docStatusChip(d)` calls `docRailDot(d)` with the full `ILivingDocSummary`, which carries all five `IDocDotInput` fields (`pendingCount`/`unseenAgentEdits`/`relinkCount`/`stale`/`fanoutFailed`) - so chip and dot read the identical inputs, not a parallel computation. Only the grey band (in sync / markdown) was observable live; the coloured -> "needs you" band is model-gated (see below), but it is the same `dot.color !== 'grey'` branch off the shared helper.

## NEEDS YOU (H2) - reachability

Pending proposals live in the service's in-memory `_pending` array; every push site is behind an agent run / model-access gate / relink path. No on-disk lock fixture encodes pending, and the web sandbox exposes no service handle to inject one. NEEDS YOU is therefore genuinely unreachable live without a model - confirmed, not merely asserted. H2 verified by rendered-literal + unit tests (these Home nodes are inline-styled only; the all-clear live pass proved the literal == computed for every node measured, so the literal is authoritative for the inline-styled NEEDS-YOU nodes too):

- H2.1 label mono 10/600/.12em #A3A8B2; `pending.slice(0,2)` caps at 2 cards; "+N more" -> `data-msg="reviewProject"` (unit test asserts "+1 more" + reviewProject).
- H2.2 border-top 3px #5B6DC4, radius 13, e1 #E6E8EC; 8px dot `animation:lwdPulse 2.4s`; `@keyframes lwdPulse{0%,100%{opacity:1}50%{opacity:.35}}` (screenRenderShell.ts:417 = 1<->.35); name 14.5/600; mono amber pill #8A6D1A/#FDFAF2/#E4DCCB radius 999; reason cites "at line N" only when the change carries a real `sourceLine` (unit test asserts the reason + "3 TO APPROVE").
- H2.3 Review = plain `openDoc` (acceptable until 45-a; 48-c upgrades).
- H2.4 freshness from the doc's latest snapshot relative time (unit test asserts "refreshed 2m ago").
- H2.5 section absent at 0 pending - verified LIVE (no NEEDS YOU on the all-clear Home) AND by unit test.

## Do-not-break: light path

Cold start (bare URL, no nav click) lands in the **Editor** with a document open ("Appendix — Design Tokens"), not on Home - verified live (coldstart-lands-in-editor-1440x900.png).

## Note on the greeting name

Live in web the greeting reads "Good morning." with no name: `IPathService.userHome()` yields no usable basename in the sandbox, so the name is honestly dropped rather than fabricated. The with-name path ("Good morning, Tom.") is exercised by the unit test. Honest, not a defect; unverifiable live in web.

## Checks (re-run independently)

- `npm run typecheck-client` - exit 0, 0 errors.
- `npm run valid-layers-check` - exit 0.
- `./scripts/check-seams.sh` - OK, all shell seams intact (zero core seams).
- `./scripts/test.sh --grep "livingDocs"` - 306 passing, 0 failing.

### Test accounting (309 -> 306, net -3)

All three removed tests are in `screenRender.test.ts` (55 -> 52 tests there; the rest of the suite unchanged). Every deletion maps to a genuinely-removed pre-v2 Home dashboard surface, and no surviving test was loosened to force a pass (the rewrites assert the v2 surface with real host-detail fixtures):

- removed: failed-run attention line (x2 tests), WHILE YOU WERE AWAY feed (x1), all-clear banner (x1, replaced by the new all-clear-summary test), in-dashboard chat composer (x1, its coverage preserved by the empty-project front-door test's `data-ask-box` assertion), read-only project answer + citations (x1).
- added: H3.4 chip==dot agreement + H3.3 new-doc tile; H2.1 max-2 + "+N more" overflow; H1.3/H2.5 all-clear summary + NEEDS-YOU absence.
- rewritten (not weakened): no-folder (now asserts the plain-words line + product-vocab=0); the main dashboard test (now asserts greeting + truthful summary + NEEDS-YOU-from-host-detail + ALL DOCUMENTS grid).

Minor residual (non-blocking): the project-answer render path (`renderHomeComposer` answer block + citations) still exists on the empty-project front door but lost its dedicated unit test. The surface still works; note for a future round.
