# Living Documents v4 — Delta map vs the NEW comp ("Workbench v2")

The v4 design-alignment loop ([../plans/12-design-alignment-v3-loop.md](../plans/12-design-alignment-v3-loop.md)
is v3; v4 has no new plan file — it is a *delta* pass) takes the shipped shell from **~97% vs the OLD
comp** ("Living Documents - Workbench.dc.html") to **>=97% vs the NEW revised comp** ("Living Documents -
Workbench v2.dc.html", same DesignSync project `d198ca07-9eef-4d05-96e1-b383e6c19c03`).

**Iteration 1 (this doc) is the re-audit — NO code.** Both comp files were pulled via the DesignSync
(`claude_design`) connector and diffed (`_comp/workbench-v2.dc.html` vs `_comp/workbench-old.dc.html`),
then the **current shipped shell** (merged v3, PR #16) was driven live (`code-web` :8080, pristine after
an IndexedDB clear; webview-internal surfaces reached via the chrome-devtools a11y-click). Screenshots:
`shots/v4-iter1/`.

> **Headline:** the v2 comp is a **tightly-scoped revision** — the section structure is identical and only
> **4 hunks** differ. The shell holds against everything the comp did *not* change. All four revisions are
> in the **editor + source + right-rail** area; everything else (nav, header, Home body, Templates,
> Knowledge, Agents, Present, Context, Chat/History) is untouched by the comp and remains at its v3 score.
> **All six hard gates still pass live** in the pristine state (1 editor group, 0 draggable sashes of 7,
> 76px nav, no toasts, nav never blanks).

## The 4 revisions the v2 comp makes (new vs old comp, line-diffed)

| # | Surface | OLD comp | NEW comp ("v2") | Shipped shell today | Verdict |
|---|---------|----------|------------------|---------------------|---------|
| **D1** | **Home greeting row** | `align-items:flex-end`, `margin-bottom:8px`; title not nowrap | `align-items:baseline`, `margin-bottom:10px`; title `flex:none;white-space:nowrap`; date `flex:none` | matches OLD (flex-end, 8px) | **trivial gap** |
| **D2** | **Source-peek** | LEFT split pane (`border-right`) + floating ⟳ "Sync across →" circle on the divider + standalone `⊞ metrics.csv` tab button | **bottom in-surface drawer** (`position:absolute;bottom:0;height:52%;z-index:25`) with a 34×4 drag-handle pill, a 46px header (`⊞ metrics.csv` · "source · 12 rows · changed 2m ago"), a **filled primary "⟳ Sync to report" button** / "✓ 3 synced" chip, and ✕ close. Comment: *"in-surface overlay — never splits the editor."* No floating circle, no left pane, no separate csv tab | LEFT split pane + floating ⟳ circle — i.e. **the OLD pattern** (confirmed live, `shots/v4-iter1/03`) | **MAJOR gap** |
| **D3** | **Editor word-processor toolbar** | toolbar w/ `Heading 2 ▾` (bordered) + B/I/list + dividers 20px + **"Link to source"** + **"◈ Run skill ▾"** + right side **"v14 · saved"** + **"History"** button | calmer toolbar: `Heading 2 ▾` **borderless/transparent**, dividers 18px, B/I/list kept; **Link-to-source, Run-skill, History REMOVED**; right side collapses to a single green-dot **"● Saved · v14"** | **no toolbar at all** — doc goes straight from the 48px top bar to the title (confirmed live, a11y tree + `shots/v4-iter1/02`) | **gap (absent)** — see note |
| **D4** | **Right rail** | 4 tabs Chat / Review / History / **Skills**; the **Skills** tab renders a **Document-Agents panel** (Strategy / Financial / Formatting agent cards, RUN-ON-EXPORT toggle, "＋ Add skill from library") | **Skills tab + the whole Document-Agents panel REMOVED.** Tabs are Chat / Review / History only | tabs are **already 3** (Chat/Review/History ✓ — v3 decision 31), **but** the Document-Agents panel still renders (folded into the Review tab by v3) — Strategy/Financial/Formatting cards + RUN-ON-EXPORT + Add-skill all present live (`shots/v4-iter1/02`) | **half-done** — tab count matches; panel still ships |

### Notes / tensions to resolve before building
- **D3 (toolbar):** the OLD comp had a toolbar and v3 reported the doc editor "pixel-exact", yet the shell
  ships **no toolbar**. So the shell already *under*-shot the old comp here; the v2 comp keeps a *calm*
  toolbar. Adding it is **additive**. Before building, check whether the toolbar was a deliberate "calm"
  omission (design-notes / decision-log) — if so this is a judgment call, but the comp is authoritative, so
  default to adding the calm version (format dropdown + B/I/list + "● Saved · v14"; **no** Link-to-source /
  Run-skill / History).
- **D4 (Document-Agents panel):** removing it from the Review tab matches the comp, **but the document-agent
  capability (Strategy/Financial/Formatting + Apply-fix) is shipped v1 functionality** (Run / Re-run / Apply
  fix are wired). The Skills *tab* is already gone, so deleting the panel too would leave the agents with no
  home. **Decision needed (logged #34):** the comp de-emphasises document agents entirely — do we (a) move
  them out of the always-on Review tab into an on-demand affordance, or (b) drop the panel and accept a v1
  surface loss? Hold until resolved; do not silently delete v1 functionality.

## Per-surface score vs the NEW comp (v3-final vs old → v4 iter-1 vs new)

| Surface | vs OLD (v3 final) | vs NEW (v4-1) | Why the delta |
|---------|:-----------------:|:-------------:|---------------|
| Left rail / nav | 97 | **97** | comp unchanged |
| Knowledge | 97 | **97** | comp unchanged |
| Global header | 97 | **97** | comp unchanged |
| Templates | 97 | **97** | comp unchanged |
| Present / export modal | 97 | **97** | comp unchanged |
| Agents | 96 | **96** | comp unchanged |
| Context panel | 96 | **96** | comp unchanged |
| Interaction grammar | 97 | **97** | comp unchanged; all 6 gates hold live |
| **Home** | 97 | **95** | D1 greeting align/nowrap/gap (rest of Home unchanged) |
| **Document editor** | 97 | **82** | D3 — calm formatting toolbar absent (doc body itself still pixel-exact) |
| **Right rail (Chat/Review/History)** | 96 | **75** | D4 — Document-Agents panel still in Review; comp drops it |
| **Source-peek** | 96 | **55** | D2 — left split pane + floating circle; comp wants a bottom drawer |

**Overall vs the NEW comp: ~90% (90.1 mean).** Four surfaces dropped vs the new comp; the other eight are
unchanged at their v3 scores. Target: **>=97%** with all six gates green and a clean live click-through.

## Hard gates — live status (pristine merged-v3 state, v4 iter 1)

| Gate | Status | Evidence (v4-iter1) |
|------|--------|---------------------|
| **G1** — no split / blank panes | **PASS** | `.editor-group-container` = **1** on Home + doc + source-peek open. (Source-peek is a within-webview flex split, not a 2nd editor group — but the comp now wants it as a bottom overlay anyway; D2.) |
| **G2** — calm 48px header | **PASS** | brand L + "Opportunity OS / <crumb>" + "All sources synced" pill + "↗ Present" + "TS"; nothing else, Home + doc. |
| **G3** — tree-rail + 76px labeled nav | **PASS** | activity bar measured **76px**; tabs Files/Context/Outline/Search + tree; persists on doc. |
| **G4** — no IDE optionality | **PASS** | **0 of 7** sashes enabled (all `.disabled`); palette keybindings dead (inherited, untouched since merge). |
| **G5** — detached gutter + inline figures | **PASS** | 30px gutter dots + blue dotted-underline bound figures (+18% / $48.6k / 427 / 2.4%) + footer hint. |
| **G6** — nav never blanks + no toasts | **PASS** | pristine launch + Home→doc→source-peek click-through: zero ext-activation toasts, no blank. |

## Ranked v4 gap backlog (impact = score-gap × visual centrality; do one per iteration)

1. **D2 — Source-peek → bottom in-surface drawer (55).** *Highest impact, no functional tension.* Re-host
   the source-peek surface (CSV grid + bound figures + referenced-by — all already built and correct) inside
   a bottom drawer overlay (52% height, 34×4 drag handle, 46px header with `⊞ metrics.csv` + "source · 12
   rows · changed 2m ago" + filled primary **"⟳ Sync to report"** / "✓ 3 synced" chip + ✕). Remove the
   floating ⟳ circle and the left-split layout; the document stays full-width centered beneath. Keeps G1/G5
   honest ("never splits the editor"). **→ Iteration 2.**
2. **D3 — Editor calm toolbar (82).** Add the comp's calm formatting toolbar above the doc column (`Heading
   2 ▾` borderless + B/I/list + 18px dividers + right-aligned green-dot "● Saved · v14"; **no**
   Link-to-source / Run-skill / History). Confirm first whether the toolbar omission was deliberate (note in
   D3 above).
3. **D4 — Right-rail Document-Agents panel (75).** Resolve decision #34 first (v1-functionality tension),
   then bring the Review tab to the comp's content (drop or relocate the Document-Agents panel).
4. **D1 — Home greeting polish (95).** `align-items:baseline`, title `white-space:nowrap;flex:none`, date
   `flex:none`, `margin-bottom:10px`. Trivial; fold in with a nearby change or do last.

_Audited live 2026-06-24, branch `living-docs-design-v4` (off `main` = merged PR #16 v3). Comp pulled via
DesignSync `d198ca07-9eef-4d05-96e1-b383e6c19c03` (auth already granted on the claude.ai login — no
`/design-login` needed)._
