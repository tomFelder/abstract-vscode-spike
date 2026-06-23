# Living Documents — design-alignment v3 log

Rolling state for the **v3 loop** ([../plans/12-design-alignment-v3-loop.md](../plans/12-design-alignment-v3-loop.md)):
pixel-finish every surface to >= 95 and **fully close G4**. v2 history is archived in
[log.md](log.md) — not duplicated here. Inventory: [v3-inventory.md](v3-inventory.md). Branch
`living-docs-design-v3`. Each iteration = one commit + a PR comment with before/after shots.

## Score trajectory (overall = mean of the 12 surfaces)

| Iter | Overall | Gates passing | Headline |
|:----:|:-------:|:-------------:|----------|
| v2 final | ~82% | 5/6 (G4 mostly) | calm shell shipped (PR #15, merged) |
| 1 (re-audit) | ~82% | 5/6 (**G4 open**) | live re-audit; confirmed v2 holds; G4 leaks (palette + 2 sashes) verified live |

**Target:** >= 97% overall, **all 6 gates full**, clean click-through, or 15 iterations.

## Gate status (live)

| | G1 split | G2 header | G3 rail/nav | G4 optionality | G5 gutter/figures | G6 nav/toast |
|--|:--:|:--:|:--:|:--:|:--:|:--:|
| v2 final | ✅ | ✅ | ✅ | ◑ mostly | ✅ | ✅ |
| iter 1 | ✅ | ✅ | ✅ | ❌ open | ✅ | ✅ |

## Iterations

### Iter 1 — re-audit only (no code)
- **Did:** rebuilt the live inventory ([v3-inventory.md](v3-inventory.md)) against the comp on a pristine
  web build (IndexedDB cleared). Drove Home → doc → Templates; measured the shell structurally.
- **Confirmed holding:** G1 (1 editor group everywhere), G2 (calm header), G3 (76px nav + tree-rail),
  G5 (gutter dots + blue bound figures), G6 (no toasts, nav never blanks).
- **Confirmed open — G4:** `Cmd+Shift+P` opens the command palette live; 2 of 7 sashes are draggable
  (sidebar + aux-bar dividers, `pointer-events:auto`). Accounts/Manage are `display:none` (acceptable).
- **Also logged:** the activity-bar stub-launcher wrinkle (Templates nav drops the tree-rail) — backlog #5.
- **Scores:** unchanged from v2 (~82%); lowest = interaction-grammar 70 (the G4 leak), right rail 75,
  source-peek 78, Context 78, Home 80.
- **Next (iter 2):** **close G4** — remove the command-palette keybinding + make the sashes non-draggable
  (core patches, logged in ledger 03), re-check every gate for regressions.
- **Shots:** `shots/v3-iter1/` (01 launch, 02 G4 palette leak, 03 doc editor, 04 Templates stub-rail).
