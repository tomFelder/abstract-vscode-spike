# WP-E pre-build walk - 14 Aug 2026

Walked the real desktop app on `main` at `66fb4c15543` before writing anything, per `docs/plans/RUN-cursor-parity-remainder.md` §4. **WP-E is entirely unbuilt.**

## The walk

Opened a document, clicked into a paragraph inside the ProseMirror surface (a real `Input.dispatchMouseEvent` at the iframe's own coordinates), then sent `Cmd+F` as a real key event:

- **To the webview target** (the document has focus): no find widget anywhere inside it.
  `querySelectorAll('[class*=find],[class*=search],input')` inside `#active-frame` → `[]`
- **To the page target** (the outer workbench): nothing visible either.
  `[...document.querySelectorAll('[class*=find],[class*=quick-input]')].filter(e => e.offsetParent !== null)` → `[]`

So `Cmd+F` with editor focus does nothing at all - it does not open a find widget, and it does not fall through to any workbench search either. `pre-01-cmdf-does-nothing.png`.

## Notes for the implementer

- The document body is an **out-of-process iframe**, so a find widget either lives inside the webview (and must be driven by host-authored JS, the way the inline-widget report in #302 works) or lives in the pane host outside it (the way the tab strip does) and talks to the webview over the existing protocol. That choice is the package's main design decision.
- Project-wide search stays where it is - the Files tab's filter box. This package is the **in-document** find only.
- `Cmd+F` is stock VS Code's editor find. On Abstract surfaces the fork already swallows several stock chords additively at weight 1000 (`Cmd+T` for a new chat is the precedent from #293), so there is an established pattern for taking it without patching core.
