# Living Documents / Opportunity OS — research-spike documentation

This `docs/` folder captures **everything** about the VS Code-fork spike for "Opportunity OS"
(a.k.a. "Living Documents" / "Agentic Workbench"): what it is, what we built, what we learned,
what is likely to become problematic, the open decisions, and the design intent.

> **This is a throwaway research spike.** The code will be discarded; this documentation is the
> thing worth keeping. It exists so the thinking can be picked up later — whether we continue on
> the fork or start greenfield. Treat every claim here as "true as of the spike," not as product
> commitment.

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
| [07-decision-log.md](07-decision-log.md) | Decisions made during the spike, with rationale (ADR-style) |
| [08-living-documents-format-spec.md](08-living-documents-format-spec.md) | The raw-Markdown format + dependency model design spec (clean file + lock file); resolves Q1, with full decision log. Companion visual: [option-10-living-docs-format.html](option-10-living-docs-format.html) |
| [plans/](plans/) | The handoff prompts that drove (and will drive) the work |

## Status at a glance (2026-06-21)

- **Built:** items 0-5 (`living-docs-spike`, PR #1 -> `main`); the Studio de-IDE pass
  (`living-docs-studio`, PR #2 -> `main`); and a design-match + build-out round
  (`living-docs-design-match`) that implemented the rest of the Workbench comp — Home dashboard,
  Templates / Knowledge / Agents (with workflow canvas), the Present & export modal, the
  Chat / Review / History / Skills panel, and a clean icon nav. 15 unit tests passing.
- **Proven:** the engine (agent loop, figure-auto-apply / meaning-change-approve, provenance,
  multi-doc fan-out, live source kinds incl. a real HTTP API, export) **and** that the full hi-fi
  shell is reachable with **0 added core patches** (see [plans/03-merge-tax-ledger.md](plans/03-merge-tax-ledger.md)).
- **Decided:** the document format (Q1) — clean `<doc>.md` + generated `<doc>.lock.json` with a
  dependency graph; see [08-living-documents-format-spec.md](08-living-documents-format-spec.md).
- **Next phase (foundational):** implement that format + dependency graph — handoff
  [plans/06-format-implementation-handoff.md](plans/06-format-implementation-handoff.md).
- **Still open:** editor depth (Q2) and **fork vs greenfield** (Q3) — see
  [05-open-questions.md](05-open-questions.md). The chosen format is built to survive either.
