# Abstract — spike → beta documentation

This `docs/` folder captures **everything** about the VS Code fork behind **Abstract** (working
titles during the spike: "Opportunity OS" / "Living Documents"): what it is, what we built, what
we learned, what is likely to become problematic, the decisions, and the design intent.

> **The code is the validation vehicle; this documentation is the thing worth keeping.** The fork
> is the beta (doc 14 §6 chapter 1, upstream syncs frozen per decision 159); a validated beta
> triggers a cloud-first greenfield rebuild that inherits the *learnings* — journey grammar,
> review/provenance mechanics, funnel numbers — not the code. Docs carry dates and statuses;
> trust the decision log ([07](07-decision-log.md)) and the newest doc on any conflict.

The corpus is layered by **job**, not by number (decision 161). Files never move — numbering is
the convention and links are provenance — the layers below are the read-order.

## Layer 1 — The canon (what the team builds from; read in this order)

| Doc | What it covers |
|---|---|
| [25-why-abstract.md](25-why-abstract.md) | **Start here.** The why in one page: the problem in the user's words, the faces (incl. the services operator — quotes/SOPs/project docs), why now, why the trust wedge, why us, what winning looks like |
| [14-product-strategy.md](14-product-strategy.md) | The product spine: the ITE category vs the trust wedge, the AI-posture target market and persona archetypes, the four killer flows, positioning, the Cursor-style business model, and the local → cloud → floor arc (retires Q3 for v1) |
| [16-principles.md](16-principles.md) | The binding principles in one place: product P0-P10 (ratified), design principles, and engineering principles incl. the journey-completeness-over-feature-count rule |
| [17-primitives.md](17-primitives.md) | The agentic ontology: skill / agent / source / template (agent = skill + trigger + scope + policy), the user-facing vocabulary decision, the thinking-skills layer, and the org-library slot |
| [08-living-documents-format-spec.md](08-living-documents-format-spec.md) | The ratified + implemented format — clean `<doc>.md` + generated `<doc>.lock.json` (Option 10), bind-links, the dependency graph — with the full 10-option decision trail. Companion visual: [option-10-living-docs-format.html](option-10-living-docs-format.html) |
| [20-journey-specs-aha-path.md](20-journey-specs-aha-path.md) | The buildable specs for the aha-path journeys (groups A + B, 1p, D26 onboarding) with per-journey states, off-path fixes, merge semantics and acceptance criteria |
| [18-beta-plan.md](18-beta-plan.md) | The beta gate ("a stranger hits the aha unaided"): model access, analytics, journey robustness, onboarding + survey, the feedback verb — with 12 Jul status notes (migration stance revised; plan 34 done, 35 on #120) |
| [21-beta-v1-prioritization.md](21-beta-v1-prioritization.md) | **The build order of record** (12 Jul 2026): the journeys and aha moments the gate needs, P0-P3 tiers, the revised migration stance, real-user failure predictions, and the GitHub issue map (#120-#133) |
| [22-file-interop-and-project-layout.md](22-file-interop-and-project-layout.md) | The real-folder interop spec: docx→md import, docx/PDF export, xlsx-to-CSV sources (CSV not a database), PDF as read-only context, the data/-archive/-working-files/ conventions + Tidy verb, and the hidden `.abstract/` app home |
| [23-validation-thesis-and-value-hypotheses.md](23-validation-thesis-and-value-hypotheses.md) | The validation thesis: founder context, first-principles adoption laws, falsifiable value-prop hypotheses VP1-VP7 with kill signals, the doc-set test (§4b), the services face (§2), and the ten founder questions — resolved in §6 (decisions 156-160) |
| [24-beta-success-memo.md](24-beta-success-memo.md) | **The raise gate.** Pre-registered beta success criteria: the three questions (activation / habit / pay+grow), funnel targets and kill thresholds, growth mechanics, the WTP sequence, and the deck-claim-to-evidence table. A living scoreboard, updated weekly |
| [26-glossary-and-id-index.md](26-glossary-and-id-index.md) | **Keep open while reading anything else.** The vocabulary and every ID system (journeys, F-fixes, map-D vs decisions, VPs, T-tests, principle-P vs priority-P), each mapped to its home doc |
| [27-data-flow-one-pager.md](27-data-flow-one-pager.md) | **The trust story in plain words** (issue #135; the sole decision-163 moratorium exemption): what leaves your machine, when, and to whom - the chat/run paths, the default-on scheduled agents (and how to pause them), the two model doors, what the localhost helper keeps, that no analytics ships yet, and what is never sent. Surfaced in-product on the Model access screen. Every claim traced to a live code path |

*Named gap (decision 161): a fork-independent product spec for the greenfield team — to be
written once the T1 audit and beta evidence land.*

## Layer 2 — The ledger (running records; append, don't rewrite)

| Doc | What it covers |
|---|---|
| [07-decision-log.md](07-decision-log.md) | **The running ADR log, decisions 1-174** — from spike calls through the beta-planning and Editor-v2 wave decisions. The tie-breaker on any doc conflict |
| [13-journey-map-ratification.md](13-journey-map-ratification.md) | Journey Map v4 ratified into repo truth: decisions map-D1-D26, tests T1-T5, flagged conflicts, the chip re-baselining rule. Companion visual: [journey-map-v4.dc.html](journey-map-v4.dc.html). The walk it mandates is done — grades in [plans/34-verify/journey-grades.md](plans/34-verify/journey-grades.md) |
| [15-metrics-and-instrumentation.md](15-metrics-and-instrumentation.md) | The north star (approved agent proposals per user per week), the metric tree (activation T4 / habit / retention / guardrails), and the PostHog instrumentation plan with event dictionary and dashboards (wired in plan 36) |
| [12-north-star-and-future-features.md](12-north-star-and-future-features.md) | The north-star narrative and the post-plan-33 future-feature roadmap (trust deepening, liveness, collaboration, platform) — the vision every plan is checkable against |
| [19-website-feedback.md](19-website-feedback.md) | abstractdocs.com reviewed against the ratified strategy: the missing ITE story, pricing/publish/model-access corrections — the copy fixes are still open action items |
| [research/](research/) | **The user-evidence container** (pseudonymised, consent-first): session notes per the [template](research/session-note.template.md), interviews, survey exports, weekly digests that update the doc-24 scoreboard |
| [plans/](plans/) | The handoff prompts that drove (and will drive) the work, kept verbatim. UI Redesign set (`20`-`25`) **done**; product-completion set (`26`-`33`) **merged**; beta-gate set `34`-`38` (34 done, 35 mostly done — #120 open, 36-38 pending); QA wave of 16 Jul (issues #168-#182) **merged**; the light-path set **[42-light-path-loop.md](plans/42-light-path-loop.md)** (editor-first cold start; slices L1-L5) **merged** (PRs #202, #205, #206, #208, #209; run tracker #196); the Abstract Editor v2 wave (`43`-`49`) **merged** (23 Jul) — spec of record [43-editor-v2-spec.md](plans/43-editor-v2-spec.md), pixel source [design/abstract-editor-v2/](design/abstract-editor-v2/), master run prompt [RUN-editor-v2-loop.md](plans/RUN-editor-v2-loop.md), decisions 167-174; the audit fix wave [50-audit-fix-wave.md](plans/50-audit-fix-wave.md) (issues #252-#262, umbrella #263, run prompt [RUN-audit-fix-loop.md](plans/RUN-audit-fix-loop.md)) **merged** (28 Jul + the #275-#280 defect round), grounded in the 24 Jul full-journey audit [qa/2026-07-24-ux-audit/00-report.md](qa/2026-07-24-ux-audit/00-report.md); **Next: the use-it-daily round, plans [51](plans/51-model-access-device-auth-loop.md)-[54](plans/54-structural-extras-loop.md)** (authored 3 Aug from the founder scratchpad triage, decisions 176-181; run order 51 → 52 → 53 → 54, each plan carrying its own RUN prompt) |
| [design/abstract-editor-v2/](design/abstract-editor-v2/) | The committed Editor v2 design mock (pins + handoff ledger) and Obsidian reference screenshots — the pixel spec of record for plans 43-49 (docs win over pixels, decision 167) |
| [lwd-pm-bundle-build.md](lwd-pm-bundle-build.md) | Engineering recipe: how to rebuild the vendored ProseMirror bundle (`prosemirrorBundle.ts`) offline, so it is always reproducible |

## Layer 3 — The archive (history and superseded records; each carries a dated banner)

| Doc | What it covers |
|---|---|
| [00-overview.md](00-overview.md) | The origin record: the product idea, the wedge, why VS Code, what the spike was for (under the former name; the arc it poses is since resolved) |
| [01-architecture.md](01-architecture.md) | How the items-0-5 slice was structured — the format and render layers described are since superseded (→ 08, ProseMirror) |
| [02-what-we-built.md](02-what-we-built.md) | The items 0-5 build record in detail |
| [03-learnings.md](03-learnings.md) | Spike learnings: engine mapped cleanly, the shell is where the fork fights back — several flagged gaps since closed |
| [04-risks-and-predictions.md](04-risks-and-predictions.md) | The spike's risk ledger, now partially scored (banner note): format trap resolved, merge tax paused, persistence narrowed to X1 |
| [05-open-questions.md](05-open-questions.md) | The three coupled questions Q1/Q2/Q3 with their resolution banners — kept as the reasoning trail |
| [06-design-notes.md](06-design-notes.md) | The running design-intent log D1-D8 (self-superseding, current through plan 16; visual spec of record is now [plans/20-abstract-ui-redesign-handoff.md](plans/20-abstract-ui-redesign-handoff.md)) |
| [09-orchestration-and-automation.md](09-orchestration-and-automation.md) | The orchestration design spec (triggers, graph, policy, verify gate) — implemented in plans 07 + 32. Companion visual: [orchestration-automations.html](orchestration-automations.html) |
| [10-model-integration.md](10-model-integration.md) | Record of the retired Anthropic-OAuth-proxy phase — superseded for beta by plan 35 / doc 18 §2.1 (banner inline). Live captures: [model-verify/](model-verify/) |
| [11-product-review-2026-07.md](11-product-review-2026-07.md) | The July-2026 pre-plan review that ranked the gaps and spawned plans 26-33 — a snapshot from before those merges (banner inline) |
| [11-upstream-sync.md](11-upstream-sync.md) | The assess-then-merge upstream procedure and the 1.127.0 bump record — paused per decision 159 (banner inline) |

Working evidence directories: [qa/](qa/), [design-audit/](design-audit/), [incidents/](incidents/),
[screenshots/](screenshots/), [sync-1127-verify/](sync-1127-verify/), [v6-verify/](v6-verify/),
and the per-plan `plans/NN-verify/` folders.

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
  ([23](23-validation-thesis-and-value-hypotheses.md)); the raise gate
  ([24-beta-success-memo.md](24-beta-success-memo.md)); the why one-pager
  ([25](25-why-abstract.md)) and glossary ([26](26-glossary-and-id-index.md)). Decision log
  current through **161**.
- **Decided:** document format (Q1 → Option 10, [08](08-living-documents-format-spec.md));
  editor substrate (vendored ProseMirror, [06](06-design-notes.md) D7); **fork vs greenfield
  (Q3) — the fork is the beta vehicle**, greenfield/cloud is the post-raise chapter
  ([14](14-product-strategy.md) §6; upstream syncs frozen, decision 159).
- **Still open:** editor depth (Q2) — the **T1 paste-from-Word audit** is the pre-beta
  disqualifier check ([21](21-beta-v1-prioritization.md) §4 item 8, issue #128).
