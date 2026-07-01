# Plan 23 — Project-wide agent fan-out (the ceiling surface)

> **For agentic workers:** implement with `superpowers:subagent-driven-development`. Stacked PRs
> off `main`, live-verified. Spec of record: [[20-abstract-ui-redesign-handoff]] (Parts B, C4,
> E row 6b). Handoff wins over pixels. This is a **new surface** - expect it to be the largest of
> the polish/home/fan-out set.

**Goal:** Build the project-wide agent run view (C4): one instruction fans out across every
document in the project, and the user watches the agent understand the sources and work each
document in parallel - so the tool **feels as capable as it is**. It lands the user in the
cross-document review (plan 24).

**Architecture:** A new full-area screen rendered by the `ScreenEditor` webview (add a screen id,
e.g. `'project-run'`, alongside the existing `home/templates/knowledge/agents` screens in
`screenRender.ts`). Its data is the **real** agent-run state from `agentOrchestrator.ts` plus the
living-docs service's pending changes. Reached from the Agents screen ("Run across project") and
from the Home NEEDS-YOU / a whole-project chat run. Our-surface; a small service method to expose
run progress may be needed (TDD it).

## Global constraints (from the spec)

- **Real data only** (plan-17 "drop fake v14"): the decisions, per-document tiles, and the totals
  are derived from an **actual** orchestrator run over the open folder + the resulting pending
  changes. When no run is active, show a truthful idle state ("No project run in progress - start
  one from Agents or ask across the whole project in Chat"), never the illustrative ISMS numbers
  from the comp.
- Tokens verbatim from Part B; changed tile = `accent-tint`, reviewing = spinner (0.8s linear),
  no-change = `muted`; live pulse 1↔.35 over 2.4s. No em dash; Australian English.
- `typecheck-client` + `valid-layers-check` clean; any core patch minimal + logged in
  `docs/plans/03-merge-tax-ledger.md`. Screenshots → `docs/plans/23-verify/`.
- Every PR: before/after + side-by-side vs the "ISMS fan-out" region of
  `Abstract - UI Redesign.dc.html`.

## Sample project (prerequisite - iteration 1)

The fan-out only *reads* as the comp with enough documents. Create a richer, real multi-document
sample so the swarm grid has real tiles:
- `living-docs-sample-isms/` - ~12-16 short but real `.md` policy docs (Access Control Policy,
  Acceptable Use, Logging & Monitoring, Supplier Security, Cryptography, Incident Response,
  Statement of Applicability, etc.), a `Security Review - 3 Mar.txt` transcript source, an
  `agents.json`, and `.lock.json` bindings where natural. These are **real sample documents**
  (legitimate content), not fake in-UI numbers.
- Keep them short; the point is document count + genuine cross-doc dependencies so a single
  instruction touches several docs.

## Target (C4), exact

- **Command strip:** avatar + the instruction rendered in reading type + the attached source chip
  (e.g. `Security Review - 3 Mar.txt`) + a `Whole project` pill.
- **Left - decisions understood:** one card per decision the agent extracted, each showing the
  **source line** it came from (e.g. `transcript · line 42`) and `→ N documents affected`.
- **Right - sub-agent swarm:** a **4-column grid** of document tiles, one per project doc. Each
  tile is `✓ N changes` (accent tint) / a spinner + `reviewing…` / `· no change` (muted). Above
  the grid, a **progress bar** (`21 / 24 done`).
- **Bottom bar:** `N changes in M documents · X working · Y unchanged` + a primary
  **Review across the project →** that opens the cross-document review (plan 24). If plan 24 has
  not landed yet, route it to the Review rail as an interim and leave a `// TODO(plan-24)` note.

## Decisions to settle in iteration 1

- **D23-A - data source for the swarm.** Recommend: drive tiles + decisions from the live
  orchestrator run (`agentOrchestrator.ts`), falling back to aggregating the service's pending
  changes by document when a run has completed. Confirm the orchestrator exposes (or add a small
  TDD'd method for) per-document status + the extracted decisions with their source lines.
- **D23-B - entry points.** Recommend: an Agents-screen "Run across the project" action and the
  whole-project Chat scope both open this screen live; Home NEEDS-YOU "Review" jumps straight to
  plan 24. Confirm.

## Iteration plan (each iteration = one stacked PR off `main`)

1. **Sample project** (`living-docs-sample-isms/`) + settle D23-A/D23-B. Verify a real
   whole-project instruction over it produces genuine multi-doc pending changes.
2. **Screen scaffold + command strip.** Register the `project-run` screen; render the command strip
   from the real instruction + source. Reachable from Agents.
3. **Swarm grid + progress**, driven by live per-document status (changed / reviewing / no change)
   and a progress bar. Tiles update as the run proceeds.
4. **Decisions-understood column** from the real extracted decisions (source line → N docs
   affected).
5. **Bottom bar + route to review.** `N changes in M docs · X working · Y unchanged` +
   **Review across the project →** → plan-24 surface (interim: Review rail).
6. **E2E:** open `living-docs-sample-isms/`, run one whole-project instruction from the source
   transcript, watch the fan-out populate live, then click through to review. Before/after shots.

## Acceptance criteria (verified live, then design-matched)

- [ ] A whole-project instruction fans out and this screen shows it live: command strip, decisions
      understood (with source lines), and a 4-col swarm grid with per-doc status + progress bar,
      all from **real** run data. _(iters 2-4)_
- [ ] Bottom bar totals are real; **Review across the project →** lands in cross-doc review
      (or the Review rail until plan 24). _(iter 5)_
- [ ] Idle state is truthful when no run is active (no fabricated numbers). _(iter 2)_
- [ ] `living-docs-sample-isms/` exists with real multi-doc content that a single instruction can
      fan out across. _(iter 1)_
- [ ] `typecheck-client` + `valid-layers-check` clean; any core patch minimal + logged.
- [ ] Screen scores ≥ 90% vs the "ISMS fan-out" region of `Abstract - UI Redesign.dc.html`.

## Verify approach

`npm run watch`; `./scripts/code-web.sh ./living-docs-sample-isms` (:8080) + OpenRouter proxy
:8090; chrome-devtools drives the webview. The cheap test model may only touch a subset of docs
per run - use a directive whole-project instruction and, if needed, run twice to populate more
tiles; never pad with fake tiles. Design-match loop as in plan 21 (→ ≥ 90%, log to
`docs/design-audit/redesign-log.md`). Log decisions (D23-A/B) + any core patch from the current
tail of `docs/07-decision-log.md`.

---

## Kickoff: driven by the master loop prompt (`docs/plans/RUN-abstract-redesign-loop.md`).
