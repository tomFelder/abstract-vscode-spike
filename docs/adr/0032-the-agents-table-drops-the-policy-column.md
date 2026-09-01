---
number: 32
status: "**Done (v3 iter 6, PR #16).** 0 core patches (`screenRender.ts`). Verified live: 5-column table, comp flex proportions, populated trigger/flow. Agents 85→92."
provenance: "v3"
source: docs/07-decision-log.md
---

# The Agents table drops the Policy column

**Agents table matches the comp's exact columns — drop the extra POLICY column**

The comp's agents table is AGENT / TRIGGER / FLOW / LAST RUN / STATUS (5 cols); the spike added a 6th POLICY column. Same reasoning as the Skills fold (decision 31): for *indistinguishable from the comp*, the column set must match. Policy stays visible in the per-agent canvas, so no governance info is lost; LAST RUN is now the comp's relative-time label ("2m ago" / "yesterday"), formatted from the real `lastRun` timestamp
