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

## Core-patch count: 0 (final)

The entire Studio de-IDE (Items A–G) shipped **without a single patch to upstream VS Code core**
(`src/vs/base|platform|editor|workbench/browser|workbench/api` were never edited). Everything landed
through the cheap tiers:
- **settings** — the calm ~80% (hidden activity bar / tabs / status bar / menu / command center, theme).
- **a registered theme** — the full palette, no per-key `colorCustomizations` hacks.
- **styleOverrides CSS** — chrome removal, added inside the fork-owned `contrib/styleOverrides/` exactly
  as that subsystem intends.
- **additive contributions** — the Documents home, the tabbed right panel, hiding the Explorer (public
  `deregisterViewContainer`), and the first-run startup behaviour — all our own files / public registry APIs.

> Deferred (not blocking): a fully styled **source pane** (the hi-fi CSV viewer). Provenance reveal
> already works (clicking a dot opens the bound source); the bespoke source viewer is a follow-up.

### Where the (small) residual tax actually lives
Zero core patches does not mean zero upstream coupling. The additive route leans on a few internal
seams that a VS Code rebase could silently break:
- **String ids** — `workbench.view.explorer` (deregistered), the built-in Chat aux-bar container winning
  the default slot (worked around by `isDefault` + a startup `openView`), `workbench.editors.gettingStartedInput`
  (closed on first run).
- **DOM-class CSS selectors** in `studio.css` (`.editor-group-watermark`, `.editor-group-container > .title`,
  `.part.auxiliarybar > .composite.title`) — appearance-only, fail soft (a missed selector just shows a
  bit of chrome, nothing breaks).
- **One builtin-extension manifest edit** (`theme-defaults/package.json`) to register the theme.

These are *appearance/wiring* couplings, not behavioural core forks — cheap to re-pin after a rebase, and
each fails soft. This is a categorically smaller tax than the Cursor-style core-patch surface the Item-5
finding feared.

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
