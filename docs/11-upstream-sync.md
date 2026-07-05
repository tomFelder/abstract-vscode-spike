# 11 - Upstream sync: assess-then-merge VS Code 1.126.0 -> 1.127.0

This spec covers tracking the upstream VS Code (`microsoft/vscode`) codebase our fork is built on.
It records the current gap, the approach we chose, and a repeatable assess-then-merge procedure.
The immediate job is the 1.126.0 -> 1.127.0 bump; the procedure is written to be reused on every future release.

Companion: [plans/03-merge-tax-ledger.md](plans/03-merge-tax-ledger.md) is the authoritative catalogue of every core patch and seam this merge must protect.
This spec references it rather than duplicating it.

## Current state (as of 2026-07-05)

- Our fork is based on VS Code **1.126.0** (merge-base commit `0a9d0e4c40d`, dated 2026-06-15).
- Latest upstream **stable** is **1.127.0** - we are exactly one release behind.
- There is **no `upstream` remote** configured; only the personal `origin` fork (`tomFelder/abstract-vscode-spike`).
- The full `microsoft/vscode` history is present in the repo (the base "Hello Code" commit is reachable), so the 1.127.0 tag can be fetched and merged directly.

## Goal and non-goals

**Goal.** Assess the 1.126.0 -> 1.127.0 delta for safety and for clashes with our contributions' logic and intent, and - if the assessment is green - perform the merge, re-pin our seams, verify the app still behaves, and land it.

**Non-goals.**
- Not targeting Insiders or `main`; stable `1.127.0` only.
- Not a rewrite or refactor of our contributions; we re-apply patch *intent*, we do not redesign.
- Not adopting new upstream features; if 1.127 ships something we might want, that is a separate ticket.

## Approach: merge the tag (chosen)

We merge the `1.127.0` tag into a fresh branch off `main` (`git merge 1.127.0`).

Rationale.
Roughly 99% of our work lives in *new* files - `src/vs/workbench/contrib/livingDocs/`, `src/vs/workbench/contrib/styleOverrides/`, the `theme-defaults` theme - which cannot conflict with upstream.
Conflicts will land almost exclusively in the small, already-catalogued set of core-patched files.
Merge preserves our full history, including every merged feature PR, and resolves conflicts once.

Rejected alternatives.
- **Rebase our contributions onto 1.127.0** rewrites shared history already merged to `main` across many PRs - high pain and risk, no payoff for a fork that tracks upstream.
- **Cherry-pick specific upstream fixes** is kept in reserve: only if the assessment says we want one or two targeted fixes but not the full version bump.

## What the merge must protect

The full catalogue lives in [plans/03-merge-tax-ledger.md](plans/03-merge-tax-ledger.md).
Summary of the surface this merge touches, worst risk first:

- **5 added core patches + 1 pre-existing import line.**
  All one-line / one-field / one-flag, documented as low-fragility and *fail-soft* (a bad rebase re-adds an affordance; the regression is cosmetic and re-droppable).
  Files: `builtinExtensionsScannerService.ts` (3-id denylist), `activitybarPart.ts` (`ACTIVITYBAR_WIDTH = 76` + its guard test), `commandsQuickAccess.ts` (palette keybinding removed), `quickAccessActions.ts` (quick-open keybinding removed), `sash.ts` (`lockAllSashes()`), and the contribution-registration import in `workbench.common.main.ts`.
- **HIGH-risk seam that fails *unsafely*: `deregisterViewContainer(...)`** for `workbench.view.explorer`, Search, SCM, Debug, Extensions.
  If upstream renames or restructures any of these containers, that IDE icon silently reappears in the activity bar - a visible regression, not cosmetic.
  This is the single most important thing to verify against 1.127.
- **Fail-soft seams:** the `studio.css` DOM-class selectors, default-slot / startup string ids (the Chat aux-bar container, `gettingStartedInput`), and the `theme-defaults/package.json` theme manifest edit.
- **Feature dependency:** we depend on **Agent Host** (`chat.agentHost.enabled`), which is itself recent and actively churning upstream (the 1.126 base commit gated it behind an editor-preview policy).
  Any 1.127 change to Agent Host or chat is in scope for the assessment even though we have not patched those files.

## Phase 1 - Assess (the gate)

This phase produces a go/no-go and does not merge anything.

1. Add the `upstream` remote and fetch the tag only:
   `git remote add upstream https://github.com/microsoft/vscode.git`
   `git fetch upstream tag 1.127.0 --no-tags`
2. Produce the scoped delta.
   `git diff 1.126.0..1.127.0 --stat` filtered to the files and directories our seams touch (the core-patched files above, plus the container-registration / activity-bar code behind the HIGH-risk deregister seam).
3. Read every hit in that scoped delta and judge it against our patch *intent*:
   does the upstream change move, rename, or restructure the thing we patched, or merely edit nearby lines?
4. Verify the HIGH-risk seam explicitly: confirm all five `deregisterViewContainer` ids still exist and are still registered the same way upstream at 1.127.0.
5. Scan the 1.127.0 release notes and changelog for anything touching view containers, the activity bar, the command palette / quick open, sashes, or **Agent Host / chat**.
6. Write a per-seam verdict table: `safe` / `re-pin needed` / `clash`, with a one-line note each, and an overall **go / no-go** recommendation.

**Checkpoint.** The Phase 1 report is brought back for review before any merge happens.
If any seam comes back `clash`, we stop and decide (adjust the patch, or fall back to cherry-pick, or defer).

## Phase 2 - Merge (only if Phase 1 is green)

1. Branch off `main` (e.g. `upstream-sync-1.127`).
2. `git merge 1.127.0`.
3. Resolve conflicts by re-applying each patch's *intent* (not by blindly taking either side); the expected conflict set is the core-patched files only.
4. Re-pin every seam against the ledger's re-pin checklist, giving the HIGH-risk deregister id list a line-by-line check.

## Phase 3 - Verify

1. Node **24.15.0** (`.nvmrc`), then `npm install` - dependencies may have moved between releases.
2. `npm run typecheck-client` clean (and `npm run gulp compile-extensions` if any `extensions/` file changed).
3. `npm run valid-layers-check` clean.
4. Headless tests: the `LivingDocsService` suite and the `activitybarPart` guard test (asserts the width constant is 76).
5. Live drive the web build (`./scripts/code-web.sh ./living-docs-sample`) with the chrome-devtools MCP and confirm the calm shell still holds:
   no IDE containers reappeared, the 76px labelled nav renders, sashes are locked, the command palette is dead, and gates G1-G6 pass.
6. Capture before/after screenshots for the PR.

## Phase 4 - Land

1. Open a PR off `main` with the before/after screenshots and the Phase 1 risk report embedded.
2. Add a "1.127 merge" entry to [plans/03-merge-tax-ledger.md](plans/03-merge-tax-ledger.md) recording exactly what re-pinned, so the ledger stays a living runbook.
3. Update the "current state" section of this doc to the new base version.

## Success criteria

- The fork is based on `1.127.0` with our full contribution history intact.
- Every core patch and seam re-verified against the ledger; the HIGH-risk deregister list confirmed against 1.127.
- `typecheck-client`, `valid-layers-check`, and the headless tests pass.
- The live calm shell is visually unchanged from the 1.126 baseline (G1-G6 hold; no IDE chrome regressed in).
- A PR is open with screenshots and the risk report; the ledger has a 1.127 entry.

## Reuse

Phases 1-4 are the repeatable procedure for every future release bump.
The only per-release variables are the target tag and whatever the assessment surfaces; the seam checklist is maintained in the ledger.
