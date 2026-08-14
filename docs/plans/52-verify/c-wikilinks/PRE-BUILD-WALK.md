# WP-C pre-build walk - 14 Aug 2026

Walked the real desktop app on `main` at `66fb4c15543` before writing anything, per `docs/plans/RUN-cursor-parity-remainder.md` §4. **WP-C is entirely unbuilt** - there is no partial implementation to discover, and nothing to preserve.

## The walk

A throwaway workspace (`/tmp/wc-fixture`, a copy of `living-docs-sample`) with one added document:

```markdown
# Link Test

This paragraph links to [[Team Notes]] which exists on disk.

This one links to [[Nonexistent Doc]] which does not exist.

Plain text after the links.
```

**A `[[Doc Name]]` already in the file renders as literal text.** Inside the ProseMirror surface:

```
querySelectorAll('a,[class*=link],[class*=wiki]')  →  []
.ProseMirror textContent → "Link TestThis paragraph links to [[Team Notes]] which exists on
disk.This one links to [[Nonexistent Doc]] which does not exist.Plain text after the links."
```

No anchor, no chip, no distinction between the link that resolves and the one that does not.

**Typing `[[` opens nothing.** A real click into the last paragraph followed by `Input.insertText('[[')` left the paragraph reading `Plain text after the links.[[` with no picker, no popup, no menu anywhere in the webview document.

## Code confirms it

`grep -rln "wikilink\|Wikilink" src/vs/workbench/contrib/livingDocs/` returns nothing.

## What exists to reuse

The `@`-mention picker's filtering and ranking, and its caret-anchored popup, live in `browser/reviewRailView.ts` (around lines 106-145: the mentionable-file split, `MENTION_PICKER_MAX`, the ranking against the partial query, and the "which partial mention is the caret inside" helper). Those rules are the ones plan 52 §2 row C says to reuse - they sit in a rail view rather than in `common/`, so reusing them means lifting the pure parts out first.
