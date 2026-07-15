# Plan 40 A2 - Export: unstub docx, add PDF (issue #130)

What was verified for doc 22 §6 (Export), and how - live vs unit-level.

## Acceptance criteria (doc 22 §6)

| Criterion | Status | Evidence |
|---|---|---|
| docx export produces a Word file with headings/lists/tables/images mapped to built-in styles, bound values inlined, no Abstract chrome | Verified (node + real OOXML reader) | `Weekly Operating Summary.export.docx`, `docx-textutil-extract.txt`, `scripts/test/lwd-docx.test.js` |
| PDF export ships via desktop print-to-PDF of the HTML export | Verified at unit + type level; live print is desktop-only (not driven here) | service tests + `printToPDF` on `INativeHostService` compiles/typechecks; see "PDF" below |
| The before-export reconcile gate applies to both; "Export anyway" is audited | Verified (service tests) | `exportDocx honours the before-export gate...` in `livingDocsService.test.ts` |
| gdoc/gsheet/xlsx remain honest "SOON" rows | Verified (render-harness test) | `Present offers the four real exports... keeps gdoc/gsheet/xlsx "Soon"` in `livingDocRender.test.ts` |

## docx - verified live at the byte level (the pure node path)

The writer is a zero-dependency Node module, `scripts/lwd-docx.js` (hand-rolled WordprocessingML + a
store-method ZIP with CRC32). It is proven end-to-end without a workbench build:

- **`node scripts/test/lwd-docx.test.js` -> OK.** Walks the ZIP central directory (CRC-validates every
  part), then asserts document.xml maps onto Word's BUILT-IN styles (Title, Heading 2, List Bullet, List
  Number, Table Grid, Quote, Hyperlink), that styles.xml defines the full set incl. Heading 1 (so the
  receiving org can restyle), that the leading `# title` is promoted to Title and rendered exactly once,
  that the GFM table, nested list, hyperlink and embedded image all land, and that **no `bind:` /
  provenance / diff chrome** reaches the output.
- **`unzip -t "Weekly Operating Summary.export.docx"` -> "No errors detected".** The archive is a valid ZIP
  with all OOXML parts + `word/media/image1.png`.
- **`textutil -convert txt` (macOS's own OOXML reader) -> `docx-textutil-extract.txt`.** A real Office-format
  consumer parses the whole document: title/subtitle, both `##` headings, the KPI table with the inlined
  bound value (`$48.6k` - flattened from a `bind:` link exactly like the Markdown export), the nested list,
  the ordered list, and the block quote. This is the "opened it and confirmed structure + built-in styles +
  inlined values + no chrome" check.

The **proxy route** (`POST /export/docx` in `scripts/lwd-anthropic-proxy.js`) was smoke-tested live: starting
the proxy and `curl`-ing the route with a resolved-Markdown body returned a valid `.docx`
(`content-type: application/vnd.openxmlformats-officedocument.wordprocessingml.document`, passes `unzip -t`).

The **service wiring** (gate -> resolved Markdown -> POST -> write beside the doc) is proven by four service
tests in `livingDocsService.test.ts`: docx posts the resolved Markdown (values inlined, no bindings) and
writes the `.docx`; docx honours the gate (blocked unforced, `via:override` audit when forced).

## PDF - verified at unit + type level; live print is inherently desktop-only

PDF renders the existing self-contained HTML export through Electron's `webContents.printToPDF`, which is a
**main-process capability**: the renderer cannot produce PDF bytes silently (`window.print()` opens a dialog
and yields nothing). So a live PDF requires a full desktop/Electron build, which was **not driven in this
environment**. What IS verified here:

- `printToPDF(html)` added to `INativeHostService` + implemented in `nativeHostMainService.ts` (offscreen
  hidden `BrowserWindow` loads the HTML via a data URL, prints, returns bytes, fail-soft) - compiles,
  typechecks, and passes `valid-layers-check`.
- The browser service reaches it through the desktop-only command `_livingDocs.printToPDF`
  (`electron-browser/livingDocsPdf.contribution.ts`), so it carries no desktop dependency.
- Two service tests: `exportPdf` hands the resolved self-contained HTML to the print command and writes the
  `.pdf`; and on the web dev harness (command absent) `exportPdf` is an honest no-op that writes nothing.

To confirm PDF live, run the desktop build (`TMPDIR=/tmp` + the launch skill), open a living doc, and pick
"Export as PDF" from Present & export - the file writes beside the document.

## Gate + "SOON" honesty

- The reconcile gate is REUSED unchanged (`_gateExport` wraps the existing `_beforeExportGate` /
  `_auditGateOverride`); both new formats block unforced and audit `via:override` when forced.
- The present modal keeps gdoc/gsheet/xlsx as non-selectable "SOON" rows (render-harness test).

## Checks

`npm run typecheck-client` clean; `npm run valid-layers-check` clean; the LivingDocs export + gate + modal
tests pass (9/9 for the export subset). Five failing tests in the broader livingDocs suite
(`livingDocSse` `parseSseChunk`, `screenRender` onboarding/home) are **pre-existing** on `origin/main` - those
files are not in this change's diff.
