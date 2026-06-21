# Living Documents — Orchestration, automation & hooks (design spec)

**Date:** 2026-06-21 · **Status:** approved direction, pre-implementation · **Builds on:**
[08-living-documents-format-spec.md](08-living-documents-format-spec.md) (the dependency graph).
**Companion visual:** [orchestration-automations.html](orchestration-automations.html).
**Grounding:** Addy Osmani, *Loop Engineering*; LangChain, *The Art of Loop Engineering*.

---

## 1. Context — why this change

The format spec (08) gives Living Documents a **dependency graph** (bindings + context + claims in
the lock file) and a two-phase model: cheap staleness detection vs. expensive impact computation.
This spec answers the next question: **how do agents and skills actually run** — on a schedule, on a
heartbeat, on an event, or by hand — and how a change to one document or source **propagates** to the
others without hand-wiring documents together.

The good news from auditing the *Agentic Workbench* hi-fi: the **Agents view**, **Workflow canvas**,
**Skills panel**, and **Knowledge view** already model most of this. The work here is to make the
orchestration model *explicit and principled*, not to invent new UI.

**Intended outcome:** a trust-first orchestration model — layered triggers, one graph-propagation
rule, a per-edge safety policy, and a verification gate — buildable on existing VS Code primitives
for **$0**, and architected to survive the fork-vs-greenfield decision (Q3).

## 2. The reframe — decouple the three things

Today "an agent" bundles *when it runs* + *what it does* + *where output goes*. Separate them:

> **Triggers wake the loop · the dependency graph decides what's affected · the review rail is where output lands.**

This is the clean version of "a document update hooks other documents." There is **no doc-to-doc
wiring** (which becomes hook spaghetti). Instead, one rule (§4) plus a per-edge policy (§4.2). The
review rail (from 08) is the single destination for every result — figure, sentiment, or skill flag —
as an approve/reject diff with provenance.

## 3. The trigger taxonomy (layered — not either/or)

Each trigger type has a distinct job. ✓ = present in the hi-fi today; ＋ = recommended addition.

### Event-driven (primary — loop-engineering favours this over polling)
- **Source-change graph-hook ＋** — a source/doc saves → walk the lock-file's reverse edges → mark
  dependents dirty (cheap; no rewrite). The precise form of the "upstream hook" idea.
- **Connector webhook ✓** — CRM / sheet / API pushes (`kpi.api → Board Note.md`).
- **Folder watch ✓** — new file in a watched folder (`/quotes → pipeline.csv`).
- **Document-lifecycle hooks ＋** — on-open freshness check, **before-export verify**,
  **on-publish snapshot**. Highest-leverage additions — trust is won or lost at these moments.

### Scheduled (two genuinely different jobs)
- **Cron · specific time ✓** — the recurring cadence (`Mon 9:00` weekly refresh). The beachhead.
- **Heartbeat · every X hours ＋** — **drains the dirty-bit backlog**: impact-passes flagged-but-
  unreviewed docs and prepares candidates. It does **not** re-derive everything (that would be
  expensive and noisy). This is loop-engineering's "Automations = scheduled discovery & triage."
- **Backoff / quiet hours ＋** — batch low-priority staleness into the next heartbeat; don't nag.

### Manual (the floor — never removed)
- **Run now ✓** · **Review impact ✓** · **Re-run skill ✓**.

## 4. The propagation rule & policy model

### 4.1 One rule (the hook, done right)
> Any write to a node emits a single change event. The orchestrator walks the dependency graph's
> **reverse edges** (who depends on this) and marks each dependent **dirty**.

This is O(affected edges), needs no per-document configuration, and scales to millions of edges. It
is deliberately the *same* mechanism for a CSV cell change (value binding) and a context-doc change
(influence dependency) — only the downstream handling differs by `kind`.

### 4.2 Per-edge policy (the safety dial — surfaced on the Agents table)
What happens to a dirtied dependent is governed by policy, not hardcoded:
- **`auto · figures`** — deterministic value updates apply silently (audited).
- **`ask before apply`** — meaning/influence changes queue in the review rail (default for prose).
- **`draft only`** — an agent (esp. the heartbeat) may prepare candidates but never lands them.

`ask before apply` already exists on the Workflow canvas; this spec promotes policy to a first-class
**column on the Agents view** so it's visible per agent, not buried.

## 5. The verification gate (maker ≠ checker)

Both articles insist: the model that wrote the change must not approve its own work. **Our Skills
are the verification loop.** The Workflow canvas gains two stages around the existing agent:

```
trigger → sources(read·diff) → agent(rewrite) → VERIFY(skills as graders) → policy gate → docs → review rail
```

- **Deterministic graders first, cheap.** The **Financial agent** (figures reconcile to sources) is
  deterministic — run it before spending a model call. **Strategy** (claims vs. OKRs in the Knowledge
  decision stack) and **Formatting** (house style) may use a model.
- **A failed grader stops the run at the gate** and surfaces the flag, rather than applying.
- **Explicit stopping condition:** done = all bindings resolved **and** all graders PASS. Not
  open-ended execution.

## 6. Loop-engineering principles → where they live here

| Principle | Where it lives in this design |
|---|---|
| Maker ≠ checker | Skills panel (Strategy / Financial / Formatting grade the updater) |
| Deterministic graders first | Financial agent runs cheaply before any model call |
| External state = the spine | `.lock.json` + audit + Agents-table status (on-disk memory) |
| Human-in-the-loop | Policy `ask before apply` · Needs-approval filter · review rail |
| Event-driven over polling | webhook / folder-watch / source-change graph-hook |
| Heartbeat for discovery/triage | new **Freshness sweep** agent draining the dirty-bit queue |
| Explicit stopping conditions | policy gate (bindings resolved + graders PASS) |
| Observability → hill-climbing | History tab + audit = traces; later, agents that improve agents |
| Align to institutional memory | Knowledge view (Mission / OKRs the Strategy agent checks) |
| Isolation for parallel writes | multi-doc fan-out writes per-run (branch/worktree) at scale |

## 7. Recommended default automations (beachhead starter set)

1. **Weekly refresh** — `cron Mon 9:00` · re-derive figures, draft commentary, queue meaning-changes.
2. **Source-change watcher** — `event` · flag affected docs along the graph; no rewrite (cheap).
3. **Freshness sweep** — `heartbeat 6h` · impact-pass flagged-but-unreviewed docs as **drafts**.
4. **Before-export gate** — `lifecycle` · Financial (must PASS) + Formatting; block export if figures
   don't reconcile.
5. **On-publish snapshot** — `lifecycle` · pin the doc to current source versions for reproducibility.

## 8. Tech stack — LangChain / LangGraph, or is there enough already?

**Short answer: for the spike, there is enough already — do _not_ add LangChain/LangGraph.** For
greenfield, keep the *outer* orchestration bespoke and consider a lightweight SDK only for the
*inner* agent loop. The reasoning rests on a split:

### Separate the inner loop from the outer orchestration
- **Inner agent loop** — "call the model, let it use tools, verify, repeat until done." Generic;
  frameworkable.
- **Outer orchestration** — triggers, the dependency-graph event bus, per-edge policy, the review
  rail, the audit/lock as durable state. **Product-specific; should be our own code regardless of
  framework.** No library gives us this — it *is* the product.

### What the fork already provides (the spike: $0, no new deps)
- **Inner loop:** the Agent Host (Anthropic protocol) + `ILanguageModelsService` + **MCP** via
  `ILanguageModelToolsService` (tool-calling + external sources). Plus the heuristic fallback.
- **Triggers:** correlated **file watchers** (`IFileService.createWatcher`) for source/folder events;
  a thin scheduler for cron/heartbeat; `IRequestService` for webhooks/HTTP.
- **State & HITL:** the lock file + audit (durable state); the review rail (human-in-the-loop
  interrupts) — exactly what a framework's checkpointer/interrupt features would provide, but already
  ours and aligned to the document model.

The orchestration we need (watch → graph-walk → queue → verify → gate → review) is **simple
deterministic control flow**. A graph-execution engine is overkill for walking a dependency graph and
calling a model.

### Why be cautious about LangGraph specifically
- **State-model collision:** LangGraph's checkpoint/state store would compete with our **lock file as
  the single source of truth**. Two memories is a bug factory.
- **Runtime mismatch:** Python-first; LangGraph.js is less mature and still a heavy abstraction to
  bolt onto an Electron/TypeScript workbench.
- **Lock-in vs. payoff:** its real value (durable, *branching/cyclic* multi-agent graphs) is more than
  our linear "rewrite → verify → gate" pipeline needs today. (Note: *The Art of Loop Engineering* is
  LangChain's; its four-layer model is a useful *concept*, not a mandate to adopt the library.)

### Greenfield lean (coupled to Q3)
If/when we go greenfield web:
- Keep **outer orchestration bespoke** (triggers + graph event-bus + policy + review rail + a real
  job queue/cron + durable store).
- For the **inner agent loop**, pick a lightweight, current SDK — **Claude Agent SDK / Anthropic SDK**
  (closest to the Agent Host already proven here) or the **Vercel AI SDK** (strong streaming &
  tool-calling for a web app). **LangGraph only if** we later need durable, branching multi-agent
  graphs — and even then, reconcile its state model against the lock file first.

**Bottom line:** the engine is already here for the spike. Frameworks address the *inner* loop, which
is the part we've least worried about; they do **not** address the dependency graph, policy model, or
review rail, which are the parts that make this a product. Build those ourselves.

## 9. Scope

**In (spike):** the source-change graph-hook (reverse-edge walk → dirty bits); the Freshness-sweep
heartbeat draining the queue; the POLICY column on the Agents view; the Verify gate wiring Skills as
graders (Financial deterministic-first) before apply; the before-export and on-publish lifecycle
hooks. All on VS Code primitives — no new runtime deps.

**Deferred (named):** a production job-queue/cron service; branching multi-agent graphs; the
hill-climbing "agents that improve agents" loop; worktree isolation for large parallel fan-out;
any framework adoption — revisit at the greenfield decision (Q3).

## 10. Decision-log addendum

- **Triggers:** layered (event primary + cron + heartbeat + manual) — chosen over any single model.
  Heartbeat scoped to *draining staleness*, not re-deriving everything (cost/trust).
- **Propagation:** one reverse-edge graph-walk + per-edge policy — chosen over doc-to-doc hooks
  (which don't scale and tangle).
- **Verification:** Skills-as-graders gate before apply, deterministic graders first — chosen to
  honour maker≠checker and keep model cost down.
- **Tech stack:** no LangChain/LangGraph for the spike; reuse VS Code Agent Host / LM service / MCP /
  watchers. Greenfield keeps orchestration bespoke; inner-loop SDK (Claude Agent SDK or Vercel AI SDK)
  chosen over LangGraph unless branching multi-agent durability is later required. **Coupled to Q3**
  ([05-open-questions.md](05-open-questions.md)).

## 11. This will recur

Like the format choice (08 §9), the orchestration tech-stack call is downstream of **fork vs
greenfield (Q3)**. The model in this spec — triggers / graph / policy / verify / rail — is framework-
and runtime-agnostic on purpose: it is the same whether the inner loop runs on the VS Code Agent Host,
the Claude Agent SDK, or the Vercel AI SDK. That is the property that lets us defer the framework
decision without blocking the build.
