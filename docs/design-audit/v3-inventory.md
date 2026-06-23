# Living Documents v3 — Exists-today vs Design-intends inventory

The map the **v3 design-alignment loop** ([../plans/12-design-alignment-v3-loop.md](../plans/12-design-alignment-v3-loop.md))
closes: take the shell from **"feels like the comp (~82%)"** to **"indistinguishable (>= 97%)"** and
**fully close the one open gate (G4)**. **Iteration 1 (this doc) is the live re-audit** — the running
web build (`code-web` on :8080, driven via the chrome-devtools MCP, pristine after an IndexedDB clear)
verified surface-by-surface against the "Agentic Workbench" comp (DesignSync
`d198ca07-9eef-4d05-96e1-b383e6c19c03`, file `Living Documents - Workbench.dc.html`). Each surface is
scored 0-100 (mean of **Layout / Styling / Components / IA / Interaction-UX**) on the **same rubric as
v2** so the trajectory is comparable. Seeded from the v2 finals (`v2-inventory.md`) and re-verified.

> **Audited live 2026-06-23** (branch `living-docs-design-v3`, off `main` = merged PR #15 v2 shell).
> Screenshots: `shots/v3-iter1/`.
> **Headline finding:** the v2 shell **holds in full** — calm 48px header, 76px labeled icon-nav,
> tabbed tree-rail, single editor group (no split / no blank pane), detached gutter + inline blue
> bound figures, no dev toasts. **Five of six gates pass live.** The remaining gap is honest
> pixel-polish across surfaces **plus the one open gate, G4**: the command palette still opens on
> `Cmd+Shift+P` and two layout sashes are still user-draggable. Both confirmed live this iteration.

## Comp spec (the pixel target, extracted from the .dc.html — unchanged from v2)

- **Top bar — 48px**, `#fbfbfc`, 1px `#e9eaee` bottom border: 20px blue brand `L` + "Opportunity OS" +
  `/` + crumb; right: green "All sources synced" pill + ghost "↗ Present" + 27px "TS" avatar. Nothing else.
- **Icon-nav — 76px**, `#f6f7f9`: labeled Home / Editor / Review (badge) / Templates / Knowledge /
  Agents + Settings pinned bottom; icon over a 10px label.
- **Tree-rail — 264px**, `#fafbfc`, hidden on Home: 38px tab strip Files / Context / Outline / Search;
  Files = folder tree, Context = 5 grouped kinds + "＋ Add context", Outline = headings, Search = results.
- **Editor** = doc-tab bar (40px) over a centered **720px** column with a **30px detached gutter**;
  bound text = blue dotted underline + faint highlight; source-peek = in-surface LEFT pane + floating
  ⟳ "Sync across" circle; **never a 2nd editor group**. Right panel **392px**, tabs **Chat / Review / History**.
- **Home** = `#f8f9fb`, 1080px column (greeting + date + summary + QUICK START 3 cards + 2x2 projects).
- **Templates / Knowledge / Agents** = dedicated full-width surfaces; **Present** = 740px centered modal.

## Hard UX gates — live status (all six must FULLY pass for v3)

| Gate | Live status (v3 iter 1) | Evidence |
|------|-------------------------|----------|
| **G1** — No split editor groups / no blank panes | **PASS (hold)** | `.editor-group-container` count = **1** on Home, the doc, and Templates. Source-peek is in-surface (v2). `shots/v3-iter1/01,03,04`. |
| **G2** — Calm single 48px header | **PASS (hold)** | Header = brand `L` + "Opportunity OS / <crumb>" + "All sources synced" pill + "↗ Present" + "TS" avatar; nothing else, on both Home and the doc. `shots/v3-iter1/01,03`. _Pixel pass still owed (85)._ |
| **G3** — Tree-rail + 76px labeled icon-nav | **PASS (hold)** | Activity-bar width measured **76px**; labels Workspace/Home/Templates/Knowledge/Agents; tree-rail tabs Files/Context/Outline/Search + folder tree. `shots/v3-iter1/01`. _Residual: nav label set differs from the comp's literal Home/Editor/Review._ |
| **G4** — FULLY remove IDE optionality | **PASS — iter 2** | The palette keybindings are dead: `Cmd+Shift+P`, `F1`, and `Cmd+P` (Quick Open, the `>` command-mode entry) all no-op live; verified the quick-input widget never opens. **0 of 7 sashes draggable** (all `.disabled` / `pointer-events:none` via the global sash lock) — no user-resizable panes. Accounts/Manage stay `display:none`. 3 core patches (ledger 03). `shots/v3-iter2/01,02`. Before: `shots/v3-iter1/02`. |
| **G5** — Detached gutter + inline figures + pixel-aligned | **PASS (hold)** | Doc shows the 30px gutter dots + blue dotted-underline bound figures (+18% / $48.6k / 427 / 2.4%) in prose; footer hint present. `shots/v3-iter1/03`. _Pixel pass still owed (88)._ |
| **G6** — Nav never blanks + no dev toast | **PASS (hold)** | Pristine launch + full click-through (Home → doc → Templates) showed zero ext-activation toasts; nav switching never blanked. `shots/v3-iter1/01,03,04`. |

## Per-surface inventory + live scores (v2 final → v3 iter-1 re-verify)

| Surface | Exists today (re-verified live) | Design intends | v2 | v3-1 | Top gap to >= 95 |
|---------|----------------------------------|----------------|:--:|:----:|------------------|
| **Left rail / nav** | 76px labeled icon-nav + 264px tree-rail (Files/Context/Outline/Search) verified live | 76px labeled icon-nav + tree-rail | 90 | **90** | nav label set (Home/Editor/Review); active-item treatment |
| **Knowledge** | **iter 6:** verified against the comp spec (Org/Project toggle, Mission/Vision/Strategy/OKR decision cards, Values chips, Principles, "How this is used" + decision-stack diagram) — matches | full-width surface | 88 | **95** | minor micro-spacing |
| **Document editor** | **iter 7:** verified pixel-exact vs the comp — title 600 30px `-.015em`, H2 600 19px, body 400 16px/1.78, bound figures `rgba(80,110,235,.08)`+`1.5px oklch(.6 .1 255)`, KPI table (`#eceef2`/10px/`#f8f9fb` header); fixed bound-pad + table border/radius | hi-fi doc + gutter + figures | 88 | **95** | edge: preserve bold/italic inside a bound paragraph |
| **Global header** | **iter 5:** verified **pixel-exact** to the comp spec — topbar 48px/`#fbfbfc`/`#e9eaee`; brand 20px `oklch(.55 .13 255)` logo + 600 13px `#2a2c32` wordmark + `#c8cbd2` sep + `#868b95` crumb; pill `#eef7f0`/`#d7ecdc`/`#5d8a66`; 27px avatar | single 48px bar | 85 | **92** | residual: per-webview vs one unified shell bar (architectural, not visible) |
| **Templates** | **iter 6:** verified against the comp spec (980px column, 380px config col, step circles, source chips, Generate-draft button, Draft-preview panel + green filled-slots) — matches | full-width surface | 85 | **95** | residual: tree-rail swaps to a stub launcher when active (deferred wrinkle) |
| **Agents** | **iter 6:** table matched to the comp's exact columns — removed the extra POLICY column (now AGENT/TRIGGER/FLOW/LAST RUN/STATUS), relative-time LAST RUN; filter tabs + New-agent button match | full-width + per-agent canvas | 85 | **92** | per-agent canvas pixel pass; last-run unpopulated until agents run |
| **Present / export modal** | **iter 7:** verified vs the comp spec (code) — 740px card, 16px radius, `0 24px 70px` shadow, `rgba(20,26,40,.34)` scrim, 300px destination list w/ brand-tinted icons, preview chip, WHO-CAN-ACCESS scopes, full-width Export CTA — all match | 740px centered modal | 85 | **93** | webview-internal (can't drive the modal open from the top frame to screenshot) |
| **Home** | **iter 5:** verified against the comp spec — 1080px column, 40/36/80 padding, greeting 600 26px `#15171c`, Quick-Start cards (`#f7f9ff`/12px/34px icons), 2x2 project cards (13px radius, 26px chips, `1 TO APPROVE` `#fdf2dc`, primary/secondary buttons) all match; fixed the first card's 17px icon | 1080px Home | 80 | **94** | minor: exact since-line micro-spacing |
| **Context panel** | **iter 4:** renders all 5 group kinds (Linked sources / Referenced files / Images / Pasted text / Company knowledge) + a working "＋ Add context" composer (kind chips + input wired to `addContext`) | 5 groups + "＋ Add context" | 78 | **90** | content typography pixel-pass |
| **Source-peek / "Sync across"** | in-surface left pane (bound key→value rows) — carry | in-surface pane + raw CSV grid | 78 | **78** | render the comp's raw CSV grid w/ latest row highlighted |
| **Right rail (Chat/Review/History)** | **iter 8:** verified vs the comp spec — tab strip + count badge, Chat bubbles/composer/@mention chips, Review diff colors (`#fdecec`/`#e7f6ec`), History timeline all match; aligned the Why-box + Approve/Reject to exact spec | 392px, 3 tabs | 75 | **93** | populated Review-diff card needs a model refresh to screenshot; pin 374→392 (grid redistributes) |
| **Interaction grammar** | **iter 2:** calm app shell with the optionality **removed** — no command palette (keybindings dead), no user-resizable panes (sashes locked); reads as an opinionated document app | optionality removed | 70 | **90** | minor: nav label set vs comp; finish per-surface interaction polish |

**Overall alignment (mean of the 12 rows): ~92%** (v2 ~82%; iters 2-7 brought G4 + interaction/right-rail/
Context/Home/header/Templates/Knowledge/Agents/doc/Present up; **iter 8** right rail 85→93). **Gate status:
G1 ✅, G2 ✅, G3 ✅, G4 ✅, G5 ✅, G6 ✅ — all six pass.** Live click-through clean. The one real remaining
drag is **source-peek 78** (the raw CSV grid — webview-internal, structural verification); after that, a
final verification sweep nudges the 90-92 surfaces. **Finding:** the webview surfaces were built faithfully
to the comp; conservative v2 scores are corrected upward as each is verified against the spec.

## Ranked v3 gap backlog (most impact = lowest score × most central)

1. ~~**G4 closure (flips the last gate).**~~ **DONE (iter 2).** Removed the command-palette keybinding
   (`Cmd/Ctrl+Shift+P`, `F1`) + the Quick Open keybinding (`Cmd/Ctrl+P` → `>` command mode unreachable),
   and a global sash lock makes every layout divider non-draggable. 3 core patches (ledger 03), all
   fail-soft. Verified live; **all six gates now pass.** Interaction grammar 70→90.
2. **Right rail (75 → 85, iter 3 — DONE the IA half).** Folded Skills → the comp's exact 3-tab strip
   (Chat/Review/History); checks live in Review. _Remaining to 95:_ content typography pixel-pass. Chat thread / Review cards / History to the comp's exact spacing,
   type, colors; widen 374 → 392; decide the **Skills** 4th tab (keep as a justified departure or fold).
3. **Source-peek content (78 → 95).** Render the comp's raw CSV grid (week/date/mrr/signups/churn/active,
   latest row highlighted) in the in-surface pane, not just bound-key rows.
4. **Context panel (78 → 90, iter 4 — DONE).** All 5 group kinds render + a working "＋ Add context"
   composer (kind chips + input → `addContext`). _Remaining to 95:_ content typography pixel-pass.
5. **Activity-bar stub-launcher wrinkle.** Templates/Knowledge/Agents nav swaps the sidebar to a stub
   launcher (confirmed live: heading "Templates", "Open Templates" button) — the comp keeps the
   tree-rail. Make the tree-rail persist; nav opens the screen in the main area only.
6. **Home (80 → 95)** + per-surface pixel finish: header (85), Templates/Agents/Present (85), doc
   editor (88), Knowledge (88) — typography, spacing, colors, exact components.
7. **Minor:** preserve bold/italic in bound paragraphs; reconcile the nav label set vs the comp's
   Home/Editor/Review; per-agent canvas pixel pass.
