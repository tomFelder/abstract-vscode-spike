---
number: 97
status: "**Done for iter 1/2 (counts + body carried); generation deferred to iter 3.**"
provenance: "plan 28, D28-C"
source: docs/07-decision-log.md
---

# Template placeholder and bind-link semantics

**Placeholder semantics: `{{slot:hint}}` renders in the template preview as a muted chip and becomes part of the model brief at generation time; bind links in the template body copy through verbatim so generated docs are born bound**

Settled to the plan's recommendation. Iter 1/2 implements the honest, model-independent half: `countTemplateSlots` (pure, tested) counts `{{ ... }}` runs for the card's true `N slots` line, and the template's `body` (slots + `bind:` links intact) is carried on `ITemplateInfo` so an iter-3 generation can compose both the skeleton (bind links verbatim, slots stripped) and the model brief (slot hints) from the same parsed value. A generated document records `template: <name>` provenance, which the frontmatter parser reads as `fromTemplate` (distinct from the `template: true` flag) for the iter-3 "Created from <name> template" audit line. **Tier: our-surface, 0 core patches.**
