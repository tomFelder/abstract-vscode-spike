# Bundle G QA - issue #176: remove the duplicated Review-rail header

Fix: re-key the aux-bar composite-title hide rule in `studio.css` from the dead `.style-override-studio` class to `.style-override` (the class the `StyleOverridesContribution` actually toggles). The rule itself already existed; it was inert because the selector referenced a class nothing sets. Once matched, VS Code's aux-bar composite header (the "REVIEW" label + the Maximize Secondary Side Bar toolbar) is hidden, leaving the product's own Chat / Review / History tab strip as the rail's only header.

## Evidence

- `a1-before-modernui-off-review-header-present.png` - baseline launch (main defaults `modernUI: false`, so the `.style-override` class is not applied and the studio module is inert). Onboarding is on screen; the aux bar is layout-hidden here. DOM probe in this state confirmed the composite title is present and visible with text "Review".
- `b1-rail-visible-no-review-header.png` - **after**: document open, `modernUI` on, `.style-override` applied. The right rail's first visible element is the Chat / Review / History strip; no "REVIEW" header and no maximize toolbar above it. DOM probe: `compositeTitleVisible: false`, rail content starts 1px below the aux-bar top (no leftover header band, no clipping of the title-bar area). The left "Workspace" title is the primary sidebar, unaffected.
- `b2-chat-tab-active.png` / `b3-history-tab-active.png` - tab switching still works (Review -> Chat -> History), header still absent.

## Accessibility / keyboard note

The hidden composite header carried the only on-screen maximize affordance. The underlying command `workbench.action.toggleMaximizedAuxiliaryBar` is unchanged: it keeps `f1: true` (command palette) and its keybinding, so maximize/restore stays reachable without the toolbar. The tab strip is built from real focusable `<button>` elements with text labels, so the rail retains a keyboard/screen-reader entry point.
