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
