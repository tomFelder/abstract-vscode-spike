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
