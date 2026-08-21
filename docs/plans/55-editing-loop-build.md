# Plan 55. The editing-architecture build loop

**Status:** authored 20 Aug 2026, immediately after the founder's six rulings landed in [doc 30 §9](../30-editing-architecture.md). This plan turns doc 30's stages 0-2 into PR-sized work packages and carries the RUN prompt for an autonomous overnight loop.
**Spec of record:** [30-editing-architecture.md](../30-editing-architecture.md). Where this plan and doc 30 disagree, doc 30 wins. [29](../29-chat-quality-and-multi-doc-architecture.md) is background; its errata are doc 30 §8.
**Repo facts:** PRs go to `origin` = `tomFelder/abstract-vscode-spike` only, base `main`. The remote `microsoft-vscode-readonly` is never pushed to and never receives PRs, under any circumstances.

## Goal

Land doc 30's stage 0 (honesty patches), stage 1 (the change-store substrate) and stage 2 (the broker work) as a sequence of small, individually validated, squash-merged PRs, autonomously overnight, so the morning review is a stack of green PRs on GitHub with screenshots, not a monolith.

## Constraints from the founder's rulings (doc 30 §9)

- The $1/day cap stays; the OAuth door is the relief valve, so B3's picker work must actively encourage OpenAI OAuth sign-in and make the provider choice explicit (ruling 9.1).
- `anthropic/claude-sonnet-5` serves both planner and rewrite-author roles on the included tier (ruling 9.3); the B3 catalogue work promotes it.
- Web serving is out of v1.0 (ruling 9.6): no reverse-proxy work, no hosted-web validation; browser checks are the local web build or desktop app only.

## The two lanes

Two lanes run concurrently, each completing one PR at a time in strict order. Never more than two sub-agents working at once across the whole run. A lane pulls `main` before starting each work package, so Lane R and Lane B stay independent until B5.

### Lane R - renderer and review substrate

**R1 - Honest turn receipts (weak I3, kills the worst of #303).** At the two places parsed edits are consumed (`livingDocsService.ts:6000-6010` single-doc, `:6152-6158` fan-out), count parsed versus queued and render the shortfall in the reply as named reasons; a turn whose reply claims edits while zero queued must render as a failure, never success prose. All new strings externalised via `vs/nls`. Acceptance: unit tests covering claimed-but-dropped (heading target, policy, no-match, bind guard, title miss) each assert the rendered outcome names the drop; existing suites stay green.

**R2 - Closed apply results (weak I1, kills #329).** `applyBlockEdit` (`livingDocMarkdown.ts:752-760`) returns a discriminated result (`{landed, text} | {landed:false, reason}`), callers updated; `approve()` (`livingDocsService.ts:6344-6392`) must not record `approved` on either failure path (`:6358` block-gone fall-through, `:6363` anchor no-op) - a failed apply becomes a visible failed change in the rail, the change stays undecided, and the audit row records the failure. Update the enshrined fail-soft test (`test/browser/livingDocMarkdown.test.ts:814-818`) to assert the new signal rather than deleting the guard. Acceptance: an adversarial test that mutates the block after propose, approves, and asserts the file is unchanged, no `approved` record exists, and the failure is user-visible.

**R3 - One bulk path (weak I4, kills #334/#305).** A `captureBulkSet(scope) -> {ids, sentence}` over today's `_pending`, with apply-by-ids that may only shrink (per-id re-check, skips reported). Route all bulk call sites through it: editor action bar (`livingDocEditor.ts:319-326`), rail per-doc (`reviewRailView.ts:702-717`), rail foot (`:746-757`), chat-level (`:1163-1167`), `screenEditor.ts:826`. Confirm-policy coherence in the same PR: Reject all confirms at every level, the chat-level verbs confirm, ellipses only on verbs that actually raise a dialog, and any set spanning more than one document or larger than 10 confirms regardless of kind. Acceptance: a test that captures a set, mutates `_pending` mid-confirm, applies, and asserts applied ⊆ captured with skips named; a sweep asserting no call site reaches `approveAll`/`approveAllPending` directly.

**R4 - The change store and intent journal.** New pure module(s) under `src/vs/workbench/contrib/livingDocs/common/` implementing doc 30 §5: `Change` records (uuid, `anchors[]` with baseRevision hash and span, status enum incl. `needs-attention`, `partially-applied`, versions, thread scaffold), the append-only journal with J1-intent (declared `expectedPostHash`) / mutate / J2-commit / J3-final ordering, checksummed records, and the startup reconciler with its three-way classification. Persistence under the project's `.abstract/` home. No UI change in this PR. Acceptance: the adversarial suite from doc 30 §6 store tier - crash-window classification (equals-expected → `applied (recovered)`; equals-base → retry offered; neither → `unverified`), disk-full fails closed at J1, torn-append truncation, property-based propose/edit/approve/reload interleavings.

**R5 - The local differ.** Pure module implementing doc 30 §2.1 alignment: unique-content anchor pass, Jaccard pairing between anchors (reusing `similarity`), word-level LCS segments (reusing `wordDiffSegments` patterns), insert/delete, split/merge pairing, `changeClass` derivation (changed-chars ratio ≥ 0.6). Acceptance: table-driven fixtures incl. the probe cases from the council record (fenced code block chunking, duplicate headings, list blocks), plus a fuzz round asserting splice(base, hunks) reproduces the proposed text byte-exactly.

**R6 - Wire adapter, persistence, splice apply.** Convert incoming `{heading, oldText, newText}` edits into base-revision hunks in the store at queue time; pending proposals survive reload (resumable review with real decided counts replacing the hardcoded `0 of {N}` at `reviewRailView.ts:740-744`); approve splices `rawText` and never routes through `serializeLivingDoc` (quarantining the frontmatter data loss, doc 30 §8.3); stale-base handling per I8 (rebase non-overlap, `needs-attention` on overlap). Acceptance: reload-persistence test; a template-document approve that asserts `template`/`name`/`description`/`fromTemplate` frontmatter survives byte-exact; the I6 diff-equality post-check wired and tested.

**R7 - Ordinal decorations and the previous-document control.** Edit decorations resolve by block ordinal from the store's span (the mechanism the gutter already uses, `livingDocPmDecorations.ts:270-276`) instead of anchor-text equality - closes the #300 class incl. list blocks; add the previous-document control beside Next (extend `nextPendingDocId`, `livingDocsModel.ts:383`, with a backward variant; place per doc 30 §4.3). Acceptance: a decoration test on a list-block change asserting a widget mounts; screenshots of the inline diff on a list block before/after, and of prev/next navigation, embedded in the PR.

### Lane B - broker and serving

**B1 - Serving hygiene.** Per-purpose output caps: raise the client's `MODEL_MAX_TOKENS` path (`livingDocsService.ts:203`) to a per-call parameter with sane defaults, and the broker's `|| 1024` fallback (`lwd-model-broker.js:379`); delete the phantom `DEFAULT_MODEL = 'claude-opus-4-8'` (`:202`, resolution at broker `:793-800`) so the catalogue decides; retry jitter and 429 backoff on the client's single retry (`:5126-5141`); make the global `_modelLimiter` (`:5130`, width at `:241`) per-purpose. Acceptance: broker suites green (`node --test`), a new test asserting an unknown/absent model id resolves via the catalogue with the resolved id echoed, and a unit test on the jittered retry policy.

**B2 - Tool passthrough.** Carry a `tools` array and tool_use/tool_result content blocks through both doors: OpenRouter (OpenAI-shape tools; today's body `:379`, content flattening `:297-308`, text-only stream translation `:422-427`) and the Codex Responses door (function-call items; body `:482-491`, stream parser `:499-523`), normalising both to Anthropic-shaped events. Acceptance: extend the parity suite (`scripts/test/lwd-responses-parity.test.js`) and add recorded stub-upstream fixtures for a tool-call round trip per door, incl. malformed-arguments and mid-stream abort cases; the stub-upstream E2E pattern from `lwd-backend-selection.test.js:15-24`.

**B3 - Pinning, purpose, and the OAuth-first picker.** The merged catalogue with model-implies-door (`mergedModels` entries carry `{id, door, validated}`; OAuth entitlement preferred on collision, `~/.abstract/models.json` override), the advisory `purpose: plan|apply|chat` request field stamped into `model_spend`, loud `door_unavailable` (no silent cross-door substitution), and `selectBackend()` demoted to availability input (`:712-717`, `:844-855`). Promote `anthropic/claude-sonnet-5` through the validation walk (`lwd-openrouter-models.js` workflow) as the included planner/author per ruling 9.3, demote `gpt-4.1-mini` from default. Picker UX per ruling 9.1: the provider (your OpenAI account vs the included tier) is visible on every model row, and signed-out users see an inline encouragement to connect OpenAI OAuth. Acceptance: broker tests for cross-door resolution and the collision rule; a screenshot of the picker showing provider labels and the sign-in encouragement, embedded in the PR.

**B4 - Prompt-cache forwarding.** Forward `cache_control` breakpoints to OpenRouter, send a per-conversation `session_id` for sticky routing and a stable `prompt_cache_key` on the Codex door (the fixture already shows server-side caching, `scripts/test/fixtures/codex-responses-stream.sse:2,38`); surface `cached_tokens`/`cache_discount` into the spend meter's accounting. Client side: move the static system prompt and tool definitions ahead of volatile content so a breakpoint has a stable prefix to bite on (the full append-only restructure waits for the loop; this PR only stops actively defeating the cache). Acceptance: broker tests asserting the fields pass through per door and that metering records cache reads distinctly.

**B5 - The loop kernel skeleton (stretch; requires R4-R6 merged).** `common/livingDocsAgentLoop.ts` per doc 30 §2.5: a pure Anthropic-Messages tool-use state machine with injected model client and tool registry, typed events, step ceiling, and unit tests driving it with a scripted fake client through a multi-step tool conversation incl. a tool error and a mandatory `finish`. No UI wiring in this PR.

## Orchestration protocol

- **The orchestrator is Fable** (the session running the RUN prompt): strategic planner, sequencer, reviewer of reports, merger. It never implements and never fills its context with file dumps; sub-agents report digests.
- **Every sub-agent is Opus**: `Agent` tool, `subagent_type: "general-purpose"`, `model: "opus"`. At most two sub-agents exist at any moment (one active per lane). Each work package is one PR, produced by an Implementer/Validator pair looping until approved.
- **Implementer** (spawn with `isolation: "worktree"`): branch `loop55/<id>-<slug>` off fresh `main`, implement exactly the WP scope, self-verify (typecheck + targeted tests), commit (no co-author lines), push to `origin`, open the PR with `gh pr create` - body states what/why, the validation evidence, and embeds screenshots for any UI-affecting change. Screenshots are committed to the PR branch under `docs/plans/55-verify/<id>/` and embedded with raw URLs so they render in the PR body.
- **Validator** (fresh Opus agent, own worktree): check out the PR branch, build, run `npm run typecheck-client`, the targeted unit suites, the broker suites where touched, and `npm run valid-layers-check` when imports changed; for UI WPs, launch the app (web build or desktop), exercise the change, capture its own screenshots over CDP and attach them in the review. Verdict via `gh pr review` - approve, or request changes with specific, reproducible findings.
- **The loop:** request-changes goes back to the same Implementer (SendMessage keeps its context) for a fix round; re-validate; at most three cycles, then the orchestrator parks the WP with a PR comment explaining the block and moves the lane on.
- **Merge on approval:** `gh pr merge --squash --delete-branch`; the lane pulls `main` and starts its next WP. Approved-and-merged is the definition of done; the founder reviews the merged stack in the morning.
- **Stop conditions:** backlog complete; or both lanes blocked; or the run judges the remaining WP cannot land cleanly overnight. The orchestrator's final message is the morning report: per-WP outcome, PR links, defects discovered en route (file them with `gh issue create`), and what was parked and why.

## Environment gotchas (hard-won; do not rediscover)

- Node is pinned by `.nvmrc` (24.x); ensure the shell picks it up before any npm/gulp command.
- `scripts/test.sh` runs against `out/` - transpile first, and beware stale `out/` producing phantom results. Prefer the watch task pattern from CLAUDE.md; never `npm run compile`.
- Husky's precommit can leave files staged when it fails; check `git status` after a failed commit.
- Worktrees: symlink `node_modules` from the main checkout instead of a fresh `npm install`.
- The unit suite must never reach a live broker on port 8090 (#318): construct the service through the test helper that dead-loops the proxy URL (`livingDocsService.test.ts:170`, `:357-367`).
- Screenshots over CDP (chrome-devtools MCP against `./scripts/code-web.sh ./living-docs-sample`, bare URL, or the launch-abstract skill for desktop with `TMPDIR=/tmp`); never full-screen `screencapture`.
- Git LFS: if a push rejects on LFS objects, `git lfs push origin <branch> --all` then retry.
- Absolute rule: PRs and pushes go to `origin` (tomFelder/abstract-vscode-spike) only - never `microsoft-vscode-readonly`.

## The RUN prompt

The verbatim prompt to start the overnight run is kept beside this plan in [RUN-55-editing-loop.md](RUN-55-editing-loop.md).
