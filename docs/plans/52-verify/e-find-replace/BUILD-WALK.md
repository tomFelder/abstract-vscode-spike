# WP-E build walk - 14 Aug 2026

The implementer's own walk of the real desktop app after building find & replace. The independent validator re-walks this; nothing here ticks a box.

Built from `52-e-find-replace`, launched with `.agents/skills/launch-abstract/scripts/launch.sh` on a throwaway profile, driven with real `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` / `Input.insertText` events into the document's out-of-process iframe.

## The fixture

A throwaway workspace at `/tmp/wpe-ws` (never the repo's `living-docs-sample`) holding one long document whose matches sit in every block shape WP-E cares about: a heading, plain paragraphs, a word split across bold formatting (`**mar**gin`), a bullet list, a GFM table header cell and two body cells, a fenced code block, a blockquote, and two more matches far below the fold. Plus regex bait (`a.b`, `a[x]`, `c*d`), an emoji and a CJK phrase, and a second document with nothing to find.

Hand-counting the fixture gives **13** matches for "margin".

## What the walk showed

| Walk | Result | Evidence |
|---|---|---|
| `Cmd+F` with the caret in the document | Widget opens inside the webview, its input focused, count reads "No results" for the empty query | `01-cmdf-live-count-13-matches.png` |
| Typing `m`,`a`,`r`,`g`,`i`,`n` **one character per event** | Count updates on every keystroke: 19 → 15 → 13 → 13 → 13 → 13 | live counts captured per character |
| Whole-document count | `1 of 13` - the hand count, including the two matches below the fold, the bold-split word, the table cells and the code block | `01-...png` |
| Highlight ranges | All 13 ranges read back as exactly `Margin`/`margin` - including inside table cells | `CSS.highlights` range dump |
| Next x13 (Enter) | 2..13 then wraps to 1; scroll kicks in exactly when the match leaves the viewport (scrollY 0 → 650 → 678 → 28) | live counts |
| Previous (Shift+Enter) from 1 | Wraps to `13 of 13`, scrolls it into view, current match painted in a distinct colour from the rest | `02-previous-wraps-to-last-match-below-fold.png` |
| Replace (single) | Blockquote match rewritten; count 13 → 12; the file on disk carried it | `grep` of the file |
| Replace All ("margin" → "contribution") | All 13 rewritten across heading, paragraphs, bold-split word, list, table header + body cells, code block, blockquote; count → "No results" | `03-replace-all-13-of-13-round-trips.png` + `cat` |
| Undo after Replace All | **One** `Cmd+Z` reverts the whole replace-all, and the revert reaches disk | doc + `grep` |
| `Esc` | Widget hidden, focus back on `.ProseMirror` (`ProseMirror-focused`), highlights cleared | `04-esc-closes-and-returns-focus.png` |
| `Cmd+F` from the workbench (focus in the Files-tab filter box) | Widget opens in the webview and its input takes focus - the host action route | live check |
| Files-tab filter (project-wide search) | Typing "Plain" still filters the tree to one row; clearing restores all four documents; unaffected by the find | live check |

## Off-path

| Probe | Result |
|---|---|
| No matches (`zzz`) | "No results" |
| Regex metacharacters `a.b`, `a[x]`, `c*d` | 1 match each, matched literally (`a.b` also matches the literal `a.b`, never `axb`) |
| Emoji `🚀` | 1 match |
| CJK `季度利润率` | 1 match |
| Case (`MARGIN`) | Matches case-insensitively |
| Single `.` | 20 matches - every literal full stop |
| Replace and Replace All with 0 matches | No-op; the file on disk is byte-identical (same md5); the widget stays open reading "No results" |
| Find with a pending proposal on screen (source sync) | Count correct, review bar and gutter markers intact; the widget re-seats itself **below** the review bar (measured, not guessed) - `05-find-with-pending-proposal.png` |
| Find with a pending **meaning change** and its inline diff widget on screen | `steady` → **1** match (the document's own text, not the widget's copy); `consistent` → **No results** (it exists only inside the widget); `MEANING CHANGE` (the widget's own label) → **No results**; a Replace All in another block left the widget mounted and intact - `06-find-with-inline-diff-widget.png` |

## Notes for the validator

- The proposal in `06` was produced through a real model call against a broker the implementer ran on port **8091** (`LWD_PROXY_PORT=8091` + `livingDocs.modelProxyUrl`), because port 8090 was held by another lane's app and was left alone.
- A pending **figure** change that lands on a table block shows no inline widget. That is the pre-existing #301 behaviour (widgets mount only where a decoration's text anchor matches a rendered node), not something this package introduces.
- Driving quirk, not a product defect: the first synthetic mouse click issued immediately after a burst of `Input.insertText` calls is sometimes swallowed. A second identical click always lands. Allow for it when re-walking.
