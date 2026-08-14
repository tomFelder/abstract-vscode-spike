# WP-C implementer walk - 14 Aug 2026

The real desktop app (`launch.sh --repo /Users/tommy/Sites/abstract-wt/52-c`), driven by CDP against a throwaway workspace at `/tmp/wc-52c` (a copy of `living-docs-sample` plus two fixtures). This is the implementer's own walk; the independent validator's walk is the one that ticks boxes.

## The picker

Clicking into the last paragraph and typing `[[` opens the caret-anchored picker (`02-picker-open.png`) listing 8 documents - the cap - including the two nested under `brief/`. Typing `Week` narrows it to `Weekly Summary` plus a `Create "Week"` row (`03-picker-filtered.png`). Enter inserts the link (`04-link-inserted.png`).

## The on-disk form

Immediately after accepting, `tail -1 "/tmp/wc-52c/Wikilink Walk.md"`:

```
Plain text after the links. See also [[Weekly Summary]]
```

Every pre-existing link in the file also survived that unrelated edit byte-for-byte, including the awkward names:

```
Odd names: [[Q1/Q2 Review]], [[He said "hi"]], [[Sprint 🚀 Notes]] and [[会議メモ]].
```

## Following a link

A resolved chip opens its document in a new tab (`05-resolved-link-opens.png`). An unresolved chip creates the document and opens it (`06-unresolved-link-creates.png`); re-opening the linking document shows that link now rendered resolved. `[[Q1/Q2 Review]]` created `Q1 Q2 Review.md` - the service strips path-hostile characters - and still resolves to it afterwards.

## Round-trip beside `bind:` and `{{slot}}`

`Coexist Check.md` carries frontmatter, a `bind:` figure, a `{{slot}}` token and two wikilinks (`08-coexist-bind-slot-wikilink.png`). After typing an unrelated sentence into the last paragraph, the file on disk is unchanged apart from that sentence - frontmatter, `[49,800](bind:metrics.mrr.latest)`, `{{customer_name}}` and both `[[...]]` all byte-identical.

## Exports

All three exported from the document's Present modal. Wikilinks read as the words a reader sees, no chip markup, and **code is left alone**:

- `Wikilink Walk.export.md` - `See Team Notes and ...`, while the fenced block still reads `const wiki = "[[Team Notes]]";` and the inline span still reads `` `[[Team Notes]]` ``.
- `Wikilink Walk.export.html` - no `wikilink` or `data-target` anywhere; no raw `[[` outside `<pre>`/`<code>`.
- `Wikilink Walk.export.docx` - `word/document.xml` carries the plain words and no chip markup.

## Off-path

| Probe | Result |
|---|---|
| `[[` typed inside a fenced code block | No picker; the text stays literal in the block and on disk (`07-code-block-no-picker.png`) |
| A `[[...]]` already inside a fence or an inline span | Renders as literal code, never a chip (`01-chips-resolved-and-unresolved.png`) |
| Esc | Closes the picker, keeps the typed text, and stays closed as more is typed |
| No match | A `Create "<query>"` row rather than a dead end |
| `/`, quote, emoji, CJK names | All render as chips and round-trip byte-for-byte |
| Two links to one document | Both render and follow independently |
| Links in a list, a heading and a table cell | All render and follow |
| A linked document renamed, then another deleted | Both links flip to unresolved (`09-renamed-and-deleted-go-unresolved.png`) |

## Defects this walk found, and fixed

1. **Esc reopened the picker.** Escape closed it on keydown and the same keystroke's keyup reopened it.
2. **A table-cell link fired twice.** One click on an unresolved link inside a table cell created TWO documents (`Another Missing Doc.md` and `Another Missing Doc 2.md`, same second), because the cell's capture-phase mousedown and the bubble-phase click delegate both followed it.
3. **Exports rewrote code.** The export rule stripped brackets inside fenced blocks and inline spans.

## Not walked

- **Delete via the tree's own `Delete…` menu item.** Its confirm did not surface to CDP in this profile, so the deletion above was done on the filesystem and the app's resolution re-checked. The rename half WAS driven through the real inline-rename UI.
