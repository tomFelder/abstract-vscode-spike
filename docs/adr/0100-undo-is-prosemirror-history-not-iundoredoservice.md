---
number: 100
status: "**Done (plan 26 iter 1).** 0 core patches; branch `26-history-undo`."
provenance: "plan 26, iter 1"
source: docs/07-decision-log.md
---

# Undo is prosemirror-history, not IUndoRedoService

**Keystroke undo/redo is ProseMirror's own `prosemirror-history`, NOT VS Code's `IUndoRedoService`; `setDoc` recreates the history so undo can never cross a service write**

Plan 26's architecture (settled to the plan's recommendation): document persistence deliberately bypasses the fork's text-model/undo machinery (`saveRawText`), and deep-integrating `IUndoRedoService` would couple the feature to the fork ahead of the Q3 fork-vs-greenfield decision. So keystroke-level undo lives entirely in the vendored PM bundle - `history()` + a `Mod-z`/`Shift-Mod-z`/`Mod-y` keymap (already present), now also exposed as `LWDPM.cmd(view, 'undo'|'redo')`. The safety-critical change: `setDoc` (the service-driven body reset after an approve/restore) now REBUILDS the plugins (`buildPlugins()`) instead of reusing `view.state.plugins`, so `history()` starts fresh and Cmd+Z can never silently revert an approved change without an audit entry. This keeps the whole trust-spine feature portable to a greenfield build. **Tier: our-surface** (the offline-built PM bundle + its base64 `.ts`); 0 core patches. Two headless bundle tests prove it: type -> undo removes / redo restores; type -> `setDoc` -> undo is a no-op.
