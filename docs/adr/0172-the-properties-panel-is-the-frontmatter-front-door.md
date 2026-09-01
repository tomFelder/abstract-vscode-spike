---
number: 172
status: "**Decided.** Plan 45 bundle-c builds it; plan 49 bundle-b consumes it."
provenance: "plan 43 pin 12"
source: docs/07-decision-log.md
---

# The Properties panel is the frontmatter front door

**The Properties panel is the per-doc front door to frontmatter + lock metadata: a 284px inset panel (TITLE / CREATED / UPDATED / STATUS / TAGS / BOUND SOURCES / AGENT POLICY) with "Edit raw YAML →" as the pro back door; AGENT POLICY reuses the same plain-language three-tier policy editor as the Agents screen (shared component in `common/`), which closes issue #122 F11 (the per-doc autonomy control) with zero duplicate UI (P2)**

Frontmatter is load-bearing (sources, tags, policy) but YAML-shaped; Obsidian's Properties showed the calm middle. Policy identical everywhere is the trust grammar's whole point - one component, two hosts.
