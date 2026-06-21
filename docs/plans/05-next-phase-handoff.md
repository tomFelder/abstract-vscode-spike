# Living Documents — next-phase handoff (clean session)

You are continuing the **Opportunity OS / Living Documents** spike. The engine is proven (PR #1, merged)
and the shell now reads as a calm document app (Studio de-IDE, PR #2, branch `living-docs-studio`). A
**design-match round** then landed on branch `living-docs-design-match`: inline word-level diff, the editor
toolbar (+ Ask AI), a calm header, a styled source view, and the agreed review fixes. A **build-out round**
(this update, same branch) then implemented the rest of the locked comp's surfaces: the **Home dashboard**,
**Templates / Knowledge / Agents (with workflow canvas)** screens, the **Present & export modal**, the
**Chat / History / Skills** panel tabs, and a **clean icon nav** (built-in IDE containers deregistered).
**This phase's bias: make the wedge real on a partner's data — the comp surfaces now exist; back them with
real data and persistence.**

## Read first
- The four-lens audit + roadmap (the why): rendered artifact from the audit round; and the source files
  `docs/plans/03-merge-tax-ledger.md` (what shipped, 0 added core patches, fork-vs-rebuild call) and
  `docs/plans/04-file-format-options.md` (the deferred canonical-format decision).
- Build/run + verify: memory `abstract-vscode-spike-build` (Node 24 gotcha; `code-web.sh` + chrome-devtools;
  the IndexedDB cache + product.json restart gotchas). Engine + decisions: memories `opportunity-os-living-docs`,
  `living-docs-fullapp-decisions`.
- The code: `src/vs/workbench/contrib/livingDocs/` (`livingDocsService.ts` = brain; `livingDocRender.ts` =
  the document webview incl. the Present modal; `reviewRailView.ts` = Chat/Review/History/Skills panel;
  `documentsView.ts` = Documents sidebar list; `screenRender.ts` = the Home/Templates/Knowledge/Agents
  webview screens; `screenEditor.ts`/`screenEditorInput.ts` = the screen webview editor; `screenLauncherView.ts`
  = the activity-bar launcher per screen; `livingDocs.contribution.ts` = wiring) +
  `contrib/styleOverrides/browser/media/studio.css`.

## Get the design BEFORE writing UI (required)
Target = **Direction 01 "Workbench" hi-fi** in the Claude Design project **"Agentic Workbench"**
(projectId `d198ca07-9eef-4d05-96e1-b383e6c19c03`). Read it with the **DesignSync MCP** (ToolSearch
`select:DesignSync`; `get_file` `Living Documents - Workbench.dc.html` + the `screenshots/`: home,
wb-editor-chat, wb-source, wb-history, wb-canvas-outputs, inline-diff, chat-approveall, overview). The
`claude_design` connector the founder referenced (`api.anthropic.com/v1/design/mcp`, `/design-login`) is not
a separate server here; **DesignSync IS that connector** (claude.ai/design) and is already authorized
(`user:design:read`/`write` granted on first `get_file` — no `/design-login` needed). Diff the running build
against the comp with chrome-devtools (the web build on `:8080`).

## Decisions locked with Tom (apply these)
- **Gutter:** no line numbers — the gutter carries only the provenance markers (dots / spanning bars). (done)
- **Provenance:** pull Direction 03's **hover-a-paragraph → light up its source rows** interaction into 01
  as the demo centerpiece. (in-document hover highlight + click→source view done; the live two-pane sync is below)
- **Agent autonomy:** Tom wants **all of it — a robust ecosystem of agentic tools**, not one chat box.
  Automatic/scheduled refresh AND a conversational agent AND tool/MCP-driven actions. Design the Chat tab and
  the agent surface as the front door to that ecosystem (see "Agentic ecosystem" below).
- **Welcome / Raw Markdown:** Welcome-close is one-shot; Raw Markdown + format exports are demoted behind
  Share/Download + a power-user toggle. (done)

## What this round shipped (so you don't redo it)
- Provenance gutter without line numbers; **inline word-level diff** (red strikethrough / green added within
  the paragraph) + amber accent + "Tone rewrite from <src> · +N added · M removed · X% confidence" control row
  with inline Approve/Reject.
- **Editor toolbar** (Heading/B/I/U/list/quote via `execCommand`) + **Ask AI** (opens the Chat tab via the new
  `ILivingDocsService.onDidRequestPanel` / `focusPanel` channel).
- Calm top bar: **Share** (interim: guidance toast) + **Download** (clean Markdown export).
- **Styled source view** on provenance click (titled, synced row emphasized, "Referenced by") instead of the
  raw CSV.
- One-shot Welcome-close; merge-tax ledger corrected ("0 added this phase"; Explorer-deregister flagged High).

## What the build-out round then shipped (this update — verified in the web build)
- **Home dashboard** (`screenRender.ts` `renderHome`): greeting, quick-start cards, the projects grid. First
  run now lands here instead of an empty editor (`StudioStartupContribution` opens the Home screen).
- **Templates / Knowledge / Agents** screens as a generic webview editor (`screenEditor.ts`), reached from
  **activity-bar icon-nav** containers via slim launcher views (`screenLauncherView.ts`). Knowledge has the
  Org/Project toggle; Agents has the list + the **workflow canvas** with a working **Run now** state transition.
- **Present & export modal** in the document webview (destinations Google Docs/Sheets/Word/Excel/Hosted page;
  the hosted-page option reveals the share-scope row). Wired to the existing HTML / clean-Markdown exports.
- **Chat / History / Skills** panel tabs (Skills is new): rich Chat conversation (tool card, applied chips,
  run-summary -> Approve all that drives the real `approve()`), a version-history timeline (seeded from the
  real audit when present), and a document-agents Skills list. **Review keeps its real pending-change data.**
- **Clean icon nav:** the built-in Explorer/Search/SCM/Debug/Extensions containers are deregistered, and the
  activity bar is **shown** (`activityBar.location: default`) because the comp's icon nav IS the activity bar.
- All screens are **pixel-ported from the comp's inline styles** (glyphs as HTML entities for source hygiene).

## Known limitations to fix or be aware of
- **Editor is a re-rendered webview string, not a real editor.** `execCommand` formatting is live-visual but
  **not persisted** (`editBlock` saves `innerText`), whitespace is collapsed on blur, and the whole doc
  re-renders on every change (caret/scroll loss). This substrate does NOT extend to real WYSIWYG — see P0.
- The source view writes a `*.source.md` file (and exports write `*.export.md/html`) into the workspace —
  fine for the spike, clutter for production. The full hi-fi source pane (amber row highlight, **live two-pane
  hover-sync**, chips) is not built.
- Block ids are slugged from heading text → not stable across edits; provenance can rebind/break on hand-edits.
- Heuristic fallback (no model) emits identical text regardless of input — a trust hazard (see P0).
- Residual upstream coupling (re-pin on rebase): `deregisterViewContainer(...)` now covers Explorer **plus**
  Search / SCM / Debug / Extensions (all fail *unsafely* if an id changes upstream), the gettingStarted typeId,
  studio.css DOM selectors, the theme manifest edit.
- **The new screens are demo-data webviews, not backed by real state.** Home projects, the Agents list, the
  workflow canvas, Knowledge content, the Chat transcript and the History timeline are ported comp content with
  local-only interactivity (toggles, canvas run). Templates "Generate" shows a pre-resolved draft. Backing these
  with real workspace data (real projects, real agents/schedules, real versions) is the next-phase substance.
- The activity-bar launcher views are a thin "open in main area" surface: selecting a screen icon reveals the
  slim launcher AND opens the screen editor. It works but is a small double-surface; a cleaner icon->editor
  mapping (or making the screens true editor-only) is a polish follow-up.

## Next-phase work — in priority order (tied to a design-partner pilot)

### P0 — make the wedge real on a partner's data + protect trust
1. **Connect-a-source UI + one real connector** (a Google Sheet or one CRM via MCP) with auth, so a
   non-technical user can make a document "living" without hand-editing Markdown. This is the gate from
   guided-demo to pilot. Resolve the **`mcp` source kind** (currently stubbed) for that one connector.
2. **Persistence hardening:** dirty state, autosave, undo. The "is my work safe" credibility floor.
3. **Trust safety:** bias the figure/meaning classifier toward "queue for approval"; make "no model
   available" a **hard, visible stop** — never a silent heuristic degrade.
4. **Decide the editor substrate + canonical format** (decision, not full build): VS Code primitives vs
   ProseMirror/Lexical vs custom; and `04-file-format-options.md` option 1/2/3. Everything downstream hangs
   off this; provenance-as-guarantee needs stable block anchoring.

### P1 — the moat + the agentic ecosystem
5. **Deepen provenance:** per-field / point-in-time for api/mcp; the **full hi-fi source pane** with the
   **live two-pane hover-sync** (hover a paragraph ↔ light up source rows); an **exportable approval record**.
6. **Agentic ecosystem (Tom: "we want all"):** build the Chat tab into the front door for a robust agent
   toolset on the **Agent Host** — conversational ask-for-rewrite + "why did this change?", **scheduled/auto
   refresh** ("Weekly · Mon 9am", in the comp), and tool/MCP-driven actions (connect sources, run workflows,
   draft sections). Treat agents as first-class, composable tools, not a single chat box.
7. **De-jargon + theme:** humanize chips (`api`→"Live data", `mcp`→"Connected tool") and the History tab;
   tokenize the webview/view colors so the diff + doc surface follow the theme (today light-only).

### P2 — back the surfaces with real data + the last few comp pieces
8. **Make the comp screens real, not demo:** wire Home projects to real workspace projects; the Agents list +
   canvas to real agents/schedules on the Agent Host; Knowledge to a real org/project decision-stack store;
   the History timeline to real document versions; Templates "Generate" to a real template run. The surfaces
   exist (build-out round) — this is the data/behaviour layer behind them.
9. **The real WYSIWYG editor** on the chosen substrate (persisted formatting, a visible "bound/locked"
   affordance for source-driven text).
10. **Remaining hi-fi surfaces still not built:** multi-document editor tabs, the editor's two-pane SPLIT view
    with the "Sync across documents" floating action + confirmation chip, and the focused full-page REVIEW
    screen (the comp's `isReview`/`isSplit` states). (Home / Templates / Knowledge / Agents+canvas / Present
    modal / panel tabs are done.)

## Conventions / verify
- Node 24 (`.nvmrc`); `npm run watch`; `npm run typecheck-client`; `./scripts/test.sh --grep "LivingDocsService"`
  (runs against `out/` — wait for the watch to recompile). Visual: `./scripts/code-web.sh ./living-docs-sample`
  + chrome-devtools; clear IndexedDB after editing a builtin extension manifest. Hygiene (husky precommit): tabs
  only, no non-ASCII, no `in` operator, DI non-service args before `@IService`. One commit per item; PR at the end.
