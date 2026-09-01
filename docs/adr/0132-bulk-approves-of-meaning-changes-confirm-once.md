---
number: 132
status: "**Done (plan 31 iter 4).** 0 core patches; branch `31-review-quality-v2`."
provenance: "plan 31, iter 4"
source: docs/07-decision-log.md
---

# Bulk approves of meaning changes confirm once

**A bulk approve that includes any meaning change confirms once with real counts + a snapshot reassurance; figures-only bulk approves stay one-click**

A one-line confirm (`bulkApproveConfirm(changes, snapshot)`, pure + unit-tested in `common/livingDocsModel.ts`) gates every bulk-approve entry point - the editor action bar (`Approve all in this doc` / `Approve everywhere`), the Review rail's per-doc `Approve all`, and the cross-doc review's `Accept all here` / `Accept all remaining` - whenever the set contains at least one `meaning` change: `Approve 6 changes including 2 meaning changes?`. A figures-only (or empty) set returns `needed:false` so the auto-apply class keeps its one-click flow (no friction). Because plan 26 landed the autosnapshot on bulk approve (`approveAll` snapshots `Before bulk approve` before applying), the copy honestly adds `A version snapshot is taken first, so you can restore.` - the plan's conditional dependency, now satisfiable. Counts are REAL (derived from the passed pending set), and the confirm runs through the platform `IDialogService` (injected into the two editor hosts + the rail). **Tier: our-surface, 0 core patches.** Verified: 4 model unit tests (real counts with singular/plural wording; the snapshot mention; figures-only needs no confirm; empty set needs no confirm). Live verification (a screenshot of the confirm dialog) was blocked by the unreachable model backend - there are no model-backend credits to generate the meaning changes the confirm gates on, so the dialog has no pending set to display; the app itself builds and runs, and the PR #100 validator served it live on :8080 with Home/editor/rails rendering (esbuild was a resolvable node_modules layout quirk, symlinked from build/node_modules into root, not unbuildable code). The blocker detail is at `docs/plans/31-verify/README.md`. No screenshot was fabricated.
