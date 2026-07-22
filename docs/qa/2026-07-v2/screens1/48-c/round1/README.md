# 48-c "Template flows" - round 1 evidence

Bundle 48-c (PR #233): T2.4 Use · T2.5 Save-as-template · T2.6 discovery · H2.3u Home Review deep link · TC.1 header copy · TR.1 suite clean.

## Method + a known live-harness limitation

The four gate checks (`typecheck-client`, `test.sh --grep livingDocs`, `valid-layers-check`, `check-seams.sh`) all pass; see the PR comment for counts.

Live driving used `@vscode/test-web` on `localhost:8080` (`./scripts/code-web.sh ./living-docs-sample`) driven by the bundled Chromium via Playwright (Chrome MCP was unavailable in this environment, same as 48-b). In headless mode the File-System-Access folder handle for `./living-docs-sample` does **not** register (`No file system handle registered (/living-docs-sample)`), so the workbench shell loads fully and styled but the folder's documents/templates are not read. Consequently:

- The **shell, header, Templates surface, STARTERS row, sub-line, filter field, and the light path** (cold start lands in the editor) render live and are captured here.
- The **card-level round trips** (Use duplicates → needs-binding; Save-as-template writes to `.abstract/templates/` → appears in grid → dedupe; Home Review deep-link) need discovered folder documents, which the headless FSA mount cannot provide. These are proven honestly at the **service layer** against the in-memory file system in `livingDocsService.test.ts` + the pure builders in `livingDocMarkdown.test.ts` + the reveal reducer in `editorWebviewProtocol.test.ts` (all green).

## Screenshots (1440×900 unless noted)

| File | What it shows |
|---|---|
| `01-light-path-editor-1440.png` | Cold start lands in the numbered-gutter editor (light path intact, do-not-break). |
| `02-templates-new-template-header-1440.png` | Templates surface; header action reads **"＋ New template"** (TC.1, verified live), sub-line + filter + STARTERS present. Empty "YOUR TEMPLATES" because the headless FSA mount read no `templates/`. |
| `03-templates-1760.png` | Templates at 1760×1000 for mock comparison. |
| `04-home-1760.png` | Home; header action reads "＋ Open Folder" (H1.4 unchanged). Empty-project front door because no documents were mounted. |

## Live header reads (top-level titlebar DOM, not the OOPIF)

- Templates: `A | living-docs-sample | / | Templates | ＋ New template | TS`  → **TC.1 met**.
- Home: `A | living-docs-sample | / | Home | ＋ Open Folder | TS`.
