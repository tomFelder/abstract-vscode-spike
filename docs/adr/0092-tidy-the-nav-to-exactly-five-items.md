---
number: 92
status: "**Done (plan 25 iter 2).** 0 core patches; branch `redesign-25-2-nav-chip`."
provenance: "plan 25, iter 2, D25-C / W1"
source: docs/07-decision-log.md
---

# Tidy the nav to exactly five items

**Tidy the nav to EXACTLY 5 items — deregister the Explorer container, hide the Workspace icon (keep the container) — REVISING decision 42's "keep the Explorer icon"**

25.1's review flagged that the live nav also showed a stray "Workspace" (tree-rail toggle) icon and the native "Explorer" icon before Home, and Explorer's long label overflowed the 60px item — breaking the comp's clean 5-item nav. Two mechanisms, chosen to preserve the always-visible 264px tree-rail: **(1)** the **Explorer** container (`workbench.view.explorer`) is now added to `IDE_VIEW_CONTAINER_IDS` and deregistered by the existing `HideIdeContainersContribution` — this **revises decision 42/F1** (which had deliberately KEPT the Explorer icon for raw-file ops). Rationale: the custom Workspace tree-rail (`DOCUMENTS_CONTAINER_ID`, `isDefault`) is now the primary sidebar and already lists/creates real on-disk files (Files/Context/Outline), so the separate Explorer icon is redundant and off-comp; disk access is unchanged. **(2)** the **Workspace** container's own activity-bar icon is hidden by CSS (`:has(> .action-label.codicon-living-docs-workspace){display:none}`) WITHOUT deregistering the container, so the tree-rail it fronts is untouched. Verified live: the a11y tree shows exactly `Home · Editor · Templates · Knowledge · Agents` + Accounts + Manage; the tree-rail still renders and clicking Editor opens a doc with the rail intact. **Tier: our-surface (1-line container-id add + 1 CSS rule), 0 core patches.**
