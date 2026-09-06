---
number: 98
status: "**Settled (default, unattended) + built (plan 33 iter 1).** 0 core patches; branch `33-shell-identity`."
provenance: "plan 33 iter 1, L1/L2/L4"
source: docs/07-decision-log.md
---

# Close the title-bar and window-identity leaks

**Close the last title-bar + window-identity leaks purely via the decision-54 config-default block - no core patch**

The native title bar on the full-width screen surfaces still showed the command-centre search pill (the "Review Project" box), the layout-toggle icons and the editor-group action icons; the window/tab title still carried the old brand. All four are real, user-overridable workbench settings, so plan 33's cheapest-tier rule and the plan's own iter-1 recommendation land them in the SAME additive `registerDefaultConfigurations` block that decision 54/55 established: `window.commandCenter: false`, `workbench.layoutControl.enabled: false`, `workbench.editor.editorActionsLocation: 'hidden'`. Exact keys verified against this fork's registry before assuming (`LayoutSettings.COMMAND_CENTER='window.commandCenter'`, `LayoutSettings.LAYOUT_ACTIONS='workbench.layoutControl.enabled'` in `layoutService.ts`; `editorActionsLocation` enum `['default','titleBar','hidden']` in `parts/editor/editor.ts`). The window title template was changed from decision-55's `${activeEditorShort}` to the plan's `${rootName}${separator}Abstract` (the workspace/project name then the brand; `${separator}` collapses so a no-folder window reads simply "Abstract"). The residual old-brand leak was NOT in `product.json` (already "Abstract" since PR #38) nor the theme JSON (already `"name":"Abstract"`) but in the two sample settings files (`living-docs-sample/.vscode/settings.json` + `.../brief/.vscode/settings.json`), which hardcoded `window.title:"Opportunity OS"` and `workbench.colorTheme:"Opportunity OS"` - the latter referencing a theme label that no longer exists (the theme was renamed to "Abstract" in `theme-defaults/package.json`). Removed the stale `window.title` override (the new default now applies) and corrected the theme reference to `"Abstract"`. **Tier: settings (additive config-defaults + sample-settings fix). 0 core patches.** Desktop window-title verification deferred (web build cannot exercise the OS title bar); the settings + template are correct by construction and web verifies the on-surface chrome removal.
