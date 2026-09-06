---
number: 40
status: "**Done (v5 iter 3, PR #20). 0 core patches.** Service (TDD): pure `withFrontmatterSource(text, source, add)` edits only the `sources:` frontmatter (body verbatim); `addSource`/`removeSource` rewrite it via `saveRawText` (persists + re-resolves); `getSourceCandidates` lists folder csv/json minus bound + lock/agents system files. UI: `treeRailView` Context tab. Verified live on `.realdocs-test`: added `forecast.csv` (resolved \"live\"), removed it — both in-app (web=memfs; disk write is `saveRawText`→`IFileService`, unit-tested + desktop-real per #38)."
provenance: "v5"
source: docs/07-decision-log.md
---

# Add source picks from an in-app file list

**"Add source" picks from an in-app list of the folder's data files, written to frontmatter — not a native file dialog**

R5 needs a no-hand-editing way to bind a source. Two options for the picker: (a) the native OS file dialog (`showOpenDialog`), or (b) an in-app list of the open folder's data files (csv/json). Chose **(b)**: the folder IS the project (#39) so sources are scoped to it; an in-app list is also **drivable** for verification (the native picker is a non-automatable dialog, same wall as R1's folder-open). Lives in the **Context panel** "Linked sources" group (its natural home), with a ＋ Add source picker + a × unbind per source.
