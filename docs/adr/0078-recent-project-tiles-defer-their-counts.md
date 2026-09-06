---
number: 78
status: "**Done (plan 22 iter 2).** Branch `redesign-22-2-allprojects`, PR base `redesign-22-1-home-needsyou`."
provenance: "plan 22, iter 2"
source: docs/07-decision-log.md
---

# Recent project tiles defer their counts

**ALL PROJECTS grid shows real counts only for the current open folder; recently-opened folder tiles defer counts with an explicit affordance ("Open to see counts").**

D22-A (decision #74) committed to showing the recently-opened folder list. The question for iter 2: what stats to show on recent tiles when the folder is not open and `listDocuments()` cannot be called against it. Three options: (a) fabricate placeholder numbers; (b) omit the counts line entirely; (c) show an honest "Open to see counts" placeholder in mono type. Chose **(c)**: it clearly communicates that data exists but is deferred, satisfies the never-fabricate guardrail from plan 17, and keeps the tile layout consistent (both tile types have a two-row body: name + badge on row 1, mono counts on row 2). Counts for the *current* open folder (`docCount` + distinct `sources` set across all docs) are derived from `listDocuments()` called at `setInput` time (via `Promise.all` alongside `_fetchRecentFolders()`), and are therefore always real. The recent-folder name is resolved from the stored `IRecentFolder.label` falling back to the last non-empty path segment of `folderUri.path`, then filtered to entries with `name.length > 1` (eliminates FSA "mount" stubs with no useful display name). The current-folder tile uses an accent tint (`#f7f9ff`) to distinguish it; recent tiles are white. Health indicator: 6px green dot for zero pending, amber number chip (`attention` tokens) for N pending — no text label ("In Sync" / "N to approve"), matching the comp exactly. **0 core patches.**
