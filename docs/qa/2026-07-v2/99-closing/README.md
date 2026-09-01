# Editor v2 wave - closing audit (plan 43 §6.5)

The wave's closing evidence: all five surfaces captured on **final main** at both viewports, paired side-by-side with the committed mock frames, plus the final-main health counts and the ledger/hygiene state. This closes plan 43 §6 DoD items 3-7.

Branch `v2/99-closing` (off `origin/main` @ `fe82bb8b80c` - "feat(livingDocs): v2 editor - fit and finish (#224) (#243)"). Captures via headless chromium (playwright-core 1.56.1, `deviceScaleFactor: 2`), bare URL `http://localhost:8081/`, session `v2-closing`. The Editor surface is the cold-start default (plan 42 L1); Home/Templates/Knowledge/Agents opened via their labelled nav items.

## 1. Final-main health (DoD item 6)

All clean on final main:

| Check | Command | Result |
|-------|---------|--------|
| Type-check | `npm run typecheck-client` | **0 errors** (exit 0) |
| Layering | `npm run valid-layers-check` | **clean** (exit 0) |
| Shell seams | `./scripts/check-seams.sh` | **OK - all shell seams intact** (exit 0) |
| Unit suite (livingDoc) | `./scripts/test.sh --grep "livingDoc"` | **360 passing, 0 failing** |
| Unit suite (LivingDocs) | `./scripts/test.sh --grep "LivingDocs"` | **8 passing, 0 failing** |

## 2. The ten side-by-side pairs (DoD item 5)

Each surface is committed as a **pair** with the naming convention `<surface>-<viewport>-product.png` / `<surface>-1440x900-mock.png`, plus a stitched `compare/<surface>-compare-1440.png` (product 1440 left, mock right). The mock is authored at 1760-wide artboards; each mock frame is clipped to the surface's own frame in `Abstract Editor v2.dc.html` (the Editor frame carries the numbered pins; H/T/K/A are the stacked screen frames below it).

| Surface | Product 1440x900 | Product 1760x1000 | Mock frame | Side-by-side |
|---------|------------------|-------------------|------------|--------------|
| Editor | `product/editor-1440x900-product.png` | `product/editor-1760x1000-product.png` | `mock/editor-1440x900-mock.png` | `compare/editor-compare-1440.png` |
| Home | `product/home-1440x900-product.png` | `product/home-1760x1000-product.png` | `mock/home-1440x900-mock.png` | `compare/home-compare-1440.png` |
| Templates | `product/templates-1440x900-product.png` | `product/templates-1760x1000-product.png` | `mock/templates-1440x900-mock.png` | `compare/templates-compare-1440.png` |
| Knowledge | `product/knowledge-1440x900-product.png` | `product/knowledge-1760x1000-product.png` | `mock/knowledge-1440x900-mock.png` | `compare/knowledge-compare-1440.png` |
| Agents | `product/agents-1440x900-product.png` | `product/agents-1760x1000-product.png` | `mock/agents-1440x900-mock.png` | `compare/agents-compare-1440.png` |

That's **10 product frames** (5 surfaces x 2 viewports) + **5 mock frames** + **5 stitched comparisons**.

### What the pairs confirm on final main

- **Elevation shell (plan 44):** `#EDEFF3` chrome, tree rail / editor / right rail as floating cards with 12px frame insets and radius-14 corners; the 48px full-width Abstract header (logo tile, workspace name + breadcrumb, per-surface right cluster). Both wave core seams (V2-1 frame inset, V2-2 header height) are live and visible.
- **Editor card (plan 45):** 70px numbered gutter, product tab strip in the pane host, floating format toolbar, Ask AI / Properties header actions.
- **Tree rail (plan 46):** Files / Context / Outline tabs, Reports + Sources groups, quiet `+`.
- **Right rail (plan 47):** Chat / Review / History (collapsed on the Editor default; the mock shows it expanded).
- **Screens (plans 48-49):** Home ("Good afternoon", needs-you + all-documents grid), Templates (pattern cards + starters), Knowledge (sources table + "how binding works"), Agents (agent cards, three-tier policy table, activity ledger).

## 3. Merge-tax ledger (DoD item 3)

`docs/plans/03-merge-tax-ledger.md` - both wave rows flipped to **LANDED**:

- **V2-1** `FLOATING_PANEL_MODERN_FRAME_INSET = 12` (the 12px floating-card frame inset) - landed in **PR #218**, merge commit `7dfd5ef40e4`. Asserted by check-seams **seams 9 + 9b** (`frame-inset-constant` / `frame-inset-editor` / `frame-inset-panecomposite`).
- **V2-2** `ABSTRACT_HEADER_HEIGHT = 48` (the 48px Abstract header) - landed in **PR #219**, merge commit `a7184f30f8e`. Asserted by check-seams **seam 10** (`header-height-constant` / `header-height-consumer`).

The wave took **exactly 2** core seams against the decision-169 budget of 2. `check-seams.sh` records exactly these 2 wave seams and exits 0. Whole-fork core-patch count: **8 total** (6 pre-wave + 2 this wave).

## 4. Docs hygiene (DoD item 4) - verified, no fixes needed

- **Decision log 167-174:** all 8 stand, none struck-through or reverted. Each is now its own record under `docs/adr/`, indexed from `docs/07-decision-log.md`: [167](../../../adr/0167-abstract-editor-v2-is-the-pixel-spec-of-record.md) the pixel spec of record · [168](../../../adr/0168-a-numbered-gutter-replaces-the-dot-gutter.md) the numbered gutter · [169](../../../adr/0169-the-elevation-models-two-seam-budget.md) the two-seam budget · [170](../../../adr/0170-one-48px-header-from-the-titlebar-part.md) the 48px header · [171](../../../adr/0171-abstracts-own-product-tab-strip.md) the product tab strip · [172](../../../adr/0172-the-properties-panel-is-the-frontmatter-front-door.md) the Properties panel · [173](../../../adr/0173-the-tree-rail-is-three-tabs-with-folded-search.md) the three-tab tree rail · [174](../../../adr/0174-the-wave-orchestration-protocol.md) the wave orchestration protocol.
- **Plan 20 delta banner:** present at `docs/plans/20-abstract-ui-redesign-handoff.md:3` - the top blockquote names the v2 wave (plan 43) and the §C2 gutter supersession (decision 168).
- **`docs/README.md`:** indexes the wave `43`-`49` (lines 47-48).
- **`docs/plans/README.md`:** indexes plans 43-49 individually (lines 72-78) plus the RUN prompt.

All four items were already correct on final main; this audit confirms them.

## 5. Founder desktop smoke (DoD item 7)

See [`founder-smoke.md`](founder-smoke.md): the 2-minute manual macOS desktop checklist - the traffic-light inset on the 48px header (plan 44-b), plus the memfs-watcher freshness / audit-persistence caveat that only real disk can show (plan 49-a). Nothing blocks the wave.
