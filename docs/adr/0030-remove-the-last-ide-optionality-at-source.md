---
number: 30
status: "**Done (v3 iter 2, PR #16). 3 core patches** (ledger 03): drop `keybinding`+`f1` on `ShowAllCommandsAction` and `workbench.action.quickOpen`; add `lockAllSashes()` in `base/.../sash.ts` (coerces every `Sash` to `Disabled`) called from a `BlockRestore` contribution. All fail-soft. Verified live: Cmd+Shift+P / F1 / Cmd+P all no-op, 0 of 7 sashes draggable, no layout/gate regression. **G4 now FULLY passes - all six hard gates green.**"
provenance: "v3"
source: docs/07-decision-log.md
---

# Remove the last IDE optionality at source

**FULLY close G4 by removing the last reachable IDE optionality at the source** - the command-palette keybinding (`Cmd/Ctrl+Shift+P`, `F1`), the Quick Open keybinding (`Cmd/Ctrl+P`, so the `>` command mode is unreachable), and the draggable layout sashes (a global sash lock)

v2 removed the *surfaced* chrome (menubar/Accounts/Manage) but left two reachable leaks: the raw palette keybinding still opened the command palette, and the sidebar/aux-bar dividers were still user-draggable. A calm document app has no command palette and no user-resizable panes; v2 decision 25 flagged both as core-owned residuals. "Remove, don't just hide" (plan 12): neutralise the affordance at the registration/source, not via CSS hiding
