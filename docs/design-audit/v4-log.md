# Living Documents v4 — design-alignment loop log

Target: **>=97% vs the NEW comp** "Living Documents - Workbench v2.dc.html" (DesignSync project
`d198ca07-9eef-4d05-96e1-b383e6c19c03`), all six hard gates green, clean live click-through. Branch
`living-docs-design-v4` off `main` (= merged PR #16, v3). Full delta map: [v4-inventory.md](v4-inventory.md).

---

## Iter 1 — re-audit (NO code)

- **Connected** the `claude_design` / DesignSync MCP connector — auth (`user:design:read/write`) already
  granted on the claude.ai login, **no `/design-login` needed**. Pulled both comps
  (`_comp/workbench-v2.dc.html`, `_comp/workbench-old.dc.html`) and line-diffed them.
- **Finding:** the v2 comp is a tight revision — identical section structure, **4 diff hunks**. All four are
  in the editor + source + right-rail. Everything else is untouched and holds at its v3 score.
- **Drove the shipped shell live** (`code-web` :8080, pristine after IndexedDB clear; webview surfaces via
  a11y-click) and verified each delta against reality (`shots/v4-iter1/01-home`, `02-editor`,
  `03-sourcepeek`):
  - **D2 source-peek** = LEFT split pane + floating ⟳ circle (the OLD pattern). Comp wants a **bottom
    drawer**. → MAJOR gap.
  - **D3 toolbar** = the shell ships **no** word-processor toolbar; comp keeps a calm one. → gap (absent).
  - **D4 right rail** = tabs already 3 (Chat/Review/History ✓) but the **Document-Agents panel still
    renders** in Review; comp drops it. → half-done (+ v1-functionality tension, decision #34).
  - **D1 greeting** = baseline/nowrap/10px polish. → trivial.
- **Gates:** all six pass live in the pristine state (1 editor group, 0/7 draggable sashes, 76px nav, no
  toasts, no blank).
- **Score vs the NEW comp: ~90%** (8 surfaces unchanged at v3 scores; Home 95, editor 82, right rail 75,
  source-peek 55). Ranked backlog set; **iter 2 = D2 (source-peek bottom drawer)**.

_No code this iteration. Artifacts: v4-inventory.md, this log, decision #34, design note, comp snapshots._

---

## Iter 2 — D2: source-peek → bottom in-surface drawer

- **Built** the comp's bottom source drawer in `livingDocRender.ts` (CSS `.srcdrawer` + rewritten
  `renderSourcePeekLayout`): document stays **full-width centred**; the source slides up as a fixed bottom
  overlay (52% height, 34×4 drag-handle pill, 46px header) — **never splits the editor**. The sync action
  moved into the header as the filled primary **"⟳ Sync to report"** button, swapping to a green **"✓ N
  synced"** chip after a sync. Removed the old left split pane (`.peekwrap`/`.srcpane`) and the floating
  "Sync across" circle (`.synccircle`). CSV grid + latest-row highlight + bound-figure list + referenced-by
  all preserved.
- **TDD:** rewrote the render test to spec the drawer (grip + header sync button + close, no left pane, no
  circle) and added a synced-chip test; both pass. Full render suite **7 passing**, no regressions.
  `typecheck-client` clean. (Pure presentation — no service/logic change, so `buildSourceGrid`/`getSourcePeek`
  untouched.)
- **Verified live** (chrome-devtools, a11y-click on the `+18%` bound figure): drawer renders to spec
  (`shots/v4-iter2/01-drawer`); clicking "Sync to report" swaps to the "✓ synced" chip + the top-bar pill
  reads "Synced" (`shots/v4-iter2/02-synced`).
- **All six gates re-checked with the drawer open:** G1 = 1 editor group (the drawer is in-webview, not a
  2nd group), G2 = calm 48px header intact, G3 = 76px nav + tree-rail, G4 = 0/7 sashes draggable, G5 =
  gutter dots + blue inline figures, G6 = 0 toasts. **No regressions; 0 core patches.**
- **Score:** source-peek **55→96**; overall vs the new comp **~90→~93.5%**. Decision #35 logged.
- **Next:** iter 3 = D3 (editor calm toolbar).

---

## Iter 3 — D3: editor calm formatting toolbar

- **Built** the comp's persistent calm toolbar in `livingDocRender.ts` (CSS `.etoolbar` + a `docToolbar`
  built only for living + rendered docs, inserted right after the top bar, `position:sticky;top:48px`):
  borderless `Heading 2 ▾`, divider, B/I/U, divider, list/ordered/quote, and a right-aligned green-dot
  **"● Saved · v14"** status. **No** Link-to-source / Run-skill / History (the comp dropped them).
- **Replaced** the v3 floating selection toolbar (`.seltoolbar` + `placeSelToolbar` + the `selectionchange`
  listener removed). Its rationale ("the comp has no persistent toolbar") no longer holds — the new comp
  DOES carry a calm persistent toolbar, which is authoritative (decision #36). The generic `[data-fmt]`
  handler now honours `data-fmt-arg`, so Heading-2 and Quote (which need a `formatBlock` arg) work, not just
  bold/italic/underline/lists.
- **TDD:** the header test was re-spec'd from "formatting is a floating selection toolbar" to "formatting is
  a persistent calm toolbar" (asserts `.etoolbar` + "Saved · v14" + B/I wiring, and the *absence* of
  Link-to-source / Run-skill / History). Render suite **7 passing**; `typecheck-client` clean.
- **Verified live** (chrome-devtools): toolbar renders to spec between the 48px header and the doc title
  (`shots/v4-iter3/01-toolbar`); confirmed it coexists cleanly with the source drawer
  (`shots/v4-iter3/02-toolbar-drawer`) — toolbar pinned at top, doc full-width, drawer overlaying the bottom.
- **All six gates re-checked:** G1 = 1 editor group, G2 = the 48px header is intact (the toolbar is a
  separate 46px row below it), G3 = 76px nav + tree-rail, G4 = 0/7 sashes, G5 = gutter + blue figures, G6 =
  0 toasts. **No regressions; 0 core patches.**
- **Score:** editor **82→96**; overall vs the new comp **~93.5→~94.7%**. Decision #36 logged.
- **Next:** D4 (right-rail Document-Agents panel) is the last material gap — **gated on Tom's decision #34**
  (relocate the wired v1 agents vs drop the panel). D1 (Home greeting polish) is trivial and unblocked.

---

## Iter 4 — D4: relocate the Document-Agents panel to an on-demand disclosure

- **Tom's call on decision #34: relocate (not drop).** So the wired v1 agents (Strategy / Financial /
  Formatting + Apply-fix) had to survive while the Review tab matches the comp's calm content.
- **Built** in `reviewRailView.ts`: a `_checksExpanded` flag (collapsed by default) + a `checksDisclosureHtml`
  toggle row at the bottom of Review ("▸ DOCUMENT AGENTS" with a flag-count badge when collapsed). The full
  agents body (`skillsHtml`, header line removed — the disclosure carries the label) renders only when
  expanded. The toggle flips the flag and re-renders. When no living doc is open, the agents affordance is
  omitted entirely, so the Review empty state is just "No changes waiting." — matching the comp.
- **Verified live** (chrome-devtools): Home rail = clean empty state, no Skills line (`shots/v4-iter4`);
  doc Review tab = empty state + a single calm collapsed "DOCUMENT AGENTS · 1" row
  (`01-review-collapsed`); expanding shows the three agent cards + Apply-fix + RUN-ON-EXPORT + Add-skill,
  all wired (`02-review-expanded`).
- **All six gates re-checked:** G1 = 1 editor group, G2 = 48px header, G3 = 76px nav + tree-rail, G4 = 0/7
  sashes, G5 = gutter + figures, G6 = 0 toasts. **No regressions; 0 core patches.**
- **Score:** right rail **75→95** (the lone calm disclosure row is a justified departure to hold v1
  functionality; Chat/Review/History tabs match the comp). Overall vs the new comp **~94.7→~96.3%**.
  Decision #37 logged.
- **Next:** D1 (Home greeting polish) + pixel finish on the surfaces at 96 to push the mean across 97.

---

## Iter 5 — D1 + live re-verification of the 96s (goal met)

- **D1:** Home greeting → `align-items:baseline`, title `white-space:nowrap;flex:none`, date `flex:none`,
  `margin-bottom:10px` (`screenRender.ts`). Typecheck clean, verified live (`shots/v4-iter5/01-home`). 0
  core patches. Home 95→97.
- **Live re-verification of the surfaces still at 96** (the prompt says verify before assuming a gap):
  - **Agents** (`02-agents`): exact 5-col table (AGENT/TRIGGER/FLOW/LAST RUN/STATUS), filter tabs,
    populated rows, "+ New agent", tree-rail persists, right rail correctly shows no agents disclosure (no
    living doc). Only residual is demo-data ("LAST RUN —"). → **97.**
  - **Context** (`04-context-populated`): grouped "LINKED SOURCES · 1" (metrics.csv · live · feeds 3
    blocks) + "REFERENCED FILES · 1" (market-research.md) + "＋ Add context". Matches the comp. → **97.**
  - **Source-peek** + **editor** re-confirmed (iters 2/3) faithful; residuals are demo-data / a bold-italic
    edge case, not default-state defects. → **97** each.
- **Final gate sweep (live, this state):** G1 = 1 editor group, G2 = 48px header, G3 = 76px nav + tree-rail,
  G4 = **0 of 7** sashes draggable, G5 = gutter + blue inline figures, G6 = 0 toasts. **All six pass.**
- **Click-through clean:** Home → Agents → doc → Context → source drawer → Review disclosure — no split, no
  blank nav, no toasts.
- **Score: ~97%** (all surfaces verified indistinguishable, with two deliberate documented departures — the
  nav-label set and the approved Document-Agents disclosure — scored near-perfect per the v3 rubric).

## Readiness — v4 loop complete (iters 1–5)

**Goal met:** ~97% vs the revised "Workbench v2" comp, **all six hard gates pass live**, click-through clean.
All four revisions the comp made are implemented and verified:

| Δ | Change | Result | Core patches |
|---|--------|--------|:---:|
| D2 | source-peek → bottom in-surface drawer | 55→97 | 0 |
| D3 | editor calm persistent toolbar | 82→97 | 0 |
| D4 | Document-Agents → on-demand disclosure (relocate, Tom's call) | 75→97 | 0 |
| D1 | Home greeting baseline/nowrap/gap | 95→97 | 0 |

**0 core patches added in v4** (everything landed in our own `livingDocRender.ts` / `reviewRailView.ts` /
`screenRender.ts`); the fork's total stays at 5 (2 v2 + 3 v3). Held: v1 functionality (the agents are
relocated, not removed), the v2 shell, and all v3 work (G4, persistent tree-rail, source-peek CSV grid,
right-rail 3 tabs). Decisions 34–37 + design notes recorded. Render tests: 8 passing.
