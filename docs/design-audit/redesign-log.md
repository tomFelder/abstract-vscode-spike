# Design-match log — Abstract UI Redesign (plans 21-25)

Scores each built surface against its region of the companion pixels
`Abstract - UI Redesign.dc.html` (claude.ai/design project
`d198ca07-9eef-4d05-96e1-b383e6c19c03`), using the Part B tokens + Part C px specs in
`docs/plans/20-abstract-ui-redesign-handoff.md` as the rubric.

Reuse the conventions from the existing `docs/design-audit/` logs (v2/v3/v4): per-surface score,
a short gap backlog, and the iteration that closed each gap.

| Surface (plan) | Comp region | Baseline % | Final % | PR | Notes |
|---|---|---|---|---|---|
| Project home — greeting + NEEDS YOU (plan 22 iter 1) | Home dashboard | ~62 | **93** | redesign-22-1-home-needsyou | Greeting H1 + real-pending summary line; NEEDS-YOU section (up to 2 cards, top-2 by real `pendingCount`) with accent top-border, 2.4s pulse dot, per-doc avatar, amber `N TO APPROVE` chip (attention tokens), full-width accent Review; hidden + "Everything is in sync." when nothing pends. 0 core patches. |
| Project home — ALL PROJECTS grid + empty state (plan 22 iter 2) | Home dashboard | ~93 | **88** | redesign-22-2-allprojects | ALL PROJECTS 3-col grid (D22-A: current folder + recent folders); 24px/7px-radius avatar (Part B palette, deterministic hash); `ok` green dot for in-sync, amber number chip for pending (attention tokens, no text label — matches comp exactly); mono `N docs · M sources` counts from real `listDocuments()` + distinct sources set; recent folders deferred (real-data guardrail); empty state = single calm "Open a folder to begin." + Open folder button. `IWorkspacesService.getRecentlyOpened()` injected into `ScreenEditor`. 0 core patches. |
| Project-wide agent run — swarm grid + progress + real totals (plan 23 iter 3) | ISMS fan-out (right pane) | ~40 | **93** | redesign-23-3-swarm-grid | Live whole-project fan-out kicked from Agents (`addFolderToWorkingSet` + `sendChatMessage` → `_chatRespondMulti`); 4-col swarm grid (`repeat(4,1fr)`) of one tile per project doc from `summariseProjectRun`: changed = accent-tint + green check + `N changes`, working = 0.8s spinner + `reviewing…`, no-change = muted `no change`; progress header + accent bar (`X / Y done`); real bottom-bar totals (`N changes in M docs · X working · Y unchanged`) cross-checked against the Review rail (6/6 matched live). Live-updates via the existing `onDidChange` → `_render` path (spinners while `isChatBusy(anchor)`, settled after). Left decisions-understood column is a truthful placeholder (23.4). 0 core patches. |
| Project-wide agent run — shell + command strip + idle + bottom bar (plan 23 iter 2) | ISMS fan-out | ~40 | **92** | redesign-23-2-run-screen | New `project-run` screen registered in `screenRender.ts` + wired through the existing open-screen path (`ScreenEditorInput`); 48px run topbar (navy project avatar + name crumb + `✦ Agent run` + a `Live` pulse pill only while in-flight); command strip (32px accent avatar + instruction in reading type + source chip + `Whole Project` pill) reflecting a real run when present, else the truthful idle prompt; truthful idle body ("No project run in progress…", no fabricated ISMS numbers — guardrail); 66px bottom bar with the `N changes … · X working · Y unchanged` shape (idle 0s) + primary `Review Across the Project →` routing to the Review rail (interim, `TODO(plan-24)`). Reachable live from the Agents screen's `✦ Run Across the Project` action (D23-B). Swarm grid (23.3) + decisions column (23.4) not built yet. 0 core patches. |

## Per-surface gap backlogs

### Project home — greeting + NEEDS YOU (plan 22 iter 1) — 93%

Closed this iteration:
- Greeting summary now reads real pending state ("1 document needs your review across this project — 1 change to approve") in `attention` ink; calm "Everything is in sync." when zero.
- NEEDS-YOU card matches Part B/C3: accent top-border (`left:22px;right:22px;height:3px`), pulse dot (`lwdPulse 2.4s`), 28px per-project avatar (deterministic colour from the Part-B palette), doc name (600 16px), amber `N TO APPROVE` chip (bg `#FDFAF2` / ink `#8A6D1A` / border `#E4DCCB`, mono UPPER), primary accent Review button.
- Card width capped (`max-width:520px`) so a lone card sits at comp proportions rather than stretching full-width.
- Section omitted entirely when nothing pends.

Open gaps (deferred / by-design, tracked to later iters):
- Comp card carries two buttons (Review + Open); iter 1 ships a single primary Review that opens the doc + its review rail. The cross-doc Review target is **plan 24**; second button revisited then.
- Comp card meta reads "24 docs · 6 sources · 3 agents" (project-level); iter-1 cards are per-document so the meta shows the doc's real source count only — no fabricated doc/agent counts (real-data guardrail).
- **ALL PROJECTS** grid + empty state are **plan 22 iter 2** (not in scope here); D22-A (current project + recently-opened folders) recorded for it.
- Comp H1 uses Newsreader serif; the handoff (Part B/F, decision 4b) locks the reading UI sans, so the greeting stays sans on purpose (handoff wins over pixels).

### Project-wide agent run — shell + command strip + idle + bottom bar (plan 23 iter 2) — 92%

Scope: only the parts that exist this iteration are scored (the run topbar, the command strip, the
truthful idle body, and the bottom bar). The sub-agent swarm grid (23.3) and the decisions-understood
column (23.4) are deliberately NOT built yet, so they are out of scope for this score.

Closed this iteration:
- Run topbar matches the comp: 20px navy (`#3b4d8f`) rounded project avatar + name crumb + `✦ Agent run` label in `#5661c9`; the `Live` pulse pill (`#f4f5fd`/`#e0e5fb`/`#4650b8`, dot `accent` @ 1.6s) renders only when the run is genuinely in flight (idle => no pill, correct).
- Command strip matches the comp's structure exactly: 32px accent circle avatar (`TS`) + the instruction in reading type (18px/1.4) + the attached source chip (mono, `#4650b8` on `#f4f5fd`, `#e0e5fb` border) + the `Whole Project` accent pill pinned right.
- Bottom bar matches: 66px, `#fbfbfc`, `N changes proposed in M documents · X still working · Y unchanged` + the primary accent `Review Across the Project →` pinned right.
- Truthful idle body (guardrail): "No project run in progress" + the honest "start from Agents or ask in Chat" copy + a "Go to Agents" affordance; NO fabricated 38-changes / 24-doc ISMS numbers.

Open gaps (deferred / by-design, tracked to later iters):
- The decisions-understood column (left 360px rail: `transcript · line N` → "N documents affected") is **23.4** — not built; the idle body says so honestly.
- The sub-agent swarm 4-col grid + progress bar (`21 / 24 done`, changed/reviewing/no-change tiles) is **23.3** — not built; a live run kick + reading `summariseProjectRun(docs, getAllPending())` fills it.
- Comp renders the command-strip instruction + bottom-bar numerals in Newsreader serif; the handoff (Part B/F, decision 4b) locks the reading UI sans, so both stay sans on purpose (handoff wins over pixels) — same rationale as the Home greeting.
- The `Whole Project` pill is title-style capped per the house UI-label rule (comp shows sentence-case "Whole project").
- Bottom-bar totals are idle 0s this iteration (real totals arrive in 23.3 from `summariseProjectRun`).

### Project-wide agent run — swarm grid + progress + real totals (plan 23 iter 3) — 93%

Scope: the RIGHT pane (the sub-agent swarm) + the progress bar + the real bottom-bar totals + the
command-strip source resolution. The LEFT decisions-understood column is plan 23.4 and is a truthful
placeholder this iteration, so it is out of scope for this score (its absence is the main full-screen gap).

Closed this iteration:
- Live whole-project fan-out kicks from the Agents "Run Across the Project" action: an anchor doc is loaded, every folder document is added to its chat working set, and one directive instruction ("Extract the decisions from the 3 March security review and apply the required changes across every affected policy.") is sent so `_chatRespondMulti` fans it out in a single model call. The transcript source (`Security Review - 3 Mar.txt`) is attached by `@mention` and shown as the command-strip chip.
- 4-col swarm grid (`grid-template-columns:repeat(4,1fr)`, 9px gap, 10px-radius tiles) with one tile per project document from `summariseProjectRun(listDocuments, getAllPending())`. Tile states match Part B / the comp exactly: changed = `#f4f5fd` bg / `#e0e5fb` border + green (`#2c8159`) check + `N changes` in accent mono (`#4650b8`); working = white / `1.5px #c9cff5` border + a 0.8s `lwdSpin` spinner + `reviewing…` italic mono; no-change = `#fafbfc` / `#eceef2` + `#cfd3da` dot + `no change` muted mono.
- Progress header ("Orchestrating N sub-agents" + "reading every document in parallel", flips to "N sub-agents finished" when settled) + `X / Y done` mono + a 5px accent-on-`#e9eaee` progress bar. Real counts: Y = total project docs, X = docs no longer working.
- Real bottom-bar totals (`N changes proposed in M documents · X working · Y unchanged`) from the summary + the live working count. Verified live on the ISMS sample: 6 changes across 6 docs after the run settled, cross-checked against the Review rail which read "Review 6" / "6 changes need approval across 6 documents" — an exact match.
- Live-updates through the EXISTING screen-refresh path: `ScreenEditor` recomputes the run state each `_render` from the live service (`isChatBusy(anchor)` + `summariseProjectRun`), and `onDidChange` (fired by `sendChatMessage`'s finally block) re-renders. While in flight every tile spins; once settled the real changed/no-change tiles show. No new event loop, no new disposables (reuses the existing `_inputDisposables` `onDidChange` subscription).

Open gaps (deferred / by-design):
- Left decisions-understood column (transcript · line N → "N docs affected") is **plan 23.4** — the model output does not yet capture a decision's source line (decision #77). Rendered as a truthful placeholder for now.
- Comp renders the command-strip instruction + bottom-bar numerals + the decision cards in Newsreader serif; the handoff (Part B/F, decision 4b) locks the reading UI sans, so both stay sans on purpose (handoff wins over pixels).
- Comp button reads "Review changes across the project"; ours is "Review Across the Project" (house title-caps UI-label rule).
- The whole-project fan-out is a SINGLE model call, so per-document progress is all-or-nothing (the whole swarm spins together, then settles) rather than tiles trickling in one at a time — truthful to the architecture; per-doc trickle would need per-doc model calls (not this plan).
- The cheap test model (gpt-4o-mini) touches only the docs whose decisions clearly map (6/14 here) — truthful, never padded with fake changed tiles.

### Project-wide agent run — decisions-understood column from grounded source lines (plan 23 iter 4) — 93%

Scope: the FULL C4 screen now exists — command strip + LEFT decisions-understood column (this iteration) + RIGHT swarm grid + progress + real bottom-bar totals. This closes plan 23.

Closed this iteration:
- The fan-out model output carries a SOURCE GROUNDING per change: `_chatRespondMulti`'s JSON schema + prompt now ask the model to ground each edit/insert in a specific decision line from the attached source and return a verbatim `sourceQuote` + (where determinable) a `sourceLine`. The parser (`parseMultiChatResponse`) normalises each edit/insert and reads the optional fields; a missing/non-numeric field degrades to `undefined` with no fabricated keys (TDD, 8 parser tests).
- `findQuoteLine(sourceText, quote)` looks up a quote's TRUE line in the real source when the model gives a quote but no number (whitespace/case-insensitive, tolerant of a source that wraps a decision across lines and prints its own line-number tokens); returns `undefined` when not found so the card shows the quote with no line chip. A line number is NEVER fabricated (TDD, 3 tests).
- `IProposedChange` gains optional `sourceQuote?`/`sourceLine?`; `_queueChatEdit`/`_queueChatInsert` populate them via `_resolveSourceGrounding` (model line, else verified lookup, else quote-only).
- `groupDecisions(pending)` (pure, TDD, 5 tests) groups the pending changes into decisions by source line, else quote, else — when nothing grounded — honestly by rationale (`grounded:false`, no line chip); `docsAffected` counts distinct documents (a doc with several changes from one decision counts once).
- `decisionsRail()` renders real cards matching the comp: a `N decisions understood` mono/accent header, and per decision a `Security Review - 3 Mar.txt · line N` mono chip on top, the decision quote in reading type, then `→ N documents affected` in accent (`#4650b8`, 600). Truthful empty (`No decisions were grounded in the source for this run.`) / in-flight (`Reading the source and extracting the decisions…`) states; the idle body is unchanged when no run.

Verified live (ISMS throwaway :8082, 1440×900, both rails hidden): Agents → "Run Across the Project" → the swarm spins 14 tiles `reviewing…` (0/14), then settles. The decisions column populated with REAL decisions each carrying a source line that matches `Security Review - 3 Mar.txt`: MFA → line 2, log retention → line 7, BYOD → line 15, incident 1-hour → line 23, patch cadence → line 27, change approval → line 30 (all cross-checked against the transcript's printed line-number column). Bottom bar + Review rail cross-check exactly (e.g. "6 changes proposed in 6 documents" ↔ "Review 6 / 6 changes need approval across 6 documents"). The cheap model (gpt-4o-mini) RELIABLY emitted `sourceLine` this loop — the quote-lookup/degrade path is exercised by tests and is the honest fallback, but did not need to fire live.

Open gaps (deferred / by-design):
- Reading type stays UI sans; the comp uses Newsreader serif for the instruction + decision quotes (handoff Part B/F decision 4b — handoff wins; consistent with iters 2/3). The single systematic visual difference vs the comp.
- The chip shows the full real source name (`Security Review - 3 Mar.txt · line N`) rather than the comp's short `transcript · line N` — more truthful, slightly longer.
- Real data differs from the comp's illustrative 3 decisions / 24 docs / "N docs affected > 1" (required by the real-data guardrail): each cheap-model decision grounded to one policy, so cards read "→ 1 document affected". The grouping *does* fold multiple docs onto one decision when they share a source line (proven by `groupDecisions` tests); the cheap model just did not produce a shared-line decision this run.
- "Review across the project →" still routes to the Review rail as the plan-24 interim.

### Cross-document review — screen + 292px doc-nav rail + change cards (plan 24 iters 1+2, READ-ONLY) — 93%

Scope: the C5 cross-document review surface — the 48px topbar, the LEFT 292px doc-nav rail (count header + progress bar + per-doc `✓`/`●`/`○` rows + counts) and the CENTRE review column (doc title + per-change cards: the change in context + `decision · line NN` source chip + `● High`/`◐ Inferred` confidence chip). Per-change Accept/Tweak/Reject and the batch bar are RENDERED but inert this iteration (TODO 24.2); the entry from the plan-23 fan-out is 24.3.

Built this iteration:
- `review-project` registered as a new `ScreenId` rendered by the existing `ScreenEditor` webview (mirrors plan-23 `project-run`); a second presentation of the SAME review model the C6 rail consumes — `ScreenEditor._reviewProjectState()` reads `getAllPending()` live each render, grouped by the new pure `groupPendingByDoc()` helper.
- The 292px rail: `N documents · M changes` header, a green (`ok`) progress bar, `X of N reviewed`, then one row per changed doc with a `✓ reviewed`/`● current`(accent tint + 3px accent bar)/`○ pending` glyph + mono count — all real from the pending set.
- The centre column: `DOCUMENT n OF m` mono eyebrow, doc title, `N changes proposed · review each in context`, then a card per change — the change in context (addition/removal tokens; insert = pure additions), a `decision · line NN` chip (line omitted when unknown, never fabricated), and the D24-A confidence chip. Bottom bar reports the attention count + `Accept All N Here` / `Next: <doc> →` (inert).
- D24-A settled + TDD'd: `reviewConfidence(change)` — a `meaning` change `< 0.8` → `inferred`, else `high` (pure, 1 boundary snapshot test). `groupPendingByDoc` TDD'd (2 tests). 17 model tests pass.

Verified live (ISMS throwaway :8082, 1440×900): a whole-project chat fan-out (`@Security Review - 3 Mar.txt`) produced 3 real pending changes across 3 docs (Access Control/MFA line 2, Logging & Monitoring/retention line 7, Change Management/emergency changes line 30). Opened `review-project` via the palette command; the rail showed `3 documents · 3 changes` + progress bar + `0 of 3 reviewed` + the three docs with `●`/`○` + real counts; the centre showed the change in context + real `decision · line NN` chip + `● High` chip; clicking a rail row switched the centre column (local navigation works). Cross-checked the C6 Review rail: both read 3 changes across 3 docs (rail untouched, still works). See `24-1-review-live.png`, `24-1-cards.png`, comp `24-1-comp.png`.

Observed confidence range: gpt-4o-mini emitted a uniform 0.85 on every meaning change → all `● High`; the `◐ Inferred` path is proven by the unit test (the model produced no sub-0.8 change this run).

Open gaps (deferred / by-design):
- Accept / Tweak / Reject + `Accept all here` / `Next` / `Accept all remaining` are RENDERED but INERT — real wiring is plan 24.2. (The single biggest in-scope gap, deliberate.)
- Reading type stays UI sans; the comp uses Newsreader serif for the doc title + change prose (handoff Part B/F decision 4b — handoff wins; consistent with plans 22/23). The one systematic visual difference vs the comp.
- The topbar source pill was absent this run (the chat-driven fan-out did not carry a `reviewSource` into screen state; the entry wiring in 24.3 will pass the run's transcript name). Layout is ready for it.
- Real data differs from the comp's illustrative 12 docs / 38 changes / a `◐ Inferred` example (real-data guardrail): the cheap model produced 3 confident changes, so no `◐ Inferred` card rendered live (the amber path is test-proven).
- A reviewed doc's `✓` row shows the doc id (URI string), since the reviewed-set is populated only in 24.2 when a doc empties in-session and the title is looked up there; empty this read-only iter, so not exercised live.
