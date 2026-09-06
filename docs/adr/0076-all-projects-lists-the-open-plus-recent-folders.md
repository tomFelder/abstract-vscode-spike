---
number: 76
status: "**Settled (default, unattended). Grid built in plan 22 iter 2.**"
provenance: "D22-A · plan 22, iter 1"
source: docs/07-decision-log.md
---

# All Projects lists the open plus recent folders

**ALL PROJECTS is populated by the current open folder PLUS the workbench recently-opened folder list, not a single tile.**

Plan 22 asks what fills "ALL PROJECTS" when only one folder is open, since "the folder is the project" (decision #39) means there is normally exactly one. Two options: (a) show only the current project as a single tile; (b) show the current project prominently plus the workbench *recently-opened* folders (via `IWorkspacesService.getRecentlyOpened()`) as additional tiles, each opening that folder. Chose **(b)**: it makes the grid truthful (real recent projects the user actually opened) without inventing any data - continuing the plan-17 "never fabricate" rule and the real-data guardrail. Each extra tile carries only counts we can derive cheaply (doc/source counts are computed when a folder is opened; for not-yet-opened recents the tile shows the folder name + an "Open" affordance and defers counts). Iter 1 builds only the greeting + NEEDS-YOU section; this decision is recorded now so iter 2 can build the grid on the recently-opened list. (Numbered #74 to continue past plan-21's #72-73, which land on independent branches.)
