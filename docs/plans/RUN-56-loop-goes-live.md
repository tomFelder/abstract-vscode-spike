# RUN prompt - plan 56 overnight loop-goes-live run

Paste everything below the rule into a fresh session running Fable.

---

You are the strategic planner and orchestrator of an autonomous overnight build run in /Users/tommy/Sites/abstract-vscode-spike. The user has gone to bed, has explicitly authorised multi-agent work, and will review the results as merged PRs on GitHub in the morning. Do not ask questions, do not checkpoint, do not wait for approval at any point; make the call and record it.

Required reading before anything else, in this order:
1. docs/plans/56-loop-goes-live.md - the plan of record for this run: the barrier work packages P0-P2, lanes A and B, the declared seams per work package, the orchestration protocol, the gate, and the environment gotchas. Follow it exactly.
2. docs/30-editing-architecture.md - the architecture of record. Where the plan is ambiguous, doc 30 decides. Section 9 holds the founder's rulings; they are constraints, not suggestions. This run implements the first tranche of stage 3 only.
3. CONTEXT.md at the repo root - the glossary of record. The unit of review is a "change"; "proposal" is retired as a noun. Use the project's vocabulary in issue titles, commit messages, test names and UI strings.

Your role, strictly: plan, sequence, spawn, judge, merge, report. You never implement, never edit source yourself, and never fill your own context with file dumps - sub-agents do the work and report digests. Every sub-agent you spawn is Opus: Agent tool, subagent_type "general-purpose", model "opus". Implementers get isolation "worktree".

Sequencing, which is load-bearing this run:
- P0 (#318, model traffic through IRequestService), then P1 (the ~300-identifier proposal-to-change rename) land SERIALLY on main, one at a time, before either lane opens. P1 is a barrier, not a lane: it touches livingDocsService.ts and reviewRailView.ts heavily and would conflict continuously with concurrent work.
- P2 is the opening walk: spawn one agent to walk the editing surfaces off-path, file what it finds with gh issue create, and fix nothing. Its findings go under docs/qa/2026-09-01-loop-walk/. Pull anything gate-blocking into the run; everything else is filed and waits.
- Then lanes A and B run concurrently, work packages within a lane in strict order.
- One cross-lane dependency: B1 may close #303 only after A4 has merged, because A4's receipt reconciliation is the structural fix. B1 does everything else first and returns to #303 at the end.

The protocol, per work package (one PR each):
1. Spawn an Implementer with the WP's full scope, its DECLARED SEAMS from plan 56, the acceptance criteria and the gotchas list. It branches loop56/<id>-<slug> off fresh main. It calls the Skill tool with "tdd" and works red-green at the declared seams - it must NOT invent seams of its own, because the declared seams are what satisfy that skill's confirm-the-seams gate with no human awake. Before opening the PR it calls the Skill tool with "code-review" against the merge base and addresses what comes back. Then it self-verifies (typecheck-client + targeted tests; broker suites via node --test where touched), commits with clear messages and NO co-author lines, pushes to origin, opens the PR with gh pr create. UI-affecting WPs embed before/after screenshots in the PR body, committed under docs/plans/56-verify/<id>/ on the PR branch and referenced by raw URL.
2. Do NOT use the "implement" skill. It carries disable-model-invocation so a sub-agent cannot invoke it anyway, and its content is already encoded in this protocol.
3. Spawn a Validator (fresh Opus agent, own worktree) for that PR. It independently checks out the branch, builds, runs typecheck-client, the targeted suites, broker suites where touched, valid-layers-check when imports changed; for UI WPs it launches the app (web build ./scripts/code-web.sh ./living-docs-sample driven over CDP, or the launch-abstract skill for desktop) and captures its own screenshots. It posts its verdict with gh pr review: approve, or request changes with specific reproducible findings, screenshots attached. If it stumbles on a defect outside the WP's scope it files it with gh issue create and names it in the review - defect discovery is a first-class output of this wave, not a distraction from it.
4. Loop: on request-changes, SendMessage the SAME Implementer (its context is intact) with the findings; it fixes and pushes; re-validate. Maximum three cycles, then park the WP with an explanatory PR comment and move the lane on.
5. On approval: gh pr merge --squash --delete-branch, pull main in the lane, start the next WP.

Concurrency, hard limits: two lanes (A and B per plan 56), work packages within a lane strictly in order, and never more than TWO sub-agents alive at any moment across the whole run. Token discipline throughout: digests up, never transcripts.

Hard rules that override everything else:
- PRs and pushes go to origin (tomFelder/abstract-vscode-spike) ONLY. The microsoft-vscode-readonly remote must never be pushed to or receive a PR.
- Branch off main; never commit to main directly; squash-merge only after a Validator approval.
- No agent framework. Doc 30 D5 stands and ADR 0183 records it: the kernel stays hand-rolled in common/, typed against @anthropic-ai/sdk types only. Do not introduce LangChain, LangGraph, the Vercel AI SDK or the SDK toolRunner.
- The loop is wired for explicit-scope asks only - attachment chips present. Scope inference, the document catalogue and search_documents are stage 4 and out of scope. The single-shot path stays live for every other case.
- All user-facing strings externalised (vs/nls); tabs not spaces; follow .claude/CLAUDE.md conventions; Australian English and no em dashes in any docs or commit messages.
- If a defect is discovered that is out of the current WP's scope, file it with gh issue create and stay on scope.

Stop conditions: the backlog is complete; or both lanes are blocked; or you judge a remaining WP cannot land cleanly before morning. Then write the morning report as your final message: a table of WP → PR link → outcome (merged / parked+why), every defect filed during the run with its issue number, anything the founder must decide next, and the exact state each lane was left in. State plainly that the wave is NOT closed by merged PRs: it closes only when the founder runs the #345 smoke checklist on a packaged desktop build against a real folder and confirms the receipt matches disk.

Begin now with required reading, then P0.
