# 26 - Glossary and ID index

The corpus runs on several ID systems and a private vocabulary. This page maps every term and ID
to its home doc so nobody has to hold them in their head. Update it when a new ID system is born.

> **Banner (1 Sep 2026):** vocabulary authority now lives in the root [`CONTEXT.md`](../CONTEXT.md), the canonical glossary, seeded from the table below plus the doc-30 editing vocabulary. This doc remains the home of the ID systems and the per-term home-doc links; on any wording conflict, `CONTEXT.md` wins.

## Vocabulary

| Term | Meaning | Home |
|---|---|---|
| **Living document** | A `.md` whose figures/claims are bound to sources and kept current by agents under review | [00](00-overview.md), [08](08-living-documents-format-spec.md) |
| **Lock (`.lock.json`)** | The generated sidecar beside each doc: bindings, provenance, audit, snapshots. Rebuildable, travels with the file | [08](08-living-documents-format-spec.md) |
| **Binding / bind-link** | `[18%](bind:metrics.mrr.delta)` - a value in prose anchored to a source cell | [08](08-living-documents-format-spec.md) §3 |
| **Source** | `file` (CSV) / `api` / `mcp` - where bound values come from; listed in Knowledge | [08](08-living-documents-format-spec.md), plan 29 |
| **Change** | The unit of review, authored by an agent or a human: red/green diff in place + card (kind, confidence label, rationale). Approve = the commit | [20](20-journey-specs-aha-path.md) §1e/§1f |
| **Review grammar** | The one path every change takes: propose → diff → approve/tweak/reject → receipt. Humans and agents alike | [16](16-principles.md) P3 |
| **Figure vs meaning** | The central mechanic: low-risk figure changes may auto-apply (dialled); meaning changes always wait | [20](20-journey-specs-aha-path.md) §1g |
| **Provenance peek** | Hover/click a bound figure → source, exact row, freshness, "then vs now". The wedge in one gesture | [20](20-journey-specs-aha-path.md) §1p |
| **Fan-out** | One instruction across many docs → sub-agent swarm → cross-document review | journeys 1j/1k |
| **The aha (T4)** | First **approved agent change on the user's own file** | [18](18-beta-plan.md) §1 |
| **All-clear** | The morning inbox driven to zero - the habit moment | [14](14-product-strategy.md) §3, journey 1w/1r |
| **Skill / agent / source / template** | The four primitives; agent = skill + trigger + scope + policy | [17](17-primitives.md) |
| **Thinking-skills pack** | Default skills (interview-me, stress-test…) seeded into new projects; the ITE story in v1 | [17](17-primitives.md) §3, [14](14-product-strategy.md) §1 |
| **ITE** | Integrated Thinking Environment - the category (mission); the trust wedge is the v1 spearhead | [14](14-product-strategy.md) §1 |
| **The wedge** | Provenance + diff + approval on recurring data-fed documents | [25](25-why-abstract.md) |
| **`.abstract/`** | Hidden in-project app home: skills, knowledge metadata, run log, config, indexes | [22](22-file-interop-and-project-layout.md) §5, decision 156 |
| **`~/.abstract/`** | The localhost model helper's own home in your **home** dir (not the project): sign-in bundle, API secrets, spend/events logs - owner-only, never document text | [27](27-data-flow-one-pager.md), D29-C |
| **Data-flow one-pager** | Plain-words "what leaves my machine?" - the two model doors, the localhost helper's storage, never-sent list; surfaced on Model access | [27](27-data-flow-one-pager.md) |
| **Tidy verb** | "Tidy this project" - agent *proposes* file moves through review; atomic on locks | [22](22-file-interop-and-project-layout.md) §5 |
| **Doc-set test** | The VP4 dogfood benchmark: this repo's own `docs/` as an Abstract project - ask it, batch-edit it | [23](23-validation-thesis-and-value-hypotheses.md) §4b |
| **Merge tax / ledger** | The cost of core patches vs upstream; the running count (0-core-patch discipline) | [plans/03-merge-tax-ledger.md](plans/03-merge-tax-ledger.md) |
| **Golden path / off-path** | The journey's happy frames vs empty/error/cancel/recovery states; walkable = survives both | [plans/34-journey-walk-loop.md](plans/34-journey-walk-loop.md) |

## ID systems (and how not to confuse them)

| System | Range | What | Home |
|---|---|---|---|
| **Journeys** | 1a-1z, 2b/2c | The 26 mapped user journeys + candidates | map [13](13-journey-map-ratification.md); grades [plans/34-verify/journey-grades.md](plans/34-verify/journey-grades.md); aha-path specs [20](20-journey-specs-aha-path.md) |
| **map-D** | map-D1-D26 | The Journey Map's ratified product decisions (always written with the `map-` prefix) | [13](13-journey-map-ratification.md) §2 |
| **Decisions** | 1-160+ | The repo ADR log (no prefix). **Not** the same numbering as map-D | [07](07-decision-log.md) |
| **X** | X1-X4 | Cross-cutting walk findings (X1 = the severity-1 persistence loss; X2/X3 struck; X4 = two chats) | [plans/34-verify/journey-grades.md](plans/34-verify/journey-grades.md) |
| **F** | F1-F19 | The prioritised journey fixes, tiered | [plans/37-journey-robustness-loop.md](plans/37-journey-robustness-loop.md); mapped to issues in [21](21-beta-v1-prioritization.md) §7 |
| **T** | T1-T5 | Open tests: T1 editor audit · T2/T3 migration · T4 the aha · T5 onboarding funnel | [13](13-journey-map-ratification.md) §3 |
| **VP** | VP1-VP7 | Falsifiable value-prop hypotheses with kill signals | [23](23-validation-thesis-and-value-hypotheses.md) §3 |
| **R** | R1-R5 | The doc-18 §2.3 gate requirements (walk / GAP fill / off-path / aha unaided / floors) | [18](18-beta-plan.md), checked in [plans/34-verify](plans/34-verify/) |
| **P (principles)** | P0-P10 | Ratified product principles (P0 "more reliable than ChatGPT", P5 plain words, P6 files-on-disk…) | [16](16-principles.md) |
| **P (priority)** | P0-P3 | Priority tiers in the beta build order. **Context disambiguates**: "principle P5" vs "P1 work" | [21](21-beta-v1-prioritization.md) §4 |
| **Q** | Q1-Q3 | The spike's open questions (format / editor depth / fork-vs-greenfield) - Q1, Q3 resolved; Q2 = T1 | [05](05-open-questions.md) |
| **D26 (flow)** | - | Shorthand for the onboarding flow, from map-D26. Same thing; "D26 onboarding" = map-D26 | [20](20-journey-specs-aha-path.md) final section |
| **Issues** | #120-#365+ | The operational tracking layer: beta build order (#120-#133), plan-52 defect backlog (#297-#335), editing-loop follow-ups (#341-#365) | [21](21-beta-v1-prioritization.md) §7 |
| **Plans** | 00-55 | Handoff prompts / loop specs, kept verbatim; ≠ doc numbers (plan 20 ≠ doc 20) | [plans/README.md](plans/README.md) |

## Journey quick reference (grade as of the plan-34 walk, 9-10 Jul 2026)

**Group A - first contact:** 1a open a folder (FRAGILE) · 1b new document (FRAGILE) · 1c switch
projects (WALKABLE) · 1d organise files (MISSING) · 1w Project Home (MISSING) · 1x template from
examples (MISSING).
**Group B - the core loop:** 1e chat-rail iterate (FRAGILE, X1) · 1f judge a change (FRAGILE) ·
1g autonomy dial (FRAGILE) · 1h undo/history (FRAGILE, X1).
**Group C - across documents:** 1i one chat three docs (WALKABLE) · 1j fan-out swarm (WALKABLE) ·
1k cross-doc review (WALKABLE) · 1l rail tabs (MISSING).
**Group D - context & trust:** 1m pull files into chat (WALKABLE) · 1n context inspector
(PARTIAL/MISSING) · 1o Knowledge library (FRAGILE) · 1p provenance peek (WALKABLE) · 1y sources
rail (MISSING).
**Group E - agents & automation:** 1q schedule a doc (FRAGILE) · 1r morning inbox (PARTIAL) ·
1s watch/cancel/recover (FRAGILE - the F14 silent-outage) · 1t manage agents (WALKABLE) ·
1z usage & cost (MISSING).
**Group F - work goes out:** 1u present/export/publish (FRAGILE) · 1v interrogate the audit
(MISSING).
**Candidates:** 2b first-run orientation (MISSING) · 2c ask the project (PARTIAL).
