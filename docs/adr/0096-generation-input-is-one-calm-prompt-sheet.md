---
number: 96
status: "**Settled (plan 28); wiring deferred to iter 3.**"
provenance: "plan 28, D28-B"
source: docs/07-decision-log.md
---

# Generation input is one calm prompt sheet

**Generation input is a single calm prompt sheet - document name (required), one optional free-text line, and the source checklist pre-ticked from the template's `sources:` - no multi-step wizard**

Settled to the plan's recommendation for the iter-3 generate flow so the iter-1/2 model (`ITemplateInfo.sources` carried on the card, `templateName`/`templateDescription` parsed) is shaped to feed exactly that one sheet rather than a wizard. Not yet wired (iter 3 is out of this work unit's scope): iter 2's **Use Template** action opens the template file honestly (a real file, never a fake preview) as a placeholder for the iter-3 sheet -> `generateFromTemplate`. Recorded now so the data model and the settled input shape are locked before generation lands. **Tier: our-surface.**
