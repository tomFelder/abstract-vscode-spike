---
number: 41
status: "**Done (v5 iter 4, PR #21). 0 core patches.** Service (TDD): generalized `withFrontmatterSource`→`withFrontmatterList(text, 'sources'\\|'context', value, add)`; `addContextFile`/`removeContextFile` + `getContextCandidates`; `IDocState.folderFiles` (scanned via `_scanFolderDocs`, excludes self/lock/agents/generated); `getMentionableFiles` unions declared + folder files. UI: `treeRailView` File kind picker + × unbind on Referenced files. Verified live on `.realdocs-test`: referenced `Team Notes.md` (Referenced files), removed it; `@`-chips show `forecast.csv`/`Team Notes.md` (real folder files, not declared)."
provenance: "v5"
source: docs/07-decision-log.md
---

# Referencing a file is a Context kind

**Reference a file = a "File" kind in the Add-context form (frontmatter `context:`); @mention resolves all real folder docs**

R6 has two parts. (a) **Add a file reference via UI:** rather than a separate affordance, add a **File** kind to the existing "＋ Add context" form (its other kinds — Pasted text / Image / Company knowledge — are lock items); File shows an in-app picker of the folder's md/csv/json (same rationale as #40) and writes the `context:` frontmatter via the shared `withFrontmatterList`. (b) **@mention:** broaden `getMentionableFiles` from frontmatter-declared only to **every real folder document** (md/csv/json, cached on the doc state at load), so `@mention` can pull in any folder file — `_readContext` already reads any relative path, so no read-path change.
