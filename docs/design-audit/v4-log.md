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
