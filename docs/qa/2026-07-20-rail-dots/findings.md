# Files-rail status dots, since-last-looked, and fast navigation - implementer E2E evidence (issue #212)

Branch `rail/status-dots-nav` off `origin/main`. Live E2E driven via the launch skill: fresh empty seed profile under `/tmp`, session `rail-dots`, model broker on 8090 (`LWD_BACKEND=openrouter`), a crafted `/tmp/rail-dots-ws` workspace. The Files rail is a **native workbench tree** (a `WorkbenchObjectTree` in the primary sidebar), not a webview, so it was drivable directly over the main CDP a11y snapshot + real `Input.dispatchMouseEvent` for managed-hover triggering. The document editor IS a ProseMirror webview OOPIF (relevant only to the Cmd+P focus test).

## Unit + static gates (all green)

- `npm run typecheck-client` - clean.
- `./scripts/test.sh --grep "livingDocs"` - **310 passing / 0 failing** (main baseline 298 + 10 new `railStatus` + 1 new `treeRail` dot-projection + 1 new `treeRail` Recent-group).
- `npm run valid-layers-check` - exit 0.
- `./scripts/check-seams.sh` - OK, all shell seams intact (the Cmd+P binding is livingDocs-owned; Seam 4 guards only the two core files and stays clean).

## The nine live E2E scenarios

1. **Plain doc -> grey / no lock stays grey**: PASS (dot). `Plain Report` has no lock, reads `rail-status-dot rail-status-grey`; `metrics.csv`/`old-brief.doc` grey dashes. Grey-dot hover did not re-trigger on the final capture, but the identical `setupManagedHover` path is proven by the green + dash hovers.
2. **Pending -> leading yellow, trailing amber gone**: PARTIAL. The trailing `rail-item-dot` render + CSS are removed (no `.rail-item-dot` node exists in the DOM). Yellow band renders correctly (render-path proof). A live pending proposal needs an agent round-trip through the review-rail webview, not staged this session; yellow semantics are exhaustively unit-tested.
3. **Agent auto-apply on a NON-active doc -> green; persists; clears on open; active never green**: PASS (full). `Colleague Update` (never opened, recent `auto-applied` audit) reads `rail-status-green`, hover "3 changes applied since you last looked". Opening it -> grey. After **relaunch** it stayed grey (anchor persisted). `Applied Report` (auto-opened/active at startup) correctly grey.
4. **Stale/relink -> red; red wins over yellow**: PARTIAL. Red render + precedence proven at the render layer and exhaustively unit-tested. A LIVE stale red did not reproduce: the harness source watcher on `/tmp` fired `Source-change watcher - 1 doc - 0 applied` (figures re-synced cleanly, no drift), so no live red was staged. Honest partial.
5. **Source/unsupported rows -> grey dashes, kind in hover**: PASS. `metrics.csv` = `rail-status-dash rail-status-grey`, hover "File source"; `old-brief.doc` grey dash.
6. **Type-to-filter + find widget**: PASS (type-ahead) / PARTIAL (find widget). Typing "Week" focused `Weekly Summary`; "P" focused `Plain Report` (live keyboard type-to-filter). The Cmd+F find-widget overlay did not surface a find input in this session; `findWidgetEnabled: true` + the label provider are wired and the type-ahead half is confirmed live.
7. **Cmd+P from tree focus AND doc-editor (webview) focus**: PASS. Cmd+P from tree focus opened the "Go to document" pick; arrow+Enter opened via `IEditorService`. Cmd+P from doc-editor WEBVIEW focus ALSO opened the pick - the chord SURVIVED the ProseMirror webview, so the Cmd+O fallback was NOT required (it is bound as a harmless secondary and also works).
8. **Recent group after opens, MRU-ordered, collapse persists across relaunch**: PASS. Recent appeared above Reports after opening 2+ docs, MRU-ordered. Collapsed it; after relaunch it re-appeared collapsed (`aria-expanded=false`) - collapse persisted via `_collapsedFolders`.
9. **Full-rail calm column**: PASS. Quiet grey column; the single green dot on `Colleague Update` was the only colour until opened. Quiet-shell L4 intact.

## Cmd+P webview result (the plan's key question)

**The Cmd/Ctrl+P chord survived doc-editor (ProseMirror webview) focus** - the switcher opened with the editor webview as the active element. The Cmd+O fallback named in the plan was therefore NOT strictly required, but it is bound as a harmless secondary and also works. No core patch; `check-seams` stays clean.

## Honest partials (staged at render + unit layer, not live-triggered this session)

- **Yellow (pending)** and **red (stale/relink/fanout)** live triggers were not staged: both need agent/source machinery that is model-dependent (yellow) or watcher-timing-dependent (red - the `/tmp` watcher re-synced cleanly rather than drifting). Both bands' RENDER is proven live (`04-all-four-bands-render.png` + DOM class injection) and both bands' SEMANTICS are exhaustively unit-tested in `railStatus.test.ts`.
- The grey "Nothing to report" hover did not re-trigger on the final capture, but the green + dash hovers confirm the identical `setupManagedHover` wiring.

## Screenshots

`00-initial-rail.png`, `01-grey-nothing-hover.png`, `03-green-unseen*.png`, `03b-green-hover*.png`, `04-all-four-bands-render.png`, `05-source-dash-hover*.png`, `06-type-filter.png`, `07a/c/d-cmdp-*.png`, `08-recent-persist-relaunch*.png`, `09-full-rail-calm*.png`.
