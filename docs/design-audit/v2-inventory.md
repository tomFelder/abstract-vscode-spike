# Living Documents v2 — Exists-today vs Design-intends inventory

The map the **v2 design-alignment loop** ([../plans/11-design-alignment-loop.md](../plans/11-design-alignment-loop.md))
closes. **Iteration 1 fills this in** by auditing the running app live (chrome-devtools MCP) against
the "Agentic Workbench" comp (DesignSync `d198ca07-9eef-4d05-96e1-b383e6c19c03`, file
`Living Documents - Workbench.dc.html`). Each surface: what it **does today**, what the **comp
intends**, an alignment score (0-100 on Layout / Styling / Components / IA / Interaction-UX), and a
ranked gap list. Target: overall **>= 95%** + every hard gate below passing.

> Seeded skeleton — scores/notes are placeholders for iteration 1 to replace with live findings.
> Functionality is at the v1 bar (plan 09, PR #13); the gaps below are about the **shell / experience**.

## Hard UX gates (must ALL pass for v2 — these encode the named abrasions)

| Gate | Today | Target |
|------|-------|--------|
| G1 — No split editor groups / no blank panes | **FAIL** — source-peek + Sync-across open a `SIDE_GROUP` editor; opening a source leaves a pane blank | In-surface panel/overlay; never a 2nd editor group |
| G2 — Calm, light header (comp's 48px bar) | Heavy/cluttered (Tom) | Single calm bar matching the comp |
| G3 — Left rail matches the comp | Activity-bar-per-view split; far less IA than the design | One tree-rail: Files / Context / Outline / Search + folder tree |
| G4 — No VS Code optionality leaks | Drag/split/reopen-with/palette/group-close all reachable | Removed (not just hidden) — Word/Docs/Notion grammar |
| G5 — Provenance gutter detached (D1) + doc/rail pixel-aligned (D4) | Partially | Detached gutter; pixel-aligned |
| G6 — Nav never blanks; dev-build ext toast gone | Nav fixed (iter 6); toast still shows | Both clean |

## Per-surface inventory (iteration 1 to complete)

| Surface | Exists today | Design intends | Score | Top gaps |
|---------|--------------|----------------|:----:|----------|
| Left rail / nav | _audit_ | Files/Context/Outline/Search tree-rail + folders | _ | Build the tree-rail (G3) |
| Global header | _audit_ | Calm 48px bar (brand / crumb / sync pill / Present / avatar) | _ | De-clutter (G2) |
| Document editor | reads like Word (our webview) | hi-fi doc + detached gutter | _ | Gutter detach (G5), pixel align |
| Source-peek / "Sync across" | opens a `SIDE_GROUP` editor (split/blank) | in-surface side panel | _ | Redesign as in-surface panel (G1) |
| Right rail (Chat/Review/History/Skills) | functional | hi-fi tabbed rail | _ | Pixel align |
| Context panel | groups + Add context | comp's Context IA | _ | Align to comp |
| Home / Templates / Knowledge / Agents | built, functional | hi-fi screens | _ | Pixel align |
| Present / export modal | built | hi-fi modal | _ | Pixel align |
| Interaction grammar | IDE optionality present | opinionated, removed | _ | Remove optionality (G4) |

**Overall alignment (iter 1 baseline):** _to be scored_ → target **>= 95%**.
