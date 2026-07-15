# Plan 40 A3 - Spreadsheets as CSV sources + PDF as read-only context (issue #131)

Verification evidence for doc 22 §4/§6. Everything here is produced by the real extraction engine
(`scripts/lwd-source-extract.js`) run through the real libraries (SheetJS + pdf-parse), the same code
the proxy routes call. Regenerate with the snippet at the bottom.

## What was built (files)

- `scripts/lwd-source-extract.js` - the pure node extraction + parsing-floor engine (encoding/BOM,
  delimiter sniffing, US/EU number + currency + parenthesised-negative parsing, date normalisation,
  workbook -> per-sheet CSV, PDF text with image-only detection). Dependency-injected (SheetJS +
  pdf-parse passed in) so it is unit-testable.
- `scripts/lwd-source-extract.test.js` + `scripts/lwd-source-extract.fixtures.js` - the `node --test`
  suite (10 tests) and the real-PDF fixture generators.
- `scripts/lwd-anthropic-proxy.js` - additive routes `POST /sources/xlsx` and `POST /sources/pdf`
  (lazily require the libraries; a proxy without them still serves the model routes and returns 501).
- `src/vs/workbench/contrib/livingDocs/common/treeRail.ts` - workbooks/PDFs classify as SOURCES rows
  with a `use-xlsx` / `use-pdf` action instead of dead "Not yet imported" rows.
- `src/vs/workbench/contrib/livingDocs/browser/treeRailView.ts` - the inline "Use as source" affordance.
- `src/vs/workbench/contrib/livingDocs/browser/livingDocsService.ts` - `useXlsxAsSource`,
  `usePdfAsSource`, `resolveWorkspaceExtra`, the correlated workbook watcher + re-extract, the
  extraction manifest, the PDF text cache read by `_readContext`, and the workbook provenance hop in
  `getSourcePeek`.
- `src/vs/workbench/contrib/livingDocs/common/livingDocs.ts` - the new interfaces
  (`IWorkbookProvenance`, `IWorkbookUseResult`, `IPdfContextResult`, `IExtractedSheet`) + method decls.

## Acceptance criteria (doc 22 §6 - Spreadsheets)

- [x] **An `.xlsx` offers "Use as source"; sheets extract to `data/<workbook>/<sheet>.csv`; the
  workbook is watched and re-extracts on hash change, flagging dependents.**
  - Tree classification proven by `treeRail.test.ts` ("Use as source" action) and the browser service
    test `useXlsxAsSource extracts each sheet to data/<workbook>/<sheet>.csv...` (writes
    `data/Budget/FY26.csv` + `.abstract-source.json`).
  - Extracted CSV artefacts: `Budget__FY26.csv`, `Budget__EU.csv`, `Budget__Merged Headers.csv`
    (the `Budget__` prefix here is only to flatten the folder for the artefact dir; on disk they land
    under `data/Budget/`).
  - Workbook watching + re-extract + dependent flagging: `_watchWorkbook` (correlated
    `fileService.createWatcher`) -> `_reextractWorkbook` -> `_orchestrator.onSourceChanged` per CSV.
- [x] **The provenance drawer shows figure → CSV row → workbook chain.**
  - Browser test `the provenance drawer shows the figure → CSV row → workbook chain...`:
    `getSourcePeek` returns `{ source: 'data/Budget/FY26.csv', workbook: { workbook: 'Budget.xlsx',
    sheet: 'FY26' }, value: '2000' }`.
- [x] **Delimiter/encoding/number-format parsing floor holds; merged-header sheets warn.**
  - `Budget__FY26.csv`: `$1,234.56 -> 1234.56`, `(430) -> -430`, `2.4% -> 2.4%`, dates ISO-normalised.
  - `Budget__EU.csv`: European `1.234.567,89 -> 1234567.89`.
  - `messy-european.csv -> messy-european.normalised.csv`: BOM + `;`-delimited + Windows-1252 (`Acme's`
    curly apostrophe preserved) + European decimal + day-first date -> clean comma CSV.
  - `Budget__Merged Headers.csv` carries the named warning "This sheet has merged header cells - values
    may misalign with their columns." (see `extraction-manifest.json`), never a silent misread.
- [x] **PDF sources contribute extracted text as context edges, appear in SOURCES with freshness, and
  name themselves unreadable when image-only.**
  - `board-pack.pdf` (text) -> readable text; `scanned-invoice.pdf` (no selectable text) -> "This PDF
    has no selectable text - it looks scanned or image-only." (see `extraction-manifest.json`).
  - Browser test `usePdfAsSource registers a readable PDF as a context edge...`: a readable PDF becomes
    a `context:` edge + its text is cached under `.abstract/knowledge/` (read by `_readContext`); an
    image-only PDF names itself unreadable and creates NO edge.

## What was verified live vs. by test

- **Live (curl against a running proxy on 8092):** `POST /sources/xlsx` returned the clean normalised
  CSV; `POST /sources/pdf` returned the text for a text PDF and `readable:false` with the scanned
  reason for an image-only PDF.
- **`node --test scripts/lwd-source-extract.test.js`:** 10/10 pass (parsing floor + workbook extraction
  + PDF readable/image-only/password branches, against real SheetJS + real pdf-parse).
- **Browser unit tests (`./scripts/test.sh`):** the 3 new `LivingDocsService` tests + the new
  `treeRail` test pass; the full `LivingDocsService` suite (130) and `treeRail` suite (8) stay green -
  no regressions.
- **`npm run typecheck-client`:** clean. **`npm run valid-layers-check`:** no new errors from this
  change (the pre-existing `fileDialogService.ts` DOM-typing errors are an environmental worktree
  artefact - a clean checkout of the same base commit reproduces them without this change).

## Not verified live (and why)

- The end-to-end **desktop UI click** ("Use as source" in the running workbench, the toast, the
  provenance drawer rendered on screen) was not driven live. The renderer logic is proven by the
  browser unit tests over the real service (with in-memory file + mocked-proxy fakes) and the proxy
  routes are proven by live curl; a full Electron smoke of the click was out of scope for the time
  box (doc 22 §6 fallback). No behaviour depends on an unverified path: the write/watch/provenance
  logic is exercised by the service tests, the parsing by the node tests, the transport by curl.

## Regenerate the artefacts

```
export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"
node --test scripts/lwd-source-extract.test.js
# the artefact generator lives in the PR description / this task's history; the CSVs above are its output
```
