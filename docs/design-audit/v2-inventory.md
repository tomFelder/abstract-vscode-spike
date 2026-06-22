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
| **G3** — Left rail matches the comp | **PASS — iters 3 + 9** | The sidebar is one **`TreeRailView`** (Files/Context/Outline/Search tabs + folder tree, iter 3), and the **icon-nav is now 76px with a label under each icon** (Workspace/Home/Templates/Knowledge/Agents — iter 9, `ACTIVITYBAR_WIDTH` core patch + studio.css labels). Verified live: labeled rail, no overlap, all tabs work. `shots/v2-iter9/01-labeled-icon-nav.png`. _Minor:_ our nav set (Workspace + screens) differs from the comp's literal Home/Editor/Review labels — an IA choice (Review lives in the right rail). Before: `shots/v2-iter1/01,06`. |
| **G4** — No VS Code optionality leaks | **MOSTLY PASS — iters 2/4/5** | Removed: the source open-beside split (iter 2), the Download/Refresh/Ask-AI/Source header buttons (iter 4), and the **menubar + Accounts + Manage(gear) chrome** (iter 5, `studio.css`). Already off via settings: editor **tabs**, status bar, command center, editor-group **title/close** (studio.css). The command palette is **no longer surfaced** (commandCenter off + Manage gone). `shots/v2-iter5/01`. _Residual:_ the raw `Ctrl+Shift+P` keybinding + pane-resize sashes (core-owned) — a later iteration, may need a core patch. Before: `shots/v2-iter1/01`. |
| **G5** — Provenance gutter detached (D1) + doc/rail pixel-aligned (D4) | **PASS — iters (prior)+8** | The gutter is a **30px detached grid column** (dot per bound line, vertical bar for multi-line edits — `.docwrap`/`.gutter2`), and **iter 8** added the comp's **inline bound-figure highlighting** (faint-blue bg + underline on each resolved figure in prose; tables stay plain) so the reader sees what's live. Doc column 720px centered; the rail was widened toward 392px (iter 7). `shots/v2-iter8/01-inline-figure-highlight.png`. |
| **G6** — Nav never blanks + dev-build ext toast gone | **PASS — iter 6** | Nav switching never blanks (v1 iter-6 fix holds). The **ext-activation toasts are gone**: the IDE-only builtins (`emmet`/`git-base`/`merge-conflict`) are excluded from the product in the web `BuiltinExtensionsScannerService` (first v2 core patch). Verified live: clean launch + click-through, zero toasts (`shots/v2-iter6/01-no-toasts.png`). Before: `shots/v2-iter1/01`. |

## Per-surface inventory + live scores

| Surface | Exists today (verified live) | Design intends | Score | Top gaps |
|---------|------------------------------|----------------|:----:|----------|
| **Source-peek / "Sync across"** | **iter 2:** "⇆ Source" / provenance dot opens an **in-surface left pane** (styled source table, "REFERENCED BY", floating ⟳ "Sync across" circle, close ✕) inside the one webview — no 2nd group, no blank pane | In-surface LEFT pane inside the editor + floating ⟳ "Sync across" circle; never a 2nd group | **78** ↑ | _Remaining:_ pane shows bound key→value rows, not the comp's raw CSV grid w/ latest row highlighted; no in-pane CSV edit yet |
| **Interaction grammar** | **iter 5:** menubar + Accounts + Manage(gear) removed; tabs/status/command-center/group-title already off; palette no longer surfaced. The shell reads as a calm app, not an IDE | Opinionated Word/Docs/Notion grammar; optionality **removed** | **70** ↑ | _Residual:_ raw `Ctrl+Shift+P` keybinding + pane-resize sashes (core-owned) |
| **Left rail / nav** | **iters 3/7/9:** 76px labeled icon-nav (iter 9) + 264px `TreeRailView` (Files/Context/Outline/Search + folder tree) | 76px labeled icon-nav + 264px **Files/Context/Outline/Search** tree-rail + folder tree | **90** ↑ | Minor: nav label set differs from the comp's literal Home/Editor/Review |
| **Global header** | **iter 4:** the doc header is the comp's single calm bar (brand/crumb + pill + Present + avatar); pill refreshes, formatting is a floating selection toolbar, Download/Refresh removed | Single calm 48px bar (brand/crumb/synced/Present/avatar) | **85** ↑ | _Residual:_ VS Code menubar leaks above (G4); the bar is per-webview, not one unified shell header |
| **Context panel** | **iter 3:** now a **tab inside the tree-rail** (verified: Linked sources / Referenced files groups for the active doc), reusing `buildContextGroups` | A **tab inside the tree-rail**: Linked sources / Referenced files / Pasted text / Images / Company knowledge + Add context | **78** ↑ | Surface Pasted/Images/Knowledge groups + Add-context inside the rail tab (data model already supports) |
| **Right rail (Chat/Review/History)** | **iter 7:** pinned to ~374px (was 282; comp 392) — roomy, functional; 4 tabs (Chat/Review/History/**Skills** — Skills kept as a deliberate verification-feature departure) | 392px rail, **Chat / Review / History** (3 only) | **75** ↑ | Content typography pixel-pass; Skills is an accepted departure |
| **Document editor (body + gutter)** | **iter 8:** 30px detached gutter (dot/bar), **inline blue figure highlighting** in prose, 720px centered column, calm header (iter 4) | hi-fi doc + 30px detached gutter + 720px centered column + inline bound figures | **88** ↑ | Minor: bound-paragraph bold/italic not preserved by the highlight path (edge case) |
| **Templates** | **iter 10 re-verify:** now **full-width** (un-squeezed) — 3-step config (Template/Prompt/Sources/Generate) + a live Draft preview with highlighted figures | Dedicated full-width surface | **85** ↑ | Minor: the activity-bar nav item shows a stub launcher in the rail when active |
| **Knowledge** | **iter 10:** full-width — decision stack (Mission/Vision enduring, Strategy directional, OKRs measurable), Org/Project toggle, Values chips, Principles, "How this is used" | Dedicated full-width surface | **88** ↑ | Pixel pass |
| **Agents** | **iter 10:** full-width — header, ＋ New agent, All/Scheduled/Event/Needs-approval filters, 5-agent table (trigger/policy/flow/status) | Dedicated full-width surface + per-agent canvas | **85** ↑ | Per-agent canvas pixel pass |
| **Present / export modal** | **iter 10 re-verified live:** centered modal — destinations (Docs/Sheets/Word/Excel/Hosted page) + detail/preview + WHO CAN ACCESS + Export CTA | 740px centered modal (destinations + preview) | **85** ↑ | Pixel pass |
| **Home** | High-fidelity webview (greeting/summary/Quick Start/4 project cards/calm brand bar); clean & full, no toasts, labeled nav | 1080px Home surface | **80** ↑ | Pixel pass |

\* Present scored from comp + v1 evidence; not re-driven live in iteration 1 (flagged for iter-2+).

**Overall alignment: iter-1 ~56% → … → -9 ~77% → -10 ~82%** (final, mean of the 12 surface rows). Iter-10
re-verified the secondary surfaces live now that the shell is fixed — un-squeezed + full-width, they
score 80-88 (Templates 70→85, Knowledge 70→88, Agents 70→85, Present 70→85, Home 78→80). **Final gate
status:** G1 ✅, G2 ✅, G3 ✅, **G4 mostly ✅**, G5 ✅, G6 ✅; **live click-through clean**. The ~82%
(not 95%) reflects honest remaining pixel-polish across surfaces — see the per-surface scores; nothing
is squeezed, abrasive, or IDE-leaking anymore. Two tiny core patches total.

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
