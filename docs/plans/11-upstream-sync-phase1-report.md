# 11 - Upstream sync Phase 1 (Assess) report: 1.127.0

Companion to [../11-upstream-sync.md](../11-upstream-sync.md) (the procedure) and [03-merge-tax-ledger.md](03-merge-tax-ledger.md) (the seam catalogue).
This is the Phase 1 go/no-go gate.
It merges nothing.

## Headline

**GO.**
Every core patch and seam is either untouched by upstream or trivially re-pinnable.
The single expected merge conflict is one append-only import list.

## Correction to the base assumption

The spec assumed our fork is based on the `1.126.0` stable tag.
It is not.
The true merge-base of our branch and `1.127.0` is `06d84f5a8c` (2026-06-19, an upstream `main` commit: "chat: Suppress missing Agent Host file read logs").
That commit is a few days *after* the 1.126.0 tag (2026-06-15) and is **not** on the stable release line, so `1.126.0` is not in our history.

Consequence: a real `git merge 1.127.0` replays `06d84f5a8c..1.127.0`, i.e. roughly `main -> 1.127.0 stable`, not a clean `1.126 -> 1.127` bump.
The scoped delta is large - **1,111 files, ~86k insertions, ~18k deletions** - but almost all of it lands in files our contribution never touches, so it does not threaten our seams.
It does raise the weight of Phase 3 live verification (more upstream churn in areas we ride on, chiefly Agent Host / chat).

## Per-seam verdict

Assessed against the true merge-base `06d84f5a8c..1.127.0`.

| # | Seam | Tier / risk | Upstream delta | Verdict | Note |
|---|------|-------------|----------------|---------|------|
| 1 | `builtinExtensionsScannerService.ts` - 3-id builtin denylist | core-patch | none | **safe** | File untouched upstream; patch re-applies clean |
| 2 | `activitybarPart.ts` - `ACTIVITYBAR_WIDTH = 76` + guard test | core-patch | none | **safe** | Untouched; re-pin trivial (const = 76, test expects 76) |
| 3 | `commandsQuickAccess.ts` - palette keybinding removed | core-patch | none | **safe** | Untouched |
| 4 | `quickAccessActions.ts` - quick-open keybinding removed | core-patch | none | **safe** | Untouched |
| 5 | `sash.ts` - `lockAllSashes()` | core-patch | none | **safe** | Untouched |
| 6 | `workbench.common.main.ts` - contribution-registration imports | core-import | +4 lines, 2 hunks (`agentHostConnectionsService` ~L145; `onboarding.contribution` ~L392) | **re-pin (trivial)** | Our imports sit at L303 (livingDocs) / L341 (styleOverrides) - different regions. Auto-merge likely; else keep all four import lines |
| 7 | `deregisterViewContainer` x5 (explorer / search / scm / debug / extensions) | **HIGH / fails unsafely** | none | **safe** | All 5 `VIEWLET_ID` constants still resolve to the exact strings we deregister; each container still registered at 1.127.0. No rename/restructure |
| 8 | Agent Host dependency (`chat.agentHost.enabled`) | feature dep | subsystem **expanded** (`src/vs/platform/agentHost/`); config key unchanged | **safe - verify live** | Upstream marks Agent Host "Insiders / non-stable only". We do not patch these files, so no merge conflict; chat behaviour is a Phase 3 gate |
| 9 | `theme-defaults/package.json` - "Opportunity OS" theme manifest entry | manifest edit | none | **safe** | File untouched upstream; theme entry merges clean |
| 10 | `studio.css` DOM-class chrome selectors | fail-soft CSS | target classes still present (`editor-group-watermark`, `monaco-menu`, `auxiliarybar`, `activity-bar`) | **safe - verify live** | Exact selector shape confirmed live in Phase 3 |

No seam came back `clash`.

## HIGH-risk seam detail (the one the spec says matters most)

All five deregistered container IDs are intact at 1.127.0:

| Container | `VIEWLET_ID` at 1.127.0 | Defined in |
|-----------|--------------------------|------------|
| Explorer | `workbench.view.explorer` | `contrib/files/common/files.ts` |
| Search | `workbench.view.search` | `services/search/common/search.ts` |
| SCM | `workbench.view.scm` | `contrib/scm/common/scm.ts` |
| Debug | `workbench.view.debug` | `contrib/debug/common/debug.ts` |
| Extensions | `workbench.view.extensions` | `contrib/extensions/common/extensions.ts` |

Each container is still created via `registerViewContainer` at 1.127.0 (search moved to `search.contribution.ts:53`; the rest unchanged).
So the deregister list re-pins byte-for-byte.

## Expected merge mechanics

- **Only expected conflict:** `workbench.common.main.ts` - resolve by keeping all imports (upstream's two + our two).
- Everything else: clean auto-merge.
- After merge, re-pin per the ledger checklist, giving the container-ID list (seam 7) a line-by-line confirm.

## Residual risk (not blocking, carried into Phase 3)

1. **Large real delta.** Because our base is post-1.126 `main`, we pull `main -> 1.127`, so untouched-file behaviour can still shift. Live-verify the calm shell and gates G1-G6, not just typecheck.
2. **Agent Host churn.** It is a preview feature we depend on; it grew at 1.127. Chat must be live-verified end to end (create -> chat -> propose -> approve), because a subtle Agent Host / chat change would not show up as a merge conflict.

## Recommendation

Proceed to Phase 2 (merge the `1.127.0` tag on `upstream-sync-1.127`), then Phase 3 verify with the live drive weighted appropriately given the delta size.
