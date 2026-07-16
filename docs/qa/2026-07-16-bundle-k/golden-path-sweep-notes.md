# Bundle K - golden-path IDE-toast sweep (issue #182, part 3: note, do not fix)

Golden path: open the `docs` folder (inside the git repo) -> onboarding -> open a document -> switch documents -> chat/review rail. Notification toasts and notification-centre items observed live: **0** (confirmed via CDP DOM probe `.notifications-toasts` / `.notifications-center` = 0, and the two committed screenshots).

## Fixed in this bundle
- **Leak 1 (git parent-repo toast):** suppressed by `git.openRepositoryInParentFolders: 'never'` default. 0 occurrences.
- **Leak 2 (chat `chatForegroundSessionCount` assertion on every editor switch):** fixed by the nullish guard in `ViewsService.getActiveViewPaneContainer`. 0 occurrences across startup + multiple editor switches.

## Other IDE-origin console noise seen on the golden path (NOT toasts, NOT fixed - out of scope)
These are console errors, not user-visible notification toasts, so they do not undermine the calm shell the way the two target leaks did. Recorded for a future cleanup unit.

1. `Cannot read properties of undefined (reading 'id')` and `... (reading 'extensionId')` - the **known pre-existing** Extensions-container boot noise already documented in `docs/plans/03-merge-tax-ledger.md` (1.127.0 upstream merge log). Root cause: the fork deregisters the `workbench.view.extensions` container while `viewsExtensionPoint` / `ExtensionsViewletViewsContribution` still register views into it. Different root cause from leak 2; a candidate cleanup is to guard `ExtensionsViewletViewsContribution` when its container is absent.
2. `Failed to set the 'innerHTML' property on 'Element': This document requires 'TrustedHTML' assignment.` - a TrustedTypes warning from a webview/render path (x2). Not an IDE toast; unrelated to the de-IDE seams. Worth a separate look if webview TrustedTypes hardening is ever prioritised.

No git/SCM, trust, or extension-activation **notification toasts** appeared on the golden path with the two fixes in place.
