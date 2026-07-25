# WP-F fix round 1 - paste-slice open-boundary (heading first-block glue)

Issue #256, PR #269, umbrella #263. Validator FAIL: with the caret at the END of a non-empty paragraph ("...for the bound report."), the FIRST pasted block glued onto that paragraph as inline text and lost its heading level - reproduced with both `MsoTitle` and `MsoHeading1`.

## Root cause (confirmed at source)

The `rewriteWordHeadings` tag rewrite in `common/livingDocWordPaste.ts` is correct: a Word heading paragraph becomes a real `<hN>`, and pasted into an EMPTY paragraph it lands as a block. The defect is a ProseMirror paste-slice open-boundary problem at the insertion site. `livingDocRender.ts` calls `pmView.pasteHTML(cleaned)`, which runs the bundle's `doPaste` -> `parseFromClipboard`. There the slice is built with `Slice.maxOpen(...)`, giving it an OPEN start boundary (`openStart > 0`). `replaceSelection(slice)` then merges the first block's content into the caret's non-empty textblock - so a pasted `<h1>` flows into "...report." and loses its heading level.

## Fix (openStart close via the sanctioned transformPasted hook)

`installPasteBoundaryGuard(view)` registers a `transformPasted` editor prop through `view.setProps(...)`. The bundle's `someProp` checks direct view props before plugin props, so `parseFromClipboard` invokes it while building the slice. When the slice's FIRST top-level child is a STRUCTURAL block (heading / list / table_block / blockquote / code_block), the slice start is open, the paste is not plain text, and the caret's own textblock already holds content, the guard returns `new slice.constructor(slice.content, 0, slice.openEnd)` - a start-closed slice, so the leading block lands as its own block. Inline pastes, plain-text pastes, an already-closed slice, and a paste into an empty paragraph are all returned untouched.

The decision lives in one pure predicate `pasteStartShouldClose(...)` in `common/livingDocWordPaste.ts`, injected verbatim into the webview via `${String(...)}` (same seam as the normaliser) and unit-tested directly. No bundle edit, no core patch.

## Live E2E proof (real ProseMirror bundle, real DOM, real paste pipeline)

Driven through the actual `pasteHTML` -> `parseFromClipboard` -> `transformPasted` -> `replaceSelection` path in the browser unit-test environment; asserted on the Markdown the surface serialises (the exact bytes that reach disk).

Caret at end of the non-empty paragraph "Here is a sentence for the bound report.":

BEFORE (no guard - defect reproduced), MsoTitle first block:
```
Here is a sentence for the bound report.Quarterly Title Zed
```

AFTER (guard on), MsoTitle first block:
```
Here is a sentence for the bound report.
# Quarterly Title Zed
```

AFTER (guard on), MsoHeading1 first block:
```
Here is a sentence for the bound report.
# Heading First Golf
```

Non-regression - inline snippet still merges mid-paragraph:
```
Here is a sentence for the bound report.plus appended words
```

Non-regression - paste into an EMPTY paragraph keeps the heading as a block (unchanged):
```
# Quarterly Title Zed
```

All five behaviours verified live (5 passing). The BEFORE row proves the guard is load-bearing (removing it restores the glue).

## Unit tests

`livingDocWordPaste.test.ts` - 33 passing (was 32): added the `pasteStartShouldClose` decision-table test (structural blocks close the start on a non-empty line; paragraph / plain-text / already-closed / empty-paragraph / non-textblock all leave the slice untouched) and extended the self-containment guard to cover the new injected helper. All previously-ticked WP-F behaviours (Word tables -> GFM, honesty notice on real drops only, plain/non-Word paste, WP-C enrichment) remain green.

Ran headless in real Chromium via `test/unit/browser/index.js --run .../livingDocWordPaste.test.js --browser chromium`. Live desktop Electron launch was not used: the volume was at 96-100% (752MB free) with the 2-instance machine cap already consumed by a concurrent agent; the browser-runner E2E above exercises the identical bundle + paste pipeline in a real DOM and asserts the on-disk Markdown, which is a stronger check than a screenshot.
