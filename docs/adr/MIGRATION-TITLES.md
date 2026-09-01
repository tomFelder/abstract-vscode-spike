# ADR migration - written titles for review

Every row of [`../07-decision-log.md`](../07-decision-log.md) became a file in this directory. The decision cell was a *statement*, not a title, so a title was written for each one. This table is the review artefact: scan the excerpt against the title and flag any that miss.

154 decisions, numbers 1-181, with 27 reserved-but-unused numbers absent by design.

| # | Original statement (first 80 chars) | Written title |
|---|---|---|
| 1 | Spike on a VS Code fork before committing to an architecture | Spike on a VS Code fork |
| 2 | Direction 01 "The Workbench" as the design | The Workbench as the design direction |
| 3 | Thin, purpose-built agent orchestration (reuse model/tools/diff, not the generic… | Thin, purpose-built agent orchestration |
| 4 | Reuse VS Code primitives for rich text; no TipTap | VS Code primitives for rich text, not TipTap |
| 5 | Back documents with portable Markdown (`.living.md`) rather than bespoke JSON | Portable Markdown as the document format |
| 6 | Claim `*.md` as the default editor (not just `*.living.md`) | Claim all Markdown as the default editor |
| 7 | Generic Markdown via VS Code's `renderMarkdown` | Generic Markdown via renderMarkdown |
| 8 | WYSIWYG only on non-bound prose; bound blocks stay source-driven | WYSIWYG only on non-bound prose |
| 9 | `file \| api \| mcp` source-kind abstraction; implement `api` for real, stub `mc`… | The file, api and mcp source-kind abstraction |
| 10 | Export to a self-contained HTML page (over Google Docs / .docx) | Export to a self-contained HTML page |
| 11 | Calm shell via workspace settings, not core patches | Calm shell via workspace settings |
| 12 | `product.json` rebrand: display-only (`nameShort`/`nameLong`); leave `applicatio`… | Display-only product.json rebrand |
| 13 | Verify on the web build via chrome-devtools MCP, unit-test the service headlessl… | Verify on the web build, unit-test headlessly |
| 14 | Model calls go through a localhost OAuth proxy, not from the renderer | Model calls go through a localhost proxy |
| 15 | OAuth (Console billing), not a static API key or Pro/Max sub | Console OAuth over a static API key |
| 16 | Optional OpenRouter test backend in the proxy | Optional OpenRouter test backend in the proxy |
| 17 | Chat agent built on `livingDocsService._callModel` (reuse the proxy transport, n… | Chat reuses the proxy transport and Review rail |
| 18 | v1 functionality landed inside the livingDocs contrib with 0 core patches (Chat… | v1 functionality with zero core patches |
| 19 | v1 source-peek / Sync-across opened a VS Code `SIDE_GROUP` editor group | Source-peek opened a side editor group |
| 20 | Source-peek + Sync-across become in-surface panels, never editor splits | Source-peek becomes an in-surface panel |
| 21 | Build the design's left tree-rail (Files/Context/Outline/Search + folder tree),… | Build the comp's left tree-rail |
| 22 | Core patches permitted where the design genuinely needs them, logged in the merg… | Core patches permitted, logged in the merge-tax ledger |
| 23 | The tree-rail is ONE `TreeRailView` (a single sidebar `ViewPane`) with internal… | The tree-rail is one tabbed ViewPane |
| 24 | The doc header is the comp's single calm bar; formatting moves to a floating sel… | A single calm doc header plus a floating toolbar |
| 25 | Remove the residual IDE chrome (menubar, Accounts, Manage gear) via the Studio s… | Remove residual IDE chrome via Studio CSS |
| 26 | Exclude the IDE-only first-party builtins (emmet / git-base / merge-conflict) fr… | Exclude the IDE-only built-in extensions |
| 27 | Pin the tree-rail (264px) and right rail (392px) to the comp's widths on startup | Pin the rail widths to the comp |
| 28 | Highlight bound figures inline in prose (the comp's "living figure" treatment) | Highlight bound figures inline in prose |
| 29 | The icon-nav is a 76px labeled rail (the comp), not VS Code's 48px icon-only act… | A 76px labelled icon-nav |
| 30 | FULLY close G4 by removing the last reachable IDE optionality at the source - th… | Remove the last IDE optionality at source |
| 31 | Fold the right-rail "Skills" tab into Review; the tab strip is the comp's exact… | Fold the Skills tab into Review |
| 32 | Agents table matches the comp's exact columns — drop the extra POLICY column | The Agents table drops the Policy column |
| 33 | Keep the tree-rail persistent on the screen surfaces — bounce the sidebar back t… | Keep the tree-rail persistent across screens |
| 34 | The comp's revised "Workbench v2" removes the right-rail Document-Agents panel a… | Document Agents need a home before removal |
| 35 | Source-peek is a bottom in-surface drawer, not a left split pane | Source-peek becomes a bottom drawer |
| 36 | The editor carries a persistent calm formatting toolbar — reverses the v3 floati… | A persistent formatting toolbar over the floating one |
| 37 | Resolves #34 — relocate the Document-Agents panel to an on-demand disclosure (To… | Document Agents move to an on-demand disclosure |
| 38 | The Real Documents loop's build + verification surface — "web drives, desktop pr… | Web drives, desktop proves disk |
| 39 | "The folder IS the project", and the tree/Home show all Markdown with living doc… | The folder is the project |
| 40 | "Add source" picks from an in-app list of the folder's data files, written to fr… | Add source picks from an in-app file list |
| 41 | Reference a file = a "File" kind in the Add-context form (frontmatter `context:`… | Referencing a file is a Context kind |
| 42 | Bring back the native File Explorer alongside the custom tree-rail — both contai… | Keep the native File Explorer alongside the rail |
| 43 | Ship ProseMirror as a vendored, prebuilt ASCII IIFE bundle inlined into the doc… | A vendored ProseMirror bundle in the doc webview |
| 44 | OpenRouter is the default model backend for every call | OpenRouter is the default model backend |
| 45 | Generative chat content is an "insertion" proposal that reuses the existing revi… | Generated prose is an insertion proposal |
| 46 | A bound figure is a first-class ProseMirror atom inline node, not a decoration o… | A bound figure is a ProseMirror atom node |
| 47 | A pending proposal renders as ProseMirror decorations/widgets, accepted via a re… | Proposals render as ProseMirror decorations |
| 48 | Chat is available on every document; "living" is a data-binding badge, not a gat… | Chat on every document; living is a badge |
| 49 | Retire the bespoke `renderDoc` HTML body; ProseMirror is the single render path… | ProseMirror is the single render path |
| 50 | The doc webview is a persistent surface: set the shell once, update via postMess… | Mount once, then message the doc webview |
| 51 | Living docs render in ProseMirror behind an opt-in 'pm' mode, rolled out before… | Roll ProseMirror out behind an opt-in mode |
| 52 | Pending proposals + the provenance gutter are real ProseMirror decorations; acce… | Proposals and the gutter are real decorations |
| 53 | Flip the default to ProseMirror, retire `renderDoc`, and drop the read-only `ren`… | Flip the default to ProseMirror and retire renderDoc |
| 54 | Strip the workbench shell by registering product config-default overrides, not c… | Strip the shell via product config defaults |
| 55 | Kill the cold-launch noise via product config-defaults; one minimal core patch s… | Silence the cold-launch activation noise |
| 56 | The document-first on-ramp: a new doc is a BLANK writing surface that opens focu… | A new document is a blank writing surface |
| 57 | Hide internal artifacts from the Explorer via `files.exclude`; serialize a plain… | Hide internal artefacts, emit byte-clean Markdown |
| 58 | Chat robustness first (tolerant parse + retry-once + an alive "Thinking" indicat… | Chat robustness first, token-streaming deferred |
| 59 | Calm polish pass: the formatting toolbar shows for every PM document (plain or l… | The formatting toolbar shows for every document |
| 60 | A working set is a separate concept from sources | A working set is not a source |
| 61 | No working set → chat edits only the active doc (backwards compatible) | No working set means the active document only |
| 62 | The model is asked ONCE, returning a per-doc edit map | Ask the model once for a per-document edit map |
| 63 | Living and plain docs in a set both flow through the same prose-edit proposal pa… | Living and plain docs share one proposal path |
| 64 | Editor becomes a first-class review surface, contrib-first, both surfaces equal | The editor is a first-class review surface |
| 65 | The inline diff anchor must whitespace-collapse to match the rendered PM node | The inline diff anchor whitespace-collapses |
| 66 | The chat-edit JSON parser must brace-match, not slice to the last `}` | The chat-edit JSON parser brace-matches |
| 67 | Inline per-hunk Approve/Reject confirmed working; provenance label cleaned | Inline per-hunk Approve and Reject confirmed |
| 68 | Editor action bar lives in the in-webview toolbar; tiny pure `nextPendingDocId`… | The editor action bar lives in the webview toolbar |
| 69 | Harden the chat-JSON extractor to drop stray closing brackets, not just braces | The chat-JSON extractor drops stray brackets |
| 70 | Approve-all-everywhere + the full cycle + an honest "all reviewed" end state | Approve all everywhere with an honest end state |
| 71 | Full editor-driven review verified E2E; desktop real-disk smoke deferred with ra… | Editor-driven review verified end to end |
| 72 | Review actions move out of the formatting header into a floating review bar; dro… | Review actions move to a floating review bar |
| 73 | Provenance gutter is a real 30px reserved column; a bound multi-line paragraph's… | The provenance gutter is a reserved 30px column |
| 74 | Reading ramp updated to the exact Part B type table; H2 at 16px is intentionally… | The Part B reading ramp: H2 smaller than body |
| 75 | + Skill in the composer: reuses the shared getSkillReport + runSkillCheck path;… | Skill in the composer reuses the shared report path |
| 76 | ALL PROJECTS is populated by the current open folder PLUS the workbench recently… | All Projects lists the open plus recent folders |
| 77 | NEEDS YOU + greeting summary read the real per-document pending count already ca… | Needs You reads the real pending count |
| 78 | ALL PROJECTS grid shows real counts only for the current open folder; recently-o… | Recent project tiles defer their counts |
| 79 | The project-run swarm is driven by the live orchestrator run PLUS a pure per-doc… | The project-run swarm's pure aggregation selector |
| 80 | Entry points to the project-run screen: an Agents-screen "Run across the project… | Entry points to the project-run screen |
| 81 | The `project-run` screen is a new `ScreenId` rendered by the existing `ScreenEdi`… | Project-run is a screen, not a new editor |
| 82 | The project-run swarm grid + progress + bottom-bar totals are driven by a LIVE w… | The project-run grid runs a live fan-out |
| 83 | The C4 decisions-understood column is built from a REAL per-change SOURCE GROUND… | Decisions understood come from real source grounding |
| 84 | A `meaning` change with `confidence < 0.8` maps to `◐ Inferred` (attention, "nee… | The two-state confidence chip mapping |
| 85 | `review-project` is a new `ScreenId` rendered by the EXISTING `ScreenEditor` web… | The cross-document review screen, read-only |
| 86 | Per-change Accept/Reject/Tweak + the sticky doc action bar (Accept All Here / Ne… | The cross-document review screen goes live |
| 87 | The fan-out's "Review Across the Project" now OPENS the `review-project` screen… | Review Across the Project opens the review screen |
| 88 | The labeled 76px icon-nav needs NO new core patch — the width seam was already p… | The labelled nav needs no new core patch |
| 89 | The "Editor" nav item opens the active/last Living Document, else the first doc… | The Editor nav item's open fallback chain |
| 90 | The active-nav white chip is driven by the ACTIVE EDITOR, not the activity bar's… | The active-nav chip follows the active editor |
| 91 | Account + settings pinned to the bottom of the 76px bar — style-only, functional… | Account and settings pin to the nav's foot |
| 92 | Tidy the nav to EXACTLY 5 items — deregister the Explorer container, hide the Wo… | Tidy the nav to exactly five items |
| 93 | Regression sweep passes at 76px; both logged design gaps closed in CSS; desktop… | The redesign loop closes with no new core patches |
| 94 | Both rails are EDITOR companions, not global chrome - hidden on the screen surfa… | Both rails are editor companions, not chrome |
| 95 | Template files are `<name>.template.md` in the project folder, discovered anywhe… | Templates are .template.md files in the project |
| 96 | Generation input is a single calm prompt sheet - document name (required), one o… | Generation input is one calm prompt sheet |
| 97 | Placeholder semantics: `{{slot:hint}}` renders in the template preview as a mute… | Template placeholder and bind-link semantics |
| 98 | Close the last title-bar + window-identity leaks purely via the decision-54 conf… | Close the title-bar and window-identity leaks |
| 99 | A truthful project name via one pure `projectDisplayName` helper in `common/`; t… | A truthful project name from one pure helper |
| 100 | Keystroke undo/redo is ProseMirror's own `prosemirror-history`, NOT VS Code's `I`… | Undo is prosemirror-history, not IUndoRedoService |
| 101 | Snapshots live in the lock as a capped `snapshots[]` (in-lock, not a `.history/`… | Snapshots live capped inside the lock |
| 110 | The residual IDE keyboard chords are neutralised with an ADDITIVE `noop`-shadow… | Neutralise the residual IDE keyboard chords |
| 111 | Present is made honest - only the two exports Abstract genuinely writes are sele… | Present is honest, the seams gate executable |
| 120 | A chat edit to one list item is anchored and applied at the `<li>` boundary via… | List edits anchor at the list-item boundary |
| 121 | The renderer streams the model reply over a `fetch` + `ReadableStream` reader ag… | Streaming over fetch against the localhost proxy |
| 122 | On user cancel the prose streamed so far is kept as a muted "stopped" assistant… | Cancel keeps the prose, discards the proposal |
| 123 | The rail renders a live assistant turn that appends streamed deltas WITHOUT a fu… | The rail renders a live streaming turn |
| 124 | The whole-project run is stoppable with TRUTHFUL per-doc states: "Stop run" on t… | The fan-out is stoppable with truthful states |
| 125 | Generation is one calm sheet then the EXISTING chat path: a static skeleton writ… | Generation writes a skeleton, then drafts prose |
| 126 | The new-document on-ramp is a name-or-template sheet on Home; a named blank is b… | The new-document sheet takes a name or template |
| 127 | The Knowledge screen becomes the project's real source library: a `listSources()`… | Knowledge becomes the real source library |
| 128 | A bound figure + its provenance gutter dot answer "where from, how fresh" on a q… | A bound figure answers where from on hover |
| 129 | The `mcp` source kind resolves for real through the localhost proxy (stdio JSON-… | MCP and authenticated API sources resolve for real |
| 130 | Every review surface renders one self-explaining framing, built once and shared:… | One shared self-explaining review framing |
| 131 | Tweak is amend-before-approve through the ONE approve path - a service `amendCha`… | Tweak is amend before approve |
| 132 | A bulk approve that includes any meaning change confirms once with real counts +… | Bulk approves of meaning changes confirm once |
| 133 | The History tab is a truthful per-document version timeline built entirely from… | The History tab is a truthful version timeline |
| 134 | The editor toolbar's save/version chip is honest: real snapshot count, live Savi… | The save and version chip tells the truth |
| 135 | A refresh/agent run bounds its remote work with two `Limiter`s (4 concurrent sou… | Bound remote work with limiters and a cooldown |
| 136 | `refreshFromSources(resource?)` is incremental and source-scoped: a cheap freshn… | Refresh is incremental and source-scoped |
| 137 | The whole-project fan-out packs the working set into context-bounded BATCHES (es… | The fan-out packs context-bounded batches |
| 138 | The document editor's mount-once-then-message webview lifecycle is extracted to… | The webview lifecycle becomes a pure reducer |
| 150 | Agent runs persist to `agents.json` (no new file): `IAgentRun` gains `via` (trig… | Agent runs persist to agents.json |
| 151 | The Agents-screen workflow canvas is read-only for the validation phase - a hori… | The workflow canvas is read-only for now |
| 152 | The Agents-screen detail drawer builds on D32-B (decision 151): the read-only ca… | The Agents drawer edits the registry inline |
| 153 | The before-export gate and the on-publish pins become visible, explainable and o… | The export gate becomes visible and audited |
| 154 | Journey Map v4 ratified (D1-D26, P0-P10, T1-T5) and the early-phase planning spi… | Journey Map v4 and the planning spine |
| 155 | Beta v1.0 prioritisation set (docs 21-23): the plan-37 fix tiers + model access… | Beta v1.0 priorities and the interop floor |
| 156 | A hidden `.abstract/` project folder holds app-internal project state: skills, k… | A hidden .abstract/ folder holds project state |
| 157 | The beta gates on T4 activation; the *raise* gates on retention + growth evidenc… | The beta gates on activation, the raise on retention |
| 158 | Willingness-to-pay is tested in-beta via a monetised metered-API fast-follow, no… | Willingness to pay is tested with a metered API |
| 159 | Upstream VS Code syncs are frozen for the beta window (security-only exception) | Freeze upstream VS Code syncs for the beta |
| 160 | Deferred: the share-a-read-only-link fake door (collab demand signal) and all re… | Defer the share link and realtime coaching |
| 161 | Docs governance: the corpus is layered into canon / ledger / archive by the READ… | Docs governance: canon, ledger, archive |
| 162 | The beta targets the Electron desktop build ONLY; the web build is demoted to a… | The beta targets the desktop build only |
| 163 | Docs moratorium + single operational tracking layer: no new strategy docs until… | A docs moratorium and one tracking layer |
| 164 | docx -> Markdown import ships the doc 22 §2 pipeline: a `.docx` tree row becomes… | Docx to Markdown import in the proxy |
| 165 | Spreadsheets become sources by EXTRACTION to per-sheet CSVs under `data/<workboo`… | Spreadsheets extract to CSV, PDFs become context |
| 166 | Export unstubs docx and adds PDF, both behind the existing before-export reconci… | Docx and PDF export behind the reconcile gate |
| 167 | Abstract Editor v2 is the pixel spec of record for the next UI wave: the mock (``… | Abstract Editor v2 is the pixel spec of record |
| 168 | The numbered gutter replaces the 30px dot gutter, revising plan-20 §C2: a 70px l… | A numbered gutter replaces the dot gutter |
| 169 | The elevation model ships with a hard core-seam budget of TWO small seams for th… | The elevation model's two-seam budget |
| 170 | The 48px Abstract header is ONE full-width surface - the titlebar part repurpose… | One 48px header from the titlebar part |
| 171 | Product tabs are Abstract's own 40px tab row inside the editor card, rendered in… | Abstract's own product tab strip |
| 172 | The Properties panel is the per-doc front door to frontmatter + lock metadata: a… | The Properties panel is the frontmatter front door |
| 173 | The tree rail is three tabs - Files · Context · Outline - with Search folded int… | The tree rail is three tabs with folded search |
| 174 | Wave orchestration protocol: a Fable orchestrator that never implements + Opus 4… | The wave orchestration protocol |
| 175 | map-D2 is IMPLEMENTED, not re-decided: a folder open (a project) lands on Projec… | A folder open lands on Project Home |
| 176 | OpenAI model access moves to the Codex device-authorization flow: the broker's l… | OpenAI access moves to device authorisation |
| 177 | The approval UX target is Cursor-style inline diffs IN the document: pending pro… | Cursor-style inline diffs in the document |
| 178 | Chat becomes workspace-level with chat tabs: chats belong to the workspace (not… | Chat becomes workspace-level with tabs |
| 179 | Obsidian-style `[[wikilinks]]` are the doc-to-doc link syntax: `[[` opens a filt… | Obsidian-style wikilinks between documents |
| 180 | The Files rail becomes a PURE file tree (the Reports section dissolves into the… | The Files rail becomes a pure file tree |
| 181 | The strip-back wave: after the core loop lands, cut the ~108 built-in extensions… | The strip-back wave on built-in extensions |
