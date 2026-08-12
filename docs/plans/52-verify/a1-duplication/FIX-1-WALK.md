# WP-A1 fix round 1 - the block-class walk, 13 Aug 2026

Walked the real desktop app on `52-a1-pointer-cards` (OpenRouter door serving) after replacing the pointer's routing PREDICTION with an OBSERVATION reported by the document itself.

The walk used a throwaway copy of `living-docs-sample` (kept outside the repo so the diff stays inside `contrib/livingDocs/` and `docs/`) with one added fixture, `Block Classes.md`: one clearly named section per Markdown block class, so a proposal could be aimed at each in turn. Its content is reproduced at the bottom of this file.

## The table

| Block class | Inline widget mounts? | Pointer routes to | User can read + act? |
|---|---|---|---|
| paragraph | yes | `document` | yes - the inline widget, with Edit / Approve changes / Reject |
| bullet list | no | `review` | yes - the Review card, with Approve & apply / Reject |
| nested list | no | `review` | yes - Review card |
| table cell | no (the whole table block mounts nothing) | `review` | yes - Review card |
| heading | could not produce a proposal at all | n/a | n/a - see below |
| block quote | no | `review` | yes - Review card |
| code block (fenced) | no | `review` | yes - Review card |
| paragraph with a hard line break | no | `review` | yes - Review card |
| code block (indented) | no | `review` | yes - Review card |
| paragraph with an HTML entity | no | `review` | yes - Review card |

The last three rows are not block classes the brief asked for. They are there because they are the rows that matter: **each one is a case the old prediction routed to `document`, where nothing mounts.**

**Heading: could not be produced, and it is not the pointer's doing.** `livingDocsService.ts` `_queueChatEdit` skips heading blocks outright (`if (block.type === 'heading') { continue; }`), so no chat-proposed change can ever target one. Four differently-worded attempts all produced either nothing or a mis-targeted edit on a neighbouring block; on two of them the model replied that it had made the edit while queueing no change at all. A heading therefore has no pointer to route.

## Ground truth, measured rather than described

With nine changes pending on one document, the live ProseMirror DOM held exactly one widget:

```
{"mounted":["8e26dfa5-…"],"editblocks":1,"dO":1,"dN":1,"pendingGutters":8}
```

and the transcript drew exactly one `document` pointer and eight `review` pointers. The rail and the document agree because they are now reading the same fact.

## The three proven mis-routes

The anchors below are the real strings the live decoration payload carried (`window.__LWD_PM_DECO`), run back through the predicate the first cut of WP-A1 shipped:

| Block class | Old prediction | Observed | |
|---|---|---|---|
| paragraph | `document` | `document` | agrees |
| bullet list | `review` | `review` | agrees |
| table | `review` | `review` | agrees |
| block quote | `review` | `review` | agrees |
| code block (fenced) | `review` | `review` | agrees |
| nested list | `review` | `review` | agrees |
| paragraph with a hard line break | `document` | `review` | **MIS-ROUTE - lands on nothing** |
| code block (indented) | `document` | `review` | **MIS-ROUTE - lands on nothing** |
| paragraph with an HTML entity | `document` | `review` | **MIS-ROUTE - lands on nothing** |

The mechanism is the same in all three: the predicate asked "does this anchor still carry Markdown syntax?", and each of these anchors is syntax-free while still failing to match its rendered node.

- `The first half of the sentence sits here, and the second half follows a hard line break.` - the hard break renders as `<br>`, so the node reads `…sits here,and the second…` with no space.
- `const secondary = '#101214'; console.log(secondary);` - an indented code block, whose four leading spaces the anchor has already trimmed away.
- `The conversion rate was 5 &amp; rising through the whole of the quarter.` - the node reads `5 & rising`.

None of these are exotic. The third is what any document imported from Word or HTML looks like.

## What the clicks do

- **`document` route** (`fix1-02`): the transcript pointer for the paragraph change scrolls the document to its widget and flashes it (`.lwd-focus-flash` on the `.editblock`). The rail stays on Chat. Clicked three times in a row: three flashes, no bounce.
- **`review` route** (`fix1-03`, `fix1-05`): the pointer for a change with no widget scrolls the document to the block (amber gutter bar, no widget) **and** switches the rail to Review, scrolled to that change's card with its full red/green diff and Approve & apply / Reject.
- **approve from the widget** (`fix1-04`): the change applies to disk, the widget goes, the badge drops 9 -> 8, and the pointer leaves the transcript.

## Screenshots

| | |
|---|---|
| Nine pointers, routed by what the document reported | `fix1-01-nine-pointers-observed-routes.png` |
| The `document` route: tab, scroll, flash | `fix1-02-document-route-flashes-widget.png` |
| **The fallback firing**: an entity paragraph - which the old rule sent to `document` - landing on its Review card | `fix1-03-mis-routed-class-now-lands-in-review.png` |
| Approve from the widget: pointer leaves the transcript | `fix1-04-approve-from-widget-pointer-leaves.png` |
| A code block change landing on its Review card | `fix1-05-code-block-lands-in-review.png` |

## What could not be walked

- **The `unknown` route** (a pointer whose document has never been opened, so nothing has looked at it). Producing one needs a pending change in a document that has never been opened, and the only door to that is the cross-document "Edit across" fan-out, which in three attempts answered without queueing a change. The state is covered by unit tests, and the click path resolves it by opening the document and waiting for its first report.
- **Heading**, as above.

## The fixture

```markdown
# Block Classes

A fixture for the WP-A1 walk: one clearly named section per Markdown block class, so a proposal can be
aimed at each one in turn.

## Paragraph

The onboarding funnel converted at a steady rate through the quarter, with no notable movement week to week.

## Bullet list

- The primary colour is blue `#1E5BFF` for the principal action.
- The neutral ink is `#14161A` for body text.
- The surface background is `#FFFFFF`.

## Nested list

- Marketing site
  - The hero headline reads "Built for calm teams".
  - The footer notice reads "All rights reserved".
- Product shell
  - The empty state reads "Nothing here yet".

## Table

| Surface | Owner | Status |
| --- | --- | --- |
| Marketing site | Priya | On track |
| Product shell | Marco | At risk |
| Email templates | Dana | On track |

## Heading target

### The quarterly readout is ready

Body text sitting under the heading, so the heading is a block of its own.

## Block quote

> The rebrand modernises the brand without losing its heritage.

## Code block

    ```ts
    const primary = '#1E5BFF';
    console.log(primary);
    ```

## Hard break paragraph

The first half of the sentence sits here,··
and the second half follows a hard line break.

## Indented code

    const secondary = '#101214';
    console.log(secondary);

## Entity paragraph

The conversion rate was 5 &amp; rising through the whole of the quarter.
```

(`··` marks the two trailing spaces that make the hard break; the fenced code block is shown indented so it nests inside this listing.)
