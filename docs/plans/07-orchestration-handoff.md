# Living Documents — orchestration & automation handoff (clean session)

You are continuing the **Opportunity OS / Living Documents** spike. The engine is proven (PR #1, merged), the
shell reads as a calm document app (Studio de-IDE, PR #2, merged), the locked comp's surfaces are built
(design-match round), and **the clean-file + lock-file format + dependency graph are now implemented**
([plan 06](06-format-implementation-handoff.md) — that must be merged before you start). **This phase has ONE
job: build the orchestration layer that runs agents and skills — triggers, the cross-document graph event-bus,
per-edge policy, and the verify gate — on top of the format/graph from plan 06.** This is what turns a pile of
bound documents into a system that keeps itself current.

> **Hard dependency:** this phase needs the lock-file dependency graph, bind-link resolution, the
> single-document dirty-bit, and the "Review impact" pass from **plan 06**. Do not start until 06 is merged.

## Read first (the decisions are made — do not re-litigate them)
- **`docs/09-orchestration-and-automation.md`** — the approved spec. Your contract. It settles the trigger
  taxonomy (event / cron / heartbeat / manual), the single graph-propagation rule (write → reverse-edge walk →
  dirty bits) with **per-edge policy**, the **verify gate** (Skills as graders, maker≠checker), the
  loop-engineering principle mapping, the default automation set, and **§8 the tech-stack call**. **§7 is the
  default automation set you wire; §8 is binding on dependencies; §9 is your scope.** Build exactly that.
- **`docs/orchestration-automations.html`** — the companion visual. Open it for the target Agents view (with the
  POLICY column + the Freshness-sweep row) and the Workflow canvas as a loop (trigger node → sources → agent →
  **verify** → policy gate → docs → review rail).
- `docs/08-living-documents-format-spec.md` + `docs/plans/06-…` — the format + graph you are building on. The
  lock file is the dependency graph and the **single source of truth + external state** (loop-engineering's
  "spine"); the review rail is your human-in-the-loop surface. Reuse both; invent neither.
- `docs/05-open-questions.md` — Q3 (fork-vs-greenfield) is still open; the orchestration model in spec 09 is
  deliberately framework- and runtime-agnostic so it survives either. Keep it that way.
- `docs/plans/03-merge-tax-ledger.md` — the discipline: **0 added core patches.** All of this is our own
  contribution + service code; add zero, and update the ledger if you must.
- Memories: `abstract-vscode-spike-build` (Node 24, web-build verify, DesignSync), `opportunity-os-living-docs`,
  `living-docs-fullapp-decisions`.

## Tech stack — binding (spec 09 §8)
**Do NOT add LangChain / LangGraph or any agent framework.** Reuse what the fork already ships: the Agent Host +
`ILanguageModelsService` (+ heuristic fallback) for the inner loop, **MCP** (`ILanguageModelToolsService`) for
tools/sources, correlated **file watchers** (`fileService.createWatcher`) for events, and `IRequestService` for
webhooks/HTTP. The scheduler is a **thin, injectable clock** (so cron/heartbeat are testable with a fake clock),
NOT a framework. The orchestration logic (graph event-bus, policy, verify gate, review rail) is our own
product code — no library provides it. Rationale + the greenfield lean are in spec 09 §8/§10.

## Repo / branch / build
- Repo: `/Users/tommy/Sites/abstract-vscode-spike`. **Branch `living-docs-orchestration` off `living-docs-format`**
  (or off `main` once plan 06's PR has merged).
- Node 24 REQUIRED: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.15.0`
- `npm run watch` (own long-lived background process; never with a trailing `&` inside another background job).
  `npm run typecheck-client` to type-check `src/`.
- Tests: `./scripts/test.sh --grep "LivingDocsService"` — **runs against `out/`; wait for the watch to recompile**
  the changed `.js` first.
- Visual verify: `./scripts/code-web.sh ./living-docs-sample` → http://localhost:8080; drive + screenshot with
  chrome-devtools MCP (open the base URL; `?folder=` does NOT work). `take_screenshot` `filePath` must be inside
  a workspace root (e.g. `/Users/tommy/Sites/.lwd-shots/…`), NOT `/tmp`. GOTCHAs: server caches `product.json` at
  startup; the web build caches the builtin-extension scan + theme in **IndexedDB**.
- Conventions (husky precommit blocks commits): **tabs only** (even inside template literals); **no non-ASCII** in
  source (HTML entities/ASCII); **no `in` operator** (`Object.prototype.hasOwnProperty.call`); **no
  `querySelector`/`querySelectorAll`** (walk `parentElement` + `hasAttribute`, or dom `h()`); **double-quoted
  strings reserved for nls-externalized strings** (single quotes/backticks otherwise); DI ctor non-service args
  BEFORE `@IService` args; declare service deps in the constructor. One commit per item; type-check + tests green
  each time. End commit messages with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- PRs **must include screenshots** (drive the web build, capture before/after, embed in the PR body).

## What you are building on / wiring (current code)
- `browser/livingDocsService.ts` — the brain. After plan 06 it holds the lock graph, bind-link resolution, the
  single-doc dirty-bit, and the Review-impact pass. **It has no scheduling/trigger/watcher code yet — that is
  this phase.** Add the agent registry, the graph event-bus, the trigger layer, the policy router, and the
  verify gate here (or in a focused `agentOrchestrator.ts` it owns — keep the service from ballooning).
- `browser/reviewRailView.ts` — the review rail (`getAllPending`/`approve`/`reject`/audit). **Route every
  orchestration result through it.** Do not invent new review UX.
- `browser/screenRender.ts` — the **Agents view + Workflow canvas are currently static mock HTML**
  (`renderAgentList` / `renderAgentCanvas`; `IScreenState` only tracks which screen is open + canvas open/run).
  Going "live" = driving these from the agent registry. The Knowledge screen here is the decision stack the
  Strategy grader reads against.
- The **Skills panel** (right-panel tab from the design-match round — grep `Skills`) holds the Strategy /
  Financial / Formatting "document agents". This phase makes them the **graders** in the verify gate, not just
  on-demand buttons.
- `common/livingDocsModel.ts` / `common/livingDocs.ts` — add the orchestration types (agent def, trigger, policy,
  run record) and any new service methods.

## Work items — in order, one commit each, verify against spec 09.

**ITEM 1 — Agent registry + the graph event-bus (the propagation rule, spec §4.1).**
Model an agent as `{ id, name, trigger, flow (source→doc edges), policy, lastRun, status }`, persisted as
external state (a workspace `agents.json` behind the same read/write seam as the lock — production platform-stores
it). Generalize plan 06's single-document dirty-bit into a **cross-document reverse-edge walk**: any write to a
node emits ONE change event; the orchestrator walks the lock graph's reverse edges and marks every dependent
dirty — same mechanism for value bindings and influence `context`, only the downstream `kind` differs.
Acceptance: editing one source dirties **every** document whose lock binds/contexts it, workspace-wide, from a
single emitted event (test with two docs sharing a source).

**ITEM 2 — The trigger layer (event + scheduled + manual, spec §3).**
Wire the trigger types onto agents: **source-change / folder watch** via `fileService.createWatcher` (correlated);
**webhook/HTTP** via `IRequestService`; **cron + heartbeat** via a thin **injectable clock** (default real,
fake in tests). The **Freshness sweep** heartbeat (spec §7) **drains the dirty-bit queue** — impact-passes
flagged-but-unreviewed docs — and does **NOT** re-derive everything. Manual **Run now** stays the floor.
Acceptance: a `cron` agent fires at its scheduled time (fake clock); editing a watched source fires its
source-change agent; the heartbeat processes only dirty docs and is a no-op when the queue is empty.

**ITEM 3 — Per-edge policy model (the safety dial, spec §4.2).**
A policy enum on each agent/edge: `auto·figures` / `ask·before·apply` / `draft·only`. The propagation handler
routes a dirtied dependent by policy: figures auto-apply (audited in the lock), meaning/influence queue in the
rail, `draft·only` (the heartbeat) prepares candidates but **never lands them**.
Acceptance: an `auto·figures` edge applies a figure silently + audited; an `ask` edge queues a pending change;
a `draft·only` run leaves the doc untouched with a draft waiting in the rail.

**ITEM 4 — The verify gate: Skills as graders (maker≠checker, spec §5).**
Between agent-rewrite and apply, run the document's enabled Skills as **graders**. **Financial is deterministic**
(figures reconcile to lock/source) — run it first and cheap; Strategy (claims vs the Knowledge decision stack)
and Formatting (house style) may use the model/heuristic. A **failed grader stops the run at the policy gate**
and surfaces the flag instead of applying. Explicit stop-condition: done = all bindings resolved AND all graders
PASS. Wire the existing Skills panel agents to this gate.
Acceptance: a run whose figures don't reconcile is **blocked** at the gate with a Financial flag (nothing
applied); a clean run passes and lands via the rail.

**ITEM 5 — Document-lifecycle hooks (spec §3, §7).**
Three hooks: **before-export verify gate** (Financial must PASS + Formatting; block export on fail — extend the
existing Export action); **on-publish snapshot** (write a `pins[]` entry = current source versions/hashes, using
the schema field reserved in plan 06, so a published doc stays reproducible); **on-open freshness** (run staleness
on open so the Context panel's ⚠ is current).
Acceptance: export is blocked when figures don't reconcile (with the Financial flag shown); publishing writes a
pin; opening a doc whose source changed shows ⚠ without a manual refresh.

**ITEM 6 — Make the Agents view + Workflow canvas live (spec §3-§5 on the real UI).**
Convert `renderAgentList` / `renderAgentCanvas` in `screenRender.ts` from hardcoded HTML to data from the agent
registry: real triggers, the new **POLICY column**, real status / last-run; the filter chips
(All / Scheduled / Event / Needs-approval) operate on real data. The canvas renders the real flow as the loop:
**trigger node → sources → agent → verify stage → policy gate → documents → review rail**, reflecting live run
state. **Run now** executes the agent end-to-end.
Acceptance: the Agents table reflects actually-registered agents with live status; opening one shows its real
flow including the verify stage; **Run now** drives a real run whose results land in the review rail.

**ITEM 7 — Tests + verification (spec §9 acceptance).**
Extend `test/browser/livingDocsService.test.ts` (or a focused orchestrator test): graph reverse-edge propagation
(shared-source fan-out); fake-clock cron + heartbeat queue-drain (incl. empty-queue no-op); policy routing
(auto / ask / draft); verify-gate block-on-fail + pass; lifecycle hooks (export block, pin write, on-open ⚠).
Snapshot-style assertions where possible. Then the web-build pass with chrome-devtools screenshots for the PR
(live Agents table, canvas with the verify stage, a heartbeat-drained review queue).

## Trust guardrails to honor throughout (spec §5-§6 — these are the product)
No eager rewrites (flag or draft, never auto-land prose); deterministic graders first; `ask·before·apply` is the
default for meaning/influence; the heartbeat is **draft-only**; the verify gate **stops on grader failure**;
on-publish snapshots keep published docs reproducible; every result carries provenance into the rail + an audit
entry in the lock.

## Deferred — named, NOT built this phase (spec §9)
A production job-queue / cron service (the injectable clock is enough for the spike); branching/cyclic
multi-agent graphs; the hill-climbing "agents that improve agents" loop; worktree isolation for large parallel
fan-out; ANY framework adoption (LangGraph et al.) — all revisit at the greenfield decision (Q3).

## After all items
Summarize; run the full verify (type-check + tests + a chrome-devtools screenshot pass per spec §9); update the
merge-tax ledger (expect **0 added core patches**); update the memories; open a PR **with screenshots**. With the
format (06) + orchestration (07) in place, the spike has a real format, dependency graph, and self-updating
engine — the remaining backlog (connect-a-source UI + a real connector, persistence hardening, the agentic
ecosystem) in `docs/plans/05-next-phase-handoff.md` now all builds on solid ground.
