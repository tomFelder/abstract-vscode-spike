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
| B | "Opportunity OS" color theme (full hi-fi palette) | theme | `extensions/theme-defaults/themes/opportunity-os-color-theme.json`, `theme-defaults/package.json` | Registered theme; no per-key hacks |
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

## Core-patch count: **2 added in v2** (iter 6 builtin exclusion + iter 9 activity-bar width) + 0 from earlier rounds (this phase + build-out + format + orchestration + v1 + v2 iters 2-5,7,8) (1 pre-existing, from the engine phase). v2 (plan 11) permits this - both are one-line/one-constant, low-fragility, product-correct.

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
a VS Code rebase could break, ordered worst → best:
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
