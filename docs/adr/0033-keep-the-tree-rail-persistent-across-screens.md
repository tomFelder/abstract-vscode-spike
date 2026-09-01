---
number: 33
status: "**Done (v3 iter 11, PR #16).** 0 core patches (our own `screenLauncherView.ts` + `IViewsService`). Verified live across Home/Templates/Knowledge/Agents + doc: tree-rail persists (4 tabs), no stub, 1 editor group, 0 draggable sashes — no gate regression. Left rail 93→95, interaction 93→95. _Residual:_ the activity-bar highlight lands on Workspace, not the active screen (a minor departure vs the comp's highlighted nav item)."
provenance: "v3"
source: docs/07-decision-log.md
---

# Keep the tree-rail persistent across screens

**Keep the tree-rail persistent on the screen surfaces — bounce the sidebar back to the Workspace container after a screen opens**

The stub-launcher wrinkle (twice-deferred): clicking a screen nav item (Home/Templates/Knowledge/Agents) swapped the sidebar to a stub "Open X" launcher; the comp keeps its left rail persistent (plan 12 #5). Rather than the deep "activity-bar icon as a pure command" rework, the `ScreenLauncherView` (which opens the screen editor when its container is revealed) now re-opens the `DOCUMENTS_CONTAINER_ID` (tree-rail) container a tick later — so the screen lands full-width in the editor area and the tree-rail stays put
