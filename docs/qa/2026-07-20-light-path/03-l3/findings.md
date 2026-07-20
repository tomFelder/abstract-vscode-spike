# Plan 42 - Light-path L3 findings: markdown-first, "living" is earned

**Date:** 2026-07-20
**Branch:** `light-path/l3-markdown-first` (worktree `/Users/tommy/Sites/abstract-lp-l3`)
**Issue:** #199 -- part of the Plan 42 light-path run
**Base:** `origin/main` @ `2539d37` (includes the L1 merge #197/#202)

## Summary

L3 asks for two things: plain Markdown must be the default citizen on the entry path (no lock / birth-sheet / Living-Document ceremony before the user meets an agent), and a doc must upgrade to living silently the moment the first source is bound or the first agent edit is accepted.

The storage layer already earned this at baseline: opening and typing into a plain `.md` writes no lock. The service's lock-write sites are all gated - behind `state.doc.isLiving`, behind `_bootstrapLock` (which only writes when the doc declares bind keys / context), or on the agent-accept / import / publish paths (already living, or the moment of becoming living). The residual L3 work was (1) making the earned-upgrade rule explicit and unit-tested as a pure function rather than an inline `||` chain re-derived in several places, and (2) the entry-path vocabulary audit - three surfaces a fresh user meets were showing source-sync / Living-Document ceremony before binding anything.

All four AC clauses were live-verified E2E (see "Verification").

## File-by-file changes

### `common/livingUpgrade.ts` (new - the pure, tested rule)
The explicit statement of "has this doc earned living?" and "does this project have any living surface yet?", modelled on the L1 exemplar `common/startupRouting.ts` (no DOM, no service, no I/O).
- `docHasEarnedLiving(facts)` - true when a source is bound (frontmatter `sources:`/`context:` or an inline bind link) OR a sibling lock exists (the mark an accepted agent edit / import leaves). The single predicate the earned-upgrade rule reads from; naming the two upgrade triggers together makes "living is earned" explicit.
- `projectHasLivingSurface(facts)` - true when at least one discovered doc is living or the project has at least one bound source. Drives the truthful entry-path sync pill.

### `common/livingDocMarkdown.ts` (route the parse rule through the predicate)
The parser's `isLiving` derivation now calls `docHasEarnedLiving({..., hasSiblingLock: false})`. Behaviour-identical (same boolean); it just states the rule in one place. Sibling-lock is `false` here because the parser cannot see the disk - it is the service-only trigger, left as a documented factor.

### `browser/screenRender.ts` (Home + screens top bar: truthful sync pill)
The global screen top bar hard-coded an `All sources synced` pill on every screen, shown on a fresh folder of plain Markdown that has no sources to be "synced". `topBar` / `withTopBar` now take a `showSyncPill` flag; `renderScreenHtml` computes it via `projectHasLivingSurface({ anyDocLiving: state.docs?.some(d => d.isLiving), boundSourceCount: state.sources?.length })`. When nothing is living, the pill is omitted (calm, truthful). The string is now localized (`livingDocs.topbar.allSynced`).

### `browser/treeRailView.ts` (Context tab empty state)
`"This document has no bound sources yet."` -> `"Connect a data source to keep figures in this document up to date."`. The old copy led with "bound sources" (lock/provenance-adjacent ceremony) on a plain doc. The new copy is markdown-first, stays truthful (a doc IS open - preserves #181), and the "+ Add source" / "+ Add context" doors remain the affordances.

### `browser/reviewRailView.ts` (Review tab empty state)
`'No changes waiting. Open a Living Document and click "Refresh from sources".'` -> localized `"No changes waiting. When the agent proposes an edit, it lands here for you to review."`. The Review tab is default-open on the entry path (pre-L4), so a fresh user meets this string before any AI use; it carried "Living Document" + "sources" ceremony. Edit is in the Review-tab empty-state region, clear of the L2 composer / inline-choice-card region of the same file.

### tests
- `test/browser/livingUpgrade.test.ts` (new) - two snapshot-style `deepStrictEqual`s: plain stays plain / each trigger earns living; project has no living surface until a doc is living or a source is bound.
- `test/browser/screenRender.test.ts` (extended) - the top-bar loop now asserts the pill shows once the project has a living surface, plus a new case asserting the pill is omitted on a fresh plain project.

## Copy audit - every entry-path string reviewed (before first AI / source use)

Entry path post-L1 = editor with a plain doc (livingDocRender top bar), left rail Context/Files/Outline (treeRailView), right rail Chat/Review/History (reviewRailView), and Home (screenRender).

| String | Location | Shown when | Disposition |
| --- | --- | --- | --- |
| "This document has no bound sources yet." | treeRailView.ts:490 (Context empty) | Plain doc, Context tab | Changed -> "Connect a data source to keep figures in this document up to date." |
| 'No changes waiting. Open a Living Document and click "Refresh from sources".' | reviewRailView.ts:356 (Review empty) | Plain doc, Review tab (default-open pre-L4) | Changed -> "No changes waiting. When the agent proposes an edit, it lands here for you to review." |
| "All sources synced" | screenRender.ts:569 (screen top bar pill) | Every screen incl. fresh Home | Changed -> shown only once projectHasLivingSurface; omitted on a plain project |
| breadcrumb `Abstract / Living Document` | livingDocRender.ts:899 | Only when isLiving; a plain doc shows the file breadcrumb (post-#174) or `/ Markdown` | Kept - already earned-gated |
| editor sync pill `${status}` | livingDocRender.ts:879-880 | Only rendered when isLiving | Kept - `livingControls` guarded by isLiving; plain doc shows no pill (verified: notes.md has none) |
| editor pane type label "Living Document" | livingDocs.contribution.ts:249,275; webview title livingDocEditor.ts:118 | Editor registration / a11y title | Kept - internal descriptor; visible breadcrumb is the file path |
| "+ Add source" / "+ Add context" / "Use as source" / "Remove source" | treeRailView.ts:527,558,404,508 | Context tab / tree menu | Kept - these are the doors that bind a source (the earned-upgrade affordance) |
| "Living Documents works on a folder... its documents, sources and agents" | screenRender.ts:835 (empty-project front door) | Folder open with zero docs | Kept - descriptive product framing on the empty-folder door, not a status claim; no lock/birth vocabulary |
| source-peek / provenance / "Source changed since last sync" / "Bound figures..." | livingDocRender.ts:520,946,971,1018,1023,1032,1051 | Only when the doc has bound sources/figures | Kept - the provenance/source-peek surface only renders for a living doc; unreachable on the plain-doc entry path |
| "Everything is in sync / Nothing needs your review right now" | screenRender.ts:731 (Home away-feed all-clear) | Home, when awayFeed present | Kept / deferred to L4 - this is review-state truth (nothing pending), not source-sync ceremony; changing the away-feed's semantics is L4 (quiet shell) territory |

## Which lock-writing paths existed, and how each respects the earned-upgrade rule

Every `_lockStore.write` / `_persist` site was traced (`livingDocsService.ts`):
- `_persist` (:5011, write at :5016) - the doc+lock pair writer. Callers are already-living or the moment of becoming living: `applySkillFix` (:660, guarded isLiving), `publishDocument` (:2801, living), `approve` (:4714, the first accepted agent edit = the earned-upgrade write), fan-out run loop (:3351, guarded isLiving at :3328).
- `_bootstrapLock` (:2192) - the entry-path save gate. Called from `saveRawText` (plain typing/save) and `_loadState`. Early-returns unless the doc declares bind keys or missing context. A plain `.md` has none -> no write (why plain typing never earns a lock). When a source IS bound it writes the initial lock - the silent upgrade. Live-verified: binding `context: [research.md]` in ideas.md then opening it wrote `ideas.lock.json` (context entry + reviewedHash); notes.md (still plain) got none.
- docx import (:2035) - provenance-from-birth; imported doc IS living (doc 22). Unchanged.
- rename-dependent rewrite (:1255), publish/snapshot (:2841), override-audit writes (:2886,2912,2939) - all on already-living docs / the agent-edit trust grammar. Untouched (byte-for-byte once living).

No lock-writing path was added or reordered. The rule is now stated in `docHasEarnedLiving` and consumed by the parser; the write gates were already correct and left surgically intact.

## Verification results

- typecheck-client: clean (0 errors).
- `./scripts/test.sh --grep "livingDocs"` (case-sensitive; catches new `livingDocs earned-upgrade rule` + updated `livingDocs screenRender`): 144 passing, 0 failing.
- `./scripts/test.sh --grep "LivingDocsService"`: 140 passing, 1 failing - the single failure is the known pre-existing #203 (`a fan-out with the model down...`), identical on main. No new failures.
- `npm run valid-layers-check`: clean (exit 0).
- `./scripts/check-seams.sh`: OK - all shell seams intact (0 core patches; stayed inside src/vs/workbench/contrib/livingDocs/).

### Live E2E (launch skill, fresh empty seed profile, workspace /tmp/lp-l3-docs, broker on :8090)
The livingDocs surface is a webview OOPIF; the top-level rails were driven with @playwright/cli, the editor prose body with raw CDP Input.dispatchMouseEvent / dispatchKeyEvent at device-pixel coords.

- (a) create/edit/save a plain doc -> zero artefacts on disk. Landed in the editor on the user's own plain notes.md (L1). Typed a line into the prose via CDP and saved (Cmd+S) - the edit persisted to notes.md, and `find /tmp/lp-l3-docs -name "*.lock.json"` returned nothing. Screenshots a1-entry-editor.png, a2-typed-no-lock.png.
- (b) entry-path copy sweep clean. Editor top bar shows the file breadcrumb, no sync pill, no "Living Document". Context tab: "Connect a data source...". Review tab: "...it lands here for you to review." Home: brand + Present, no "All sources synced" pill. Screenshots a1, b1-context-tab.png, c1-home.png.
- (c) bind a source -> lock appears silently + History/provenance work. Added `context: [research.md]` frontmatter to ideas.md and opened it; ideas.lock.json appeared (context entry + reviewedHash + reviewedAt), written silently with no dialog. The editor then showed the earned "All sources synced" pill, the Context tab listed research.md (current), and History showed "VERSION HISTORY / No versions yet - changes you approve will appear here." Screenshots d1-living-context.png, d2-living-history.png.
- (d) rails truthful in both states. Plain notes.md: no pill, "Connect a data source", "No changes waiting". Living ideas.md: earned pill, bound-source list, live History. Both truthful; no fabricated state either way.

## Deliberately left to other slices / deviations
- The Home away-feed "Everything is in sync" all-clear (screenRender.ts:731) is review-state, not source ceremony; its rewrite belongs to L4 (quiet shell) if anywhere. Left untouched to keep the diff surgical.
- The demo path (generateDemoReport) legitimately writes lock files - the demo doc IS living. Untouched; reachable only via the demoted Home card post-L1.
- The agent-edit trust grammar (diff/approve/provenance) is byte-for-byte unchanged; the earned-upgrade write in `approve` is the existing `_persist` call, not a new path.

## Screenshots
docs/qa/2026-07-20-light-path/03-l3/screenshots/: a1-entry-editor.png, a2-typed-no-lock.png, b1-context-tab.png, c1-home.png, d1-living-context.png, d2-living-history.png.
