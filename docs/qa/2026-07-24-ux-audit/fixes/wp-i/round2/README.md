# WP-I fix round 2 - CodeRabbit "duplicate palette entries after re-apply" (finding 3649060725)

Issue #260, umbrella #263, PR #272.

## The finding

In `_curatePalette` (`livingDocs.contribution.ts`), `explicitShadowedIds` was a per-call local. `_shadowItems`'s idempotency check (`this._shadowed.has(item)`) skips an already-shadowed explicit item BEFORE the callback that populates that local. So on every `onDidChangeMenu` re-apply after the first, previously explicit-shadowed commands were missing from the call's set, and the implicit-command loop appended a fresh duplicate gated item for each. Once "All Commands..." lifts the gate, those commands showed twice.

## The fix

Factored the persistent bookkeeping into `common/shellCuration.ts` as `PaletteShadowBookkeeping` (unit-testable): two persistent id sets - explicit-shadowed and appended - with `shouldAppendImplicit(id)` gating the implicit loop. The contribution now delegates to it, so the explicit-shadowed ids survive across re-applies. Lifecycle unchanged (plain fields on the `Disposable` contribution, GC'd with it; the actual restoration stays in the two `_register`ed `DisposableStore`s).

## Repro-then-fix (unit)

`test/browser/shellCuration.test.ts` - new "convergence" test simulates the two `_curatePalette` passes `onDidChangeMenu` triggers. Proven to FAIL when the persistent explicit-shadow tracking is neutered (the per-call-local bug: a duplicate is appended for the already-shadowed explicit command) and PASS with the fix. 2/2 tests green.

## Live proof (desktop, `living-docs-sample` workspace)

Measured `MenuRegistry.getMenuItems(CommandPalette)` directly in the running renderer (confirmed the running build loads `PaletteShadowBookkeeping`):

- Items we appended: **972**, stable.
- Forced 8 `onDidChangeMenu` re-applies (append+dispose throwaway palette items): appended count delta = **0**; total items, distinct ids, and max per-id duplicate all unchanged. With the per-call-local bug this would balloon; it is convergent.
- `DOUBLE_OURS` (two of our appended items for one id) = **0**. The CodeRabbit finding is resolved.

Residual (out of scope, pre-existing since round 1): 3 `testing.*` ids show one of our appended items alongside a real explicit item that registers AFTER our implicit append (a narrow append-then-real ordering race, not the per-call-local finding, unchanged by this fix).

## Screenshots

- `01-calm-palette-curated.png` - Home, calm shell.
- `02-gear-menu-curated.png` - curated gear: Model Access / Onboarding / Advanced (VS Code).
- `03-advanced-submenu.png` - Advanced submenu with "All Commands...".
- `04-all-commands-palette-lifted.png` - gate lifted; stock commands revealed, each appears exactly once (no duplicates).
