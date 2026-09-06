---
number: 182
status: "**Decided.** Applied to the canon docs and CONTEXT.md; the ~300 living-docs source identifiers and the two analytics event keys follow in plan 56 barrier P1."
provenance: "founder, grilling session"
date: 2026-09-01
---

# Change is the unit of review, not proposal

**The canonical noun for the unit of review is "change" (and "change set" for one run's output). "Proposal" is retired as a noun; the verb "propose" stays canonical and unchanged.**

Two words were competing for one concept with no declared boundary: doc 26's glossary defined "proposal" as the agent-suggested change with its diff and card, while doc 30 introduced "Change" as the persisted hunk with identity, versions and a thread, and used "proposal" loosely alongside it. The decisive argument is not that the shipped code already speaks `Change`, `ChangeSet` and the change store - it is that **"proposal" is already taken in this tree**. Upstream VS Code owns it for the extension API proposal system (`enabledApiProposals`, `ApiProposalName`, `parseEnabledApiProposalNames`), which accounts for a large share of the occurrences in `src/`. A domain term that collides with an upstream concept in the same repository is a bad canonical term, however good it reads in isolation.

"Change" also has the better semantics: the review grammar is identical for human and agent edits (principle P3), and a human's own edit is naturally a change but not naturally a proposal. The review UI already counts in changes.

Consequences accepted: the north star metric is reworded to "approved agent changes per user per week"; the analytics event keys `proposal_created` and `proposal_resolved` become `change_created` and `change_resolved`, which is safe only because the analytics work (#134) is still open and no production data depends on the old names; historical layers - this log, the plans, the QA evidence and the archive - keep the old word verbatim, so journey 1f is "judge a change" in the specs while the ratified journey map still reads "judge a proposal". That inconsistency is knowingly accepted as the price of not rewriting history.

Vocabulary authority moved to the root `CONTEXT.md` at the same time; doc 26 keeps the ID systems and the per-term home-doc links, and defers on wording.
