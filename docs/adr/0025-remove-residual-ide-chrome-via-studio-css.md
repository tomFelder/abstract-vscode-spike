---
number: 25
status: "**Done (v2 iter 5, PR #15).** Tier: **styleOverrides-CSS**, 0 core patches. Verified live: menubar/Accounts/Manage gone; doc opens clean (G1-G3 hold). _Residual (tracked):_ the raw `Ctrl+Shift+P` palette keybinding (UI surface removed) + pane-resize sashes may need a core seam for a full G4 pass."
provenance: "v2"
source: docs/07-decision-log.md
---

# Remove residual IDE chrome via Studio CSS

**Remove the residual IDE chrome (menubar, Accounts, Manage gear) via the Studio styleOverrides CSS**

`window.menuBarVisibility:hidden` is ignored in modernUI (the menubar renders inside the activity bar); the Accounts (sign-in-to-sync) and Manage (gear -> Settings/Command Palette/Extensions/Updates) global actions are IDE tells the comp's icon-nav lacks, and Manage is the surface that exposes the command palette. Hide them in `studio.css` (the established `.style-override-studio` chrome-removal mechanism), alongside the already-hidden editor-group title/watermark
