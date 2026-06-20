# Living Documents spike — continuation (items 0-5)

> This is the handoff prompt that drove the build of items 0-5 (Markdown-by-default, multi-doc
> fan-out, WYSIWYG, live API source, export, Studio skin). Captured verbatim for the record.
> Outcomes are recorded in `00-spike-plan-and-outcomes.md` and `../02-what-we-built.md`.

---

You are continuing a research spike that forks VS Code into an AI-native, data-bound
word processor ("Opportunity OS" / "Living Documents"). Read these first:
- Plan: /Users/tommy/.claude/plans/back-okay-so-i-ve-generic-wigderson.md
- Memory: opportunity-os-living-docs, abstract-vscode-spike-build, living-docs-fullapp-decisions

## Repo / branch / build
- Repo: /Users/tommy/Sites/abstract-vscode-spike   Branch: living-docs-spike (NOT merged to main)
- Node 24.15.0 REQUIRED: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.15.0`
- Watch build (background): `npm run watch`   Type-check: `npm run typecheck-client`
- Unit tests: `./scripts/test.sh --grep "LivingDocsService"`
- Desktop run: `./scripts/code.sh ./living-docs-sample "./living-docs-sample/Weekly
  Summary.living.md"`
- Visual verify without a GUI: serve web build `./scripts/code-web.sh ./living-docs-sample`
  (listens on http://localhost:8080) and drive it with the chrome-devtools MCP tools.
- Conventions (hygiene blocks commits otherwise): tabs only — even inside template
  literals (use single left-aligned template strings); NO non-ASCII in source (HTML
  entities or ASCII); DI constructor params: non-service args BEFORE @IService args.
- Work in steps; commit after each item; keep type-check + unit tests green each time.
  End commit messages with: Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>

## Current code (all under src/vs/workbench/contrib/livingDocs/)
- common/livingDocsModel.ts, common/livingDocs.ts (service iface + view IDs),
  common/livingDocMarkdown.ts (parse/serialize .living.md)
- browser/livingDocsService.ts (the loop: CSV -> propose -> figures auto-apply,
  meaning-changes queue -> approve/audit; model via ILanguageModelsService w/ heuristic
  fallback; revealSource selects the source row)
- browser/livingDocEditor.ts (webview EditorPane), browser/livingDocRender.ts (HTML)
- Sample: living-docs-sample/ (metrics.csv + Weekly Summary.living.md)
- Tests: test/browser/livingDocsService.test.ts (4 passing)

## Work items — implement in order, one commit each, with tests where sensible.

ITEM 0 (do FIRST — reported bug): Open Markdown in our editor by default + rendered/raw toggle.
- Symptom to reproduce: opening a .md from the Explorer shows nothing useful; today our
  editor only claims **/*.living.md, so plain .md opens in the default text editor.
- Make our Living Document editor the DEFAULT editor for .md files (RegisteredEditorPriority),
  but keep "Edit as plain Markdown" reachable. Decision to make + document: claim all *.md
  vs only *.living.md — recommend claiming *.md as default with an easy opt-out, since the
  product is a word processor. Don't break opening README-style files into raw text.
- Render GENERIC markdown (headings, paragraphs, lists, bold/italic, code) even when the
  file has no frontmatter/bindings, so any .md renders instead of showing blank. Currently
  the renderer assumes living-doc structure — fix that so a plain .md isn't empty.
- Add an in-editor TOGGLE in the doc top bar: "Rendered" <-> "Raw Markdown". Raw mode shows
  an editable plaintext/Monaco view of the source; edits round-trip back through
  parse/serialize. (Reuse VS Code's reopen-with or an internal mode switch — your call.)
- Verify by opening both Weekly Summary.living.md and a plain .md from the Explorer.

ITEM 1: Multi-document fan-out / propagation.
- When a source changes, re-derive EVERY bound document in the workspace, not just the open
  one. Add 1-2 more bound docs to the sample (e.g. Board Note.living.md sharing the KPI
  section). Aggregate pending changes across docs in the Review rail (group by document).
- Acceptance: changing metrics.csv surfaces pending changes for multiple docs; approving one
  doesn't touch the others; audit trail spans documents.

ITEM 2: Editable WYSIWYG on the Markdown model.
- Today the rendered view is read-only. Make blocks editable in the rendered view and write
  edits back to the .md (via serialize). Per living-docs-fullapp-decisions, prefer building
  on VS Code's own primitives (notebook-cell / text-buffer / decorations) over a 3rd-party
  editor like TipTap. Start with editing non-bound prose blocks; keep bound blocks driven by
  the source.

ITEM 3: A second, live source type beyond CSV (API / Sheet via MCP).
- Bind a block to a non-file source using the existing ILanguageModelToolsService / MCP path
  the Agent Host ships. Prove "bound to a CRM/an API", not just a local file. Add a
  source-kind abstraction so bindings can target file | api | mcp.

ITEM 4: Export (Google Docs / Word / hosted page).
- Add export of a Living Document to at least one of: Google Docs, .docx, or a static hosted
  HTML page. Forces the Markdown model to be export-clean. Add an "Export" action to the doc
  top bar. (Google Drive MCP tools are available in this environment.)

ITEM 5: De-IDE the shell into the calm "Studio" skin (strategic test).
- Hide activity bar / editor tabs / dev chrome (try workbench.experimental.modernUI +
  floatingPanels), rebrand product.json (nameShort/nameLong/icon — test carefully, it changes
  the user-data dir), set the indigo accent. GOAL: measure how hard fighting VS Code's
  IDE-ness is, and write findings into the plan file — this informs the keep-the-fork vs
  rebuild-on-web decision. Timebox it.

After all items: summarize results, run the full verify, and propose the next set.

---

## How it actually went (one-line per item)
- **0 done** — default editor for `*.md`, generic Markdown render via VS Code's `renderMarkdown`, Rendered/Raw toggle round-trips. Verified.
- **1 done** — service re-keyed by resource; fan-out across all bound docs; rail grouped by document; approve isolates. Verified.
- **2 done** — `contenteditable` on headings + non-bound prose, writes back via serialize; bound blocks locked. Verified.
- **3 done** — `file|api|mcp` binding kinds; `api` fetched the **real GitHub API** via `IRequestService` and filled a `{cell}` template; `mcp` stubbed. Verified live.
- **4 done** — Export to a self-contained HTML page. Verified.
- **5 done** — calm shell via workspace settings + display-only product.json rebrand; findings written up. Verified.

13 unit tests passing; each item one commit on `living-docs-spike` (PR #1 to `main`).
