# Bundle C QA - issues #172 (icon-nav) + #173 (rail resizing)

Branch `fix/172-173-iconnav-sashes`. Live evidence captured by driving a from-sources Code OSS build (launch skill) against the `docs/` folder. Required checks pass: `typecheck-client` clean, `valid-layers-check` clean (exit 0), `check-seams.sh` OK, and no new unit-test failures; the four `screenRender` failures are pre-existing on main (livingDocs 127 passing / 4 pre-existing screenRender failures known on main; Splitview 17, Grid 49, Activitybar 14, treeRail 8 all passing).

| Shot | What it proves |
|------|----------------|
| `a-labelled-iconnav.png` | Folder window shows the labelled 76px icon-nav (Home / Editor / Templates / Knowledge / Agents), each with a text label. No stock IDE viewlet icons and no Workspace tree-rail icon leak into the rail (#172). |
| `b-knowledge-active-chip.png` | Clicking Knowledge navigates to the Knowledge screen and the active white chip moves to the Knowledge nav item (#172 active-state wiring). |
| `b2-agents-active-chip.png` | Clicking Agents navigates and the chip follows to Agents (second navigation, confirms the chip tracks the surface). |
| `c1-rails-before-drag.png` | Editor surface with both rails visible: left Workspace tree-rail (~252px) + right Review rail (~374px). |
| `c2-rails-after-drag.png` | After dragging the sidebar sash and the aux-bar sash: sidebar 252 -> 368px, aux 374 -> 474px. Sashes are no longer `disabled` (pointer-events auto) — the global lock is gone (#173). |
| `d-widths-persisted-after-restart.png` | After a full process restart (seeded from the same profile), the rails restore at the dragged 368/474 — NOT the old hard-pinned 264/392. Persisted natively (`workbench.sideBar.size`=380, `workbench.auxiliaryBar.size`=492 in `state.vscdb`); `livingDocs.railWidthsSeeded`=true so `RailVisibilityContribution` no longer re-pins (#173). |
| `e-narrow-window-900px.png` | At a 900px window width the layout holds: 76px nav fixed, all parts visible, no overlap or clipping. |
