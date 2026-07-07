# Plan 26 iters 3-4 - verification

Iter 3: truthful History tab.
Iter 4: honest version chip + design match.

## What was built

- `browser/historyRender.ts` (new, pure): `historyHtml(snapshots, audit, docTitle?, fromTemplate?, now?)` renders a per-document version timeline entirely from the lock.
  Real snapshots (restorable versions) interleave newest-first with the real audit entries recorded since each; a `Current version` head carries the `CURRENT` badge; published versions carry the amber `SNAPSHOT` badge; the display caps at 20 rows with an `N earlier entries` line.
  The fabricated v14/v13 sample is deleted.
- `browser/reviewRailView.ts`: `_renderHistory` reads `getSnapshots(resource)` + `getLock(resource).audit`, renders through `historyHtml`, and wires `Save version` (→ `saveSnapshot(..., 'manual')` via `IQuickInputService`) and per-version `Restore` (→ confirm via `IDialogService` → `restoreSnapshot`, the one approve path).
- `browser/livingDocRender.ts` + `browser/livingDocEditor.ts`: the toolbar chip is honest - `Saved`, `Saved · vN` (N = real `getSnapshots(resource).length`), and a `Saving…` state the RUNTIME shows during the 300 ms `pmEdit` debounce.
  The mock `Saved · v14` is gone.

## Automated evidence (run in this sandbox)

- `npm run typecheck-client` - clean for the touched files (pre-existing `agentHost/**` errors are unrelated and were ignored per the task note).
- `npm run valid-layers-check` - clean.
- `scripts/check-seams.sh` - OK, all shell seams intact.
- History render unit tests (`test/browser/historyRender.test.ts`, 8 tests) - run as an esbuild bundle of the pure module: **19 assertions PASSED**.
  Cover: real snapshots+audit with no sample; Restore wired to the snapshot id; publish `SNAPSHOT` badge + `CURRENT` head; truthful empty state; no-doc prompt; a restore audit reads `Restored`; cap-at-20 names the remainder; the template origin row is kept.
- Version chip unit tests added to `test/browser/livingDocRender.test.ts` (2 tests): plain `Saved` + no version number at 0 snapshots; `Saved · v3` at 3; no `v14`.
- Fabricated-string grep gate over the contrib: no `v14`/`v13`/`just now` remains in the History tab or the chip.
  (The only surviving `just now` strings are pre-existing REAL relative-time formatters in `screenRender.ts`/`livingDocPmDecorations.ts`, computed from actual timestamps - unrelated to this work.)

## Render preview (real render code)

`history-render-preview.png` (from `history-render-preview.html`) is a capture of the ACTUAL `historyHtml` output and the chip markup, driven with a realistic post-workflow dataset (a manual save, a bulk-approve snapshot, a `Published` milestone, and the audit entries between them).
It shows the interleaved newest-first timeline, the `CURRENT`/`SNAPSHOT` badges, the `Restore` actions, the calm empty state, and the three chip states (`Saved`, `Saved · v3`, `Saving…`).
This is a render preview, not a screenshot of the running app.

## NOT verified in this sandbox (and why)

A live in-app pass on `:8080` (open a doc → source edit + refresh autosnapshot → see it in History → click Restore → confirm the doc updates → capture the chip) could **not** be run here.
The symlinked `node_modules` (from the main checkout) is a pruned install that lacks the dev-serve toolchain:

- no `@vscode/test-web` - `scripts/code-web.js` throws at `require.resolve('@vscode/test-web')`, so the web server cannot start;
- no `electron` dist - `scripts/code.sh` (desktop) cannot start;
- no `gulp`/`mocha` - the standard compile (`npm run gulp compile`) and test runner cannot run;
- the chrome-devtools MCP could not attach (a Chrome instance already holds its profile lock).

This is the same documented environment limitation that blocked the live pass for plan 31 iters 2-4 (decisions 130-132), where the app was served live externally by a separate validator.
The feature itself needs no model backend - it works through the deterministic paths (source edit + refresh autosnapshot, manual Save version, Restore), all of which are exercised by the merged iter-2 service tests (`restoreSnapshot` round-trips: rejects pending, writes the body, audits `via: restore`, re-flags staleness) and the new render/wiring tests above.
No screenshot of the live app was fabricated.
