# Studio de-IDE — merge-tax ledger

Every change in the "Studio" phase, tagged by tier. The point of the phase is to keep the
**core-patch** count near zero — each core patch is a liability that fights every upstream merge.
Tiers, cheapest first: `settings` -> `theme` -> `styleOverrides-CSS` -> `additive-contribution` ->
`core-patch`. (`our-surface` = code inside our own livingDocs contribution; carries no merge tax.)

| Item | Change | Tier | File(s) | Note |
|------|--------|------|---------|------|
| A | "Documents" view container + view (default primary sidebar) | additive-contribution | `livingDocs/browser/documentsView.ts`, `livingDocs.contribution.ts` | New container/view; no core edit |
| A | Hide the built-in File Explorer | additive-contribution | `livingDocs.contribution.ts` (`HideExplorerContribution`) | `deregisterViewContainer('workbench.view.explorer')` via the public registry — no patch to the files contrib |
| A | Workspace discovery + create (`listDocuments`, `createDocument`) | our-surface | `livingDocs/browser/livingDocsService.ts`, `common/livingDocs.ts` | Service additions only |
| B | "Abstract" color theme (full hi-fi palette) | theme | `extensions/theme-defaults/themes/abstract-color-theme.json`, `theme-defaults/package.json` | Registered theme; no per-key hacks |
| B | Set workspace theme; delete `colorCustomizations` | settings | `living-docs-sample/.vscode/settings.json` | Retired the accent-keys hack |
| C | Hide residual IDE chrome (watermark, editor group title, aux-bar title) | styleOverrides-CSS | `styleOverrides/browser/media/studio.css` (+ catalog entry) | New gated module; no core patch |
| C | Chat/Review/History tabbed right panel; branded doc header | our-surface | `livingDocs/browser/reviewRailView.ts`, `livingDocRender.ts` | Our webview/view surfaces |
| C | Make the Studio panel the default aux-bar container | additive-contribution | `livingDocs.contribution.ts` | `isDefault: true` on our container |
| C | Brand the window title | settings | `living-docs-sample/.vscode/settings.json` | `window.title`; product.json untouched |
| D | Document body type ramp / spacing / KPI / diff card to hi-fi | our-surface | `livingDocs/browser/livingDocRender.ts` | Our webview |
| E | First-run: close Welcome editor, reveal Studio panel | additive-contribution | `livingDocs.contribution.ts` (`StudioStartupContribution`) | Startup contribution; no core patch |
| F | Provenance gutter redesign (line numbers, dots, spanning bars) | our-surface | `livingDocs/browser/livingDocRender.ts` | Our webview |
| G | "Download as Markdown" export + format-options memo | our-surface | `livingDocRender.ts`, `livingDocsService.ts`, `docs/plans/04-file-format-options.md` | Service/webview + docs |

### Build-out round (this update) — the rest of the comp's surfaces, still 0 added core patches

| Item | Change | Tier | File(s) | Note |
|------|--------|------|---------|------|
| BO1 | Home / Templates / Knowledge / Agents screens (webview editor) | our-surface + additive-contribution | `livingDocs/browser/screenRender.ts`, `screenEditor.ts`, `screenEditorInput.ts` | Generic webview editor pane + input registered via public `IEditorPaneRegistry`; HTML is our surface |
| BO2 | Icon-nav containers + launcher views (Home/Templates/Knowledge/Agents) | additive-contribution | `livingDocs/browser/screenLauncherView.ts`, `livingDocs.contribution.ts` | New activity-bar view containers + views via public registry; launcher opens the screen editor |
| BO3 | Open-screen palette commands | additive-contribution | `livingDocs.contribution.ts` | `registerAction2` per screen; public API |
| BO4 | Present & export modal + share scope | our-surface | `livingDocRender.ts`, `livingDocEditor.ts` | Overlay inside our document webview; wired to existing exports |
| BO5 | Chat / History / Skills panel tabs (Skills new) | our-surface | `livingDocs/browser/reviewRailView.ts` | Our view; static comp content + real `approve()` from Chat |
| BO6 | Show the activity bar (it is the comp's icon nav) | settings | `living-docs-sample/.vscode/settings.json` | `activityBar.location: default` (was `hidden`) |
| BO7 | Hide built-in IDE containers (Search/SCM/Debug/Extensions, + Explorer) | additive-contribution | `livingDocs.contribution.ts` (`HideIdeContainersContribution`) | `deregisterViewContainer` per id via public registry; see HIGH-risk note below |
| BO8 | First-run opens the Home dashboard | additive-contribution | `livingDocs.contribution.ts` (`StudioStartupContribution`) | Opens our screen editor when no editor is restored |

### Format round (this update) — clean-file + lock format and the dependency graph, still 0 added core patches

| Item | Change | Tier | File(s) | Note |
|------|--------|------|---------|------|
| F1 | Clean-file bind-link format: parser/serializer + model | our-surface | `livingDocs/common/livingDocMarkdown.ts`, `common/livingDocsModel.ts` | Replaces the HTML-comment scheme; pure functions in our contrib |
| F2 | `.lock.json` schema + read/write seam (lock is source of truth) | our-surface | `livingDocs/common/livingDocsModel.ts`, `browser/livingDocLockStore.ts`, `browser/livingDocsService.ts` | `SidecarLockStore` behind `ILockStore`; swap to platform-store is trivial |
| F3 | Always-on staleness dirty bit + correlated source watcher | our-surface | `livingDocs/browser/livingDocsService.ts` | `fileService.createWatcher` (public API), per-doc; no core edit |
| F4 | Context panel (influence sources + freshness) | additive-contribution | `livingDocs/browser/contextPanelView.ts`, `livingDocs.contribution.ts` | New sidebar view container/view via public registry |
| F5 | Review-impact pass + prose-claim anchoring | our-surface | `livingDocs/browser/livingDocsService.ts`, `contextPanelView.ts` | Model-or-heuristic; routes through the existing review rail |
| F6 | Migrate the sample docs to the new format | our-surface | `living-docs-sample/*.md` (+ `market-research.md`) | Sample content only |

### Orchestration round (this update) - triggers, graph event-bus, policy, verify gate, still 0 added core patches

| Item | Change | Tier | File(s) | Note |
|------|--------|------|---------|------|
| O1 | Agent registry + dependency-graph event-bus (reverse-edge propagation) | our-surface | `livingDocs/browser/agentOrchestrator.ts`, `agentStore.ts`, `common/livingDocsModel.ts` | `WorkspaceAgentStore` (agents.json) behind an `IAgentStore` seam; one write -> reverse-edge walk -> dirty queue |
| O2 | Trigger layer: event + cron/heartbeat + manual | our-surface | `livingDocs/browser/clock.ts`, `agentOrchestrator.ts`, `livingDocsService.ts` | `IClock`/`RealClock` (mainWindow.setInterval) - a thin injectable clock, no framework; correlated watcher routes to the orchestrator |
| O3 | Per-edge policy router (auto / ask / draft) | our-surface | `livingDocs/browser/livingDocsService.ts`, `common/livingDocsModel.ts` | figure changes routed by policy through the run host |
| O4 | Verify gate: Skills as graders (Financial deterministic-first) | our-surface | `livingDocs/browser/livingDocsService.ts` | gate between rewrite and apply; failed grader blocks the run |
| O5 | Lifecycle hooks: before-export gate, on-publish pin, on-open freshness | our-surface | `livingDocs/browser/livingDocsService.ts`, `common/livingDocs.ts` | uses the pins[] field reserved in the format round |
| O6 | Live Agents view + workflow canvas (POLICY column, real status, Run now) | our-surface | `livingDocs/browser/screenRender.ts`, `screenEditor.ts` | the previously-static comp HTML now renders from the registry |

No framework was added (spec 09 section 8): the inner loop reuses `ILanguageModelsService` + the heuristic fallback, triggers reuse `fileService.createWatcher` + `IRequestService` + a thin clock, and durable state is the lock + `agents.json`. The orchestration logic (graph event-bus, policy, verify gate, review rail) is our own product code.

### v1 functionality round (plan 09, PR #13) - still 0 added core patches

| Item | Change | Tier | File(s) | Note |
|------|--------|------|---------|------|
| V1 | Chat agent (composer, @mention, model reply, tool-steps, proposed edits -> Review) | our-surface | `livingDocs/browser/reviewRailView.ts`, `livingDocsService.ts`, `common/livingDocs.ts` | Built on `_callModel`; edits route through the existing approve loop |
| V2 | Apply-fix (Formatting title-cases flagged headings in place) | our-surface | `livingDocs/browser/livingDocsService.ts`, `reviewRailView.ts` | `applySkillFix`; deterministic |
| V3 | Source-peek + "Sync across" figure diff | **our-surface, but used `SIDE_GROUP`** | `livingDocs/browser/livingDocsService.ts`, `livingDocEditor.ts`, `livingDocRender.ts` | **Regression:** opens a VS Code editor group beside the doc -> split/blank pane. **To be reversed in v2 (in-surface panel).** |
| V4 | Context kinds (Images/Pasted text/Company knowledge) + Add context | our-surface | `livingDocs/common/livingDocsModel.ts` (`IAddedContext` on the lock), `contextGroups.ts`, `contextPanelView.ts`, `livingDocsService.ts` | Typed context persisted in the lock |
| V5 | Doc subtitle tracks the resolved week | our-surface | `livingDocs/browser/livingDocsService.ts` | `_resolveSubtitle` on load + sync |

### v2 design-alignment loop (plan 11) - core-patch policy CHANGE

The v2 shell pass ([11-design-alignment-loop.md](11-design-alignment-loop.md)) **permits added core
patches where the design genuinely requires them** (decision log 22), reversing the strict 0-core rule
for the shell only. Each must be logged here with its tier + justification, and counts as **evidence
toward greenfield (Q3)**. Always prefer the cheapest tier that works; reach for `core-patch` last.
Expected candidates: the single-surface layout (no editor groups / source-peek as an in-surface panel,
reversing V3's `SIDE_GROUP`), the bespoke left tree-rail, removing IDE optionality (drag/split/
reopen-with/palette/group-close), and excluding the unused first-party builtins that 404 in the dev run.

**v2 iter 2 — kill the split-pane abrasion (the first expected candidate above): 0 core patches.**
Source-peek + Sync-across moved fully in-surface entirely inside the `livingDocs` contrib: removed the
two `SIDE_GROUP` `openEditor` calls (`revealSource`/`openSourceBeside`) in `livingDocsService.ts`,
replaced them with a pure `getSourcePeek` data method, and rendered the pane + floating Sync circle in
the existing `livingDocEditor` webview (`livingDocRender.ts`). Tier reached: **additive-contribution**
(no `styleOverrides`, no theme, no core file touched). The single biggest expected core-patch candidate
turned out contrib-only — mild evidence the fork can still de-IDE without core forks (Q3).

**v2 iter 3 — the left tree-rail (the second expected candidate above): 0 core patches.**
Built one `TreeRailView` (a standard `ViewPane`, like the old DocumentsView) with internal Files /
Context / Outline / Search tabs + a folder tree, registered as the single default sidebar container;
folded the separate Documents + Context containers into it (deleted `documentsView.ts` +
`contextPanelView.ts`). Pure helpers in `common/treeRail.ts`. Tier reached: **additive-contribution** —
the tabbed rail was reachable as one DOM-rendered view without touching the activity-bar/part core. The
**residual** 76px labeled icon-nav (vs VS Code's ~48px activity bar) + making Home/Templates/etc. pure
nav may need a `styleOverrides`-CSS or core seam; deferred to a later iteration and re-evaluated then.

**v2 iter 4 — calm the header (the third expected candidate above): 0 core patches.**
Entirely inside the doc webview (`livingDocRender.ts`): collapsed the 2-row header to the comp's single
bar (removed Download + the standalone Refresh button + the persistent formatting-toolbar row), made the
sync pill the refresh affordance, moved formatting to a floating selection toolbar, and relocated the
raw-Markdown toggle to the footer. Tier reached: **additive-contribution** (webview HTML/CSS/JS only; no
core file, no `styleOverrides`). The doc header is our own surface, so calming it never approached core.

**v2 iter 5 — remove IDE chrome (the fourth expected candidate above): 0 core patches.**
Added three rules to `styleOverrides/browser/media/studio.css` (the existing `.style-override-studio`
chrome-removal sheet) to hide the modernUI menubar hamburger ("Application Menu") and the Accounts +
Manage global activity-bar actions. Tier reached: **styleOverrides-CSS** — one tier above
additive-contribution, still no core file touched. **Residual** (a full G4 pass): the raw command-palette
keybinding and pane-resize sashes are core-owned; removing those (not just their UI surface) is the one
place G4 may finally need a `core-patch` — deferred and re-evaluated when tackled.

**v2 iter 6 — exclude IDE-only builtins (gate G6): the FIRST v2 CORE PATCH (1 added).**
`src/vs/workbench/services/extensionManagement/browser/builtinExtensionsScannerService.ts` — a 3-id
denylist (`vscode.emmet`, `vscode.git-base`, `vscode.merge-conflict`) filtered out of the scanned web
builtins. These IDE-only builtins are irrelevant to a word processor AND their web bundle 404s in the
dev run (the "Activating extension failed" toasts). Tier: **core-patch** — the builtin set is injected
(dev DOM / prod build) and read only here, so the scanner is the single clean exclusion point.
- **Merge-tax cost:** minimal/low-fragility. One small filter guarded by a named const; survives rebases
  unless the scanner is rewritten. Re-pin check: confirm the const + `.filter(...)` line still sit before
  `this.builtinExtensionsPromises = bundledExtensions.map(...)`.
- **Greenfield evidence (Q3):** the entire v2 calm shell (source-peek in-surface, tree-rail, calm header,
  chrome removal, builtin exclusion) needed exactly **one** tiny core seam — the fork de-IDEs cheaply.

**v2 iter 8 — inline bound-figure highlighting (doc G5 pixel-align): 0 core patches.**
Entirely in `livingDocRender.ts`: bound prose wraps each resolved figure in a `.bound` span (tokenize
before the Markdown renderer, swap after). Tier: **additive-contribution** (webview only).

**v2 iter 9 — the 76px labeled icon-nav (G3): the SECOND v2 CORE PATCH (1 added).**
`src/vs/workbench/browser/parts/activitybar/activitybarPart.ts` — `ACTIVITYBAR_WIDTH 48 -> 76` so the
grid allocates the comp's wider rail; the label under each icon is then added by `studio.css`
(styleOverrides-CSS, `::after { content: attr(aria-label) }`). The guard test
(`activitybarPart.test.ts`, "default constants...") was updated 48 -> 76 (it asserts the constant value).
Tier: **core-patch**. Low fragility (one constant + its guard test); re-pin check: the constant is 76 and
the test expects 76.
- **Greenfield evidence (Q3):** two tiny core constants/seams (builtin denylist + activity-bar width)
  were the *only* core patches needed for the whole v2 calm shell — the de-IDE is overwhelmingly
  reachable via contributions + styleOverrides.

**v2 iter 7 — pin the shell widths (right-rail pixel-align): 0 core patches.**
`StudioStartupContribution` calls `IWorkbenchLayoutService.setSize` (a public service) after revealing
the rail + a layout tick, to pin the tree-rail to 264px and the right rail to 392px (the comp). Tier:
**additive-contribution** — no core file touched. (The grid redistributes to ~252/374, near- not
exact-pixel, but well toward the comp from the cramped 246/282 defaults.)

### v3 design-alignment loop (plan 12) - G4 closure: 3 added core patches (all sanctioned by the plan)

**v3 iter 2 - fully close G4 (remove the last reachable IDE optionality): 3 CORE PATCHES.** The plan
explicitly sanctions core patches for G4 ("Remove, don't just hide. These are core-owned"). All three are
small, additive-in-spirit (remove a default, add an opt-in lock), and product-correct for a calm shell.

| # | Change | File | Tier | Fragility / re-pin check |
|---|--------|------|------|--------------------------|
| 1 | Remove the command-palette keybinding + palette listing (`ShowAllCommandsAction`: drop `keybinding` Cmd/Ctrl+Shift+P/F1, set `f1:false`; drop 3 now-unused imports) | `src/vs/workbench/contrib/quickaccess/browser/commandsQuickAccess.ts` | **core-patch** | LOW / fails *soft* (a rebase that restores the field just re-adds a keybinding - cosmetic regression, re-drop it). The command still exists for programmatic callers. |
| 2 | Remove the Quick Open (Go to File) keybinding (`workbench.action.quickOpen`: drop `keybinding` Cmd/Ctrl+P, Cmd/Ctrl+E, set `f1:false`) so command mode (the `>` prefix) is unreachable | `src/vs/workbench/browser/actions/quickAccessActions.ts` | **core-patch** | LOW / fails *soft*. `globalQuickAccessKeybinding` is retained (still used by the in-picker navigate rules). |
| 3 | ~~Global sash lock: `lockAllSashes()` coerces every `Sash` to `SashState.Disabled`~~ | ~~`src/vs/base/browser/ui/sash/sash.ts`~~ | ~~core-patch~~ **REMOVED** | **REVERTED (issue #173, bundle-c).** The global sash lock made every rail non-resizable, which users read as broken, not calm. `sash.ts` is now byte-identical to upstream stock (the whole `globalSashesLocked` / `liveSashes` / `lockAllSashes` machinery is gone), and `LockLayoutSashesContribution` is deleted from `livingDocs.contribution.ts`. Rail resizing is now governed by the stock part-level minimum widths (170px) with no maximum; the 264/392 defaults are seeded ONCE per profile by `RailVisibilityContribution` (first-run only, storage-backed) and the workbench persists the user's dragged width natively thereafter. **Core-patch count: 3 -> 2 in v3, 5 -> 4 total.** |

All three remove/neutralise an *affordance* rather than re-architecting core; each fails toward *showing
IDE optionality* on a bad rebase, so re-pin them in the G4 checklist. **G4 now FULLY passes** (palette
keybindings dead: Cmd+Shift+P / F1 / Cmd+P all no-op) - verified live, iter 2. (The sash-lock half of
this G4 claim was later REVERTED for issue #173: rails are draggable again by design - see the
struck-through row 3 above and the bundle-c section below.)

### v6 chat-on-document loop (plan 14) iter 1 — settle + prove: still 0 added core patches

The three foundations (OpenRouter, native Explorer, ProseMirror) all landed **additively / in our own
surfaces** — no core patch. Notably the de-IDE work is *relaxed* (G4, decision 42) by *removing one id from
our own deregister list*, not by patching core.

| # | Change | Tier | File(s) | Note / re-pin check |
|---|--------|------|---------|---------------------|
| V6-1 | Re-enable the native File Explorer (drop `workbench.view.explorer` from the hide-list) | additive-contribution | `livingDocs/browser/livingDocs.contribution.ts` | Our own `HideIdeContainersContribution`; Search/SCM/Debug/Extensions stay hidden. Relaxes G4 (decision 42). No core edit. |
| V6-2 | Vendored ProseMirror IIFE bundle (base64 in a `.ts`) + decode/inline into the doc webview; `pmEdit` message → silent persist | our-surface | `livingDocs/browser/prosemirrorBundle.ts` (generated), `livingDocRender.ts`, `livingDocEditor.ts`, `livingDocsService.ts` (`saveRawText` gains `{silent}`), `common/livingDocs.ts` | All inside our contribution. The bundle is a `.ts` (base64) so it needs **no** `.eslint-allowed-javascript-files` entry and trips no non-ASCII/`querySelector` hygiene gate. Decision 43. |
| V6-3 | OpenRouter as the default proxy backend | our-surface | `scripts/lwd-anthropic-proxy.sh` | Script-only; app code unchanged (renderer always speaks the Anthropic Messages shape to the proxy). Decision 44. |

_Residual to retire in build-order #1:_ the 367KB bundle is re-inlined on every webview render (blank-on-reopen); moving it to a webview resource (`asWebviewUri`) removes the re-inline and is still our-surface.

### Redesign round — plan 25 iter 1 (the labeled 76px nav + Editor entry): 0 ADDED core patches

**D25-A outcome — CSS/styleOverrides + settings, NO new core patch.** The plan flagged the labeled
76px nav as "the one item expected to need a core patch." On audit, the core patch it would take
**already exists**: `ActivitybarPart.ACTIVITYBAR_WIDTH = 76` (`activitybarPart.ts:52`) landed in **v2
iter 9** (see that entry above), and the label layer is the `styleOverrides` `studio.css`
`::after { content: attr(aria-label) }` rule. So iter 1 needed **zero new core touches** — the width
seam was paid for once, in v2. Everything iter 1 changed sits in the cheap tiers:

| # | Change | Tier | File(s) | Note / re-pin check |
|---|--------|------|---------|---------------------|
| 25-1a | Re-pin the nav tokens to Part B/C1: `panel` bg `#F6F7F9`, 60px item, 18px glyph, 10px label | styleOverrides-CSS | `styleOverrides/browser/media/studio.css` | Extends the existing `.style-override-studio .part.activitybar` block (bg + `width:60px` + `::before{font-size:18px}`); appearance-only, fail-soft. No core edit. |
| 25-1b | Register the **Editor** nav item (container + launcher view + palette command), ordered first-after-Home; screens re-ordered to 1/3/4/5 around it | additive-contribution | `livingDocs/browser/livingDocs.contribution.ts`, `livingDocs/browser/editorNavLauncherView.ts` (new) | New activity-bar view container + view via the public registry + a `registerAction2`, exactly like the existing Home/Templates/Knowledge/Agents entries. D25-B open logic reuses `IEditorService`/`IHistoryService`/`ILivingDocsService.listDocuments()`. No core edit. |
| 25-1c | Give the `:8080` brief root its own `.vscode/settings.json` (mirror of the parent sample) so the shell (activity bar / modernUI) renders as designed | settings | `living-docs-sample/brief/.vscode/settings.json` (new) | Sample content only; a subfolder opened as its own root does not inherit the parent workspace settings, so the served brief root needed its own copy. Reversible; no app/core code. |

**Core-patch count is unchanged by plan 25 iter 1: still 5 total** (the 76px width patch is one of those
5, from v2 iter 9 — not double-counted here). **Greenfield evidence (Q3):** the item the plan singled
out as the most likely fresh core patch cost **0 new core** this iteration — the one seam it needs was
already paid, and the labeled layout + the new Editor nav ride entirely on styleOverrides CSS + additive
contributions.

### Redesign round — plan 25 iter 2 (active chip + bottom pins + nav tidy): 0 ADDED core patches

**C1 finish — the active white chip, the bottom-pinned account/settings, and the clean 5-item nav all
landed our-surface. NO new core patch.** The active-chip driver was the only place a core touch was
plausible (marking an activity-bar item as active), but it was avoidable: the item's own `.checked`
state tracks the sidebar container (always the bounced-back Workspace rail), so it was the wrong signal
anyway. A tiny contribution reads `IEditorService` and toggles a class instead — no `activitybarpart`
edit.

| # | Change | Tier | File(s) | Note / re-pin check |
|---|--------|------|---------|---------------------|
| 25-2a | Active white chip driven by the active editor: `ActiveNavChipContribution` toggles `lwd-nav-active` on the matching nav `.action-item`; `studio.css` paints white chip + `#4650B8` glyph + e1 off that class | additive-contribution + styleOverrides-CSS | `livingDocs/browser/livingDocs.contribution.ts`, `styleOverrides/browser/media/studio.css` | Reads `IEditorService.onDidActiveEditorChange` + the activity-bar part container via `IWorkbenchLayoutService.getContainer(mainWindow, Parts.ACTIVITYBAR_PART)`, then walks its descendants via `element.children` and matches by the known `codicon-living-docs-<id>` classes + `.closest('.action-item')` (activity bar has no per-item API). Avoids the banned query APIs (`querySelector`/`getElementsByClassName`/`getElementsByTagName`), so hygiene is clean. Re-pin if the `living-docs-<id>` icon ids move. No core edit. |
| 25-2b | Account + settings styled + confirmed pinned bottom (reverses 25.1's hide of them) | styleOverrides-CSS | `styleOverrides/browser/media/studio.css` | The core `GlobalCompositeBar` already renders them as `.content`'s last child, floated down by the core `.composite-bar{margin-bottom:auto}` — CSS only styles them (44px, faint glyph, no label). Functionality untouched. No core edit. |
| 25-2c | **Nav tidy (W1/D25-C):** deregister the Explorer container; hide the Workspace container's activity-bar icon (keep the container) | additive-contribution + styleOverrides-CSS | `livingDocs/browser/livingDocs.contribution.ts` (`+'workbench.view.explorer'` in `IDE_VIEW_CONTAINER_IDS`), `styleOverrides/browser/media/studio.css` (`:has(codicon-living-docs-workspace){display:none}`) | **Revises decision 42 / ledger row V6-1** (which had re-added the Explorer icon). Uses the existing `HideIdeContainersContribution` for Explorer (public registry `deregisterViewContainer`) — so the Explorer now rejoins the HIGH-risk "fails-unsafely on id rename" set (see note below). The Workspace icon is hidden by CSS only; its container stays `isDefault`, so the 264px tree-rail is unaffected (verified live). No core edit. |
| 25-2d | Minors from 25.1 review: (M1) distinct `livingDocs.editorIcon` NLS key for the Editor icon; (M3) drop the `_register(...)` wrapper on the fire-and-forget `disposableTimeout` in `editorNavLauncherView` (was leaking one dead disposable per visibility change) | our-surface | `livingDocs/browser/livingDocs.contribution.ts`, `livingDocs/browser/editorNavLauncherView.ts` | Correctness/hygiene only. No core edit. |
| 172-a | **Restore the labelled icon-nav (issue #172):** drop the `'workbench.activityBar.location': 'hidden'` config default so the 76px nav renders in folder windows | additive-contribution | `livingDocs/browser/livingDocs.contribution.ts` | The activity bar is the fork's labelled icon-nav; hiding it stranded folder windows with no navigation. Real user-overridable setting. No core edit. |
| 172-b | **Fix the dead studio styling seam (issue #172):** `studio.css` was gated on `.style-override-studio`, a class nothing sets — the upstream style-override refactor (#322532) consolidated every module to a single `.style-override` class but this fork file was left behind, so the labelled nav / chrome removal / Workspace-icon hide were all inert. Re-key studio.css to `.style-override` and default `workbench.experimental.modernUI: true` so the StyleOverridesContribution actually applies it | our-surface (CSS) + additive-contribution (config default) | `styleOverrides/browser/media/studio.css`, `livingDocs/browser/livingDocs.contribution.ts` | studio.css is fork-authored (Item C), so re-keying it is not a core patch. `modernUI` is a real user-overridable setting. Verified live: five labelled nav items render, Workspace icon hidden, active chip tracks the surface. No core edit. **Re-pin check:** if a future upstream sync renames the toggle class again, re-key studio.css to match the other module CSS files. |

**Core-patch count is unchanged by plan 25 iter 2: still 5 total at that time** (later reduced to **4** when issue #173 reverted the sash lock — see the authoritative count in the section below). The C1 finish (chip + pins + tidy)
rode entirely on styleOverrides CSS + two small additive contributions. **Greenfield evidence (Q3):**
the whole labeled-nav row (plan 25, the item flagged as most likely to need core work) landed across two
iterations at **0 new core patches**. The residual coupling it adds is the codicon-class DOM reach
(fragile-on-rename, but hygiene-clean) — appearance wiring, not a behavioural fork.

### Redesign round — plan 25 iter 3 (regression sweep + design polish): 0 ADDED core patches

**Final iter: the regression sweep (all surfaces at 76px), two small design-polish CSS rules, and the
desktop-smoke decision. NO new core patch.** Both polish gaps closed in `studio.css` only.

| # | Change | Tier | File(s) | Note / re-pin check |
|---|--------|------|---------|---------------------|
| 25-3a | Close the inactive-glyph colour gap: `#606060` (the `activityBar.css :not(.checked)` `!important` rule, tied at (0,9,0) and winning on source order) -> `#868B95` (comp C1). Added the real `.composite-bar` ancestor to the studio inactive-glyph selector to reach (0,10,0) and win outright | styleOverrides-CSS | `styleOverrides/browser/media/studio.css` | Appearance-only. Re-pin if the composite-bar class name changes. No core edit. |
| 25-3b | Add the 1px divider after Editor: a `34px x 1px` `#E4E6EA` hairline with `4px` vertical margin, rendered as a `::before` on the Templates item (matched by its stable `codicon-living-docs-templates` class, mirroring the workspace-hide rule); the Templates item is made `display:flex; flex-direction:column; align-items:center` so the divider centres above its label | styleOverrides-CSS | `styleOverrides/browser/media/studio.css` | Appearance-only; matches the comp's `<div style="width:34px;height:1px;background:#e4e6ea;margin:4px 0">`. Re-pin if the icon id or nav grouping changes. No core edit. |

**Core-patch count is unchanged by plan 25 iter 3: still 5 total.** The whole plan-25 stack (iters 1-3,
the row flagged as most likely to need core work) landed at **0 new core patches** — the one seam it
needs (the 76px `ACTIVITYBAR_WIDTH`) was paid once in v2 iter 9. **Desktop real-disk smoke: deferred**
(matching decision 71's precedent) — iter 3 changed only appearance CSS, and driving the Electron build
is impractical from the browser-bound chrome-devtools session; a 2-minute manual desktop check should
confirm the 76px labeled nav + active chip render in the packaged workbench.

### Shell-integrity round — plan 33 iters 1-2 (title-bar identity + project naming): 0 ADDED core patches

Plan 33's own cap was "at most 1 new core patch (the title-bar command centre, if settings cannot fully
remove it)". Settings reached everything, so **iters 1-2 took 0 core patches** (patch budget untouched;
count stays 5 total). Decisions #95-#96.

| # | Change | Tier | File(s) | Note / re-pin check |
|---|--------|------|---------|---------------------|
| 33-1a | Hide the residual title-bar chrome on the screen surfaces (command-centre "Review Project" pill, layout-toggle icons, editor-group action icons) by adding `window.commandCenter:false`, `workbench.layoutControl.enabled:false`, `workbench.editor.editorActionsLocation:'hidden'` to the decision-54 `registerDefaultConfigurations` block | settings (additive config-default) | `livingDocs/browser/livingDocs.contribution.ts` | Real user-overridable settings; keys verified against `layoutService.ts` (`LayoutSettings.COMMAND_CENTER`/`LAYOUT_ACTIONS`) + `parts/editor/editor.ts` (`editorActionsLocation` enum). No core edit. Re-pin if VS Code renames these settings. |
| 33-1b | Window/tab title template `${activeEditorShort}` -> `${rootName}${separator}Abstract` (project name then brand; collapses to "Abstract" with no folder) | settings (additive config-default) | `livingDocs/browser/livingDocs.contribution.ts` | Standard `window.title` token template. No core edit. |
| 33-1c | Fix the residual old-brand leak in the two sample settings files: drop the stale `window.title:"Opportunity OS"` (the new default applies) and correct `workbench.colorTheme:"Opportunity OS"` -> `"Abstract"` (the theme was renamed to "Abstract" in `theme-defaults/package.json`; the old label no longer resolved) | sample content | `living-docs-sample/.vscode/settings.json`, `living-docs-sample/brief/.vscode/settings.json` | Sample data, not core. |
| 33-2a | Truthful project display name: new pure `projectDisplayName` helper + a `getProjectDisplayName()` service getter reading a cached `.abstract-name` marker; used by `ScreenEditor._render` for the user-facing folder name so the web/memfs "mount" stub shows the sample's real name | our-surface (`common/` helper + service getter + render call) | `livingDocs/common/projectDisplayName.ts` (new), `livingDocs/common/livingDocs.ts`, `livingDocs/browser/livingDocsService.ts`, `livingDocs/browser/screenEditor.ts` | No core edit. The marker read is fail-soft (missing marker -> real folder name, never fabricated). |
| 33-2b | Ship the `.abstract-name` marker in both samples + add `**/.abstract-name` to the `files.exclude` config-default so it stays invisible plumbing | sample content + settings | `living-docs-sample/.abstract-name`, `.../brief/.abstract-name`, `livingDocs/browser/livingDocs.contribution.ts` | Sample data + an additive object-merge exclude (same route as `.lock.json`/`agents.json`). No core edit. |

**Core-patch count is unchanged by plan 33 iters 1-2: still 5 total.** The one item the plan pre-flagged
as possibly needing a core patch (the title-bar command centre) was fully removed by the `window.commandCenter`
setting — no patch needed. **Desktop window-title verification deferred** (matching decision 71/93's
precedent): the web build cannot exercise the OS-level window title bar, and driving the packaged Electron
build is impractical from the browser-bound chrome-devtools session; the title template + settings are
correct by construction, and web verifies the on-surface chrome removal. Iters 3-4 (keyboard/menu audit,
Present honesty, the seam-check script) are out of scope for this work unit.

### Shell-integrity round — plan 33 iters 3-4 (keyboard/menu audit + Present honesty + the seam gate): 0 ADDED core patches

Plan 33's cap for the whole plan was at most 3 new core patches. Iters 1-2 took 0; **iters 3-4 also take 0**
(count stays 5 total). The keyboard neutralisation is an additive contribution (a public registry call from
our own module), not a decision-30-style core edit, so the plan's "extend decision-30 if a chord is
core-registered and user-visible" branch was not needed. Decisions #110-#111.

| # | Change | Tier | File(s) | Note / re-pin check |
|---|--------|------|---------|---------------------|
| 33-3a | Neutralise 8 residual IDE chords (`Cmd+J` panel, `Ctrl+`` `` ` terminal, `Cmd+Alt+B` secondary side bar, `Cmd+Shift+E/F/G/X/M` view-container switches) by shadowing each with the built-in `noop` command via `KeybindingsRegistry.registerKeybindingRule` at weight 1000 | additive contribution (public keybinding registry) | `livingDocs/browser/livingDocs.contribution.ts` (`NEUTRALISED_IDE_CHORDS`) | No core edit. `Cmd+B` (side-bar / Bold) deliberately KEPT. Guarded by check-seams seam 8. Re-pin if upstream changes a default chord (the audit cites each source). |
| 33-3b | Keyboard + context-menu audit doc with a verdict per chord and the L7 context-menu findings (webviews show no IDE items; title-bar OS chrome recorded as accepted desktop-only residue) | docs | `docs/plans/33-verify/keyboard-audit.md` | Documentation only. |
| 33-4a | Present honesty (L8): the `↗ Present` modal now offers only the two exports Abstract genuinely writes - a self-contained HTML page and clean Markdown - each wired to a real writer (`exportDocument`/`exportMarkdown`); the four native-format/cloud destinations are shown honestly as non-selectable "Soon" rows. Removes the fabricated hosting/shareable-URL/access-scope UI (which also carried an old-brand `opportunity-os.live` string) | our-surface (render + editor) | `livingDocs/browser/livingDocRender.ts`, `livingDocs/browser/livingDocEditor.ts` | No core edit. Defensive: a "Soon" choice that somehow arrives falls back to the HTML export, never a dead end. |
| 33-4b | The executable seam gate: `scripts/check-seams.sh` mechanically asserts every ledger shell seam (the 5 deregistered container ids still exist upstream + stay deregistered, `ACTIVITYBAR_WIDTH===76`, the builtin denylist, the palette/quick-open `f1:false` absence + no re-added keybinding, the sash-lock fn + call site, the `studio.css` selectors, the iter-1/2 identity defaults, the chord neutralisation). Exits non-zero naming the first broken seam | tooling (shell script) | `scripts/check-seams.sh` | Run next to `valid-layers-check`. Passes clean on this branch; verified to fail loud (exit 1, named seam) when a hide-list id is renamed. |

**Core-patch count is unchanged by plan 33 iters 3-4: still 5 total.** The whole of plan 33 (iters 1-4)
added **0 core patches** against a 3-patch cap - every leak was reachable through settings, our-surface, and
additive-contribution tiers.

**Running the seam gate (validation step, next to `valid-layers-check`):** `./scripts/check-seams.sh` -
exit 0 = all shell seams intact; exit 1 names the broken seam(s) to re-pin per this ledger. Wire it into the
per-PR validation alongside `npm run typecheck-client` and `npm run valid-layers-check` for any change that
touches the de-IDE seams.

## Core-patch count: **8 added total** = 2 in v2 (iter 6 builtin exclusion + iter 9 activity-bar width) + **2 in v3** (iter 2 G4 closure: palette keybinding, quick-open keybinding; the sash lock was REVERTED for issue #173, see the struck-through row above) + **1 in plan 40 export round** (A2-1 native `printToPDF`) + **1 in bundle K** (issue #182 K2: nullish-guard in `ViewsService.getActiveViewPaneContainer`) + **2 in the Editor v2 wave** (V2-1 `FLOATING_PANEL_MODERN_FRAME_INSET`, PR #218; V2-2 `ABSTRACT_HEADER_HEIGHT`, PR #219 - both budgeted up front by decision 169, asserted by check-seams seams 9/9b/10) + 0 from earlier rounds (this phase + build-out + format + orchestration + v1) + **0 in v5 (realdocs) + 0 in v6 iter 1 (chat-on-doc foundations)** (1 pre-existing, from the engine phase). v2/v3 (plans 11/12) permit these - all are one-line/one-field/one-flag, low-fragility, fail-soft, product-correct. The wave hit its 2-seam budget exactly (decision 169); check-seams records exactly 2 wave seams.

The Studio de-IDE (Items A–G) added **zero new patches to upstream VS Code core**
(`src/vs/base|platform|editor|workbench/browser|workbench/api` were untouched this phase). To be
precise, though: the feature as a whole carries **one** core edit — a single contribution-registration
import line in `src/vs/workbench/workbench.common.main.ts` (added in the engine phase, Items 0–5, so it
predates the Studio merge-base and doesn't show in this phase's diff). It is the standard, low-fragility
way every contribution registers; but it *is* a core-owned file, so the honest headline is "0 **added**
this phase," not "0 in the feature." Everything else landed through the cheap tiers:
- **settings** — the calm ~80% (hidden activity bar / tabs / status bar / menu / command center, theme).
- **a registered theme** — the full palette, no per-key `colorCustomizations` hacks.
- **styleOverrides CSS** — chrome removal, added inside the fork-owned `contrib/styleOverrides/` exactly
  as that subsystem intends.
- **additive contributions** — the Documents home, the tabbed right panel, hiding the Explorer (public
  `deregisterViewContainer`), and the first-run startup behaviour — all our own files / public registry APIs.

> Deferred (not blocking): a fully styled **source pane** (the hi-fi CSV viewer). Provenance reveal
> already works (clicking a dot opens the bound source); the bespoke source viewer is a follow-up.

### Where the residual tax actually lives (per-seam fragility)
Zero added core patches does not mean zero upstream coupling. The additive route leans on internal seams
a VS Code rebase could break, ordered worst → best.
**Every seam below is now asserted mechanically by `scripts/check-seams.sh` (plan 33 iter 4)** - run it
after a rebase; it exits non-zero naming the first broken seam so re-pinning is executable, not tribal.
- **HIGH / fails *unsafely* — `deregisterViewContainer(...)` for Explorer, Search, SCM, Debug, Extensions.**
  These fail toward *showing the IDE*: if upstream renames/restructures any of these containers, that icon
  silently reappears in the activity bar. Order-dependent on `WorkbenchPhase.BlockRestore`. A miss is a visible
  regression, not a cosmetic gap. The build-out round widened this from Explorer-only to five containers, so
  re-pin the whole id list on every rebase.
- **MED — default-slot / startup string ids** — the built-in Chat aux-bar container winning the default
  slot (worked around by `isDefault` + a startup `openView`), and `workbench.editors.gettingStartedInput`
  (closed once on first run). Break toward extra chrome, recoverable.
- **LOW / pre-existing core import** — `workbench.common.main.ts` contribution registration (the one core
  edit named above). Mechanical; every contrib does it.
- **LOW / fail-soft — DOM-class CSS selectors** in `studio.css` (`.editor-group-watermark`,
  `.editor-group-container > .title`, `.part.auxiliarybar > .composite.title`) — appearance-only; a missed
  selector just shows a bit of chrome.
- **LOW — one builtin-extension manifest edit** (`theme-defaults/package.json`) to register the theme.

Apart from the Explorer-hide, these are *appearance/wiring* couplings, not behavioural core forks — cheap
to re-pin after a rebase. Still a categorically smaller tax than the Cursor-style core-patch surface the
Item-5 finding feared.

## Recommendation — keep the fork; defer the web rebuild

The Item-5 prediction was: ~80% calm is free via settings, and the costly 20% is a merge-tax surface that
argues for rebuilding the shell on web. **The build refined that call.** The "costly 20%" turned out to be
reachable with **0 core patches** — additive contributions + styleOverrides + a registered theme covered the
Documents home, the Studio theme, chrome removal, the tabbed panel, the first-run flow, and the provenance
gutter. The shell resisted far less than predicted.

Concrete call:
1. **Keep the fork for the validation phase.** It now presents as a genuine document app end-to-end
   (launch → Documents home → open doc → review/approve → export), which is more than enough for design
   partners — and we got there without taking on real merge-tax debt.
2. **Re-pin the seams on each rebase.** The residual coupling is a short, known checklist (the string ids and
   CSS selectors above). Budget a few minutes per upstream merge to re-verify them; they fail soft, so a miss
   is cosmetic, not breaking.
3. **The web rebuild is now a product decision, not a merge-tax escape.** Rebuild on web when the *product*
   needs it (a true block/WYSIWYG editor, the canonical-format move in Item G's option 2/3, multiplayer) —
   not because the fork is too expensive to de-IDE. On the evidence here, it isn't.

_Recommendation (keep-fork vs rebuild-on-web) is written at Item H, grounded in the final count._

## Upstream merge log

Each upstream version bump records here exactly what re-pinned, so this ledger stays a living runbook (per [../11-upstream-sync.md](../11-upstream-sync.md) Phase 4).

### 1.127.0 (merged 2026-07-07, branch `upstream-sync-1.127`)

Assessed in [11-upstream-sync-phase1-report.md](11-upstream-sync-phase1-report.md) (GO). True merge-base `06d84f5a8c` (post-1.126 `main`), so the real replay was ~`main -> 1.127.0` (1,111 files, ~86k insertions). **Clean auto-merge, 0 conflicts.**

Re-pin result per seam - nothing needed hand-editing; verified post-merge:

| Seam | Upstream touched it? | Re-pin outcome |
|------|----------------------|----------------|
| builtin denylist (`builtinExtensionsScannerService.ts`) | no | intact (3 ids + filter) |
| activity-bar width 76 (`activitybarPart.ts` + guard test) | no | intact (const 76; test 14/14 pass) |
| palette keybinding removed (`commandsQuickAccess.ts`) | no | intact (`f1: false`) |
| quick-open keybinding removed (`quickAccessActions.ts`) | no | intact (`f1: false`) |
| ~~sash lock (`sash.ts` + call site)~~ | n/a | **REMOVED (issue #173)** - `sash.ts` reverted to upstream stock; no longer a seam to re-pin |
| contrib imports (`workbench.common.main.ts`) | yes (+4, 2 hunks at L145/L392) | **auto-merged** - our livingDocs (L304) + styleOverrides (L342) preserved alongside upstream's agentHostConnectionsService + onboarding imports |
| HIGH-risk deregister list (explorer/search/scm/debug/extensions) | no | all 5 `VIEWLET_ID` consts still resolve to the exact strings; icons did NOT reappear (verified live) |
| theme manifest (`theme-defaults/package.json`) | no | intact |
| Agent Host dep (`chat.agentHost.enabled`) | subsystem expanded, key unchanged | verified live (chat rail present) |
| studio.css DOM selectors | target classes still present | verified live (calm shell holds) |

Verification: `typecheck-client` 0, `valid-layers-check` 0, LivingDocs suite 66/66, ActivitybarPart 14/14; live web drive - branded calm shell, 76px nav, no IDE containers, full PM editor with bound figures, no living-docs console errors (G6).

**Known pre-existing noise (not a regression, not fixed here):** the hidden Extensions view container throws two console errors on boot (`viewsExtensionPoint` / `extensionsViewlet` -> `viewDescriptorService`) because we deregister its container while the extensions viewlet still registers views into it. All three files are byte-identical to our pre-merge base, so this is a byproduct of the 0-core-patch de-IDE seam (amplified by the incomplete web build - `watch` not `watch-web`), present before 1.127. Candidate cleanup: guard `ExtensionsViewletViewsContribution` when its container is absent, tracked separately from version bumps.
### Redesign round - plans 21-24 + the rails follow-up: 0 ADDED core patches

For completeness alongside the plan-25 entries above: **plans 21, 22, 23 and 24 added nothing to this
ledger** - every surface (provenance gutter, reading ramp, ＋Skill composer, project Home, the
project-wide fan-out + ISMS sample, and the cross-document review) landed entirely in the `livingDocs`
contribution / `livingDocRender` webview / `screenRender` / the service, plus `styleOverrides` CSS. The
review engine was reused, not rebuilt (no new approve/reject logic; `reviewRailView.ts` untouched by the
cross-doc surface). The post-redesign **rails-are-editor-companions** change (PR #85,
`RailVisibilityContribution`) is likewise our-surface only - it reads the active editor and toggles part
visibility via `IWorkbenchLayoutService`, no `activitybarpart` / core edit.

**Whole Abstract UI Redesign (plans 21-25 + rails): 0 NEW core patches; the count stays 5 total** - all
pre-existing, the newest being the v2-iter-9 76px `ACTIVITYBAR_WIDTH`. This is the headline Q3 datapoint:
the redesign that was expected to force a core seam (the labeled nav) needed none. The fork resisted far
less than predicted; the residual coupling the redesign adds is appearance wiring (the codicon-class DOM
reach for the nav chip/tidy, fails-soft/cosmetic on rename), not behavioural forks.

### File interop round - A1 docx -> Markdown import (issue #129, doc 22 section 2): 0 core patches

| Item | Change | Tier | File(s) | Note |
|------|--------|------|---------|------|
| I1 | Pure docx-HTML -> GFM-Markdown converter + kept/dropped summary | our-surface | `livingDocs/common/docxImport.ts`, `test/browser/docxImport.test.ts` | New module + unit suite; string-in/data-out, no imports |
| I2 | `imported` provenance on the lock (`importedFrom` + `sourceHash` + kept/dropped) | our-surface | `livingDocs/common/livingDocsModel.ts`, `browser/livingDocLockStore.ts` | Additive lock field; `coerceLock` tolerates older locks (LOCK_VERSION unchanged) |
| I3 | `importDocx` service method + tree "Import as Document" door + bulk affordance | our-surface | `livingDocs/browser/livingDocsService.ts`, `common/livingDocs.ts`, `common/treeRail.ts`, `browser/treeRailView.ts` | Turns the F10 "not yet imported" marker into a door; refused formats stay refused |
| I4 | Proxy `POST /import/docx` (mammoth docx -> HTML + image extraction + fidelity detection) | our-surface (proxy script) | `scripts/lwd-anthropic-proxy.js` | New route in our own node proxy; conversion runs where file access lives, never the renderer |
| I5 | `mammoth@1.8.0` runtime dependency (pure-JS docx parser) | dependency | `package.json`, `package-lock.json` | Doc 22 section 2's recommended pipeline. Not a core patch; used only by the proxy at runtime (the TS build never imports it) |
| I6 | `jszip@3.10.1` promoted to a direct dependency (review fix) | dependency | `package.json`, `package-lock.json` | The proxy's `detectDocxFidelity` calls `require('jszip')` directly; it was only transitively hoisted via mammoth, so a stricter install could silently drop fidelity detection. Declaring it directly makes that path robust. Same runtime-only footprint as mammoth |

**A1 docx import: 0 core patches.** The whole feature lives in the `livingDocs` contribution + our node proxy, plus two pure-JS npm dependencies (mammoth + jszip) that only the proxy loads at runtime - so the merge tax is two additive lines in `package.json`, not a fork of any upstream file. Verified: `typecheck-client` 0; `valid-layers-check` 0 in changed files; the conversion pipeline exercised end-to-end against a real `.docx` through the live proxy (`docs/plans/40-verify/a1-import/`).
### Export round (plan 40, A2 - issue #130): +1 core patch (count 4 -> 5, post-#173 sash revert)

Unstubbing docx export and adding PDF (doc 22 §3). docx is entirely our-surface + additive: a
zero-dependency pure-JS OOXML writer (`scripts/lwd-docx.js`) exposed through a new proxy route
(`scripts/lwd-anthropic-proxy.js` `POST /export/docx`), driven by `livingDocsService.exportDocx` +
the present modal - no core edit.

PDF needs Electron's `webContents.printToPDF`, a main-process capability with no existing seam, so it
takes **the one core patch of this round**:

| Item | Change | Tier | File(s) | Note |
|------|--------|------|---------|------|
| A2-1 | `printToPDF(html)` on the native host: offscreen hidden `BrowserWindow` loads the HTML via a data URL and prints to PDF | **core-patch** | `platform/native/common/native.ts` (interface), `platform/native/electron-main/nativeHostMainService.ts` (impl), `workbench/test/electron-browser/workbenchTestServices.ts` (`TestNativeHostService` stub) | One new method on `ICommonNativeHostService`, modelled on the existing `getScreenshot` (also a `webContents`->`VSBuffer` capability). Fail-soft: any failure returns `undefined`. |
| A2-2 | Desktop-only command `_livingDocs.printToPDF` bridging the browser service to the native host | additive-contribution | `livingDocs/electron-browser/livingDocsPdf.contribution.ts` (new), `workbench.desktop.main.ts` (one import line) | Keeps the browser-layer `LivingDocsService` free of a desktop dependency; on web the command is simply absent and PDF reports honestly. The one desktop-barrel import is the same kind of additive wiring as the existing `browser/livingDocs.contribution` import in `workbench.common.main`. |

Why a core patch was unavoidable: `printToPDF` is a Chromium/Electron main-process API; the renderer
cannot produce PDF bytes silently (`window.print()` opens a dialog and yields nothing). Adding one
`getScreenshot`-shaped method to the native host is the minimal, upstream-mergeable seam. **New core-patch
count: 5 total (was 4, post-#173 sash revert).**

Hardening (CodeRabbit review on #162, no new patch - same A2-1 method): the offscreen print window now (a)
runs on its own in-memory session and **denies every non-`data:` resource load** via a scoped
`webRequest.onBeforeRequest`, so an authored remote `![](http…)` image can no longer make the export contact
arbitrary URLs (local/inlined `data:` images still render); and (b) races the whole load+print against a
20 s deadline, destroying the hidden window on timeout so a stalled page or wedged print can never leave the
command pending. Both are contained inside the existing `printToPDF` impl and stay fail-soft (any failure
still returns `undefined`).

### Shell-integrity round (issue #182, bundle K - suppress IDE toasts + silence the broken chat contribution): +1 core patch (count 5 -> 6, post-#173 sash revert)

Two IDE leaks on the golden path (open folder inside a git repo -> open doc -> chat). Leak 1 landed
settings-tier (0 core); leak 2 took **the one core patch of this round** - a one-line nullish-guard at the
shared views seam that the fork's own container-deregistration breaks.

| Item | Change | Tier | File(s) | Note / re-pin check |
|------|--------|------|---------|---------------------|
| K1 | Default `git.openRepositoryInParentFolders: 'never'` in the decision-54 `registerDefaultConfigurations` block, so opening the docs folder (which sits inside the abstract-vscode-spike git repo) no longer raises the stock "A git repository was found in the parent folders..." toast | settings (additive config-default) | `livingDocs/browser/livingDocs.contribution.ts` | Real, user-overridable git setting. Verified semantics against `extensions/git/src/model.ts:632-642`: the git model calls `showParentRepositoryNotification()` only when the setting reads `prompt`; `never` skips the prompt entirely without opening the parent repo. No livingDocs feature depends on the git extension (SCM container already deregistered). No core edit. Re-pin if the git extension renames the setting. |
| K2 | Nullish-guard `undefined` in `ViewsService.getActiveViewPaneContainer`: change `if (location === null)` to `if (location === null \|\| location === undefined)` | **core-patch** | `src/vs/workbench/services/views/browser/viewsService.ts` | Fixes a genuine latent upstream defect exposed by the fork's de-IDE: `getViewContainerLocation` is typed non-null but its registry lookup (`[...keys].filter(...)[0]`, `common/views.ts:271`) returns `undefined` for a DEREGISTERED container. The strict `=== null` guard let that `undefined` reach `getActivePaneComposite(undefined)` -> `getPartByLocation` -> `assertReturnsDefined` (thrown assertion). Upstream `ChatForegroundSessionCountContribution` calls `isViewVisible(ChatViewId)` on every editor switch; since the fork deregisters the `workbench.panel.chat` container while its view descriptor still maps to it, every switch logged "Unable to create workbench contribution... Assertion Failed". Fails **safe** (missing location -> view treated as not-visible). LOW fragility: a rebase that reverts the guard just re-surfaces the assertion (console noise, not a crash - the throw is caught by the contribution harness); re-pin check: the guard is `=== null \|\| === undefined` (or equivalent `== null`). |

Why a core patch (not the fork's usual additive route): there is **no** public API to deregister a
`registerWorkbenchContribution2` contribution, so the leaking `ChatForegroundSessionCountContribution`
cannot be unregistered from our own module. The two candidate patch sites were (a) guarding the upstream
chat file - narrow but sits in a heavily-churned file - or (b) the shared views seam. Site (b) is the
**root-cause** fix (the defect is the strict-null guard missing `undefined`), lives in a stable method,
fails safe, and benefits every hidden-container caller, so it carries less merge tax than repeatedly
re-pinning a guard inside the chat file. **New core-patch count: 6 total (was 5, post-#173 sash revert).**

Not fixed (out of scope, noted): the known pre-existing Extensions-container boot noise
(`viewsExtensionPoint` registering views into the deregistered `workbench.view.extensions` container ->
`Cannot read properties of undefined (reading 'id'/'extensionId')`) is a **different** root cause than K2
and is tracked separately in the 1.127.0 merge log above; bundle K does not touch it.

### Editor v2 wave (plans 43-49) - sanctioned seam budget: 2 (decision 169)

The elevation shell (plan 44) is the only loop in the wave permitted core seams, and only these
two, budgeted up front. Every other v2 loop ran at 0 core patches. **Both seams are now LANDED**
(plan 44-a PR #218 + plan 44-b PR #219); each is asserted in `scripts/check-seams.sh` (V2-1 by
seams 9 + 9b, V2-2 by seam 10) and `check-seams.sh` exits 0 on final main. The wave took **exactly
2** core seams against the 2-seam budget - no third seam, no escalation (plan 43 §6).

| Item | Change | Tier | File(s) | Note / re-pin check |
|------|--------|------|---------|---------------------|
| V2-1 | **LANDED - 1 core seam (plan 44-a, PR #218, merge commit `7dfd5ef40e4`, round 2). check-seams: seams 9 + 9b (`frame-inset-constant` / `frame-inset-editor` / `frame-inset-panecomposite`).** The tree rail / editor / right rail read as floating cards (12px inter-card gaps, radius 14, `#E9EAEE` border, rail `#FBFCFD` / editor `#FFFFFF`, shadow-rail / shadow-editor + e1) on the `#EDEFF3` chrome, floated a uniform **12px clear of all four frame edges**. The re-skin is CSS-only, but the top/bottom frame inset needs the **one sanctioned core seam of the wave** (plan 43 §6 seam 1: "part backgrounds/margins CSS for the elevation model" - CSS-only was tried in round 1 and the layout disagreed, so the patch is taken). | styleOverrides-CSS + theme + **core-patch** | **core-patch:** `services/layout/browser/layoutService.ts` (new `FLOATING_PANEL_MODERN_FRAME_INSET = 12` constant), `browser/parts/editor/editorPart.ts` (reserves it in `layout()`, replacing the single-margin bottom), `browser/parts/paneCompositePart.ts` (reserves it in `getFloatingInset` for the side/aux rails, replacing the flush-top). styleOverrides: `styleOverrides/browser/media/elevation.css` (new module + the matching 12px `margin-top`/`margin-bottom`). theme: `theme-defaults/themes/abstract-color-theme.json`. | The cards **ride the existing core floating-panels feature** (`browser/media/floatingPanels.css` + `AbstractPaneCompositePart.getFloatingInset`, which reserves `FLOATING_PANEL_MARGIN` so card content never clips). Round 1 delivered the re-skin CSS-only but hit **P1.2**: stock floating panels deliberately keep the cards flush under the title bar (0px top) and give the editor a single 6px bottom gap, and a CSS-only `margin-top` / wider `margin-bottom` clips card content because the layout code reserves only the stock 6px. Round 2 takes the sanctioned seam: a single fork constant `FLOATING_PANEL_MODERN_FRAME_INSET = 12` reserved in the two card-layout paths, gated on `isFloatingPanelsEnabled()` (== the `MODERN_UI` setting == when `.style-override` + `.floating-panels` are applied), with the matching 12px margins in elevation.css. **Fail-soft:** with Modern UI off, zero change (stock layout); if elevation.css is dropped but the constant stays, core reserves the space and the backdrop shows through (a benign gap, no clip). The top inset sits **below the title bar part**, so once bundle 44-b repurposes the title bar into the 48px header this 12px becomes the header-to-cards gap - it is not hard-coded against the current no-titlebar state. Measured live (1440×900 + 1760×1000): all four frame edges 12px, 12px inter-card gaps, radius 14, exact shadows, rail #FBFCFD / paper #FFFFFF, sashes resize. **Re-pin (`check-seams.sh` seam 9 + 9b):** 9 pins the re-skin (elevation.css gates on `.floating-panels`, the core feature still exists, chrome/border/shadow tokens stay at plan-43 §1 values); 9b pins the frame-inset coupling (the `= 12` constant, both consumers reference it, the CSS margin stays) so a rebase that drops any leg fails loud instead of silently reverting the top edge to 0px. |
| V2-2 | **LANDED (plan 44-b, PR #219, merge commit `a7184f30f8e`) - the wave's SECOND + FINAL core seam. check-seams: seam 10 (`header-height-constant` / `header-height-consumer`).** The 48px full-width Abstract header repurposes the custom title bar part (decision 170). The title bar's height is the grid slot the layout reserves for the part (`BrowserTitlebarPart.minimumHeight` feeds the grid), so a CSS-only height renders 48px visually but the grid allocates only the stock 35px and clips the header. One fork constant lifts the reserved height. | core-patch (constants-style, budgeted) | **core-patch:** `platform/window/common/window.ts` (new `ABSTRACT_HEADER_HEIGHT = 48` constant), `browser/parts/titlebar/titlebarPart.ts` (`minimumHeight` reserves it in the web/non-auxiliary path, `Math.max(value, ABSTRACT_HEADER_HEIGHT)`). Also **settings** (0 core): `livingDocs.contribution.ts` flips `window.commandCenter` false->true so the title bar is not "empty" and stays visible in web; **styleOverrides CSS**: `styleOverrides/browser/media/studio.css` (`.abstract-header` overlay hides stock title-bar content and paints the header; `.part.titlebar` height 48px). The header DOM + rail toggles + badge are an **additive contribution** (`browser/abstractHeader.ts` + `common/abstractHeader.ts` + `browser/abstractHeaderService.ts`), reaching the title-bar container via `IWorkbenchLayoutService.getContainer` (the ActiveNavChipContribution route) - no further core touch. | The `ACTIVITYBAR_WIDTH 48->76` precedent: one constant + its consumer, asserted by `check-seams.sh` **seam 10** (constant `= 48`, the `minimumHeight` consumer references it, the `.abstract-header` studio.css rules stay). **Fail-soft:** the constant only raises the reserved height in web; drop the fork header CSS and it is just a taller empty title bar (no crash, no clip of other parts). If a rebase drops the constant/consumer the header shrinks to 35px and clips; if the `commandCenter:true` default or the studio.css overlay go, the header disappears - each leg is seam-gated. **Measured live (1440×900 + 1760×1000):** header 48px, bg `#EDEFF3` chrome, border-bottom `1px #E2E4EA`, logo 22×22, workspace 13.5/600 `#1A1C20`, breadcrumb 13.5 `#868B95` (updates on doc/surface change), toggles 28×28 hover `#E2E4EA`, per-surface right clusters exact, no double-header on any of the five surfaces; ⌘\ toggles the tree rail (stock split-editor neutralised, editor groups stay 1), ⌘⇧\ toggles the right rail, ⌘B keeps its dual role, collapse persists across reload, badge dot 8×8 `#C99A2E`. **Desktop:** the macOS traffic-light inset must clear the left rail toggle - a CSS-only `.mac` left pad if it collides (founder 2-minute smoke; see `docs/qa/2026-07-v2/shell/44-b/desktop-note.md`). |
