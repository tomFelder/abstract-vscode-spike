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
| **G1** — No split editor groups / no blank panes | **PASS (source-peek) — iter 2** | "⇆ Source" now opens an **in-surface pane inside the one webview** (source table + floating "Sync across" circle + close ✕) — verified live: NO 2nd editor group, NO blank pane (`shots/v2-iter2/01,03`). Provenance-dot reveal shares the same in-surface path. _Remaining:_ the **export/Download** flow still opens its generated artifact in a `SIDE_GROUP` (separate flow, not the named abrasion) — tracked for a later iteration. Before: `shots/v2-iter1/07`. |
| **G2** — Calm, light 48px header | **PASS (doc header) — iter 4** | The doc header is now the comp's **single calm bar**: brand/crumb + "All sources synced" pill + ↗ Present + avatar — verified live, nothing else (`shots/v2-iter4/01`). Removed Download (Present modal covers it) + the standalone Refresh (the **pill is the refresh**) + the whole formatting-toolbar row (now a **floating selection toolbar**); raw-Markdown moved to the footer. _Residual:_ the VS Code **menubar ("Application Menu")** still sits above the webview (a G4 optionality item). Before: `shots/v2-iter1/06`. |
| **G3** — Left rail matches the comp | **MOSTLY PASS (tree-rail) — iter 3** | The sidebar is now one **`TreeRailView`** with the comp's **Files / Context / Outline / Search** tab strip + a **folder tree** (REPORTS + SOURCES), replacing the separate Documents + Context containers — verified live across all 4 tabs + doc-open (`shots/v2-iter3/01-04`). _Residual:_ the **76px labeled icon-nav** (VS Code's activity bar is still ~48px unlabeled) + making Home/Templates/etc. pure nav — a follow-up slice. Before: `shots/v2-iter1/01,06`. |
| **G4** — No VS Code optionality leaks | **MOSTLY PASS — iters 2/4/5** | Removed: the source open-beside split (iter 2), the Download/Refresh/Ask-AI/Source header buttons (iter 4), and the **menubar + Accounts + Manage(gear) chrome** (iter 5, `studio.css`). Already off via settings: editor **tabs**, status bar, command center, editor-group **title/close** (studio.css). The command palette is **no longer surfaced** (commandCenter off + Manage gone). `shots/v2-iter5/01`. _Residual:_ the raw `Ctrl+Shift+P` keybinding + pane-resize sashes (core-owned) — a later iteration, may need a core patch. Before: `shots/v2-iter1/01`. |
| **G5** — Provenance gutter detached (D1) + doc/rail pixel-aligned (D4) | **PARTIAL → FAIL** | Dots render in a **thin left margin**, not the comp's clean **30px detached gutter column**; no multi-line "vertical bar" marker; doc column not pixel-aligned (width/centering differ). `shots/06`. |
| **G6** — Nav never blanks + dev-build ext toast gone | **PASS — iter 6** | Nav switching never blanks (v1 iter-6 fix holds). The **ext-activation toasts are gone**: the IDE-only builtins (`emmet`/`git-base`/`merge-conflict`) are excluded from the product in the web `BuiltinExtensionsScannerService` (first v2 core patch). Verified live: clean launch + click-through, zero toasts (`shots/v2-iter6/01-no-toasts.png`). Before: `shots/v2-iter1/01`. |

## Per-surface inventory + live scores

| Surface | Exists today (verified live) | Design intends | Score | Top gaps |
|---------|------------------------------|----------------|:----:|----------|
| **Source-peek / "Sync across"** | **iter 2:** "⇆ Source" / provenance dot opens an **in-surface left pane** (styled source table, "REFERENCED BY", floating ⟳ "Sync across" circle, close ✕) inside the one webview — no 2nd group, no blank pane | In-surface LEFT pane inside the editor + floating ⟳ "Sync across" circle; never a 2nd group | **78** ↑ | _Remaining:_ pane shows bound key→value rows, not the comp's raw CSV grid w/ latest row highlighted; no in-pane CSV edit yet |
| **Interaction grammar** | **iter 5:** menubar + Accounts + Manage(gear) removed; tabs/status/command-center/group-title already off; palette no longer surfaced. The shell reads as a calm app, not an IDE | Opinionated Word/Docs/Notion grammar; optionality **removed** | **70** ↑ | _Residual:_ raw `Ctrl+Shift+P` keybinding + pane-resize sashes (core-owned) |
| **Left rail / nav** | **iter 3:** one `TreeRailView` with **Files/Context/Outline/Search** tabs + folder tree (REPORTS + SOURCES); Documents + Context containers folded in | 76px labeled icon-nav + 264px **Files/Context/Outline/Search** tree-rail + folder tree | **75** ↑ | _Residual:_ the 76px labeled icon-nav restyle (activity bar still ~48px); make Home/Templates/etc. pure nav |
| **Global header** | **iter 4:** the doc header is the comp's single calm bar (brand/crumb + pill + Present + avatar); pill refreshes, formatting is a floating selection toolbar, Download/Refresh removed | Single calm 48px bar (brand/crumb/synced/Present/avatar) | **85** ↑ | _Residual:_ VS Code menubar leaks above (G4); the bar is per-webview, not one unified shell header |
| **Context panel** | **iter 3:** now a **tab inside the tree-rail** (verified: Linked sources / Referenced files groups for the active doc), reusing `buildContextGroups` | A **tab inside the tree-rail**: Linked sources / Referenced files / Pasted text / Images / Company knowledge + Add context | **78** ↑ | Surface Pasted/Images/Knowledge groups + Add-context inside the rail tab (data model already supports) |
| **Right rail (Chat/Review/History)** | 4 tabs — **Chat / Review / History / Skills** (one extra); functional; empty-state shown | 392px rail, **Chat / Review / History** (3 only) | **65** | Reconcile the extra "Skills" tab; pixel-align width/typography |
| **Document editor (body + gutter)** | Body reads like Word — h1, subtitle, sections, KPI table, dotted-underline bindings (high fidelity); gutter dots in thin margin | hi-fi doc + **30px detached gutter** + 720px centered column | **70** | **G5/D1** — detach gutter to 30px column; pixel-align column |
| **Templates** | Faithful webview (Run template / Template / Prompt / Sources / Generate draft) but opened as an editor, squeezed beside the blank group | Dedicated full-width surface | **70** | Host outside editor-groups; full-width; pixel pass |
| **Knowledge** | Faithful (Org/Project toggle, "How this is used", DECISION STACK: Mission/Strategy/OKRs) but squeezed | Dedicated full-width surface | **70** | Same as Templates |
| **Agents** | Faithful (header, ＋ New agent, All/Scheduled/Event/Needs-approval filters, 5-agent table, canvas tip) but squeezed | Dedicated full-width surface + per-agent canvas | **70** | Same as Templates |
| **Present / export modal** | "↗ Present" entry present in webview headers; modal built in v1 — **not re-opened this iteration** | 740px centered modal (destinations + preview) | **70\*** | Re-verify live next iteration; pixel pass |
| **Home** | High-fidelity webview (greeting/summary/Quick Start/4 project cards/calm brand bar); clean & full on first load | 1080px Home surface | **78** | Hide tree-rail on Home (matches `notHome`); pixel pass |

\* Present scored from comp + v1 evidence; not re-driven live in iteration 1 (flagged for iter-2+).

**Overall alignment: iter-1 ~56% → -2 ~61% → -3 ~67% → -4 ~70% → -5 ~73% → -6 ~73%** (mean of the 12
surface rows; iter-6 fixed gate **G6** — toasts — which isn't a per-surface score, so the mean holds but
a gate flips and the **live click-through is now clean**). **Gate status after iter 6:** G1 ✅, G2 ✅,
G3 mostly ✅, G4 mostly ✅, G5 partial (gutter detached; pixel-align pending), **G6 ✅**. Remaining for
the surface mean: **right rail (65)** + the **70-cluster** (doc editor, Templates, Knowledge, Agents,
Present) + the **icon-nav restyle** — i.e. per-surface pixel alignment to lift toward 95%.

## Ranked gap backlog (most abrasive × most central)

1. ~~**Kill the split/blank-pane abrasion (G1)** — source-peek + "Sync across" as an in-surface panel.~~
   **DONE (iter 2).** Source-peek now renders in-surface; no `SIDE_GROUP` on that path; no blank pane.
   _(Residual: the export/Download artifact still opens in a side group — separate flow, lower priority.)_
2. **Build the tree-rail (G3).** **DONE (iter 3):** one `TreeRailView` with Files/Context/Outline/Search
   tabs + folder tree, replacing the Documents + Context containers. _Residual:_ the 76px labeled
   icon-nav restyle + making Home/Templates/etc. pure nav (a smaller follow-up slice).
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
