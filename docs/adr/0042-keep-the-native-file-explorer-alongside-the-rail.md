---
number: 42
status: "**Done (v6 iter 1).** Removed `workbench.view.explorer` from `HideIdeContainersContribution`'s id list (`livingDocs.contribution.ts`); Search/SCM/Debug/Extensions stay hidden. Tier: **additive-contribution** (the hide-list is our own contribution; no core patch). Verified live on `.realdocs-test`: the Explorer icon is back in the 76px icon-nav with the tree-rail still default/selected (shot `v6-iter1-explorer-back.png`). _Residual:_ create-folder/file → on-disk → open-as-project still to be verified on desktop (real disk)."
provenance: "v6"
source: docs/07-decision-log.md
---

# Keep the native File Explorer alongside the rail

**Bring back the native File Explorer alongside the custom tree-rail — both containers, rail default**

F1 (plan 14) needs on-disk folder/file creation from a real file tree, which the de-IDE removal of the Explorer (decisions 25 & 30, gate G4) blocked. Tom's call: re-enable the native Explorer as a *second* activity-bar container while the custom tree-rail (Files/Context/Outline/Search) stays the default/primary one — Explorer for raw file ops, rail for sources/@mention. This **deliberately REVISES G4** for functional power (the calm-shell de-IDE work is otherwise preserved).
