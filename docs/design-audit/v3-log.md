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
| 2 (G4 closure) | ~84% | **6/6** | palette keybindings dead + sashes locked; **G4 ✅ — all gates pass**; interaction 70→90 |
| 3 (right rail) | ~85% | 6/6 | folded Skills → comp's exact 3-tab strip (Chat/Review/History); right rail 75→85 |
| 4 (Context) | ~86% | 6/6 | all 5 context group kinds + working "＋ Add context" composer; Context 78→90 |

**Target:** >= 97% overall, **all 6 gates full**, clean click-through, or 15 iterations.

## Gate status (live)

| | G1 split | G2 header | G3 rail/nav | G4 optionality | G5 gutter/figures | G6 nav/toast |
|--|:--:|:--:|:--:|:--:|:--:|:--:|
| v2 final | ✅ | ✅ | ✅ | ◑ mostly | ✅ | ✅ |
| iter 1 | ✅ | ✅ | ✅ | ❌ open | ✅ | ✅ |
| iter 2 | ✅ | ✅ | ✅ | **✅ closed** | ✅ | ✅ |
| iter 3 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| iter 4 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

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

### Iter 2 — close G4 (3 core patches)
- **Did:** removed the last reachable IDE optionality at the source. (1) `ShowAllCommandsAction`: dropped
  the `Cmd/Ctrl+Shift+P` / `F1` keybinding + `f1:false`. (2) `workbench.action.quickOpen`: dropped the
  `Cmd/Ctrl+P` / `Cmd/Ctrl+E` keybinding (so Quick Open — and its `>` command mode — can't open) + `f1:false`.
  (3) `base/.../sash.ts`: a global `lockAllSashes()` that coerces every `Sash` to `Disabled`, called once
  from a `BlockRestore` workbench contribution → no user-draggable layout dividers.
- **Verified live (pristine reload):** `Cmd+Shift+P`, `F1`, `Cmd+P` all no-op (quick-input never opens);
  **0 of 7 sashes draggable** (was 2). Re-checked every gate: no regression — 1 editor group on Home + doc
  (G1), calm header (G2), 76px nav + tree-rail (G3), gutter + blue figures (G5), no toasts (G6). Layout
  sizing intact (nav 76 / sidebar 246 / aux 374).
- **Gate flip:** **G4 ❌ → ✅. All six hard gates now pass.**
- **Scores:** interaction grammar 70 → 90; overall ~82% → **~84%**.
- **Core patches:** +3 (total 5; all fail-soft, logged in [ledger 03](../plans/03-merge-tax-ledger.md)).
- **Next (iter 3):** right rail content (75 → 95) — Chat/Review/History pixel-pass + Skills tab decision.
- **Shots:** `shots/v3-iter2/` (01 after-shell, 02 after-doc).

### Iter 3 — right rail → the comp's exact 3-tab strip
- **Did:** **folded the "Skills" tab into Review** (decision 31, reverses v2 decision 27). The rail strip is
  now exactly **Chat / Review / History** (the comp). Skill graders render as a "Document agents" checks
  section below the pending changes in Review — feature fully preserved (Run / Re-run / Apply fix wired).
  `reviewRailView.ts`: `PanelTab` 4→3, `_renderSkills` → `_appendChecks(parent)` (appends a `.ldr-checks`
  section instead of replacing content), editor-change re-render now keys on `review`/`chat`.
- **Verified live (pristine reload):** rail shows exactly 3 tabs; opening a doc populates the checks
  (Strategy READY/Run, Financial PASS/Re-run, Formatting FLAG/Apply-fix). No gate regression (nav 76,
  1 editor group, 0 draggable sashes). Tests green (66, incl. the Skills-report service test).
- **Scores:** right rail 75 → 85 (IA/Components now match the comp; content typography pixel-pass still
  owed for 95). Overall ~84% → **~85%**. 0 core patches.
- **Next (iter 4):** source-peek (78 → 95) — render the comp's raw CSV grid in the in-surface pane.
- **Shots:** `shots/v3-iter3/` (01 review-with-checks).

### Iter 4 — Context tab: 5 group kinds + "＋ Add context"
- **Note on ordering:** source-peek (backlog #3) renders *inside the webview iframe*, which chrome-devtools
  cannot drive or screenshot (cross-origin). It needs a structural/unit verification approach, so it's
  reordered later; picked Context (equally low at 78, and live-screenshottable in the DOM tree-rail).
- **Did:** `treeRailView.ts` — the Context tab already renders all 5 group kinds via `buildContextGroups`
  (Linked sources / Referenced files / Images / Pasted text / Company knowledge); they just never showed
  because the sample had only the first two and there was **no way to add context**. Added the comp's
  **"＋ Add context"** affordance: a collapsed button that expands to a kind picker (Pasted text / Image /
  Company knowledge) + an input wired to `ILivingDocsService.addContext` (the data model + lock already
  supported all three). New `.rail-addctx*` styles.
- **Verified live:** opened the doc → Context shows Linked sources + Referenced files + "＋ Add context";
  added a "Company knowledge" item → a new **COMPANY KNOWLEDGE** group appeared with the item (persisted
  in the lock). No gate regression (nav 76, 1 editor group, 0 draggable sashes, 3 rail tabs). Tests green (313).
- **Scores:** Context 78 → 90 (IA/components now match the comp; typography pixel-pass owed for 95).
  Overall ~85% → **~86%**. 0 core patches.
- **Next (iter 5):** Home (80 → 95) pixel pass, or the activity-bar stub-launcher wrinkle (#5).
- **Shots:** `shots/v3-iter4/` (01 context-groups, 02 add-context-composer).
