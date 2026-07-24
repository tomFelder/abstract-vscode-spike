# RUN - The audit fix wave (paste this into a fresh chat)

This is the master orchestration prompt for the 2026-07-24 audit fix wave: [50-audit-fix-wave.md](50-audit-fix-wave.md) (work packages A-J, issues #252-#262, umbrella #263), grounded in the full-journey audit at [../qa/2026-07-24-ux-audit/00-report.md](../qa/2026-07-24-ux-audit/00-report.md). Same three-role architecture as [RUN-editor-v2-loop.md](RUN-editor-v2-loop.md): one Fable orchestrator (the session), Opus implementer sub-agents, independent Opus adversarial validator sub-agents, the exchange living on open PRs. Paste the block below verbatim into a fresh session.

---

Execute the **audit fix wave** on this fork until the ten work packages of `docs/plans/50-audit-fix-wave.md` are ticked or honestly parked, as one continuous unattended run.

The spec of record is `docs/plans/50-audit-fix-wave.md`; the findings, repros and acceptance floors live in issues **#252-#262** (umbrella **#263**); the evidence base is `docs/qa/2026-07-24-ux-audit/00-report.md` with per-group screenshots beside it. You orchestrate and never implement. Implementers and adversarial validators are separate Opus sub-agents (`model: "opus"`); a validator never sees its implementer's conversation.

**Step 0 (bootstrap).** Confirm the plan-50 docs PR is merged to `main` (merge it if still open). Read plan 50 in full - §4 carries the desktop-verification traps that will otherwise cost you hours (TMPDIR, native dialogs, webview CDP targets, broker self-respawn, node 24 + `npm run compile` before any launch). Comment on #263 that the run has started.

**The loop, per work package (plan 50 §2 table, §3 lanes).** Open a draft PR carrying the WP's acceptance floor from its issue as an unticked checklist → dispatch an Opus implementer with the issue + the relevant audit findings as its brief → implementer pushes with **before/after screenshots embedded in the PR** → dispatch an independent Opus adversarial validator that launches the built desktop app and **re-walks the WP's journeys** - golden path plus the audit's off-path probes (relaunch + `cat` on disk, empty state, broker-down, cancel, twice-in-a-row, wrong-door discoverability) - and is the ONLY party that ticks checklist boxes, with its own screenshots as evidence. Findings that fail → back to the implementer, max 3 fix rounds, then park with honest notes on the WP issue. Squash-merge on PASS; close the WP issue only on validator-confirmed PASS; every PR references #263.

**Sequencing (plan 50 §3).** Lane 1 (service, owns `livingDocsService.ts`): B(#253+#248) → D(#258) → E(#257). Lane 2 (editor webview): C(#254+#255) → F(#256). Lane 3 (screens): A(#252, the P0 - start immediately) → H(#261) → G(#259). Lane 4 (after a lane frees): I(#260), then remaining J(#262) items - J boxes may also be ticked opportunistically on any wave PR. ≤3 desktop instances machine-wide; every live lane rebases after any merge; `livingDocsService.ts` changes route through you as additive methods; core-patch budget is **0** - park and escalate on #263 instead.

**Validation is the product.** A validator that only reads the diff has failed - every tick traces to a live desktop walk. Where a fix claims to resolve an audit finding, the validator must run the audit's exact repro (they are written step-by-step in the issues) and attach the disproof. Journeys, not code, decide done: WP-A is done when 1j and 1t re-walk WALKABLE on a populated project, not when `openAgent` has an emitter.

**Budgets.** Iteration budget 30 (a fix round counts). If it nears exhaustion, priority: A > B > C > F > E > D > G > H > I > J; park the tail honestly.

**No checkpoints, no questions.** Never AskUserQuestion; recover from build breaks, port clashes, webview timing and broker respawns yourself (plan 50 §4 carries the known traps; the audit's `BRIEF.md` in the evidence folder is a ready-made validator briefing). #120 (ChatGPT-subscription backend) stays open and no package fails on it - WP-G only makes the screen truthful about it. Stop conditions: every WP ticked-or-parked, or budget spent.

**Conclude with** the closing audit (plan 50 §6): one fresh adversarial validator re-walks the full regressed set on a clean profile on final `main`, writes `docs/qa/2026-07-24-ux-audit/99-closing/re-grades.md` (before → after scoreboard) with closing screenshots beside it, posts the wave summary on #263 (every PR, every parked gap, every re-grade), and sends a push notification - the founder is likely away. The whole run must be reviewable from the PR record alone.

---

## Notes for whoever runs this

- Expected shape: ~10-14 PRs (A ≈ 2, B ≈ 1-2, C ≈ 2, D/E/F/G ≈ 1 each, H ≈ 1-2, I ≈ 1-2, J absorbed), all screenshot-carrying with validator-ticked checklists.
- The riskiest packages: **A** (the v2 Agents render tree needs doors re-threaded without re-breaking the redesign - the audit's automation group mapped every dead end, use it) and **I** (shell chrome; take the minimal floor in #260, not a settings redesign).
- **B before D and E** is load-bearing: the identity fix changes the doc-key both of them read and write.
- The two verification passes (`verify-actuation`, `verify-provenance`) contain named source locations for most root causes (`approveAllDoc`/`_confirmBulkApprove`, `getDocPolicy`'s single caller, `reject()`'s missing `_persist`, `_onbSeeItWork()`'s step skip) - hand these to implementers, they are starting points, not gospel.
- Validators should reuse `docs/qa/2026-07-24-ux-audit/BRIEF.md` (method, probes, grading vocabulary) with the WP's journeys substituted in.
- Model backend for live verification: the included/OpenRouter door works cold (broker auto-starts). Do not touch `~/.abstract/openai-oauth.json`.
