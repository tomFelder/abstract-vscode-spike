---
number: 126
status: "**Done (plan 28 iter 4).** 0 core patches; branch `28-templates-gen`."
provenance: "plan 28, iter 4"
source: docs/07-decision-log.md
---

# The new-document sheet takes a name or template

**The new-document on-ramp is a name-or-template sheet on Home; a named blank is born titled (`<name>.md`), an empty name keeps decision 56's `Untitled` name-on-first-save escape hatch, and a template row reaches the iter-3 generate flow with the same typed name**

Home gains a **New document** primary that opens a lightweight sheet: an autofocused name field, a **Blank document** default row (Enter), and each real template (`listTemplates()`) as a secondary row - real data only, so with no templates only Blank shows. `createDocument` now takes an optional `name`: a provided name writes `<name>.md` already titled (path-hostile characters stripped to a safe stem, uniquified), while an empty name keeps the existing `Untitled.md` zero-ceremony path (decision 56 held). A template row posts `generateFromTemplate` with the sheet's typed name, so the template path lands in the exact iter-3 flow (skeleton + review-engine draft). The webview message bridge was extended with generic sheet plumbing (open/close client-side with no host round-trip or flash; submit gathers the sheet's `name`/`note`; Enter triggers the sheet's default) reused by both the Templates generate sheet and this on-ramp. The plan named "Home's New document card and the tree-rail's new-doc action", but the Home redesign (plans 22/33) and the current tree-rail ship no such affordance; the on-ramp is delivered as Home's primary new-document entry (the honest, highest-value placement), with the tree-rail left unchanged (noted deviation). Settled to the plan's recommendation (unattended run). **Tier: our-surface, 0 core patches.**
