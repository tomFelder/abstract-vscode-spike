---
number: 156
status: "**Decided.** Layout in [22](22-file-interop-and-project-layout.md) §5."
provenance: "founder"
date: 2026-07-12
source: docs/07-decision-log.md
---

# A hidden .abstract/ folder holds project state

**A hidden `.abstract/` project folder holds app-internal project state: skills, knowledge metadata/caches, run logs, project config, indexes**

Keeps the user's folder clean (their documents and data are what they see); skills/knowledge need a durable in-project home that travels with the folder. Boundaries: contents stay **plain, portable files** (P6) - skill.md files are user-editable if found; `templates/*.template.md` stays visible (the shipped plan-28 convention users author directly); **locks stay beside their documents** (Option 10 spec of record - lock-follows-file semantics and external-tool provenance visibility; revisit placement at greenfield); secrets never live here (proxy-side `~/.abstract/`, D29-C). `mcp.json` at folder root is a candidate to fold in later.
