# RUN prompt - plan 56 adversarial goal loop

The `implement`-driven variant of the plan 56 run. It works the same tickets as [RUN-56-loop-goes-live.md](RUN-56-loop-goes-live.md), which stays as the agent-native alternative, and differs in two ways: the implementation step is a real `/mattpocock-skills:implement` session rather than a paraphrase of it, and a ticket is finished when adversaries **fail to falsify it**, not when a validator approves it.

**Why falsification rather than approval.** This wave exists partly because five issues were recorded as fixed by an earlier wave and were not - nobody tried to break the claim, so the claim stood. An approval gate asks "does this look right?", which that wave passed. A falsification gate asks "prove this is wrong", which it would not have.

**Verified before writing this prompt** (1 Sep 2026, `claude` 2.1.252): user-invoked skills *do* fire from the prompt position in a headless `claude -p` session - tested against `ask-matt`, which loaded and produced its routing output. This matters because `implement` carries `disable-model-invocation: true`, so no orchestrator and no sub-agent can reach it through the Skill tool. Occupying the human turn in a headless session is the only way to use the real skill, and it works.

Paste everything below the rule into a fresh session running Fable.

---

You are the orchestrator of an autonomous overnight run in /Users/tommy/Sites/abstract-vscode-spike. The user has gone to bed, has explicitly authorised multi-agent work, and will review merged PRs in the morning. Do not ask questions, do not checkpoint, do not wait for approval. Make the call and record it.

Required reading before anything else, in this order:
1. docs/plans/56-loop-goes-live.md - the plan of record: the four seams, the barrier, the two lanes, the gate, and the environment gotchas.
2. docs/30-editing-architecture.md - the architecture of record. Where the plan is ambiguous, it decides. Section 9 holds founder rulings, which are constraints.
3. CONTEXT.md at the repo root - the glossary. The unit of review is a "change"; "proposal" is retired as a noun. Use the project's vocabulary in issue titles, commit messages, test names and user-facing strings.

Your role, strictly: select work, run the loop, judge refutations, merge, report. You never implement and never edit source yourself. You never read a full file into your own context; agents and headless sessions report digests.

## Selecting work

The tickets are GitHub issues #375-#389, labelled `ready-for-agent`, with real blocking edges recorded as native GitHub issue dependencies. Do not hand-maintain a list - ask the tracker what is runnable:

```
gh api repos/tomFelder/abstract-vscode-spike/issues/<n> --jq '.issue_dependencies_summary.blocked_by'
```

A ticket is on the frontier when that number is 0 and the issue is open. Work the frontier. When a ticket merges, re-query, because merging unblocks its dependents.

**#378 (the rename) is a barrier.** It rewrites roughly 300 identifiers across the two largest files in the area. While it is in flight nothing else may be in flight, and nothing else may start until it is merged. Everything except #375, #376 and #377 depends on it anyway; enforce it explicitly rather than trusting the graph.

## The goal loop, per ticket

The **goal** is the ticket's acceptance criteria. The loop ends when a full adversarial round produces zero concrete refutations - a **dry round** - not when someone approves.

### Stage 1 - prepare

Create a git worktree off fresh `main` on branch `loop56/<issue>-<slug>`. Symlink `node_modules` from the main checkout; never run a fresh `npm install` in a worktree. Generate a UUID and keep it: it pins the implement session so fix rounds resume the same context.

### Stage 2 - implement, via the real skill

Run the implementation as a headless session whose prompt is the skill. From inside the worktree:

```
claude -p "/mattpocock-skills:implement <the full ticket body, pasted>" \
  --session-id <the uuid> \
  --permission-mode bypassPermissions \
  --model opus \
  --output-format json \
  > implement.log 2>&1
```

Paste the ticket body into the prompt. That skill reads no issue tracker and will not fetch it for you.

Append these instructions to the pasted ticket, because the skill does not know them:
- The seam to work at is the one the ticket names. Do not invent seams. The plan has already agreed them, which is what satisfies the "no test is written at an unconfirmed seam" rule with nobody awake to confirm them.
- Australian English, no em dashes, tabs not spaces, all user-facing strings externalised through `vs/nls`, and the conventions in .claude/CLAUDE.md.
- Commit to the current branch with no co-author lines. Do not create a branch and do not open a PR; the orchestrator owns both.

Read only the tail of `implement.log`, never the whole thing. `--permission-mode bypassPermissions` is what makes the session unattended; the worktree is what contains the blast radius if it goes wrong.

If the ticket turns out to be too large for one session - the skill has no bail-out and will grind - kill it, park the ticket with a PR comment explaining the split you would make, and move on.

### Stage 3 - the adversarial panel

Spawn **three sub-agents concurrently**, each in its own worktree checked out to the branch, each with one job: **prove the ticket's acceptance criteria are not met.** They are not reviewers. Do not ask them whether the code is good. Ask them to break the claim.

**A1, the tautology hunter.**
- *The revert test.* Revert only the production change, leaving the new tests in place. Run those tests. **They must fail.** A test that still passes with the fix removed proves nothing and is a refutation on its own. Restore afterwards. This operationalises the `tdd` skill's own named anti-pattern: an assertion that recomputes the expected value the way the code does passes by construction and can never disagree with the code.
- *The claim audit.* Walk every acceptance checkbox on the ticket. For each, name the test that asserts it. A checkbox satisfied only by prose in the PR body is a refutation. This is the lens that would have caught the five claimed-fixed issues.

**A2, the edge hunter.**
- *Adjacent inputs.* Find an input, state, ordering or size that still exhibits the original defect. The fix may be real but narrow.
- *The original repro, both ways.* For any ticket that closes an issue: demonstrate that the issue's original reproduction **does** reproduce on the parent commit, and **does not** after. If you cannot make it reproduce before the fix, you cannot claim it fixed - say so, and that is a refutation.

**A3, the collateral hunter.**
- *Blast radius.* Run the wider suite, `npm run typecheck-client`, and `npm run valid-layers-check` when imports changed. Anything that regressed is a refutation.
- *The real app*, for UI-affecting tickets: launch it and try to reproduce the original defect by hand, then capture screenshots of the fixed behaviour. Use the web build driven over CDP, or the launch-abstract skill for desktop with `TMPDIR=/tmp`. Never full-screen `screencapture`.

**What counts as a refutation.** A refutation must be **concrete and reproducible**: it names the command or input, and the wrong behaviour observed. "This looks fragile", "consider also handling X", and "the naming could be clearer" are not refutations - they are review comments, and this stage is not review. `implement` already ran `code-review` internally for that. An adversary that finds nothing concrete must say so plainly; a dry report is a real result, not a failure to try.

### Stage 4 - the verdict

**Any single concrete refutation sends the ticket back.** This is not a vote. One reproducible failure is a failure, however many lenses came back clean.

On refutation, resume the same implement session so its context is intact:

```
claude -p "<the refutations, verbatim>" --resume <the uuid> \
  --permission-mode bypassPermissions --model opus --output-format json
```

Then run a fresh adversarial panel. Maximum **three** implement-to-adversary cycles; then park the ticket with a PR comment naming exactly what could not be satisfied, and move on.

### Stage 5 - the dry round

When a full panel returns nothing concrete, the goal is met. Open the PR with `gh pr create`, targeting `main` on `tomFelder/abstract-vscode-spike`. The body states what was built, the acceptance criteria with the test that asserts each, **the revert-test result**, **the original-repro-both-ways result** where the ticket closes an issue, and the adversarial rounds it survived including what earlier rounds refuted. UI tickets embed before and after screenshots, committed under `docs/plans/56-verify/<issue>/` on the branch and referenced by raw URL.

Then `gh pr merge --squash --delete-branch`, remove the worktree, and re-query the frontier.

## Concurrency

At most **two tickets in flight**, and at most **four worktrees alive at once** across the whole run. Queue rather than exceed it - each adversary builds, and concurrent builds on one machine will simply make everything slower and flakier. #378 runs alone.

## Defect discovery is an output, not a distraction

Anything any agent stumbles on outside the current ticket's scope gets filed with `gh issue create` and named in the report. Do not fix it. The wave is measured partly on what it finds.

## Hard rules that override everything else

- PRs and pushes go to `origin` (tomFelder/abstract-vscode-spike) ONLY. The `microsoft-vscode-readonly` remote must never be pushed to or receive a PR. Verify every PR with `gh pr view <n> --repo tomFelder/abstract-vscode-spike --json isCrossRepository,baseRefName`: `isCrossRepository` must be false.
- Branch off `main`; never commit to `main`; squash-merge only after a dry round.
- No agent framework. Decision D5 stands and ADR 0183 records it: the kernel stays hand-rolled in `common/`, typed against `@anthropic-ai/sdk` types only. Do not introduce LangChain, LangGraph, the Vercel AI SDK or the SDK tool runner.
- The loop is wired for explicit-scope asks only. Scope inference, the document catalogue and `search_documents` are stage 4 and out of scope. The single-shot path stays live for everything else.
- Node is pinned by `.nvmrc` (24.x). `scripts/test.sh` runs against `out/`, so transpile first and beware a stale `out/` producing phantom results; never `npm run compile`. Husky can leave files staged when precommit fails, so check `git status` after a failed commit. If a push rejects on LFS objects, `git lfs push origin <branch> --all` and retry.

## One ticket needs judgement

**#389** reports the flagship journey as torn at both ends - no Present on a fresh profile's first document, and the journey not completing. These may be two independent causes. Investigate before implementing; if they are independent, split the ticket, say so in a comment, and work them separately rather than forcing one fix to cover both.

## Stop conditions and the morning report

Stop when the frontier is empty, or every remaining ticket is parked, or you judge the next ticket cannot land cleanly before morning.

Your final message is the report: a table of ticket, PR link, and outcome (merged after N adversarial rounds / parked and why); for each merged ticket, what the adversaries refuted along the way, because that is the record of what nearly shipped broken; every defect filed during the run with its issue number; and anything the founder must decide.

State plainly that merged PRs do not close this wave. It closes only when the founder runs the #345 smoke checklist on a packaged desktop build against a real folder, drives an explicit-scope agentic edit end to end, and confirms the receipt matches what is on disk.

Begin with the required reading, then query the frontier.
