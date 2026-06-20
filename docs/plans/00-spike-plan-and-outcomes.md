# Living Documents — VS Code Fork Research Spike

## Context

Tom is exploring a business idea: an **AI-native, non-technical-friendly word processor** ("Living Documents" / "Opportunity OS" / "Agentic Workbench") where documents stay bound to live data sources, an agent keeps them current, and **every change surfaces as an auditable red/green diff you approve** — provenance + diff + approval trail as the defensible wedge. Beachhead: recurring, data-linked reports (weekly operating summaries, LP letters, client updates).

This spike tests one question: **can we smush the design onto a VS Code fork and prove the core loop works on real data?** The fork has already been cloned to `/Users/tommy/Sites/abstract-vscode-spike` (a very recent build whose HEAD mentions "Agent Host").

### Why VS Code is a credible base (grounded in source exploration)
- **The agent→diff→approve→provenance loop is ~70% already built.** This build ships an Agent Host (Anthropic protocol), chat-editing sessions with per-file **accept/reject** and an `autoAcceptController` (≈ "low-risk auto-applies, meaning-changes wait"), a decorations engine for inline diffs + gutter provenance dots, and `ILanguageModelToolsService` + MCP for binding external data sources.
- **The editor is not locked to Monaco.** Clean `EditorPane`/`EditorInput` abstraction; many non-text editors already exist (notebook, settings, terminal, merge, image). A custom rich-text surface is feasible.
- **Direction 01 "The Workbench" maps ~1:1** onto the existing 3-pane workbench layout (activity bar / side bar / editor / auxiliary bar).

### Strategic caveat (named, not solved here)
The shipped product's north star (calm, "not an IDE," non-technical) fights VS Code's deeply-embedded IDE-ness, and every upstream merge re-introduces it (Cursor's tax). **The honest arc: spike on VS Code to prove the engine, then decide** whether to keep riding the fork (invest in de-IDE-ing) or rebuild the shell on web once the engine is validated. The spike's job is to de-risk the engine, not to commit to the fork forever.

## Decisions locked with Tom
- **Direction 01 — The Workbench** (fastest map onto VS Code).
- **Spike editor:** webview + lightweight rich-text (Lexical or plain `contenteditable`) — **throwaway**.
- **Full-app editor (future, not this spike):** build the document as a block tree on VS Code's **notebook cell model + text buffer + decorations** — no new third-party dependency. (See options table in chat.)
- **Spike goal:** a **real thin vertical slice** (not a faked shell).
- **Agent:** reuse model service (`ILanguageModelsService`) + tools/MCP + diff infra; write a **thin purpose-built orchestration** rather than bending the generic Agent Host session handler.

## The thin vertical slice (the one moment all three designs render)
`metrics.csv` week-24 row changes (MRR 41.2k→48.6k, signups 312→427, churn 3.1→2.4) → **Weekly Summary** doc has bound blocks (Highlights figure, KPI table, Commentary narrative) → agent re-derives them → the figure change (12%→18%) is classified **figure-only / low-risk → auto-applies**; the Commentary "steady"→"accelerated sharply" is classified **meaning-change → waits for approval** in the review rail → Tom approves → applied to the doc, an audit entry recorded, and a **provenance** link ties Commentary back to the MRR row in the CSV.

## Implementation plan

All new code lives in one contribution: `src/vs/workbench/contrib/livingDocs/`.

1. **Workspace fixtures.** Add a sample workspace with `metrics.csv` and `Weekly Summary.ldoc` (JSON: blocks + bindings). Bindings sidecar maps `blockId → {sourceFile, cellRef}`; hardcoded for the slice.

2. **Document editor — webview custom EditorPane** (`browser/livingDocEditor.*`).
   - Register an `EditorPane` + `EditorInput` for `.ldoc` (precedent: `src/vs/workbench/contrib/customEditor/` and `webviewPanel/browser/webviewEditor.ts`).
   - Webview renders the Weekly Summary with: bound figure spans (provenance underline), gutter provenance dots, inline red/green diff spans for pending changes.
   - Webview↔host messaging: `load`, `applyChange`, `hoverProvenance`.

3. **Source pane (left).** Open `metrics.csv` beside the doc and highlight the changed row. Simple table webview or reuse an existing CSV rendering; clicking a provenance dot highlights its source row (Direction 03's row↔paragraph mapping, simplified).

4. **Agent orchestration — real (`browser/bindingAgentService.ts`).** On source-change/refresh:
   - read current `metrics.csv` values;
   - call the model via `ILanguageModelsService` with the bound blocks + new values + a classification instruction → structured proposed changes `{blockId, oldText, newText, kind: figure|meaning, confidence}`;
   - **figure-only → apply immediately**; **meaning-change → queue in review rail**.

5. **Review rail (right auxiliary bar view).** Register a view in `ViewContainerLocation.AuxiliaryBar`. Render each pending change as a red/green diff with confidence/risk + **Approve/Reject** (matches Direction 01's rail). Approve → webview applies the edit, provenance dot updates, audit entry appended to a JSON log (spike-grade audit trail).

6. **Minimal rebrand.** `product.json` name → "Opportunity OS" / "Living Documents"; hide dev-only activity-bar entries; set the indigo accent + "L" mark. Light touch only — full de-IDE-ing is out of scope.

## Reuse map (don't rebuild these)
- Editor shell: `src/vs/workbench/browser/parts/editor/editorPane.ts`, `customEditor/`, `webviewPanel/browser/webviewEditor.ts`
- Views/auxiliary bar: `src/vs/workbench/common/views.ts`, `browser/parts/auxiliarybar/auxiliaryBarPart.ts`
- Model loop: `src/vs/workbench/contrib/chat/common/languageModels.ts`, `.../tools/languageModelToolsService.ts`, `src/vs/workbench/contrib/mcp/`
- Diff + decorations: `src/vs/editor/browser/widget/diffEditor/`, decorations API in `src/vs/editor/common/model.ts`, precedent `scm/browser/quickDiffDecorator.ts`
- Full-app editor precedent: `src/vs/workbench/contrib/notebook/`

## Verification (end-to-end)
1. Build & launch the dev build: `npm install` then `./scripts/code.sh` (large first build — flag the time cost).
2. Open the sample workspace; open `Weekly Summary.ldoc` and `metrics.csv` side by side.
3. Edit the CSV week-24 row (or hit "refresh") → confirm the **figure auto-applies** (12%→18%) and the **Commentary change appears in the review rail** as a meaning-change with confidence/risk.
4. Click **Approve** → confirm the Commentary updates in the doc, a provenance dot links it to the MRR row, and an audit entry is written.
5. Click a provenance dot → confirm the source row highlights in the CSV pane.

Success = that loop runs on a real model call against the real CSV, end to end.

## Out of scope for the spike
Full WYSIWYG editor, multi-document fan-out/propagation, templates/knowledge/agents screens, export (Docs/Sheets/Word/Excel/hosted), the calm "Studio" restyle, real multi-source sync, persistence/auth hardening.

---

## Spike outcomes (2026-06-20) — items 0-5 built on branch `living-docs-spike`

All work landed as one-commit-per-item under `src/vs/workbench/contrib/livingDocs/`, type-check + unit tests (13 passing) green throughout, each verified in the web build via chrome-devtools.

- **Item 0 — Markdown by default + Rendered/Raw toggle.** Our editor is the default for every `*.md` (text editor stays reachable via "Reopen With"); plain Markdown renders generically (reusing VS Code's `renderMarkdown`); a top-bar toggle switches to an editable raw-source view that round-trips through parse.
- **Item 1 — Multi-document fan-out.** One source change re-derives every bound doc in the workspace; the service is keyed by resource; the Review rail groups pending changes by document and the audit spans documents; approving one leaves the others.
- **Item 2 — WYSIWYG on non-bound prose.** Headings and non-bound paragraphs are `contenteditable` and write back via serialize; bound blocks stay source-driven. Built on VS Code primitives only (no TipTap).
- **Item 3 — Live API source.** `file | api | mcp` source-kind abstraction; the `api` kind fetches a real HTTP endpoint via `IRequestService` and substitutes live values into a `{cell}` template. Verified live against the GitHub repo API (real star/issue counts) even in the web build (GitHub CORS permits it). `mcp` is parsed/round-tripped, resolution stubbed pending an MCP server.
- **Item 4 — Export.** A top-bar Export action renders the doc's resolved state to a self-contained HTML page (`<stem>.export.html`) — no IDE chrome, clean KPI table.

## Item 5 — "Studio" de-IDE findings (the strategic test)

**What was applied.** Workspace `.vscode/settings.json` (reversible, no source patches): `workbench.experimental.modernUI: true`, `activityBar.location: hidden`, `editor.showTabs: none`, `editorActionsLocation: hidden`, `layoutControl.enabled: false`, `statusBar.visible: false`, `menuBarVisibility: hidden`, `window.commandCenter: false`, `breadcrumbs/minimap off`, plus an indigo accent (`#5b5bd6`) via `workbench.colorCustomizations`. Plus a display-only `product.json` rebrand (`nameShort`/`nameLong` -> "Opportunity OS"); `applicationName`/`dataFolderName` left alone on purpose (those move the user-data dir).

**Result (verified):** the shell goes genuinely calm — no activity bar, no tabs, no menu/status bar, rounded modernUI panels, indigo controls. The editor area is our webview, which already reads as a word processor. ~**80% of the calm look is free and reversible** via settings alone, in minutes, with zero merge-tax surface.

**What still leaks IDE-ness (the hard 20%, all the parts a non-technical user notices):**
- The left rail is still a **file tree**, not a "documents" list — the single biggest tell.
- The Review rail carries VS Code **view-pane chrome** (header, twisties, overflow menu).
- The window **title bar** still shows the product/OS title; `product.json` is **cached by the running server**, so the rebrand needs a restart — and on desktop a *real* rebrand means changing `applicationName`/`dataFolderName`, which **moves the user-data dir** (the documented footgun).
- Editor **group/close chrome**, the command palette, context menus, keybindings, and notifications are all unmistakably VS Code.

**Effort read.** The settings route is trivial and safe. Each item in the hard 20% is either (a) a **source patch that fights every upstream merge** (Cursor's tax) or (b) something we'd **build ourselves anyway** (a documents list, branded title bar). None is individually huge, but together they are exactly the high-friction, recurring-cost surface.

**Strategic conclusion (informs keep-the-fork vs rebuild-on-web).** The **engine maps cleanly and is now proven** on a VS Code fork: agent loop, figure-auto-apply / meaning-change-approve, provenance, multi-doc fan-out, multiple live source kinds, and export all work end-to-end on real data. The **shell is where the fork resists** the calm/non-technical north star. Recommended arc, unchanged but now evidenced: **keep the fork to validate and sell the engine** (80% calm is enough for design partners), and **rebuild the shell on web** once the engine is validated — rather than paying the recurring merge tax to chase the last 20% of de-IDE-ing inside the fork.
