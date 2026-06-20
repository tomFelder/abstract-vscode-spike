# 01 — Architecture

All spike code is one additive contribution: `src/vs/workbench/contrib/livingDocs/`, registered by
a single import in `src/vs/workbench/workbench.common.main.ts`. No existing VS Code behaviour was
changed (the only edits outside the contribution are the registration import, `product.json`
display names, and the sample workspace's `.vscode/settings.json`).

## File map

```
src/vs/workbench/contrib/livingDocs/
  common/
    livingDocsModel.ts      Data model: ILivingDoc, ILivingDocBlock, ILivingDocBinding (sourceKind
                            file|api|mcp, url, tool), IProposedChange (docId/docTitle/blockLabel),
                            IAuditEntry (docTitle, via model|heuristic|api), IKpiRow.
    livingDocs.ts           Service interface (ILivingDocsService) + view/container IDs.
    livingDocMarkdown.ts    parse/serialize the portable .living.md format (frontmatter + HTML-comment
                            bindings + {cell} templates for api blocks).
  browser/
    livingDocsService.ts    THE BRAIN. Holds every loaded doc (Map keyed by URI). The loop:
                            load -> derive (figures auto-apply, narrative -> model/heuristic propose,
                            api -> fetch+fill) -> queue meaning-changes -> approve/reject -> audit ->
                            persist. Also: revealSource (provenance), saveRawText, editBlock,
                            exportDocument, multi-doc discovery + fan-out.
    livingDocEditor.ts      Webview EditorPane. Per-resource render; relays webview messages
                            (refresh / reveal / setMode / applyRaw / edit / export) to the service.
    livingDocRender.ts      Pure HTML rendering: the in-editor view (topbar + structured doc OR
                            generic Markdown via VS Code's renderMarkdown + raw textarea) and the
                            standalone export page (renderExportHtml).
    reviewRailView.ts       Auxiliary-bar ViewPane: pending changes grouped by document + audit trail.
    livingDocEditorInput.ts EditorInput for the editor pane.
    livingDocs.contribution.ts  Registers the singleton service, the editor pane, the *.md editor
                            resolver (default priority), the review-rail view container, config.
  test/browser/livingDocsService.test.ts   13 unit tests over the service + markdown round-trip.
living-docs-sample/         Sample workspace: metrics.csv, Weekly Summary.living.md, Board Note.living.md,
                            Team Notes.md (plain), .vscode/settings.json (the "Studio" skin).
```

## The service (the loop in detail)

`LivingDocsService` is a singleton shared by the editor pane(s) and the review rail.

- **State:** `Map<uriString, IDocState>` where a doc state holds the parsed doc, raw text, the
  bound CSV rows, the "recently auto-applied" set, and a status string. Pending changes and the
  audit are global lists, each entry tagged with `docId`/`docTitle` so they fan across documents.
- **loadDocument(uri):** read file, parse; if it's a Living Document, also read the CSV source.
- **refreshFromSources():** discover every `*.living.md` in the workspace (scan the directories of
  loaded docs via `IFileService.resolve`), then re-derive each:
  - **KPI table + synced week** -> pure figures, auto-apply.
  - **`p-highlights` figure paragraph** -> recompute from CSV numbers, auto-apply.
  - **api/mcp blocks** -> `_deriveLiveBlocks`: fetch the endpoint (`IRequestService` -> `asJson`),
    substitute live values into the block's `{cell}` template, auto-apply (audited `via: 'api'`).
  - **narrative blocks** -> `_proposeCommentary`: ask `ILanguageModelsService` to rewrite+classify
    (JSON: newText/kind/confidence/rationale), with a deterministic heuristic fallback when no model
    is available. `kind: figure` auto-applies; `kind: meaning` queues for approval.
- **approve/reject(changeId):** apply (or not) to the change's own document, append an audit entry,
  persist that document's file + `<stem>.audit.json`.
- **revealSource(uri, cells):** open the bound CSV beside the doc and select the synced-week row.
- **editBlock / saveRawText / exportDocument:** WYSIWYG edit of non-bound prose, raw-Markdown
  round-trip, and the HTML export.

The agent orchestration is **thin and purpose-built** (re-derive bound blocks -> classify
figure-vs-meaning -> propose -> fan out), reusing the model service / request service rather than
bending VS Code's generic code-edit session handler. This was a deliberate decision
(see [07](07-decision-log.md)).

## The view layer

- **livingDocEditor** is a `webview` EditorPane. It does NOT hold document state — it renders by
  asking the service for `getDoc(resource)` etc., so multiple documents can be open and each pane
  renders its own resource. Edits/actions are webview `postMessage`s relayed to the service.
- **livingDocRender** is pure (string in, HTML out) and has three jobs: the structured living-doc
  view, the generic-Markdown view (delegated to VS Code's sanitizing `renderMarkdown` so any plain
  `.md` renders), and the standalone export page.
- **reviewRailView** is a normal VS Code `ViewPane` in the auxiliary (secondary) side bar. It reads
  `getAllPending()` and groups by `docTitle`, plus the audit trail.

## The `.living.md` file format (current)

A Living Document is portable Markdown:
- **YAML-ish frontmatter** for doc scalars: `title`, `subtitle`, `source`, `syncedWeek`,
  `livingDoc: true`.
- **Bindings live in HTML comments** before the block they annotate, so the file still renders in
  any Markdown viewer:
  - `<!-- bind id=p-highlights kind=figure cells=mrr,signups,churn -->`
  - `<!-- bind id=p-eco kind=figure src=api url=https://... cells=stars,issues -->` (api block;
    the following line is a `{cell}` template)
  - `<!-- table id=kpi-table cells=mrr,signups,churn,active -->`
- **Provenance/audit** is NOT in the Markdown — it's a sidecar `<stem>.audit.json`.

This format is a known tension point — see [05-open-questions.md](05-open-questions.md). It is
neither fully clean Markdown (it smuggles metadata, shows `{cell}` placeholders on disk) nor a
natural home for rich structure once WYSIWYG matures.

## Reuse map (what we leaned on, didn't rebuild)

- Editor shell: `EditorPane`/`EditorInput`, webview service.
- Markdown rendering: `vs/base/browser/markdownRenderer` (`renderMarkdown`, sanitized).
- Views/auxiliary bar: `views.ts` registries, `ViewPane`.
- Model loop: `chat/common/languageModels` (`ILanguageModelsService`).
- HTTP: `platform/request/common/request` (`IRequestService`, `asJson`).
- Calm shell: `contrib/styleOverrides/` (the build's `workbench.experimental.modernUI` CSS) +
  workbench settings.
