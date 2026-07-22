# Validation round 2 - product tabs (bundle 45-b, PR #234, #224)

Adversarial re-validation of the round-2 fix commit (e4e87fd0240). Round 1 ticked 6/8 and
failed P7.4 (wrong glyph) and the P7.8-adjacent split leak. This round re-checks everything and
adjudicates the two open criteria on fresh eyes.

Worktree `/Users/tommy/Sites/abstract-v2-editor`, branch `v2/editor-b`, head e4e87fd0240.
Server `TMPDIR=/tmp ./scripts/code-web.sh ./living-docs-sample --port 8081`, bare URL, driven
headed via playwright-core. Measurements read from the live DOM (codepoints, computed styles,
group counts), not eyeballed.

## Build checks

- `npm run typecheck-client` - clean (no errors).
- `npm run valid-layers-check` - clean.
- `./scripts/check-seams.sh` - OK, all shell seams intact (exit 0).
- `./scripts/test.sh --grep "livingDoc"` - 324 passing.

## P7.4 - source tab glyph + grid + drawer independence: PASS

Opened metrics.csv from the tree SOURCES row. Live DOM read (02-source-tab-grid.png):

- Source TAB glyph: `⊞` codepoint **U+229E** (not the round-1 U+2338). Computed font
  `"JetBrains Mono", ui-monospace, monospace` (mono treatment). `aria-hidden="true"`.
- Source tab a11y: `role=tab`, `aria-selected=true`, explicit `aria-label="Source metrics.csv"`
  - the accessible name is meaningful and glyph-free (the decorative glyph/dot/× are aria-hidden,
  so the computed name is driven by the aria-label, not the raw text content).
- Viewer head glyph: `⊞` codepoint **U+229E**, mono, `aria-hidden="true"`; name span reads
  `metrics.csv` (separate text node).
- Grid renders: `table.lwd-source-grid` with header row (week/date/mrr/signups/churn/active) + 13 rows.
- Strip geometry regression intact: strip 40px / rgb(243,244,247); active tab 34px / white.

Drawer independence (06-drawer-independent.png): with the strip carrying a document tab
(Weekly Operating Summary, active) AND a source tab (metrics.csv, source), clicking a bound
figure (`span.bound[data-key]`, 16 present) in the document opened the `.srcdrawer` bottom
overlay (visible, 24 rows, header `⊞ metrics.csv`). The document's bottom drawer works
independently of the source-viewer tab; both surfaces coexist on the same strip.

## P7.8 - split path audit: PASS

Live (07-after-split-chords.png): with editor focus, editor-group-container count stayed at 1
across both chords:
- before = 1 group
- after `Cmd+K Cmd+\` = 1 group (no new group)
- after `Cmd+K Cmd+Shift+\` = 1 group (no new group)
- editor still works: opening Board Note afterwards activated its tab, still 1 group.

Independent code audit of every backslash-based split chord in stock
(editorActions.ts / editorCommands.ts):

- `Cmd+K Cmd+\` is shared by splitEditorOrthogonal + splitEditor{Left,Right,Up,Down}
  (editorActions.ts:106/128/144/162/180) -> each opens a NEW group.
- `Cmd+K Cmd+Shift+\` is splitEditorInGroup / toggleSplitEditorInGroup
  (editorCommands.ts:1132/1185) -> in-group side-by-side split.

Both are shadowed with `noop` at weight 1000 (livingDocs.contribution.ts:306-312), the same
orchestrator-sanctioned mechanism 44-b used for the bare `Cmd+\`. Weight 1000 sits above
WorkbenchContrib, so the swallow wins chord resolution - no core patch (check-seams still OK).

Remaining group/window-creating actions carry NO keybinding and are f1-only, so the neutralised
command palette makes them unreachable in the calm shell:
- newGroup{Left,Right,Above,Below} (AbstractCreateEditorGroupAction) - f1 only.
- DuplicateGroup{Left,Right,Up,Down} - f1 only.
- Move/CopyEditorGroupToNewWindow, MoveEditorToNewWindow, NewEmptyEditorWindow,
  RestoreEditorsToMainWindow - f1 only.
- The focus-side-group actions (focus{Left,Right,Above,Below}Group, focusFirst/Last, Cmd+1) are
  pure AbstractFocusGroupAction - they navigate between EXISTING groups, they never create one.
- `copyEditorToNewWindow` keeps `Cmd+K O` (editorActions.ts) - an editor-into-new-window MOVE,
  not a shell split-group. Left as-is by design (per the fix-commit rationale). Not a group split.

No reachable path in the calm shell creates a group outside `openToTheRight`.

openToTheRight (contract 43 section 3.2 "build the group-side support") - adjudicated on code, since
the menu item does not ship until 46-c (no UI trigger in 45-b):
- The tab strip is per-group: `tabStripStorageKey(groupId)`, one AbstractTabStrip instance per pane
  bound to `this._group`, so a second group opened to the right gets its own strip row.
- `_close` -> `group.closeEditor`, and the split contract relies on
  `workbench.editor.closeEmptyGroups` (stock default true) so closing the last tab in a group closes
  the group. Activation is routed through IEditorService with the group as preferred group and never
  opens a second group. The SIDE_GROUP wiring for the menu ships in 46-c.
- The live blank-group matrix (last-tab-closes-group across split rows) DEFERS to 46-c validation,
  where the "Open to the right" menu item actually ships. The group-side support the criterion asks
  for ("build the group-side support even though the menu item ships in plan 46") is present in code.

Tick both criteria: P7.4 on live proof, P7.8 on live neutralisation + code audit + the group-side
support being built (with the openToTheRight blank-group matrix explicitly deferred to 46-c).

## Regression

- Reload persistence (P7.7): a 4-tab set (Board Note, Team Notes, Appendix, metrics.csv incl. the
  source, source active) survived a hard reload with the exact set + active preserved
  (05-after-reload-persist.png). Labels self-heal from display-title to filename on cold restore
  (the documented filename-until-visit caveat) - the SET/active criterion holds.
- 45-c Properties: the Properties panel renders in the doc webview (2 els).
- 45-a gutter / bound figures: bound figures present (6 `span.bound`) and trace to the source drawer;
  the `.gutters` mechanism is live.
