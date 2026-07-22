# 46-a round 2 - fixing the two validator defects (P4.5 SOURCES label, P4.2 body-content reach)

Round-1 validation failed P4.5 and P4.2. This round fixes both. Every px/hex below was read live via `getComputedStyle` / `getBoundingClientRect` against the round-2 build on port 8082 (`living-docs-sample`), Node 24.

## Found-diff verdict (the prior fix-round agent's uncommitted change)

The prior agent left one uncommitted line in `treeRailView.ts`: it restyled `.rail-files-tree .rail-tree-folder-label` (the Files-tree group label - the real home of the SOURCES label) from `600 11px/1 system-ui / #1A1C20 / no transform` to `600 10px/1 'JetBrains Mono' / .12em / #A3A8B2 / uppercase`. **Kept** - it is exactly the P4.5 fix the validator asked for, on the correct selector (the validator confirmed the label renders through `.rail-tree-folder-label`, not the Context tab's `.rail-folder`). Nothing was discarded.

## P4.5 - SOURCES group label (Files tree)

Measured live on the "Sources" folder label:

```
text:          "Sources"
fontFamily:    "JetBrains Mono", ui-monospace, monospace
fontSize:      10px
fontWeight:    600
letterSpacing: 1.2px   (= .12em × 10px)
color:         rgb(163, 168, 178)  = #A3A8B2
textTransform: uppercase
```

Spec (pin 4 P4.5): mono 10/600/.12em `#A3A8B2` uppercase. **Exact match.** Evidence: `sources-label-1440.png`.

## P4.2 - body-content reach folded into the filter

The filter now matches a row's **label** AND a document's **body text**. Body matching reuses `searchTreeRail` (the single home of title-OR-body matching) - the view resolves the docs whose body contains the query via `searchTreeRail`, projects the hits to `resource.toString()` keys, and `filterTreeRailNodes` keeps those doc rows (plus ancestor folders) even when the label does not match. No duplicated matching code.

**What ships:** body-phrase matching surfaces the document as a normal tree row - **no inline snippet** (the tree widget has no snippet affordance; snippets were a Search-tab-list feature). The criterion "docs are findable by body phrase" is met.

Measured live - filter "primary colour" (a body-only phrase, in no title):

```
leaves surfaced: ["Appendix — Design Tokens"]   (under Reports ▸ brief)
"No documents match": not shown
```

Round-1 returned 0 rows / "No documents match" for the same phrase. Evidence: `body-search-primary-colour-1440.png`.

## Regressions - label filter + focus discipline (both still pass)

- **Label filter still narrows.** Filter "Weekly" → 2 rows `["Reports", "Weekly Operating Summary"]`; clearing restores 12 rows. Evidence: `label-filter-weekly-1440.png`.
- **Focus discipline (no regression).** With the filter holding "Board", clicking into the editor and typing `SHOULD_NOT_LAND_IN_FILTER` leaves the filter value **unchanged** ("Board" → "Board"). The filter reacts only to its own `input` events. Evidence: `focus-discipline-1440.png`.

## Checks (Node 24)

| Check | Result |
|---|---|
| `npm run typecheck-client` | clean |
| `npm run valid-layers-check` | clean |
| `./scripts/check-seams.sh` | OK - all shell seams intact |
| `./scripts/test.sh --grep "treeRail"` | **19 passing** (was 18; +1 new body-match filter test) |
| `./scripts/test.sh --grep "livingDocs"` | **309 passing** |

The new unit test (`filterTreeRailNodes keeps a document matched only by body text (P4.2 content reach)`) drives a doc whose label lacks "primary colour" but whose body carries it, resolves the body-match set through `searchTreeRail`, and asserts the doc is kept - while a term in no label or body still prunes to nothing.
