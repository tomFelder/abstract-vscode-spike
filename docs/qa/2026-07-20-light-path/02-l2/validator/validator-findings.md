# Plan 42 slice L2 - adversarial validation (issue #198)

**Verdict: FAIL** (one blocking defect - a test-suite regression). The feature itself is sound and live-verified; the failure is that the behaviour change broke two previously-green `LivingDocsService` unit tests that were not updated, violating the plan's binding "the livingDocs test suite stays at 0 failures; extend tests where behaviour changes" constraint.

**Branch:** `light-path/l2-model-access` - **Worktree:** `/Users/tommy/Sites/abstract-lp-l2` - **Date:** 2026-07-20 - **Validator session:** `lp-l2v2` (fresh, adversarial; resumed after the prior validator died mid-run).

## Check results (all re-run by this validator)

| Check | Result |
| --- | --- |
| `npm run typecheck-client` | clean (no errors) |
| `./scripts/test.sh --grep "livingDocs"` | 143 passing, 0 failing |
| `./scripts/test.sh --grep "LivingDocsService"` | **138 passing, 3 FAILING** - see defect 1 |
| `npm run valid-layers-check` | clean |
| `./scripts/check-seams.sh` | OK - all shell seams intact |
| Zero core patches | confirmed - diff entirely within `contrib/livingDocs/` |
| No co-author lines | confirmed (`git log main..HEAD --format=%B`) |

The implementer's findings.md claimed "143 passing, 0 failing" but ran only the lowercase `livingDocs` grep. The case-sensitive `LivingDocsService` grep (which the plan explicitly called out as a gap) surfaces the regression. The `livingDocs`-grep suite and the `LivingDocsService`-grep suite are DIFFERENT files - the gate's own new tests live in the former and pass; the broken tests live in the latter.

## Defects

### 1. BLOCKING - the L2 gate breaks two previously-green LivingDocsService unit tests

**Observation.** `./scripts/test.sh --grep "LivingDocsService"` reports 3 failing:
- (a) `cancelChat stops an in-flight reply: no pending changes, busy cleared, a muted stopped turn (plan 27)` - expects `stopped: true`, gets `undefined`.
- (b) `with no model reachable, chat is honest (fallback turn, no faked reply, nothing queued)` - expects `via === 'fallback'`, gets `undefined`.
- (c) `a fan-out with the model down names EVERY failed doc... (F14)` - this is the KNOWN pre-existing failure #203, NOT caused by this branch.

**Root cause (proven, not guessed).** In the unit-test harness there is no broker, so `getModelProviderStatus()`'s `/healthz` request throws -> returns `provider:'none', readiness:'broker-down'` -> `needsModelChoice()` = true. The new gate block in `sendChatMessage` (`livingDocsService.ts` ~L4117) therefore intercepts EVERY genuine (no-`displayText`) send in these tests, holding the prompt and early-returning before `_deliverChatReply`. So no assistant turn is produced: (b) never gets its `fallback` turn; (a) never gets its `stopped` turn from the cancel path. The `cancelChat` test provides `opts.model` (which mocks `/v1/messages` and `/healthz -> {ok:true}` for the REPLY) but the probe still resolves against the harness default in the cancel timing, so it too is gated.

**Proof of causation (isolation run).** I temporarily neutered only the gate condition (`if (false && ...)`), re-transpiled, and re-ran: **140 passing, 1 failing** - both (a) and (b) turned green and only the known #203 remained. Restoring the branch file reproduced the 3 failures. So (a) and (b) are unambiguously caused by this branch; (c) is pre-existing. The test file `livingDocsService.test.ts` is UNCHANGED on the branch (`git diff main...HEAD` empty for it), confirming the implementer changed behaviour without extending the affected tests.

**Repro.** `nvm use 24; cd worktree; ./scripts/test.sh --grep "LivingDocsService"` -> 3 failing.

**Prescribed fix (for the fix-round).** Update the two affected tests to reflect the new first-AI-use contract: a genuine send against an unconfigured/broker-down backend now HOLDS the prompt and renders the inline choice instead of emitting a fallback/answer turn. Either (i) point these two tests through a configured-model path (set `opts.model` AND ensure the probe is healthy so `needsModelChoice` is false), or (ii) re-express them as asserting the held-prompt + inline-choice contract, and add a fresh snapshot test that the no-backend send holds rather than answers. This is a test-only change; the production behaviour is correct and desired. Do NOT weaken the gate.

## Live verification (this validator's own driving - not inherited)

Fresh throwaway profile, `TMPDIR=/tmp`, session `lp-l2v2`, adopted a self-started broker on 8090 (unconfigured -> then configured-included via `~/.config/lwd-openrouter.key`, `HOME=/tmp` empty so ChatGPT stays signed out; real keychain/token files never touched). The livingDocs surface is a webview OOPIF; a11y snapshot stops at the iframe, so I drove it with raw CDP `Input.dispatchMouseEvent` / char key events at CSS coordinates (DPR=1).

| Path | AC | Result | Evidence |
| --- | --- | --- | --- |
| Cold start | never shows model UI | PASS - Welcome renders, no forced model decision on the entry path | `vlive-1-coldstart.png` |
| (a) unconfigured send -> inline choice, prompt preserved | first AI action with no backend shows the inline choice | PASS - typed "Tighten the note to the board, keep its meaning.", clicked send; the user turn moved into the transcript (preserved), the composer cleared, and the "Choose how to run your request" card rendered with both doors. No honest-fallback turn was emitted - the choice replaced it. | `vlive-2-inline-choice-prompt-preserved.png` |
| (b) pick included -> replays and answers live | included-model path live-verified with the broker | PASS - switched broker to configured-included, clicked "Use the included model"; broker log shows `/v1/messages backend=openrouter` immediately (the held prompt replayed live); a real streamed proposal appeared with the inline red/green diff, a "MEANING CHANGE - NEEDS YOUR CALL / High" provenance chip, and Approve/Reject. Composer flipped to "Using the included model". | `vlive-3-included-replay-live-proposal.png` |
| Approve on the proposal | approve/reject works on the proposal | PASS - clicked Apply; the diff resolved into the document ("...no surprises." with "this week" removed), the Review banner cleared, the proposal card collapsed. Trust grammar intact end-to-end. | `vlive-4-approve-applied.png` |

### Scenario provenance (live vs inherited vs unverified)

| Scenario | Status |
| --- | --- |
| Cold start - no model gate | LIVE-VERIFIED by this validator |
| Unconfigured send -> inline choice, prompt preserved (core path a) | LIVE-VERIFIED by this validator |
| Pick included -> replay answers live + real proposal (core path b) | LIVE-VERIFIED by this validator (broker log + streamed diff) |
| Approve the proposal | LIVE-VERIFIED by this validator |
| Broker-down send -> inline choice (`needsModelChoice` gates broker-down too) | ACCEPTED from dead validator's `v10`; consistent with the code (`needsModelChoice` returns true for `broker-down`) |
| Sign-in PENDING inline state (spinner + "Open the sign-in page") | ACCEPTED from dead validator's `v15`; consistent with `_renderInlineModelChoice`'s pending branch |
| Newest-wins (edit + re-send before choosing) | ACCEPTED from dead validator's `v14`; matches `holdPrompt` replace semantics |
| Second-doc-no-card (per-resource keying) | ACCEPTED from dead validator's `v16`; matches the `Map<resourceString>` keying |
| Relaunch -> no stale pending (in-memory hold) | ACCEPTED from dead validator's `v18`; the hold is in-memory only, so a reload clears it |
| **Real ChatGPT sign-in ROUND-TRIP completion** (loopback -> signed-in -> replay) | **NOT VERIFIED** - requires a real ChatGPT OAuth completion, out of scope for a sandboxed validator. The in-process poll + in-memory hold design is sound by inspection (`_pollInlineSignIn` -> `completeSignInAndReplay`), but the live signed-in replay was not exercised end to end by anyone. |

## Adversarial code review (no additional defects found)

- Diff is confined to `src/vs/workbench/contrib/livingDocs/` (service, rail, common types, new pure gate, new gate test). Zero core patches. Trust grammar untouched (verified live - diff/approve/provenance all intact).
- `common/modelAccessGate.ts`: pure, DOM-free, service-free. `needsModelChoice` gates ONLY `provider==='none'` with `unconfigured`/`broker-down` - `budget-paused` and `ready`/`chatgpt`/`included` are correctly NOT gated (a door is already chosen). Per-resource `Map` keying, newest-wins `holdPrompt` (replace), take-once `takePending` (delete + fire), `clear` for dismiss. Sound.
- Strings localized via `localize("...", ...)` with double quotes; tabs used; disposables registered immediately (`_modelAccessGate` via `_register`; the inline sign-in poll is a `MutableDisposable` so a re-open/completion never leaks a timer; listeners via `_renderDisposables` DisposableStore cleared each render). No storage-key abuse. No new events driving control flow (the gate's change event is forwarded onto the existing `onDidChange` the rail already listens to - a state-change broadcast, which is the sanctioned use).
- `_invalidateModelProbe()` correctly resets `_modelProbedAt`/`_modelProbe` (field names verified against their declarations and use sites) so a just-chosen door is reflected immediately.
- The onboarding demo path is correctly exempted (`!shown` guard: a substituted `displayText` means the walkthrough is driving, which has its own no-model guidance) - this is why the demo-driven scenarios still work.

## Cleanup

My Code OSS instance (pid 29986) killed; my broker (47665) stopped; port 8090 free; playwright session closed; temp profiles/home/workspace and the scratch CDP drive script removed. The worktree's `livingDocsService.ts` was restored to its committed state after the isolation experiment (`git diff --stat` empty). Only the `validator/` dir is added.
