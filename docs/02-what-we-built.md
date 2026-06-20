# 02 — What we built (items 0-5)

Two phases of work. **Phase 1** (a prior session) built the thin vertical slice: the `.living.md`
editor, the agent loop, the review rail, provenance, the real-model commentary rewrite. **Phase 2**
(this session, items 0-5) extended and stress-tested it. Everything below is on branch
`living-docs-spike` (PR #1 -> `main`), one commit per item, 13 unit tests passing, each verified
end-to-end in the web build via the chrome-devtools MCP.

## Phase 1 — the vertical slice (pre-existing at the start of this session)
- `.living.md` portable-Markdown model + parse/serialize.
- Webview editor pane rendering the doc with bound spans, provenance dots, inline red/green diffs.
- The agent loop: CSV -> propose -> figures auto-apply, meaning-changes queue -> approve/audit.
- Real language-model path for narrative rewrites (`ILanguageModelsService`) with a heuristic
  fallback; provenance click reveals + selects the source row.

## Item 0 — Open Markdown by default + Rendered/Raw toggle
**Why:** opening a plain `.md` showed nothing useful — our editor only claimed `*.living.md`, so
ordinary Markdown opened in the default text editor; and the renderer assumed living-doc structure.
**What:**
- Our editor is now the **default for every `*.md`** (`RegisteredEditorPriority.default` +
  `canSupportResource`); "Reopen With -> Text Editor" stays reachable, so README-style raw editing
  is never blocked.
- **Generic Markdown renders** (headings/prose/lists/bold-italic/code/links/blockquote/tables) by
  reusing VS Code's sanitizing `renderMarkdown` — a plain `.md` is no longer blank.
- A top-bar **Rendered <-> Raw Markdown** toggle. Raw mode is an editable textarea over the
  verbatim source; edits round-trip through `saveRawText` -> parse.
- `isLiving` detection: frontmatter `livingDoc: true` OR any binding; plain docs skip source
  loading and hide the status pill / Refresh.
**Verified:** `Team Notes.md` renders as rich prose; a raw edit persisted and re-rendered; the
Living Document still renders structurally.

## Item 1 — Multi-document fan-out
**What:** the service is keyed by document resource; one source change re-derives **every** bound
doc in the workspace (discovery scans loaded docs' directories for `*.living.md`). Proposed changes
and audit entries carry `docId`/`docTitle`; the Review rail **groups pending changes by document**
and the audit spans documents. Approving one document's change leaves the others untouched; each
doc persists its own `<stem>.audit.json`.
**Sample:** added `Board Note.living.md` (shares the KPI section + a bound commentary).
**Verified:** one Refresh surfaced grouped pending changes for Weekly Summary + Board Note;
approving Weekly left Board Note pending; audit spanned both.

## Item 2 — WYSIWYG on non-bound prose
**What:** the rendered view is no longer read-only. Headings and **non-bound** paragraphs are
`contenteditable` and write back to the `.md` via serialize (`editBlock`); Enter commits (blurs)
rather than inserting a newline. **Bound blocks stay source-driven** and are not hand-editable —
preserving the provenance guarantee. Built on VS Code primitives only (no TipTap).
**Verified:** edited "What to watch" inline -> persisted + re-rendered; bound blocks exposed no
editing affordance.

## Item 3 — Live API source kind (file | api | mcp)
**What:** bindings gained a **source-kind abstraction**. The `api` kind fetches a real HTTP
endpoint via `IRequestService`, parses JSON, and substitutes live values into the block's `{cell}`
placeholder template (auto-applied as a figure, audited `via: 'api'`; the template is kept on disk
so values re-derive next refresh). `mcp` is parsed and round-trips but resolution is stubbed
pending an MCP server. Sample: Weekly Summary gained an "Ecosystem signal" block bound to the
GitHub repo API — one document, two source kinds.
**Verified LIVE:** Refresh filled the block with **real GitHub star/issue counts** from
`api.github.com` — even in the web build (GitHub's permissive CORS allowed it).

## Item 4 — Export to a self-contained HTML page
**What:** a top-bar **Export** action renders the document's *resolved* state to a standalone,
shareable HTML page (`<stem>.export.html`) — inline styles, no IDE chrome, no provenance dots, no
diff/edit affordances, clean KPI table. Chose hosted HTML (over Google Docs / .docx) so export is
self-contained and needs no runtime auth; a Drive/MCP exporter can drop in behind the same call.
**Verified:** Export created and opened `Weekly Summary.export.html`.

## Item 5 — The calm "Studio" skin (the strategic test)
**What:** stripped the IDE chrome via reversible **workspace settings** (`.vscode/settings.json`):
`modernUI` on, activity bar hidden, editor tabs none, editor actions hidden, layout control off,
status bar off, menu bar hidden, command center off, breadcrumbs/minimap off, indigo accent via
`colorCustomizations`. Plus a **display-only** `product.json` rebrand to "Opportunity OS"
(`nameShort`/`nameLong`; `applicationName`/`dataFolderName` left alone — those move the user-data
dir). The key deliverable was the **findings** (see [03](03-learnings.md)).
**Verified:** the shell goes genuinely calm (no activity bar/tabs/menu/status bar, rounded modernUI
panels, indigo controls). Caveat: the web server caches `product.json`, so the rebrand needs a
restart to show in the title.

## Verification approach
Throughout: `npm run typecheck-client` + `./scripts/test.sh --grep "LivingDocsService"` green, and
the web build (`./scripts/code-web.sh ./living-docs-sample` on :8080) driven and screenshotted with
the chrome-devtools MCP. The unit tests use mocked `IFileService`/`IRequestService`/etc. so the
core loop (derive/approve/reject/fan-out/api-fill/export) is covered headlessly.
