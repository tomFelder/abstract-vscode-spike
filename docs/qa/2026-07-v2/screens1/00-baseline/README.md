# Plan 48 - Screens I (Home + Templates) - iteration 0 baseline

Lane C, Abstract Editor v2 wave. This directory captures the before-state for plan 48 (`docs/plans/48-screens-home-templates-loop.md`), the surfaces `screenRenderHome.ts` and `screenRenderTemplates.ts` render today, so the redesign PRs (48-a/b/c) can be diffed against a truthful baseline.

- Worktree: `/Users/tommy/Sites/abstract-v2-screens1`
- Branch: `v2/screens1-00-baseline`
- Base commit: `3ec16a6333e` - `feat(livingDocs): v2 shell - icon-nav on chrome + regression sweep (#216) (#220)` (current `origin/main`). The plan-44 v2 shell (48px `abstractHeader.ts`, icon-nav on chrome) has already landed on this main; the Home/Templates screen bodies below are still the pre-v2 renders.
- Gate check: PASS. `src/vs/workbench/contrib/livingDocs/browser/screenRenderHome.ts` exists (the pre-step `screenRender.ts` split landed), so lane C is unblocked. Siblings present: `screenRenderTemplates.ts`, `screenRenderShell.ts`, `screenRenderKnowledge.ts`, `screenRenderAgents.ts`, `screenRenderMisc.ts`.

## Live-screenshot blocker (ENOSPC - environmental, not a plan blocker)

Live baseline screenshots (Home-with-pendings, Home-all-clear, Home-no-folder, Templates at 1440x900 and 1760x1000) could **not** be captured this iteration: the machine's data volume was full (`/System/Volumes/Data` at 97-100%, dropping to ~130Mi free during the run) and could not hold a VS Code build (`npm install` ~1.7GB + `out/` compile output). This is the shared machine under load from the concurrent v2 lanes (editor / tree / shell baselines all installing + compiling at once), not anything specific to this lane.

Actions taken to relieve it (all non-destructive, no other lane touched):
- `npm cache clean --force` and removed the `~/.npm/_npx` cache (~9GB reclaimed).
- Removed this lane's own partial `node_modules` (corrupted by an ENOSPC-aborted install) so as not to add to the pressure on sibling lanes.

Even after reclaiming ~9GB the volume settled at ~2.9Gi free - below the safe headroom for a full VS Code build running alongside 3 sibling lanes. Rather than re-trigger ENOSPC mid-compile (which would corrupt this build **and** starve the sibling lanes), the live capture is deferred. The **source-truth baseline below is complete** and is what the redesign actually diffs against (the exact copy, the exact geometry literals, and the file:line pointers). When disk frees up, a follow-up can drop the four PNGs into this directory with no other change.

Recommended follow-up to unblock the images: run `TMPDIR=/tmp ./scripts/code-web.sh ./living-docs-sample --port 8083` (port 8083 is this lane's; do not use 8081/8082) once the volume has >8Gi free, session `screens1-48-baseline`, bare URL `http://localhost:8083/`; capture the three Home states + Templates at both viewports; for the no-folder state launch a second instance on 8083 pointed at an empty dir (`TMPDIR=/tmp ./scripts/code-web.sh /tmp/lwd-empty-$RANDOM --port 8083`).

## Current empty-state copy (VERBATIM) - the #211 items 1-2 before-state

Plan 48 H1.5 removes the product vocabulary from these. Recorded verbatim so the diff is exact.

### 1. No-folder state (`renderHome`, `screenRenderHome.ts:256-264`)

Rendered when `state.hasFolder` is false. This is the #211 item 1-2 target - it uses product vocabulary ("Living Documents", "sources", "agents"):

- Icon: folder glyph (📁, `&#128193;`)
- Heading (600 23px, `#15171c`): **"Open a folder to begin"**
- Body (400 14px, `#696e78`): **"Living Documents works on a folder of Markdown files on your computer. Open one to see its documents, sources and agents - everything stays on disk."** (source uses `&mdash;` for the dash)
- Button (accent fill): **"Open folder…"** (`data-msg="openFolder"`)

Words to count for the H1.5 fail-check (product vocabulary present today): **"Living Documents"**, **"sources"**, **"agents"**.

### 2. Empty-project front door (`renderEmptyProjectFrontDoor`, `screenRenderHome.ts:228-248`)

Rendered when a folder IS open but has zero documents (`docs.length === 0`). Not strictly the no-folder state, but it is Home's other empty surface and part of the #211 vocabulary sweep:

- Icon: page glyph (📄, `&#128196;`)
- Heading (600 24px): **"<folderName> is empty"** (e.g. "living-docs-sample is empty")
- Body (400 14px), one of two, real-data driven:
  - with templates: **"Start from one of your N templates, from a blank page, or ask me to draft one."**
  - no templates: **"Start from a blank page, or ask me to draft your first document."**
- Buttons: **"＋ New document"** (accent) and **"Browse templates"** (ghost)
- Below: the whole-project chat composer + birth sheets.

### 3. Templates empty state (`renderTemplates`, `screenRenderTemplates.ts:64-81`)

Rendered when `state.templates` is empty:

- Icon: ▢ (`&#9636;`)
- Heading (600 17px): **"No templates yet"**
- Body (400 13.5px): **"A template is an ordinary Markdown file in this project with a structure, sources and a brief. Grow one from a few past documents, or author one by hand."** (product vocabulary: "sources")
- Actions: with example docs -> **"New from examples"** + **"New blank template"**; else **"Create your first template"**.

## Home geometry + typography today (`screenRenderHome.ts`, source literals)

The pre-v2 Home has no floating card and no v2 shell shadow; it is a scroll container on `#f8f9fb`, not chrome. Measurements are the literals in the render string (a live build would confirm computed values; the redesign changes these literals).

- **Reading column** (`renderHome`, line 371): `max-width:1080px; margin:0 auto; padding:40px 36px 80px`. (Plan H1.1 target: max 1080px, padding 64/48/80 - so padding changes 40/36/80 -> 64/48/80, and the surface becomes a white radius-14 `shadow-editor` card on chrome.)
- **Greeting row** (line 373): `font:600 26px/1.2 system-ui; color:#15171c; letter-spacing:-.01em; white-space:nowrap`. Text is **hardcoded "Good morning, Tom"** - no time-of-day switch, no real name binding. (Plan H1.2 target: 30/600/-0.02em + mono date 13 `#A3A8B2`; there is **no date element** today.)
- **Summary line** (line 374): `font:400 14.5px/1.5 system-ui; color:#52575f`. Text when pending: "N documents need your review across this project. **N changes to approve**." When clear: "Here is where <folderName> stands." (Plan H1.3 target: 14 `#868B95`, "N documents need you · everything else is in sync.")
- **NEEDS YOU section label** (line 308): `font:600 11px/1 'JetBrains Mono'; letter-spacing:.12em; color:#5661c9` with a leading 6px pulse dot. (Plan H2.1 target: 10/600/.12em `#A3A8B2` - today it is accent-coloured 11px, not faint 10px.)
- **NEEDS YOU cards** (`needsCard`, lines 290-299): `max-width:520px; background:#fff; border:1px solid #e0e5fb; border-radius:15px; padding:20px 22px`; 3px accent top-border; `N TO APPROVE` amber mono pill; a 7px amber pulse dot (`lwdPulse 2.4s`); name 600 16px; Review button accent fill. Cards laid out `display:flex; gap:16px; flex-wrap:wrap`, sliced to first 2 (`pendingDocs.slice(0, 2)`). (Plan H2.2 target radius 13, name 14.5/600.)
- **Grid** (lines 352-355): the current section is labelled **"ALL PROJECTS"** (not "ALL DOCUMENTS"), a `repeat(cols,1fr)` grid, **gap 14**, `cols = tiles>=3 ? 3 : (2 ? 2 : 1)` - a **project/folder** grid (current folder tile + recent-folder tiles), NOT a per-document grid. Tiles: `border-radius:14px; padding:17px 18px; 24px avatar (radius 7)`. (Plan H3 target: rename to ALL DOCUMENTS, **4-col** grid, gap **12**, per-document cards with 26px avatar + status chip + source count + a dashed "＋ New document" tile. This is a substantial reshape: folder-grid -> doc-grid.)
- There is **no dashed "＋ New document" tile** in the grid today; new-doc is a header button + sheet.

Extra Home surfaces present today that the plan does not mention (context for the implementer - do not regress silently, but the v2 Home spec is calmer): the whole-project **ASK THIS PROJECT** composer (`renderHomeComposer`, 35-64), the **Tidy this project** surface (`renderTidy`, 70-131), the **WHILE YOU WERE AWAY / all-clear** feed (`renderAwaySection`, 136-170), the resume/demo walkthrough banner (`renderResumeBanner`, 182-199), and the failed-run attention line (302-306).

## Templates geometry today (`screenRenderTemplates.ts`, source literals)

- **Column** (line 100): `max-width:1080px; margin:0 auto; padding:28px 36px 80px`. (Plan T1.1 target: max **1180px**; and a 240px live-filter field in the title row - **no filter field today**.)
- **Header** (lines 98, 101-107): `<h2 class="scr-head">Templates</h2>` + sub-line "Reusable starting points for new documents." (Plan T1.2 target sub-line: "Start a living document from a pattern. Sources bind after creation." + header button "＋ New template".)
- **Count label** (line 102): mono "N TEMPLATES" (`font:600 11px/1 'JetBrains Mono'; letter-spacing:.12em; color:#a3a8b2`).
- **Card grid** (line 83): `grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:16px` - auto-fill, **not** a fixed 3-col. (Plan T2.1 target: YOUR TEMPLATES 3-col, gap 14.)
- **Card** (`card`, lines 30-41): `background:#fff; border:1px solid #e9eaee; border-radius:14px; padding:20px 20px 16px; gap:12px`. Anatomy: 34px 2-letter avatar (radius 9), name 600 15px, description 400 13px, mono count "N slots · M sources" (`countTemplateSlots(t.body)` + `t.sources.length`), then **"Use Template"** primary + **"Edit"** ghost. (Plan T2 target: radius 13, **110px skeleton thumbnail** rendered from the parsed template - **none today**; LWD chip; "Use" 26px button; mono "N bind slots · used N×" with a **real usage count** - today's meta has no usage count.)
- **No STARTERS row today** (plan T3 is net-new: 4 quieter built-in cards).
- **No "Save current doc as template" tile today** (plan T2.5 is net-new).

## Grep pointers (file:line, base `3ec16a6333e`)

Home + Templates render:
- `screenRenderHome.ts:252` `renderHome(state)` - the public Home entry. No-folder branch `:256-264`; empty-project front door delegate `:273-274`; greeting `:373`; summary `:284-286,374`; NEEDS YOU label `:307-310`; `needsCard` `:290-299`; ALL PROJECTS grid `:312-355,380-381`.
- `screenRenderHome.ts:228` `renderEmptyProjectFrontDoor(state, folderName)` - the folder-open-but-empty front door.
- `screenRenderHome.ts:389` `renderNewDocSheet(templates, hasSources)` - the name-or-template new-doc sheet (Blank row `:390-393`, From-sources row `:396-399`).
- `screenRenderHome.ts:205` `renderBirthSheets(state)` - new-doc + from-sources picker sheets.
- `screenRenderTemplates.ts:17` `renderTemplates(state)` - the public Templates entry; `card` `:23-42`; empty state `:64-81`; grid `:83`; from-examples wizard `:49-59`; generate sheet `:86-96`.

`screenEditor.ts` message handlers (the shared surface; plan 48/49 additive-only). `switch (message?.type)` at `screenEditor.ts:532`. Relevant to plan 48:
- `case 'openFolder'` `:688` -> `this._livingDocs.openFolder()`.
- `case 'newDocument'` `:693-694` -> `this._livingDocs.createDocument(message.name)` (the name-first flow).
- `case 'newFromSources'` `:699-700`; `case 'newTemplateFromExamples'` `:704-705`.
- `case 'openDoc'` `:707-708` -> `this._editors.openEditor({ resource: URI.parse(message.arg), options: { pinned: true } })` (plain open, no Review-tab deep link yet - the 45-a address model upgrades this in 48-c).
- `case 'editTemplate'` `:712-713`; `case 'newTemplate'` `:717-718` -> `createTemplate()`; `case 'generateFromTemplate'` `:722-723`.
- `case 'openFirstDoc'` `:751`; `case 'openRecentFolder'` `:755`; `case 'goTemplates'` `:607`; `case 'goAgents'` `:625`.
- No `useTemplate` / `saveAsTemplate` handler today (plan T2.4/T2.5 add these, additive).

Template discovery today (`.template.md` only; `.abstract/templates/` NOT discovered):
- Interface: `ITemplateInfo` `common/livingDocs.ts:254-263`; `listTemplates()` decl `common/livingDocs.ts:714-715`.
- Impl: `livingDocsService.ts:878` `listTemplates()` - walks every workspace folder via `_collectTemplates`, parses each with `parseLivingDoc`, keeps only files whose frontmatter has `template: true` (`doc.isTemplate`, `:888`), maps to `{ uri, name, description, sources, body }`, sorts by name.
- `livingDocsService.ts:1022` `_collectTemplates(dir, found, depth)` - recursive folder scan, depth cap 4, skips dot-dirs / `node_modules` / `out`, collects files matching `_isTemplateFile`.
- `livingDocsService.ts:2158` `_isTemplateFile(resource)` -> `resource.path.endsWith('.template.md')`. So today: any `*.template.md` with `template: true` frontmatter anywhere in the folder tree (depth <=4). **`.abstract/templates/` is not a discovery root** (and is in fact excluded, since `_collectTemplates` skips any dir starting with `.`). Plan T2.5/T2.6 (write to and discover `.abstract/templates/`) is net-new and will need `_collectTemplates` to stop skipping that specific dot-dir, or a second discovery root.
- Usage count for T2.3 ("used N×") does **not** exist today - `ITemplateInfo` carries no usage field; the lineage source noted in the plan is `templateName`/`fromTemplate` provenance recorded on generated docs (`common/livingDocsModel.ts:70-72` `templateName?` / `templateDescription?`, and `generateFromTemplate` "records `template: <name>` provenance", `common/livingDocs.ts:732-737`). A real count must be computed from that lineage, never hardcoded.

Name-first new-doc flow (plan 42) entry point:
- Command/handler: `screenEditor.ts:693-694` `case 'newDocument'` -> `createDocument(message.name)`.
- Service impl: `livingDocsService.ts:1224` `createDocument(name?)` - names as `<name>.md` (safe-stemmed via `_safeStem` `:1247-1249`), or `Untitled.md` on empty name (decision 56), writes `NEW_DOCUMENT_TEMPLATE`, opens pinned, fires `onDidChange`.
- UI entry points: Home header button + sheet `screenRenderHome.ts:373` (`data-msg="newDocument" data-sheet-open="newdoc"`), front-door button `:242`, blank sheet row `:390`.

## Traps hit

- **ENOSPC / disk full** was the dominant trap: the data volume was already at ~97-100% before this lane started (siblings' concurrent installs+compiles), and the first `npm install` aborted mid-extraction, leaving a corrupted `extensions/copilot/node_modules` (`ENOENT` on `tree-sitter-go.wasm` during `postinstall.ts`). Reclaimed ~9GB by clearing `~/.npm/_npx` (safe transient cache) and removing this lane's own partial installs; deferred the live build rather than starve sibling lanes. Live screenshots are the only outstanding deliverable.
- **`nvm use 24` did not persist across the profile re-source**: a shell that ran `source ~/.nvm/nvm.sh && nvm use 24` then printed `node -v` as v22 in a later part of the same compound command (the profile default reasserts). Fix: chain `nvm use 24` in the *same* command as the actual work, immediately before it - confirmed `v24.15.0` that way.
- **zsh no-match on `--include=*.ts`**: unquoted glob in grep args fails under zsh (`no matches found`). Quote the pattern (`--include="*.ts"`).
