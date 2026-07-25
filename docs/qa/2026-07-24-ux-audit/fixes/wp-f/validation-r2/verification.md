# WP-F (#256, PR #269) - Validation round 2 (adversarial, live desktop)

Independent round-2 validator. Did not trust the fix-round conversation. HEAD validated: `84e3c6de89f9807ae08a4f0ef668a4d3986368a1` (matches `gh pr view 269 --json headRefOid`).

The fix-round implementer could not launch the desktop app (disk pressure) and verified only in a browser test runner. This round performed the live desktop walk that was missing.

## How the walk was driven

- Launched Code OSS from the `wp-f-paste-fidelity` worktree via the `launch` skill against a private `/tmp` copy of `living-docs-sample`, after `npm run transpile-client`.
- The editor is a nested OOPIF: workbench page -> `iframe.webview` -> inner `iframe#active-frame` -> `.ProseMirror`. The inner document is reachable from the webview iframe's context via `af.contentDocument`, so real synthetic `ClipboardEvent('paste')` events (with a `DataTransfer` carrying `text/html` + `text/plain`) were dispatched onto the live `.ProseMirror` node - exercising the real bundle's `parseFromClipboard` -> `transformPasted` guard -> `replaceSelection` pipeline.
- Caret placement at the END of the repro paragraph was done by a synthetic mouse click at the paragraph's last text node plus a collapsed DOM Range (confirmed each time: `selAnchorText: " for the bound report."`, offset 22). An early harness bug that mis-placed the caret at doc-start was caught and fixed before any box was ticked - the results below are all with the caret verified at the true repro site.
- Between payloads the doc was restored from `git show HEAD:living-docs-sample/"Team Notes.md"` and reloaded from disk (the external-edit "Reload from disk" floor, which also incidentally verified that feature works).

Repro paragraph: the last block of `Team Notes.md`, `See the [Weekly Summary](...) for the bound report.` (a NON-EMPTY paragraph) - the exact round-1 failure site.

## Boxes 2 + 4 (the round-1 failures) - PASS

**Box 2 - a leading structural block lands as its own block, not glued.** Caret at END of the non-empty paragraph, four structural-first payloads:

| Payload (first block) | On screen | On disk (`Team Notes.md` tail) |
|---|---|---|
| MsoTitle (`class=MsoTitle`) | target paragraph intact, then `h1` "Quarterly Title Zed" | `...for the bound report.` then `# Quarterly Title Zed` then body para |
| MsoHeading1 | target intact, then `h1` "Pasted Heading One" | `# Pasted Heading One` as its own line |
| MsoHeading2 (H2 probe) | target intact, then `h2` "Second Level Heading" | `## Second Level Heading` |
| Word list (list-first probe) | target intact, then `ul` (two bullets) | `* First bullet item` / `* Second bullet item` |

In every case the target paragraph was byte-unchanged and the first pasted block kept its identity. No glue. The guard fires for every structural block type it claims (heading + list both proven live), not just headings.

**Box 4 - T1 combined (heading + bold + list + table).** Caret at END of the repro paragraph, pasted the combined payload:
- `h1` "Combined Report Heading" (own block)
- paragraph "Intro with **bold text** and normal words." (bold preserved -> `**bold text**` on disk)
- `ul` Alpha/Beta point
- `table` -> GFM pipe table `| Region | Value |` ... on disk, rendered as a real 2-column table on screen

All structure landed, persisted to disk, and survived a close+reopen (reopened editor re-read 13 blocks with the same structure; heading still its own block).

**Honesty notice (spot-check, was ticked round 1):** tracked-changes payload raised the toast "Pasted from Word: Paragraphs, The final text of tracked changes kept · Tracked-change marks (the final text was kept) not imported." and resolved paste-as-accepted (deleted run dropped, inserted "held flat" kept). A lossless Word payload raised NO Word-paste notice (`wordNoticeCount: 0`). The notice never cries wolf.

## Non-regression probes (the guard touches EVERY paste) - PASS

- **Short inline snippet mid-paragraph:** merged INLINE ("inserted words" + existing text in one paragraph); block count unchanged. The guard does not close the slice for a non-structural inline paste.
- **Plain-text paste:** merged inline at the caret ("...report.just plain pasted text"); unchanged. The `isPlainText` branch returns false (no close).
- **Paste into an EMPTY paragraph:** MsoTitle landed as its own `h1` in the empty paragraph; no glue. The `caretParentContentSize > 0` guard leaves the empty-paragraph path untouched.
- **Non-Word HTML (`<h1>` + `<table>`, no mso markers):** heading did NOT glue (`h1` "Web Page Heading" own block) and the table landed as a GFM table. The guard keys off the ProseMirror node type, so it is correctly not Word-specific.
- **Table cell:** the fork edits cells through a separate `<input class="lwd-cell-editor">` overlay, entirely outside the ProseMirror body paste path. Pasting structural HTML into an activated cell editor produced no rogue block and left the table and doc intact (block count unchanged) - sane.
- **Console:** no paste-related errors. The only console errors are pre-existing/unrelated dev-build noise (`localhost:8090/event` analytics-beacon CORS, generic `extensionId`/view-registry warnings) - none mention paste, transformPasted, ProseMirror or livingDoc.

## Unit tests (re-run at this HEAD)

After `npm run transpile-client`, `scripts/test.sh --grep "LivingDoc Word paste"` -> **33 passing, 0 failing**, including the `pasteStartShouldClose` decision-table test and the before/after E2E, the lossless-vs-drop notice test, the table colspan/rowspan/GFM round-trip tests, and the self-containment guard.

## Re-confirmation of round-1 ticks at this HEAD

- Box 1 (tables -> GFM incl. reopen): re-confirmed live - both the combined and non-Word tables serialised to GFM pipe tables on disk and survived reopen.
- Box 3 (plain / non-Word unregressed): re-confirmed live (plain-text and non-Word probes above).
- Box 5 (self-containment / enrichment carry-forward): re-confirmed via the 33-test suite.

None regressed.

## Verdict

**PASS** - all five checklist boxes verified live on the desktop app at HEAD `84e3c6de89f9807ae08a4f0ef668a4d3986368a1`.

T1 re-grade: the paste-from-Word structural-fidelity finding is **resolved**. A leading Word heading / list / table pasted at the end of a non-empty paragraph now keeps its block identity on screen and on disk, matching a real Word round-trip; honest about genuine drops; no regression to inline, plain-text, empty-paragraph, cell, or non-Word pastes.
