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

## Core-patch count: 0 added (this phase + build-out round + format round) (1 pre-existing, from the engine phase)

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
