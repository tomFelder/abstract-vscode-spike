# Living Documents — "Studio" de-IDE handoff (clean session)

You are continuing the **Opportunity OS / Living Documents** spike. The engine is built and
proven (PR #1, branch `living-docs-spike`). This phase has ONE job: **make the shell stop
feeling like an IDE and start matching the Workbench hi-fi design.** Items 0-5 already proved
the engine; do not re-litigate those.

## Read first
- Plan + spike outcomes + the Item-5 de-IDE findings: `/Users/tommy/.claude/plans/back-okay-so-i-ve-generic-wigderson.md`
- Memories: `opportunity-os-living-docs`, `abstract-vscode-spike-build`, `living-docs-fullapp-decisions`
- The code already shipped: everything under `src/vs/workbench/contrib/livingDocs/` (service is the brain; `livingDocEditor`/`livingDocRender` are our webview surface; `reviewRailView` is the rail).

## Get the design BEFORE writing UI code (required)
The target is **Direction 01 "The Workbench" hi-fi** in the Claude Design project **"Agentic
Workbench"** (projectId `d198ca07-9eef-4d05-96e1-b383e6c19c03`). There are 4 directions
(01 Workbench / 02 Studio / 03 Source-of-Truth / 04 Review Inbox) — 01 is the locked choice.
**Ask Tom to link/paste the Workbench hi-fi (and any tokens/spec) at the start of the session.**
Extract its palette, type ramp, spacing, and the three-pane layout. Do not guess the visuals —
match them. Use the chrome-devtools MCP to diff the running build against the hi-fi.

## Repo / branch / build
- Repo: `/Users/tommy/Sites/abstract-vscode-spike`. Branch FROM the merged work: if PR #1 is
  merged, branch `living-docs-studio` off `main`; else branch off `living-docs-spike`.
- Node 24 REQUIRED: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.15.0`
- `npm run watch` (background) keeps `out/` compiled; `npm run typecheck-client`; unit tests
  `./scripts/test.sh --grep "LivingDocsService"`. NOTE: `test.sh` runs against `out/`, so let
  the watch finish compiling a change before running tests (poll the compiled `.js`).
- Visual verify headlessly: `./scripts/code-web.sh ./living-docs-sample` serves on
  http://localhost:8080; drive + screenshot with the chrome-devtools MCP. Open the workspace at
  the base URL (it mounts as `[Test Files]`); `?folder=/static/mount` does NOT work here.
- GOTCHA: the web server **caches `product.json` at startup** — rebrand changes need a server
  restart, not just a reload.
- Conventions (hygiene blocks commits): tabs only (even inside template literals — single
  left-aligned strings); NO non-ASCII in source (HTML entities/ASCII); NO `in` operator (use
  `Object.prototype.hasOwnProperty.call`); DI ctor non-service args BEFORE `@IService` args.
  One commit per item; keep type-check + tests green each time. End commit messages with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

## Guiding principle (this is the whole strategy)
**Additive-first. Every core patch is a liability — isolate it, comment it, and COUNT it.**
The Item-5 finding: ~80% calm is free via settings; the costly 20% is the merge-tax surface.
So reach for tools in this order and stop at the first that works:
1. **Workspace settings** (`.vscode/settings.json`) — free, reversible.
2. **A registered theme** — palette/brand without per-key hacks.
3. **`styleOverrides` CSS** — this build already ships `contrib/styleOverrides/` (modernUI
   media: tabs.css, paneHeaders.css, padding.css, roundedCorners.css...). ADD our own calm CSS
   here rather than patching parts.
4. **New additive contribution** (our own view/container/part) — preferred over editing core.
5. **Core patch** — last resort. If unavoidable, put it in ONE clearly-commented place and add
   a line to the merge-tax ledger (Item F). The COUNT of these is the real output of this phase.

## Work items — in order, one commit each, verify against the hi-fi.

**ITEM A — "Documents" home (kill the file-tree tell — highest impact).**
The file Explorer is the single biggest "this is an IDE" signal. Build a custom view container +
view (our own contribution) that lists Living Documents as *documents*: title, source-kind
chips (file/api/mcp), last-synced, and pending-change count — sourced from the service's existing
workspace discovery (`_discoverLivingDocUris`) + per-doc state. Clicking a row opens the doc in
our editor. Make this container the default primary-sidebar view and hide the built-in Explorer
for the workspace. Add a "New document" affordance (from a template).
Acceptance: opening the workspace lands on the Documents list; you never see a file tree;
clicking a document opens it; pending counts reflect the rail.

**ITEM B — A real "Studio" theme (retire the colorCustomizations hack).**
Register an "Opportunity OS" color theme matching the hi-fi palette (paper bg, indigo accent,
calm grays) covering sidebar, lists, badges, inputs, buttons, focus, scrollbars. Set as the
workspace default and DELETE the `workbench.colorCustomizations` block from settings.json.
Acceptance: the whole shell matches the hi-fi palette, not just a few keys.

**ITEM C — Branded header + remove residual editor/group chrome.**
Match the hi-fi top chrome and kill the leftover IDE bits: the "Editor Group 1 (empty)" hint,
the editor close affordance, and the secondary-side-bar/view-pane header chrome around the
Review rail. Prefer `styleOverrides` CSS + settings. Title/brand: use `window.title` and
document the `product.json`/data-dir constraint (do NOT change `applicationName`/`dataFolderName`
— that moves the user-data dir). Log any core patch in the ledger.
**Known issue to fix here:** Tom reports the header / document-title area looks "funky" —
review the current `livingDocRender` top bar AND the editor framing against the Workbench hi-fi
specifically (the brand row, the document title block, and how the doc is seated in the editor
area) and correct the discrepancies.
Acceptance: no empty-editor IDE hint; the rail reads as a calm panel; the header matches the hi-fi.

**ITEM D — Document surface + Review rail to hi-fi spec (our surface — low risk, high polish).**
The webview doc top bar, the rendered document, the provenance/source affordances, and the rail
cards are entirely ours. Bring them to pixel-level alignment with the Workbench hi-fi: type ramp,
spacing, the red/green diff card, provenance dots/underlines, empty states, the source pane.
Pull exact tokens from the design.
Acceptance: side-by-side with the hi-fi, the document + rail match.

**ITEM E — Shell flow / first-run.**
App opens to the Documents home (not an empty editor); selecting a doc shows doc + Review rail;
no tabs, no file tree, no command center. The whole launch-to-edit flow should read as a word
processor.
Acceptance: from launch, a non-technical user sees a document app, not an IDE.

**ITEM F — Provenance gutter redesign (detach the dots from the prose).**
Today the colored provenance dots sit *inline* with the sentence and push the text in, so they
read as document indentation. They must move OUT into a true left gutter, detached from the body,
per Tom's spec:
- The dots/markers live in a dedicated left **gutter**, well left of the document column; the
  prose column is NOT indented by them (or is uniformly indented so the dots never shift text).
- The gutter shows a **line number** per document line. A line that **wraps** over 2-3 visual
  rows does NOT increment the number — it shows a blank gap for the wrapped continuation; the
  number only advances on a real new line.
- A **dot** appears in the gutter next to a bound/edited line. If an edit spans a multi-line
  paragraph, the marker **blends into a vertical bar** spanning those gutter rows (indicating the
  change touches several lines), rather than one dot.
- Hovering a gutter marker still **pulls up** the provenance (reveal source / detail), as today.
This is our own webview surface (low risk). Match the gutter styling to the hi-fi.
Acceptance: dots are visually in the gutter and never shift the prose; line numbers behave with
wrapping; multi-line edits show a spanning marker; hover still reveals provenance.

**ITEM G — File-format strategy + "Download as Markdown".**
This is an OPEN DECISION (see `docs/05-open-questions.md`), not a settled task — read it first.
The tension: we want persistent, human-editable Markdown (Obsidian / share / agent-native), but
linking + annotation + inference add metadata that raw Markdown can't hold cleanly (the `.living.md`
today smuggles bindings into HTML comments, shows `{cell}` templates on disk, and keeps provenance
in a sidecar `.audit.json`). Concrete, low-risk step to take now: add a **"Download as Markdown"**
export (mirror the HTML export from item 4) that flattens the document's *resolved* state to a
clean static `.md` — no bindings, no placeholders, live values inlined. Then write up (do NOT
silently pick) the canonical-format options for Tom: (1) Markdown-primary w/ comment metadata
(current), (2) JSON/LDOC-primary with Markdown as export-only, (3) Markdown body + `.ldoc.json`
sidecar keyed by stable block anchors. The choice is coupled to the WYSIWYG-editor decision and
to fork-vs-greenfield — leave it deferred, just improve the export surface and document the call.
Acceptance: a "Download as Markdown" action produces a clean static .md; the options memo exists.

**ITEM H — Merge-tax ledger + sharpened recommendation.**
Keep a running ledger in the plan file: every change tagged settings / theme / styleOverrides-CSS
/ additive-contribution / **core-patch** (with file + reason). Close with a concrete keep-the-fork
-vs-rebuild-on-web call grounded in how many core patches the design actually required and how
fragile they are to upstream merges.

## After all items
Summarize, run the full verify (type-check + tests + a chrome-devtools screenshot pass vs the
hi-fi), update the memories, and open a PR for this branch.
