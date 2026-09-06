---
number: 95
status: "**Done (plan 28 iter 1).** 0 core patches; branch `28-templates`."
provenance: "plan 28, iter 1, D28-A"
source: docs/07-decision-log.md
---

# Templates are .template.md files in the project

**Template files are `<name>.template.md` in the project folder, discovered anywhere (including a `templates/` subfolder), excluded from the Reports list but never hidden from disk**

Consistent with "the folder is the project" (decision 39): a template is honest Markdown with `template: true` frontmatter (plus `name:` / `description:` / optional `sources:`), openable and editable in the normal editor with no new format or sidecar. Discovery piggybacks on the SAME bounded folder walk `listDocuments` uses (a parallel `_collectTemplates` mirroring `_collectDocs`), and templates are parsed by the SAME `parseLivingDoc` frontmatter parser (no second parser) into an `ITemplateInfo` card model. `_isDocFile` now excludes `*.template.md`, so templates never appear in `listDocuments` - and therefore never in the tree-rail Reports group or the Home documents grid - while staying on disk. Ships 3 honest starters under `living-docs-sample/templates/`: Weekly report (bound to `metrics.csv`), Client update, Meeting notes to SOP. Settled to the plan's recommendation (unattended run). **Tier: our-surface, 0 core patches.**
