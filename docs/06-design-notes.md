# 06 — Design notes (intent vs reality)

The visual target is the **"Agentic Workbench" Direction 01 — Workbench hi-fi** (Claude Design
project `d198ca07-9eef-4d05-96e1-b383e6c19c03`). The spike's shell does not yet match it. This doc
records the known UI/UX gaps and Tom's specific design intent so the next pass can act on them. All
of these are wired into [plans/02-studio-de-ide-handoff.md](plans/02-studio-de-ide-handoff.md).

---

## D1 — Provenance gutter redesign (detach the dots from the prose)

### Problem (today)
The colored provenance dots render **inline with the sentence**, which pushes the text in and reads
as document indentation. They look like part of the body, not metadata about it.

### Intent (Tom's spec)
The dots/markers belong in a **true left gutter**, well left of the document column, visually
**detached** from the body — so the prose column is never shifted by them.

Add a **line-numbered gutter**, with these rules:
- Each **document line** gets a number in the gutter.
- A line that **wraps** across 2-3 visual rows does **NOT** increment the number — the wrapped
  continuation rows show a **blank gap**; the number only advances on a real new line.
- A **dot** appears in the gutter beside a **bound / edited** line.
- If an edit spans a **multi-line paragraph**, the marker **blends into a vertical bar** spanning
  those gutter rows (indicating the change touches several lines) — rather than a single dot.
- **Hover** a gutter marker still **pulls up** the provenance (reveal source / detail), as today.

### Sketch
```
 gutter        document column
 ┌────┐
 │ 1 ●│  Revenue grew 18% week-on-week to $48.6k MRR, on 427     <- bound line: dot in gutter
 │    │  new signups. Churn eased to 2.4%.                        <- wrapped: blank gutter, no number
 │ 2  │  Growth remained steady this week.                        <- plain line: number only
 │ 3 ┃│  A multi-line commentary paragraph whose edit            <- multi-line edit: bar, not dot
 │   ┃│  spans several wrapped rows, so the marker becomes
 │   ┃│  a vertical bar across the affected gutter rows.
 └────┘
```

### Notes
This is **our own webview surface** (low risk, no core patch). The detached gutter also moves us
closer to the "document, not code" feel — but note the line-number gutter is itself a slightly
code-editor metaphor; check against the hi-fi whether numbers or a subtler marker rail is wanted.

---

## D2 — Header / document-title area looks "funky"

Tom reports "something super funky going on with the header and how we're displaying the
documents." The current `livingDocRender` top bar (brand row + crumb + status pill + toggle /
export / refresh buttons) and the document title block were assembled pragmatically, not to spec.

**Action:** review the header, the document title block, and how the document is seated in the
editor area **against the Workbench hi-fi** and correct the discrepancies. Wired into ITEM C of the
next plan.

---

## D3 — The calm shell: "calm by subtraction" vs "calm by construction"

The Studio skin (item 5) hides IDE chrome via settings — **calm by subtraction**. It gets ~80% of
the way and is reversible, but it leaves the IDE's *interaction grammar* underneath (panes, groups,
view containers, palette, drag-to-split). The design intent is **calm by construction**: a shell
that was built to be a word processor.

Tom's explicit guidance for how to approach the shell:
- **Far less flexibility, less UI information, less customization** than VS Code exposes.
- **No** draggable panes/panels, **no** split editors, **no** "reopen editor with," **no** command
  palette surfaced to the user.
- The reference points are **Microsoft Word, Google Docs, Notion** — light-touch, gentle, opinionated.
- "Currently this editor feels far too customizable, like the VS Code product, than what I'd like."

The next pass should therefore **remove optionality**, not just hide chrome — and where removing it
requires fighting core, log that as evidence toward greenfield (see [05](05-open-questions.md) Q3).

---

## D4 — The document surface is the part that already works

Worth stating positively: because the document is rendered in our own webview, the **document
itself** already reads like a word processor. The gap is entirely the surrounding shell (left rail =
file tree, view-pane chrome, header, group/close affordances). The next pass should bring the
*surrounding* shell up to the document's level — and pixel-align the document + review rail to the
hi-fi (ITEM D of the next plan).

---

## D5 — Post-v1 status: functionality is done; the shell still diverges (the v2 design loop)

The v1 functionality loop (plan 09, PR #13) made every surface *work* — Chat agent, Apply-fix,
source-peek + "Sync across", Context kinds, dynamic subtitle — all live-verified. Tom's review:
**functionally good; the UX/UI/IA has drifted from the intended design.** The named abrasions:

- **Split panes / blank panes (the #1 abrasion).** v1's source-peek + "Sync across" open the source
  in a VS Code `SIDE_GROUP` *editor group*, so opening a source spawns a second pane — frequently
  leaving one pane **entirely blank**. This is exactly the "no split editors" violation of D3.
  **v2 fix:** redesign source-peek + Sync-across as an **in-surface panel/overlay** in the document
  surface; remove every `SIDE_GROUP` open; never show an empty editor group. (Decision log 19 -> 20.)
- **The header is heavy and messy** — too many controls, not the comp's calm single 48px bar.
- **The left rail has nowhere near the design's IA.** The comp is a single tree-rail
  (Files / Context / Outline / Search + a folder tree); today it's split across activity-bar
  containers. **v2 fix:** build the design's tree-rail (Decision log 21).
- Still standing from D1–D4: detach the provenance gutter; remove VS Code optionality (no drag/split/
  reopen-with/palette/group-close); pixel-align each surface.

**The v2 loop** ([plans/11-design-alignment-loop.md](plans/11-design-alignment-loop.md)) is a
UX/UI/IA/visual pass to **>= 95% alignment** with explicit "hard UX gates" for each abrasion above,
and — newly — **core patches are permitted where the design needs them** (logged in the merge-tax
ledger; decision log 22), since "calm by construction" (D3) can't always be reached contrib-only.
The per-surface **Exists-today vs Design-intends** inventory the loop builds lives in
`design-audit/v2-inventory.md`.

---

## D6 — Comp-confirmed clarifications (from the v2 iter-1 live audit, 2026-06-22)

The iteration-1 audit (read the comp `.dc.html` pixel-by-pixel + drove the live app) resolved three
open questions and pinned the header clutter. Recorded here so later iterations build to the comp, not
to a guess:

- **The provenance gutter is a subtle marker rail, NOT line-numbered (resolves D1's open question).**
  D1 floated line numbers but flagged "check the hi-fi whether numbers or a subtler marker rail is
  wanted." The comp answers it: a **30px `flex:none` gutter column** to the left of the 720px doc
  column, holding a centered **9px dot** beside a bound line (a **vertical bar** for a multi-line
  edit) — **no line numbers at all**. Build the detached dot/bar rail; drop the line-number idea.
- **The right rail is Chat / Review / History — three tabs (new gap).** The comp's 392px right panel
  has exactly three tabs. The running app has a fourth, **Skills**. v2 must reconcile: either drop
  Skills or justify it as a deliberate departure (decide in the decision log when touched).
- **The header clutter is specific (sharpens D2/G2).** The doc editor's heavy header is a **second
  toolbar row** the comp does not have: `Heading / B / I / U / list / quote / ✦ Ask AI / ⇆ Source /
  </>`, plus **↓ Download** and **↻ Refresh from sources** buttons in row 1. The comp's bar is row 1
  minus those: brand/crumb + synced pill + ↗ Present + avatar only. Calming G2 = stripping/relocating
  that whole second row and the Download/Refresh buttons, not just restyling.
- **The squeeze is a symptom of the editor-group model.** Every surface (Home/Templates/Knowledge/
  Agents) is a webview *editor*; with a leftover/blank group open they render in a narrow column. So
  G1 (kill split/blank groups) and G3 (replace activity-bar-of-editors with a real shell) are the same
  root cause — fixing the hosting model un-squeezes the secondary surfaces for free.
- **(iter 3) G3 splits cleanly into two slices.** The **tree-rail** (Files/Context/Outline/Search +
  folder tree) is a single DOM-rendered `ViewPane` and was buildable contrib-only (done, decision 23).
  The remaining slice — the comp's **76px labeled icon-nav** (vs VS Code's ~48px unlabeled activity
  bar) and making Home/Templates/Knowledge/Agents *pure nav actions* that keep the tree-rail visible
  rather than activity-bar containers that swap the sidebar — fights VS Code's one-icon-per-container
  model and likely needs a `styleOverrides`-CSS pass and/or a small core seam. Treat it as its own
  iteration, not part of the tree-rail build.
- **(v3 iter 2) "Calm by construction" means no optionality, not just no chrome (closes G4).** A
  document app has **no command palette** and **no user-resizable panes** - those are IDE affordances
  that say "this is a tool you configure," the opposite of the comp's opinionated single surface. v2
  removed the *visible* chrome; v3 removes the last two *reachable* affordances at the source: the
  palette/Quick-Open keybindings (so `Cmd+Shift+P` / `F1` / `Cmd+P` and the `>` command mode do
  nothing) and a global lock that makes every layout sash non-draggable. Design intent going forward:
  **the shell layout is set, not negotiated** - widths/positions are product decisions (decision 27),
  and the user resizes nothing. This is the design rule, not a one-off fix.
- **(v4 iter 1) The "Workbench v2" comp re-states the calm rule for the editor + source surfaces.** The
  revised comp keeps the same shell and changes only four things, all reinforcing "calm document app over
  IDE/tool": (1) **source no longer splits the editor** — it slides up as a **bottom in-surface drawer**
  (52% height, drag-handle, one filled "Sync to report" action) instead of a left pane with a floating
  sync circle; the doc stays full-width centered. (2) the **formatting toolbar is pared to essentials** —
  the heading dropdown goes borderless, and "Link to source" / "Run skill" / "History" are dropped, leaving
  just a quiet "● Saved · v14". (3) the **right rail loses the Document-Agents panel** — document agents are
  de-emphasised out of the always-on rail. (4) the **Home greeting** aligns to the baseline. Read together:
  the editor should feel like one quiet writing surface — source and agents are *traced to on demand*, not
  parked open beside the prose. That is the bar for v4 (>=97% vs this comp).
