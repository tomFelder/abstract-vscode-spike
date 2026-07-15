# Verify - A1 docx -> Markdown import (issue #129, doc 22 section 2)

Honest record of what was and was not verified live, and how to reproduce it.

## What was verified live (real proxy, real .docx)

The conversion pipeline was exercised end-to-end against a **real `.docx`** through the **running proxy's** new `POST /import/docx` route (`scripts/lwd-anthropic-proxy.js`), on Node 24. The proxy was started on port 8097 and every fixture was POSTed as base64, exactly as the renderer service does.

Fixtures (built by hand as valid OOXML, no external tooling): a full-feature `.docx` with an H1/H2, a three-level nested bullet list, a numbered list, a GFM-able table (`Region | MRR`), **two embedded images** (a PNG and a GIF), a **tracked-changes** run (deleted "fell", inserted "rose"), and a **comment**; plus three refusal fixtures - a CFB/OLE `protected.docx`, a legacy `legacy.doc`, and an unparseable `broken.docx`.

Results (full transcript in `e2e-transcript.txt`, produced artefacts in `produced/`):

- [x] **A `.docx` offers Import; conversion writes `Name.md` beside the untouched original with `importedFrom` + `sourceHash` in the lock.** `produced/Weekly Summary.md` is the converted GFM body; `produced/Weekly Summary.lock.json` carries `imported.from = "Weekly Summary.docx"`, `imported.sourceHash`, `imported.importedAt`, and the kept/dropped summary. The original `Weekly Summary.docx` sits untouched beside it (the service copies nothing over it - it only ever writes a new `.md`).
- [x] **Images land in `assets/<doc>/` with relative references.** The body references `assets/Weekly Summary/image-1.png` and `assets/Weekly Summary/image-2.gif`; both files are in `produced/assets/Weekly Summary/` with their real bytes (lifted out of the data URIs mammoth inlined).
- [x] **A kept/dropped summary card shows; tracked changes import final text and say so.** The tracked-changes paragraph converted to **"Revenue rose sharply."** (deleted "fell" excluded, inserted "rose" kept - the FINAL text). The card reads: *Headings, Paragraphs, Lists, A table (display-only for now), 2 images, The final text of tracked changes kept - Comments, Tracked-change marks (the final text was kept) not imported.* The table is named display-only (until the #140 editing path), and the comment is named as not imported - both detected from the raw docx parts, so a caveat appears only when the document actually had it.
- [x] **`.doc`, password-protected, and unparseable files stay in the "not yet imported - {reason}" state; nothing mangles silently.** `protected.docx` and `legacy.doc` (CFB magic) -> "The file is password-protected or an older Word format"; `broken.docx` (PK header, corrupt zip) -> "The file could not be read as a Word document". All return `ok:false` with no file written - the service leaves the tree row untouched.

The pure conversion module (`common/docxImport.ts`) additionally has a unit suite (`test/browser/docxImport.test.ts`) covering headings/inline/links, nested lists, GFM tables, image lifting + unique names, block quotes, the honest kept/dropped summary, unknown-tag degradation, and markdown-character escaping. Because the worktree is not built, those assertions were also run directly against the source via Node type-stripping (all 8 pass) - the same inputs the mocha suite uses.

## What was NOT verified live, and why

- **No full VS Code desktop/web build.** The worktree was not compiled (a from-scratch Code-OSS build was out of scope for the time budget, per the handoff's "do not burn indefinitely"). So the **renderer-side surfaces were type-checked but not clicked in a running workbench**: the tree-rail "Import as Document" door + the bulk "Import All N Word Documents" button (`browser/treeRailView.ts`), the service orchestration `importDocx` (`browser/livingDocsService.ts`), and the sticky kept/dropped **notification card**. Their logic is exercised by the pipeline above (the service's convert -> write -> lock steps were reproduced 1:1 in `service-sim` to produce `produced/`), but the live UI click path is unproven. `npm run typecheck-client` is clean; `npm run valid-layers-check` shows **zero** violations in any changed file (its 75 errors are pre-existing DOM-lib noise in `services/dialogs/browser/fileDialogService.ts`, untouched here).
- **Summary card surface.** The card is delivered as a **sticky notification** carrying the plain-words kept/dropped line, plus the durable `imported.kept`/`imported.dropped` in the lock. An inline in-editor banner was judged a larger webview-render change than the acceptance criterion needs; the notification + lock provenance is the shipped honest surface. See the decision-log entry.

## Reproduce

```
export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"
LWD_PROXY_PORT=8097 node scripts/lwd-anthropic-proxy.js &   # start the proxy
# build fixtures + run the pipeline (scripts kept in the scratchpad during the run):
#   node --experimental-strip-types make-fixtures.mjs <dir>
#   node --experimental-strip-types e2e.mjs <dir>
#   node --experimental-strip-types service-sim.mjs <dir>   # writes the produced/ tree
```
