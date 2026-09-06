# Plan 56. The loop goes live

**Status:** authored 1 Sep 2026, from a grilling session that settled the wave end to end. This plan turns doc 30's stage-3 first tranche into PR-sized work packages, pairs them with the content-integrity defects that stand between a stranger and the aha, and carries the RUN prompt for an autonomous overnight loop.
**Spec of record:** [30-editing-architecture.md](../30-editing-architecture.md). Where this plan and doc 30 disagree, doc 30 wins. Stages 0-2 merged in plan 55; this is the first tranche of stage 3.
**Absorbs:** plan 53's WP-C (issue hygiene) into B1. The rest of [plan 53](53-strip-back-loop.md) and all of [plan 54](54-structural-extras-loop.md) stay parked and unrun.
**Spec issue:** [#374](https://github.com/tomFelder/abstract-vscode-spike/issues/374) - the same wave as a spec, with the user stories and the testing decisions. The per-ticket contracts the overnight loop consumes hang off it.
**Repo facts:** PRs go to `origin` = `tomFelder/abstract-vscode-spike` only, base `main`. The remote `microsoft-vscode-readonly` is never pushed to and never receives PRs, under any circumstances.

## Goal

Make the editing loop real and prove it survives contact with a real folder. The loop kernel merged in plan 55 (#361) but was never wired into the product - the chat path still runs the old single-shot pipeline - so "the editing loop works" is currently unfalsifiable. This wave wires it for explicit-scope asks, fixes the defects that lose or misreport the user's content, and closes on a founder smoke rather than on a stack of green PRs.

## What this wave is for

Defect *identification* is a first-class output, not a side effect. A healthy UX is established by finding what is broken, not only by fixing what is already known. The wave therefore opens with a walk that files issues and fixes nothing, and every validator files what it stumbles on regardless of scope.

## Constraints

- **The loop is wired for explicit-scope asks only** - attachment chips present, the founder's clearest case (doc 30 §7 stage 3). Scope inference, the document catalogue and `search_documents` are stage 4 and out of this wave. The single-shot path stays live for every other scope class.
- **No agent framework.** Doc 30 D5 stands: the kernel is hand-rolled in `common/`, typed against `@anthropic-ai/sdk` types only. LangGraph is a recorded revisit trigger, not a destination - see ADR 0183. Do not introduce LangChain, LangGraph, the Vercel AI SDK or the SDK `toolRunner` in this wave.
- **Founder rulings from doc 30 §9 continue to bind**: the $1/day cap stays with the OAuth door as the relief valve (9.1); `anthropic/claude-sonnet-5` serves both planner and rewrite-author roles on the included tier (9.3); reads outside scope are permitted but ledgered (9.4); a proposed deletion is never bulk-approvable (9.5); web serving is out of v1.0 (9.6).
- **Vocabulary.** The unit of review is a **change**; "proposal" is retired as a noun. The verb "propose" stays. See the root [CONTEXT.md](../../CONTEXT.md), which is the glossary of record.

## The seams

The whole wave tests at **four seams, all of which already exist**. No new seam is introduced. Each work package below also names its seam concretely; those per-package lines are instances of these four, not twenty independent boundaries. An Implementer must work at the seam its package names and must not invent others - that is what satisfies the `tdd` skill's confirm-the-seams rule with nobody awake to confirm them.

| | Seam | Where it applies |
|---|---|---|
| **S1** | `IRequestService` - the single injection point for model traffic. One raw `fetch` bypasses it today, which is the whole of #318. | P0, and it is what makes S2's fake client honest |
| **S2** | `IAgentModelClient` + `IAgentToolRegistry` - already exported from `common/livingDocsAgentLoop.ts` and injected into the kernel, so the loop is drivable by a scripted fake client with no network and no DOM. | A1, A2, A3, A4 |
| **S3** | `ChangeStore` + `IChangeStoreDocuments` - the store's write boundary, already carrying typed receipts (`IProposeReceipts`, `ChangeSkipReason`, `IStoreRefusal`, `StoreWriteResult`) and taking read/snapshot/write by injection, so persistence and recovery are testable without a real disk. | A1's receipts, B1, B2, B3, B4 |
| **S4** | The workbench service-level harness (`test/browser/`, 50+ existing suites) - only for defects reachable solely through the assembled service and its DOM. | B5, B6, B7 |

Pure logic joins the established `common/` family (`turnReceipts.ts`, `applyOutcome.ts`, `changeJournal.ts`, `changeReconciler.ts`, `livingDocDiffer.ts`) rather than inventing a seam; A3's segment-expansion function lands there.

## The barrier

These land serially, on `main`, before either lane opens. The rename in particular cannot run as a lane: it touches `livingDocsService.ts` and `reviewRailView.ts` heavily, and any concurrent work package would conflict with it continuously.

**P0 - Verification becomes trustworthy (#318).** `_chatModelCall` uses global `fetch` (`livingDocsService.ts:5195`), bypassing the injected request service, so the unit suite reaches a real model whenever port 8090 is busy. Route the loop's model client through `IRequestService` so a test double answers structurally, per doc 30 §6. This lands first because every later claim of "validated" depends on it.
*Seams:* the `IRequestService` boundary as the single injection point for all model traffic; the existing dead-loopback test helper (`livingDocsService.test.ts:170`, `:357-367`) as the fake.
*Acceptance:* a test that occupies port 8090 with a live-looking listener and asserts the suite still cannot reach it; no code path in `livingDocs` calls global `fetch` for model traffic.

**P1 - The vocabulary rename.** Roughly 300 `proposal` identifiers in the living-docs source become `change`, aligning the service and rail with the store that already speaks `Change`. Concentration: `livingDocsService.ts` (91), `livingDocsService.test.ts` (53), `common/livingDocs.ts` (20), `reviewRailView.ts` (20), `common/changeStore.ts` (15). The PostHog event keys `proposal_created` and `proposal_resolved` rename to `change_created` and `change_resolved`, and doc 15's event dictionary is updated to match - safe because #134 is still open, so no analytics data depends on the old names. Do not touch upstream VS Code's extension-API sense of the word (`enabledApiProposals`, `ApiProposalName`).
*Seams:* none new - this is a rename with no behaviour change.
*Acceptance:* full unit suite green before and after with identical results; no `proposal` identifier remains in `livingDocs` or `sessions` except upstream API-proposal usages; a grep sweep in the PR body proving it.

**P2 - The opening walk.** An agent-driven off-path walk of the editing surfaces: chat, change review, bulk verbs, reload, multi-window. It files issues and fixes nothing. Output is a findings set under `docs/qa/2026-09-01-loop-walk/`. Anything it finds that is gate-blocking gets pulled into the running wave; everything else is filed and waits.

## Lane A - make the loop real

Doc 30 stage 3, first tranche. Lane A may not start until P1 is merged.

**A1 - The tool executors.** Implement the renderer-side executors for the explicit-scope subset of doc 30 §2.4's eight verbs: `list_documents`, `read_document` (ordinal-labelled block serialisation), `read_source`, `plan_scope` (pre-filled and gate-free when scope was explicit; typed `scope_locked` error on widening), `propose_segments` (the only in-loop mutating verb, returning per-segment receipts), and `finish` (mandatory terminal; the host composes the ledger, the model narrates). `search_documents` and `rewrite_documents` are explicitly out - stage 4 and the second tranche respectively.
*Seams:* the tool registry interface the kernel is injected with; each executor's typed receipt union (`queued(changeId) | dropped(policy | bind-guard | stale-ordinal | out-of-scope | no-op)`); the change store's write boundary as the enforcement point for scope.
*Acceptance:* each executor unit-tested against a fake store; `propose_segments` receipts cover every drop reason; `finish` is rejected while jobs are unsettled.

**A2 - The kernel, wired.** Wire the merged kernel (`common/livingDocsAgentLoop.ts`, #361) into the chat path for explicit-scope asks only - chips present. The old single-shot path stays live and is chosen for every other case. Bounded by the scope contract, a step ceiling (`livingDocs.agentMaxSteps`, default 20) and a per-document failure ceiling of 3.
*Seams:* the branch point that routes a turn to loop-or-single-shot; the injected model client; the step ledger events (`onStep`/`addStep`) as the steering surface.
*Acceptance:* a scripted fake client drives a full multi-step conversation to `finish`; a turn with no chips still takes the old path; the step ceiling terminates honestly rather than silently.

**A3 - The segment wire under structured outputs.** The planner emits `{keep: "B1-B7"} / {replace: "B8-B9", content} / {insertAfter: "B14", content}` over ordinal-labelled blocks, schema-enforced, with each `replace` echoing the first words of the blocks it replaces so an off-by-one range is a hard validation failure rather than a silent misapply. The host expands deterministically. Bind-key multiset preservation is enforced per doc 30 §2.1; frontmatter never enters model scope.
*Seams:* the segment-list schema as the wire contract; the host's deterministic expansion function (pure, unit-testable); the bind-key invariant check.
*Acceptance:* table-driven fixtures including off-by-one ranges, duplicate headings and bind-bearing blocks; a fuzz round asserting expansion is byte-exact on unchanged blocks.

**A4 - I3 receipt reconciliation.** Every model claim reconciles against the store's receipts before the reply renders. The reply renderer's signature takes `(finishSummary, receipt)`; prose cannot reach the bubble without a receipt; claimed > 0 with queued = 0 renders as a failure. This is the structural fix for #303, and it is what lets B1 close that issue.
*Seams:* the reply renderer's two-argument signature as the choke point; the receipt type as the contract between store and renderer.
*Acceptance:* the doc 30 §6 adversarial test - claimed > 0, queued = 0, assert the reply renders the reconciliation and never success prose.

## Lane B - content integrity and the aha path

Lane B may not start until P1 is merged. B1 may close #303 only after A4 has merged.

**B1 - Verify and close, with evidence.** Doc 30 §7 claims stages 0-2 killed #329, #334, #305, #303 and #300's class; all five are still open with no evidence. Reproduce each against current `main` and either close it citing the test and commit that killed it, or reopen it as a live defect with a repro. Absorbs plan 53 WP-C: verify-close #253 and #255 (the plan-50 wave closed only the first of each `Fixes` pair), post the #263 umbrella closing summary, and work the #262 one-step-off sweep. #303 waits on A4.
*Seams:* none new - this is verification, not implementation.
*Acceptance:* every issue either closed with a linked test or annotated with a fresh repro; the PR body carries the evidence table.

**B2 - #319: a `bind:` in a heading deletes it from disk.** Silent on-disk data loss - the highest-severity open defect in the tracker.
*Seams:* the autosave path's serialisation boundary; `extractBindLinks` as the invariant checker.
*Acceptance:* a test that writes a heading containing a bind link, autosaves, and asserts the heading survives byte-exact on disk.

**B3 - #357: `_persist` frontmatter loss on non-approve paths.** The serialiser drops `template`, `name`, `description` and `fromTemplate` plus unknown user keys (doc 30 §8.3). Plan 55's R6 quarantined this on the approve path by splicing; the non-approve paths remain.
*Seams:* `withReplacedBody` as the single re-attachment point for frontmatter; the parse/emit asymmetry between `livingDocMarkdown.ts` parse and emit.
*Acceptance:* a template-derived document round-trips every frontmatter key byte-exact through every persist path, not just approve.

**B4 - #359 and #360: the journal race and the store-open race.** Concurrent appends from two windows lose a decision with no trace; the store-open race is the same class. Doc 30 §5's journal discipline (J1 intent fsynced before mutation, checksummed records, torn-append truncation) is the design.
*Seams:* the journal's append boundary as the serialisation point; the reconciler's three-way post-hash classification.
*Acceptance:* a fault-injected concurrent-append test asserting no decision is lost and the reconciler classifies correctly; two-window integration check.

**B5 - #320: a blank document cannot be typed into.** `.ProseMirror` computes to 0px wide. Blocks the very first thing a new user does.
*Seams:* the editor mount's layout boundary.
*Acceptance:* a test asserting non-zero computed width on an empty document, plus a screenshot of typing into a fresh blank document.

**B6 - #299: the last tab closes to a blank white pane.** An off-path state on the most common exit action.
*Seams:* the tab-close handler's empty-state branch.
*Acceptance:* closing the last tab lands on a defined surface; screenshot in the PR.

**B7 - #333: the flagship journey is torn at both ends.** No Present on a fresh profile's first document, and the journey does not complete end to end. This is the aha path itself, so it is gate-blocking by doc 18's own standard.
*Seams:* the first-run seeding path; the Present entry point's availability predicate.
*Acceptance:* a fresh-profile walk reaches Present on the first document; before/after screenshots of the full journey.

## Orchestration protocol

Identical to plan 55's, with one addition: this wave adopts Matt Pocock's engineering skills for the inner loop, on trial.

- **The orchestrator is Fable** (the session running the RUN prompt): strategic planner, sequencer, reviewer of reports, merger. It never implements and never fills its context with file dumps; sub-agents report digests.
- **Every sub-agent is Opus**: `Agent` tool, `subagent_type: "general-purpose"`, `model: "opus"`. At most two sub-agents exist at any moment (one active per lane). Each work package is one PR, produced by an Implementer/Validator pair looping until approved.
- **Implementer** (spawn with `isolation: "worktree"`): branch `loop56/<id>-<slug>` off fresh `main`. It calls `Skill("tdd")` and works the red-green loop **at the seams this plan declares for its work package** - the declared seams are what satisfy that skill's "no test is written at an unconfirmed seam" rule with no human awake, so an Implementer must not invent seams of its own. Note that skill evicts refactoring from the loop and pushes it to review; that is intended. Before opening the PR it calls `Skill("code-review")` against the merge base, and addresses what that review raises. Then commit (no co-author lines), push to `origin`, open the PR with `gh pr create` - body states what/why, the validation evidence, the `code-review` findings and their resolution, and embeds screenshots for any UI-affecting change under `docs/plans/56-verify/<id>/`.
- **Do not use the `implement` skill.** It carries `disable-model-invocation: true` so a sub-agent cannot invoke it, and its entire content is four sentences already encoded in this protocol.
- **Validator** (fresh Opus agent, own worktree): independently checks out the PR branch, builds, runs `npm run typecheck-client`, the targeted unit suites, the broker suites where touched, and `npm run valid-layers-check` when imports changed; for UI WPs, launches the app and captures its own screenshots over CDP. Verdict via `gh pr review`. A validator that stumbles on a defect outside the WP's scope files it with `gh issue create` and says so in the review.
- **The loop:** request-changes goes back to the same Implementer (SendMessage keeps its context); re-validate; at most three cycles, then park the WP with a PR comment and move the lane on.
- **Merge on approval:** `gh pr merge --squash --delete-branch`; the lane pulls `main` and starts its next WP.
- **Stop conditions:** backlog complete; or both lanes blocked; or the run judges the remaining WP cannot land cleanly overnight.

## The gate

Merged PRs do not close this wave. It closes when the founder runs the #345 smoke checklist on a **packaged desktop build** against a **real folder**, drives an explicit-scope agentic edit end to end through the new loop, and confirms the receipt matches what is on disk. The precedent is direct: the model door had never actually worked until the plan-51 founder smoke tried it, and X1 surfaced only on a real walk. Until that run happens, the loop is asserted, not proven.

## Environment gotchas (hard-won; do not rediscover)

- Node is pinned by `.nvmrc` (24.x); ensure the shell picks it up before any npm/gulp command.
- `scripts/test.sh` runs against `out/` - transpile first, and beware stale `out/` producing phantom results. Prefer the watch task pattern from CLAUDE.md; never `npm run compile`.
- Husky's precommit can leave files staged when it fails; check `git status` after a failed commit.
- Worktrees: symlink `node_modules` from the main checkout instead of a fresh `npm install`.
- The unit suite must never reach a live broker on port 8090 - and after P0 this is structural rather than a discipline.
- Screenshots over CDP (chrome-devtools MCP against `./scripts/code-web.sh ./living-docs-sample`, bare URL, or the launch-abstract skill for desktop with `TMPDIR=/tmp`); never full-screen `screencapture`.
- Git LFS: if a push rejects on LFS objects, `git lfs push origin <branch> --all` then retry.
- Packaging the desktop app is the only thing that exercises esbuild's loader map; budget for it before the founder smoke.
- Absolute rule: PRs and pushes go to `origin` (tomFelder/abstract-vscode-spike) only - never `microsoft-vscode-readonly`.

## The RUN prompt

Two variants sit beside this plan; both work the same tickets (#375-#389) and both close on the same founder smoke.

- **[RUN-56-adversarial-goal-loop.md](RUN-56-adversarial-goal-loop.md)** - the `implement`-driven variant, and the one to reach for. The implementation step is a real `/mattpocock-skills:implement` session run headless, since that skill carries `disable-model-invocation` and cannot be reached through the Skill tool by any orchestrator or sub-agent. A ticket finishes when a panel of three adversaries **fails to falsify** its acceptance criteria, rather than when a validator approves it. The distinction is not academic: an approval gate is what let five issues be recorded as fixed by an earlier wave without being fixed.
- **[RUN-56-loop-goes-live.md](RUN-56-loop-goes-live.md)** - the agent-native variant, following the plan-55 implementer/validator protocol with `tdd` and `code-review` called directly by sub-agents. Simpler, no headless sessions, and the fallback if driving the CLI proves awkward.
