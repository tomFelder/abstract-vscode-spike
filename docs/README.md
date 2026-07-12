# Abstract — spike → beta documentation

This `docs/` folder captures **everything** about the VS Code fork behind **Abstract** (working
titles during the spike: "Opportunity OS" / "Living Documents"): what it is, what we built, what
we learned, what is likely to become problematic, the decisions, and the design intent.

> **The code is the validation vehicle; this documentation is the thing worth keeping.** The fork
> is the beta (doc 14 §6 chapter 1, upstream syncs frozen per decision 159); a validated beta
> triggers a cloud-first greenfield rebuild that inherits the *learnings* — journey grammar,
> review/provenance mechanics, funnel numbers — not the code. Docs carry dates and statuses;
> trust the decision log ([07](07-decision-log.md)) and the newest doc on any conflict.

## Read in this order

| Doc | What it covers |
|---|---|
| [00-overview.md](00-overview.md) | The product idea, the defensible wedge, why VS Code, what the spike was for |
| [01-architecture.md](01-architecture.md) | How the code is structured, the core loop, the reuse map, file formats |
| [02-what-we-built.md](02-what-we-built.md) | Items 0-5 in detail: what each did, status, how verified |
| [03-learnings.md](03-learnings.md) | What worked, what didn't, surprises — engine vs shell |
| [04-risks-and-predictions.md](04-risks-and-predictions.md) | What will get painful: technical debt, scaling, the strategic risk |
| [05-open-questions.md](05-open-questions.md) | Unresolved decisions: file format, editor maturity, **fork vs greenfield** |
| [06-design-notes.md](06-design-notes.md) | UI/UX intent vs reality: provenance gutter redesign, header issues, the calm shell |
| [07-decision-log.md](07-decision-log.md) | **The running ADR log, decisions 1-160** — from spike calls through the beta-planning decisions (155-160: interop floor, `.abstract/`, raise gate, WTP, sync freeze). The tie-breaker on any doc conflict |
| [08-living-documents-format-spec.md](08-living-documents-format-spec.md) | The raw-Markdown format + dependency model design spec (clean file + lock file); resolves Q1, with full decision log. Companion visual: [option-10-living-docs-format.html](option-10-living-docs-format.html) |
| [09-orchestration-and-automation.md](09-orchestration-and-automation.md) | How agents/skills run: trigger taxonomy, the graph-propagation rule, policy model, verify gate, and the LangChain/LangGraph-vs-built-in tech-stack call. Companion visual: [orchestration-automations.html](orchestration-automations.html) |
| [10-model-integration.md](10-model-integration.md) | How the agentic features became model-backed: the localhost Anthropic OAuth proxy (credential server-side, no CSP changes), the service wiring, request shape, config, the no-model fallback, and the OpenRouter dev test backend. Live captures: [model-verify/](model-verify/) |
| [11-upstream-sync.md](11-upstream-sync.md) | Tracking upstream `microsoft/vscode`: the current gap, the assess-then-merge approach, and a repeatable per-release procedure. First job: 1.126.0 -> 1.127.0. Companion: [plans/03-merge-tax-ledger.md](plans/03-merge-tax-ledger.md) |
| [11-product-review-2026-07.md](11-product-review-2026-07.md) | The July 2026 full review: sweep of all 85 PRs/branches since the fork, honest surface-by-surface state, ranked findings (P0-P3) across usability/UI/performance/technical debt, and the suggested execution order for plans 26-33 |
| [12-north-star-and-future-features.md](12-north-star-and-future-features.md) | The north-star write-up of the AI-native word processor (narrative + binding principles) and the future-feature roadmap beyond plans 26-33: trust deepening, liveness, collaboration, platform |
| [13-journey-map-ratification.md](13-journey-map-ratification.md) | Journey Map v4 ratified into the repo: decisions D1-D26, open tests T1-T5, candidate dispositions, flagged conflicts (publish static, Project Home IA, org library, portfolios), and the chip re-baselining rule. Companion visual: [journey-map-v4.dc.html](journey-map-v4.dc.html) |
| [14-product-strategy.md](14-product-strategy.md) | The product spine: the ITE category vs the trust wedge, the AI-posture target market and persona archetypes, the four killer flows, positioning, the Cursor-style business model, and the local → cloud → floor arc (retires Q3 for v1) |
| [15-metrics-and-instrumentation.md](15-metrics-and-instrumentation.md) | The north star (approved agent proposals per user per week), the metric tree (activation T4 / habit / retention / guardrails incl. the 5-25% tweak+reject band), and the PostHog instrumentation plan with event dictionary and dashboards |
| [16-principles.md](16-principles.md) | The binding principles in one place: product P0-P10 (ratified), design principles, and engineering principles incl. the new journey-completeness-over-feature-count rule |
| [17-primitives.md](17-primitives.md) | The agentic ontology: skill / agent / source / template (agent = skill + trigger + scope + policy), the user-facing vocabulary decision, the thinking-skills layer, and the org-library slot |
| [18-beta-plan.md](18-beta-plan.md) | The beta gate ("a stranger hits the aha unaided"): OpenAI-OAuth BYO-subscription + OpenRouter fallback (Anthropic usage stripped), PostHog, journey robustness, D26 onboarding + survey, the feedback verb, and the sequencing to the first stranger |
| [19-website-feedback.md](19-website-feedback.md) | abstractdocs.com reviewed against the ratified strategy: what to keep, the missing ITE story, pricing/publish/model-access corrections, and priority order |
| [20-journey-specs-aha-path.md](20-journey-specs-aha-path.md) | The buildable specs for the aha-path journeys (groups A + B, 1p, D26 onboarding) with per-journey states, off-path fixes, merge semantics and acceptance criteria |
| [21-beta-v1-prioritization.md](21-beta-v1-prioritization.md) | The beta v1.0 priority order (12 Jul 2026): the journeys and aha moments the gate needs, P0-P3 tiers, the revised migration stance, real-user failure predictions, and the GitHub issue map |
| [22-file-interop-and-project-layout.md](22-file-interop-and-project-layout.md) | The real-folder interop spec: docx→md import, docx/PDF export, xlsx-to-CSV sources (CSV not a database), PDF as read-only context, and the data/-archive/-working-files/ conventions + Tidy verb |
| [23-validation-thesis-and-value-hypotheses.md](23-validation-thesis-and-value-hypotheses.md) | The validation thesis: founder context (Cursor dogfooding, validate→raise→greenfield-cloud), first-principles adoption laws for the tech-savvy non-technical user, falsifiable value-prop hypotheses VP1-VP7 with kill signals, and the ten founder questions — resolved same-day in §6 (decisions 156-160) |
| [24-beta-success-memo.md](24-beta-success-memo.md) | **The raise gate.** Pre-registered beta success criteria: the three questions (activation / habit / pay+grow), the funnel targets and kill thresholds, growth mechanics at cohort size, the WTP sequence (included tier → BYO OAuth → charged metered APIs mid-beta), and the deck-claim-to-evidence table. A living scoreboard, updated weekly |
| [lwd-pm-bundle-build.md](lwd-pm-bundle-build.md) | How to rebuild the vendored ProseMirror editor bundle (`prosemirrorBundle.ts`): the offline esbuild recipe + the full `lwdpm-entry.js` (incl. the `bound_figure` atom node, decision 46) and `build.mjs` sources, so the bundle is always reproducible |
| [plans/](plans/) | The handoff prompts that drove (and will drive) the work. UI Redesign set (`20`-`25`) **done**; product-completion set (`26`-`33`) **merged to `main`**; the **live set is the beta gate, plans `34`-`38`** (34 done, 35 mostly done — #120 open, 36-38 pending), sequenced by [18-beta-plan.md](18-beta-plan.md). |

## Status at a glance (2026-07-12)

- **Built (spike → beta shell), all on `main`:** items 0-5; the Studio de-IDE pass; the
  design-match build-out; the clean-file + lock format and dependency graph; the orchestration
  layer (triggers, graph event-bus, policy, verify gate); model-backed agentic features via the
  localhost proxy; the full Abstract UI redesign (plans 20-25); and the product-completion set
  (**plans 26-33 merged**: history/undo + snapshots, streaming chat, templates on-ramp,
  knowledge/MCP sources, performance baseline, review-loop quality, orchestration completion,
  shell integrity) — motivated by [11-product-review-2026-07.md](11-product-review-2026-07.md).
- **Beta gate — in progress (plans 34-38, sequenced by [18-beta-plan.md](18-beta-plan.md)):**
  - **Plan 34 (journey walk) — done:** all 26 journeys graded — 7 WALKABLE · 8 FRAGILE ·
    2 PARTIAL · 9 MISSING; one severity-1 (X1: approved work lost on reload, web build). Output:
    [plans/34-verify/journey-grades.md](plans/34-verify/journey-grades.md) and the aha-path specs
    [20-journey-specs-aha-path.md](20-journey-specs-aha-path.md).
  - **Plan 35 (model access) — mostly done:** Anthropic usage stripped, Sign in with ChatGPT +
    capped OpenRouter fallback wired; **open: issue #120** (subscription model call fails after
    sign-in).
  - **Plans 36 (analytics), 37 (journey robustness), 38 (onboarding) — pending.**
- **Beta planning (12 Jul 2026):** priority order + issue map #120-#133
  ([21](21-beta-v1-prioritization.md)); interop + folder conventions
  ([22](22-file-interop-and-project-layout.md)); validation thesis VP1-VP7
  ([23](23-validation-thesis-and-value-hypotheses.md)); and the raise gate
  ([24-beta-success-memo.md](24-beta-success-memo.md)). Decision log current through **160**.
- **Decided:** document format (Q1 → Option 10, [08](08-living-documents-format-spec.md));
  editor substrate (vendored ProseMirror, [06](06-design-notes.md) D7); **fork vs greenfield
  (Q3) — the fork is the beta vehicle**, greenfield/cloud is the post-raise chapter
  ([14](14-product-strategy.md) §6; upstream syncs frozen, decision 159).
- **Still open:** editor depth (Q2) — the **T1 paste-from-Word audit** is the pre-beta
  disqualifier check ([21](21-beta-v1-prioritization.md) §4 item 8, issue #128).

Working evidence directories not indexed above: [design-audit/](design-audit/),
[incidents/](incidents/), [screenshots/](screenshots/), [sync-1127-verify/](sync-1127-verify/),
[v6-verify/](v6-verify/), and the per-plan `plans/NN-verify/` folders.
