# Bundle E QA - issue #171 (Files tab real tree)

Branch: `feat/171-tree-rail-real-tree`. Worktree: `/Users/tommy/Sites/abstract-wt-bundle-e`.

## Automated verification (all green)

- `npm run typecheck-client`: 0 errors.
- `npm run valid-layers-check`: clean.
- `./scripts/test.sh --grep "livingDocs"`: 127 passing, 4 failing - and the 4 failures are exactly the documented known-baseline screenRender failures (intro headline, resume status, "From sources..." row, pending sign-in). Zero new failures. The new `treeRail` data-shaping tests (`buildTreeRailNodes`, `isAssetName`, plus the pre-existing `buildFileTree` cases) all pass.

## Live E2E - blocked by a pre-existing, fork-wide broken extension build

Live E2E screenshots (a)-(f) could NOT be captured. Both build paths the launch/web
skills need require a full built-in-extension compile, and that compile fails on this
checkout for reasons unrelated to this change:

1. The machine's Data volume was at 100% at the start of the run, which truncated the
   initial `npm install` and corrupted several extensions' `node_modules` (e.g.
   `references-view/@types/node/process.d.ts` was truncated mid-file: `TS1010 '*/' expected`).
   Cleaning the npm cache freed space and clean-reinstalling individual extensions fixed the
   truncated files, but:
2. A version-skew that is present on `main` too then surfaces: multiple extensions pin
   `@types/node@24.12.4` with `undici-types@7.16.0`, and that `undici-types` build does not
   re-export `WebSocket`/`CloseEvent`/`MessageEvent` from its index - so `@types/node`'s
   `http.d.ts`/`fetch.d.ts` fail with `TS2694`. Verified identical version pair and missing
   export on the `main` worktree, so a fresh extension rebuild on `main` would fail the same
   way. `main` only runs because its extension `out/`/`dist` were built earlier and have not
   been recompiled since.

Because this blocker is a pre-existing environment/dependency condition (reproducible on
`main`) and is orthogonal to the Files-tab change, the core code was verified via the
type checker, the layers checker, and the full unit-test suite instead. The core client
(`out/vs/**`, which is all this change touches) compiles cleanly with `npm run gulp compile-client`.

A follow-up to unblock live E2E: pin `undici-types` to `~6.21` (matching `@types/node@24.x`)
across the affected built-in extensions, or repair the corrupted extension `node_modules`
with a clean full `npm install` on a machine with adequate free disk.
