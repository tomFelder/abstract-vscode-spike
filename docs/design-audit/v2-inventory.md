# Living Documents v2 — Exists-today vs Design-intends inventory

The map the **v2 design-alignment loop** ([../plans/11-design-alignment-loop.md](../plans/11-design-alignment-loop.md))
closes. **Iteration 1 (this doc) is the live audit**: the running web build (`code-web` on :8080,
driven via the chrome-devtools MCP) verified surface-by-surface against the "Agentic Workbench" comp
(DesignSync `d198ca07-9eef-4d05-96e1-b383e6c19c03`, file `Living Documents - Workbench.dc.html`).
Each surface scored 0-100 (mean of **Layout / Styling / Components / IA / Interaction-UX**).
Target: overall **>= 95%** + every hard gate passing.

> **Audited live 2026-06-22** (branch `living-docs-design-v2`). Screenshots: `shots/v2-iter1/`.
> **Headline finding:** the **webview content of every surface is high-fidelity to the comp** (Home,
> doc body, Templates, Knowledge, Agents all reproduce the comp closely). The entire gap is the
> **shell** — VS Code's IA leaks through: each surface is an *editor* opened in *editor groups*, behind
> a VS Code **activity bar** (not the comp's icon-nav + tree-rail), under a leaking **menubar**, and
> opening a source **splits the editor into a second group and leaves a blank pane**. This is exactly
> the "calm by construction, not by subtraction" gap (design-notes D3).

## Comp spec (the pixel target, extracted from the .dc.html)

- **Top bar — 48px**, `#fbfbfc`, 1px `#e9eaee` bottom border. Left: 20px blue brand square `L` +
  "Opportunity OS" + `/` + crumb. Right: green "All sources synced" pill + ghost "↗ Present" + 27px
  "TS" avatar. **Nothing else.** No formatting toolbar, no Download, no Refresh button.
- **Icon-nav — 76px**, `#f6f7f9`. Labeled buttons: Home / Editor / Review (badge) / Templates /
  Knowledge / Agents, + Settings pinned bottom. Icon over a 10px label.
- **Tree-rail — 264px**, `#fafbfc`, hidden on Home (`notHome`). 38px tab strip: **Files / Context /
  Outline / Search**. Files = folder tree (Reports / Clients / Sources / Templates) with doc + source
  rows + pending dots. Context = grouped (Linked sources / Referenced files / Pasted text / Images /
  Company knowledge) + "＋ Add context". Outline = doc headings. Search = input + results.
- **Editor** = doc-tab bar (40px) over a centered **720px** doc column with a **30px detached gutter**
  (flex:none, provenance dots centered in it, multi-line edits become a vertical bar — D1). Bound text
  = blue dotted underline + faint highlight. Source-peek opens an **in-surface pane to the LEFT**
  inside the same editor area; a floating **⟳ "Sync across"** circle sits on the divider. **No second
  editor group, ever.** Right panel **392px**, tabs **Chat / Review / History** (3 only).
- **Home** = `#f8f9fb`, 1080px column: greeting + date, summary line, QUICK START (3 cards), YOUR
  PROJECTS (2x2 cards w/ "since your last visit" + Review/Open).
- **Templates / Knowledge / Agents / Present modal** = dedicated full-width surfaces (Present is a
  740px centered modal).

## Hard UX gates — live status (all must pass for v2)

| Gate | Live status (iter 1) | Evidence |
|------|----------------------|----------|
| **G1** — No split editor groups / no blank panes | **FAIL** | "⇆ Source" (tooltip *"Open the source beside this document"*) opens `metrics.csv` in **Editor Group 2** and leaves Group 1 **blank**. On reload, prior source-peeks persist as **3 stacked `metrics.csv` groups**. Every non-doc surface also opens as an editor, so it renders **squeezed beside the blank/leftover group**. `shots/01,07,08`. |
| **G2** — Calm, light 48px header | **FAIL** | No unified shell header. The doc editor webview carries a **heavy 2-row header**: brand + synced pill + **↗ Present + ⇣ Download + ↻ Refresh from sources** + avatar, then a **formatting toolbar** (Heading / B / I / U / list / quote / ✦ Ask AI / ⇆ Source / </>). The comp bar has none of the second row. Plus the VS Code **menubar ("Application Menu")** sits above everything. `shots/06`. |
| **G3** — Left rail matches the comp | **FAIL** | Today = VS Code **activity bar** (~48px, unlabeled) with containers **Documents / Home / Context / Templates / Knowledge / Agents**, each a stub side-view. No 76px labeled icon-nav, no 264px **Files/Context/Outline/Search** tree-rail, **no folder tree** (Documents is a flat list). `shots/01,06`. |
| **G4** — No VS Code optionality leaks | **FAIL** | Menubar, activity bar, draggable sashes, **editor groups + split**, editor tabs + close, "open to the side" all reachable. Pure IDE grammar. `shots/01,07`. |
| **G5** — Provenance gutter detached (D1) + doc/rail pixel-aligned (D4) | **PARTIAL → FAIL** | Dots render in a **thin left margin**, not the comp's clean **30px detached gutter column**; no multi-line "vertical bar" marker; doc column not pixel-aligned (width/centering differ). `shots/06`. |
| **G6** — Nav never blanks + dev-build ext toast gone | **PARTIAL → FAIL** | Nav switching no longer blanks (iter-6 fix holds — verified across Home/Editor/Templates/Knowledge/Agents). **But** the **ext-activation toasts** (`vscode.merge-conflict`, `vscode.emmet`, `vscode.git-base` "failed: Not Found") fire on **every** load. `shots/01,05`. |

## Per-surface inventory + live scores

| Surface | Exists today (verified live) | Design intends | Score | Top gaps |
|---------|------------------------------|----------------|:----:|----------|
| **Source-peek / "Sync across"** | "⇆ Source" opens `metrics.csv` as a **plain text editor in a 2nd editor group**; doc pane goes **blank**; no styled source table, no in-surface pane, no sync circle on this path | In-surface LEFT pane inside the editor + floating ⟳ "Sync across" circle; never a 2nd group | **18** | **G1** — rip out `SIDE_GROUP`; build in-surface panel/overlay (backlog #1) |
| **Interaction grammar** | Menubar + activity bar + editor groups + split + drag + tabs/close all present | Opinionated Word/Docs/Notion grammar; optionality **removed** | **25** | **G4** — remove (not hide) menubar/split/drag/group affordances |
| **Left rail / nav** | VS Code activity bar (unlabeled) + per-view stub panels; flat "Documents" list, no folders/tabs | 76px labeled icon-nav + 264px **Files/Context/Outline/Search** tree-rail + folder tree | **35** | **G3** — build the icon-nav + tree-rail; consolidate the activity-bar containers |
| **Global header** | No shell header; calm brand bar lives *inside* each webview; doc editor adds a heavy 2nd toolbar row; menubar leaks above | Single calm 48px bar (brand/crumb/synced/Present/avatar) | **48** | **G2** — one 48px bar; strip the formatting toolbar + Download/Refresh from the doc header |
| **Context panel** | Separate activity-bar view reading the active editor; empty-state when active editor isn't a living doc; v1 typed kinds + Add context exist | A **tab inside the tree-rail**: Linked sources / Referenced files / Pasted text / Images / Company knowledge + Add context | **50** | Move into tree-rail tab; render groups even off a doc |
| **Right rail (Chat/Review/History)** | 4 tabs — **Chat / Review / History / Skills** (one extra); functional; empty-state shown | 392px rail, **Chat / Review / History** (3 only) | **65** | Reconcile the extra "Skills" tab; pixel-align width/typography |
| **Document editor (body + gutter)** | Body reads like Word — h1, subtitle, sections, KPI table, dotted-underline bindings (high fidelity); gutter dots in thin margin | hi-fi doc + **30px detached gutter** + 720px centered column | **70** | **G5/D1** — detach gutter to 30px column; pixel-align column |
| **Templates** | Faithful webview (Run template / Template / Prompt / Sources / Generate draft) but opened as an editor, squeezed beside the blank group | Dedicated full-width surface | **70** | Host outside editor-groups; full-width; pixel pass |
| **Knowledge** | Faithful (Org/Project toggle, "How this is used", DECISION STACK: Mission/Strategy/OKRs) but squeezed | Dedicated full-width surface | **70** | Same as Templates |
| **Agents** | Faithful (header, ＋ New agent, All/Scheduled/Event/Needs-approval filters, 5-agent table, canvas tip) but squeezed | Dedicated full-width surface + per-agent canvas | **70** | Same as Templates |
| **Present / export modal** | "↗ Present" entry present in webview headers; modal built in v1 — **not re-opened this iteration** | 740px centered modal (destinations + preview) | **70\*** | Re-verify live next iteration; pixel pass |
| **Home** | High-fidelity webview (greeting/summary/Quick Start/4 project cards/calm brand bar); clean & full on first load | 1080px Home surface | **78** | Hide tree-rail on Home (matches `notHome`); pixel pass |

\* Present scored from comp + v1 evidence; not re-driven live in iteration 1 (flagged for iter-2+).

**Overall alignment (iter-1 baseline): ~56%** (mean of the 12 rows above). The distribution is the
story: **content surfaces 65-78**, **shell/IA surfaces 18-50**. Closing the gap is almost entirely
shell work — not redrawing the webviews.

## Ranked gap backlog (most abrasive × most central)

1. **Kill the split/blank-pane abrasion (G1)** — redesign source-peek + "Sync across" as an in-surface
   panel; remove every `SIDE_GROUP` open; ensure no surface ever renders beside a blank/leftover group.
   *(First code iteration — backlog #1.)*
2. **Build the icon-nav + tree-rail (G3)** — the 76px labeled nav + 264px Files/Context/Outline/Search
   rail + folder tree; fold the activity-bar containers into it. *(Also the cure for the squeeze, since
   surfaces stop being editor-groups.)*
3. **Remove IDE optionality (G4)** — menubar, split, drag, editor groups, tabs/close. Remove, not hide.
4. **Calm the header (G2)** — collapse to one 48px bar; strip the doc editor's formatting toolbar +
   Download/Refresh (relocate the needed actions).
5. **Detach the provenance gutter + pixel-align the doc (G5/D1/D4)** — 30px gutter column, dot→bar for
   multi-line edits, 720px centered column.
6. **Kill the dev-build ext-activation toasts (G6)** — exclude `merge-conflict` / `emmet` / `git-base`
   from the dev run (cheapest fix).
7. **Reconcile the right rail** — drop/justify the extra "Skills" tab vs the comp's Chat/Review/History.
8. **Per-surface pixel alignment** — Home / Templates / Knowledge / Agents / Context / Present, once the
   shell no longer distorts them.
