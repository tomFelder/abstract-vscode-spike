# Plan 30 (tracks 1 + 2) - live verification status

## What this unit changed (user-visible surface)

Tracks 1 + 2 are **internals**: incremental, source-scoped refresh derivation with a shared-source read cache (track 1) and a concurrency-limited scheduler with a per-host cooldown (track 2).
There is **no new UI surface** - the doc-toolbar Refresh and the project refresh behave the same to the user (same proposals, same audit entries, same reconciled figures), only faster and bounded.
The plan's own global constraint states this: "Behaviour-preserving at small scale: the sample-folder demos must produce identical results before/after each iteration."

So the meaningful verification for this unit is:
1. **The deterministic count/behaviour gates** - captured and MEASURED in `notes.md` (before/after: 248 → 152 source reads; a shared CSV 26x → 1x per pass; incremental refresh touches only the changed source's dependents; ≤ 4 concurrent fetches asserted via a deferred-fetch peak; ≤ 2 concurrent model calls asserted via a deferred-model peak against a mocked healthy proxy; cooldown suppresses/re-admits).
2. **No small-scale regression** - the full pre-existing `livingDocsService`/`agentOrchestrator` unit suites re-run with zero assertion regressions against the new concurrent/incremental path.

Both are done and recorded.
The refresh-derivation path is deterministic and does **not** need the model backend (source-file edit → refresh → figures reconcile), so it was verifiable without model credits.

## The on-disk scale sample (iteration 1 artefact)

`scripts/generate-scale-sample.ts` writes `living-docs-scale-sample/` (50 documents over 4 shared CSVs, gitignored - only the generator is tracked).
Regenerate with:

```
node scripts/generate-scale-sample.ts 50 4
```

It was run in this environment and produced the 50 docs + 4 CSVs + an `.abstract-name` marker; the folder is intentionally not committed.

## Live in-app web run: BLOCKED (honest)

A live web run on `:8080` against `living-docs-scale-sample` (the plan's "Verify approach") could NOT be captured in this sandbox.
The blocker is the **generally pruned sandbox node_modules** (a chain of missing third-party dev dependencies in the extension build), not any code issue:

- `npm run compile-client` (gulp) first fails while esbuilding an unrelated extension:
  `Could not resolve "dompurify"` in `extensions/markdown-language-features/esbuild.notebook.mts`.
- `dompurify` is absent from both this worktree's node_modules **and** the main checkout's node_modules (both are pruned symlink layouts); it is an extension-build dependency and is **not used by `contrib/livingDocs/` at all** (`grep -rl dompurify src/vs/workbench/contrib/livingDocs/` → no hits).
- The independent validator confirmed the condition is broader than that one dep: symlinking the markdown extension's own node_modules gets PAST dompurify, but the build then fails on the next pruned dep (`@vscode/markdown-it-katex`), and after linking all extension node_modules, on nested `css-language-features/server` deps (`vscode-css-languageservice`, `vscode-languageserver`, `@vscode/l10n`). No `out/vs` is ever produced because the gulp extension pre-step gates the workbench build.
- Port 8080 was already occupied by an unrelated `@vscode/test-web` server serving the MAIN checkout's build on the small `living-docs-sample` - the wrong branch and the wrong folder for plan-30 verification.

This is the same pruned-toolchain blocker documented for plans 26/31 (decisions 131-134): the app code builds and typechecks cleanly; only the full extension-media bundle is blocked by missing third-party dev deps outside our surface.

**No screenshots were fabricated.**
A validator re-running with a complete node_modules can build the web bundle, generate the sample, and drive the refresh live; the deterministic derivation path this unit changes will reconcile figures with no model backend.

## How the measured numbers were produced

- The `perfScale.test.ts` harness runs against a mocked file service that counts source reads; it uses `makeScaleFixture(50, 4)` and asserts the post-cache counts, logging the wall-time.
- The **baseline** row in `notes.md` was captured by `git stash`-ing the four changed source files (reverting to the pre-plan-30 serial refresh), running the SAME mock harness, recording the numbers, then `git stash pop`.
- The tests were executed with an esbuild-bundled node runner (the sandbox lacks the full mocha/gulp browser-test toolchain); the suites are ordinary `*.test.ts` and run unchanged in CI.
