# WP-C fix round 1 - hand-typed wikilinks (#314, PR #315)

The validator refused one acceptance row: **hand-typed wikilinks were escaped on disk and corrupted permanently**. Typing `[[Team Notes]]` produced `\[\[Team Notes\]\]` in the file. Because the picker could not author an alias, hand-typing was also the *only* route to `[[Target|Alias]]` - so the one syntax the grammar, round-trip and export all support was the one syntax guaranteed to break.

This walk is the fix, driven through the real desktop app on a throwaway workspace at `/tmp/wc52c` (a copy of `living-docs-sample` plus three documents of my own; the repo's sample was not touched). Every link below was **typed one keystroke at a time** through CDP `Input.insertText`, one character per call - never pasted, never synthesised by dispatching a transaction. The rule has to fire on the final `]` exactly as it would for a human, and typing the string in one blob would not have proved that.

## No bundle rebuild - and why that is the interesting part

`handleTextInput` is a ProseMirror **editor prop**, and `someProp` checks direct props before plugin props. That is the same seam the paste-boundary guard already uses (`transformPasted`, #256, "no bundle edit, no core patch"). So the rule installs from the host webview via `view.setProps({...})` and the vendored bundle is **byte-for-byte untouched** - `git diff --name-only` matches `prosemirrorBundle` zero times.

That matters beyond convenience. `/Users/tommy/Sites/.lwd-pm-build` is shared, unversioned and currently carries this branch's sources; every avoided rebuild is one less chance to disturb it. It and the snapshot at `.lwd-pm-build-backup-20260814` were **not touched at all this round** - not even copied.

The grammar was already right. Only the typing path was missing.

## The decision is pure, and mirrors the parser exactly

`matchTypedWikilink` in `common/wikilinks.ts` decides whether a keystroke completed a link. It is injected into the webview verbatim via `String(fn)` and unit-tested without a DOM.

The invariant it holds is not "this regex looks sensible" - it is **the rule fires precisely where a reload would have produced a link**. Typing and reloading can never disagree about what a link is. Every expectation in the unit test was first checked against the *real* decoded bundle running headlessly:

| Source | Real bundle parser | `matchTypedWikilink` |
|---|---|---|
| `arr[[0]]` in prose | wikilink, target `0` | fires, target `0` |
| `[[a\|b\|c]]` | target `a`, alias `b\|c` | fires, target `a`, alias `b\|c` |
| `[[[Foo]]` | literal `[` + wikilink `Foo` | fires at the last `[[`, target `Foo` |
| `\[[Foo]]` | literal text (escape rule wins) | declines |
| `[[]]`, `[[   ]]` | literal text | declines |
| `` `[[Team Notes]]` `` | code mark, no link | declines (caller's guard) |
| ```` ```…[[Team Notes]]…``` ```` | code block, no link | declines (caller's guard) |

Code is the one thing a string cannot know, so it is guarded at the call site by `pmIsCodeAt`, which covers **both** senses: a code *block* (walking ancestors for `spec.code`) and an inline code *span* (the `code` mark at the caret). One helper serves both the input rule and the picker, because two guards that must agree are a defect waiting to happen.

## Proof on disk - `cat`, not the UI's word for it

Typed ` HAND [[Team Notes]] end.` and then ` ALIAS [[Q3 Plan|the plan]] done.`, 25 and 33 keystrokes respectively, into a plain paragraph:

```
# Typing Walk

Start here. HAND [[Team Notes]] end. ALIAS [[Q3 Plan|the plan]] done.
```

Both forms **unescaped and exact**. The plain one rendered as a resolved chip immediately:

```html
<span class="wikilink" data-target="Team Notes" data-alias="" contenteditable="false"
      data-lwd-wl="r" role="link" tabindex="0" title="Open Team Notes">Team Notes</span>
```

Clicking that hand-typed chip opened Team Notes and created **no** file (`ls *.md` unchanged at 7).

![hand-typed](https://raw.githubusercontent.com/tomFelder/abstract-vscode-spike/52-c-wikilinks/docs/plans/52-verify/c-wikilinks/10-hand-typed-plain-and-alias.png)

## The four inert cases, each checked live and on disk

Typed ` [[Team Notes]]` **inside the fenced block**, then `[[Team Notes]]` **inside the inline code span** (caret confirmed in code first - `{"inCode":true}`), then ` OPEN [[ then EMPTY [[]] and SPACES [[   ]] stop.` in a paragraph:

```
Z Code fence below. OPEN \[\[ then EMPTY \[\[\]\] and SPACES \[\[   \]\] stop.

```ts
const a = 1; [[Team Notes]]
```

Inline code: `x[[Team Notes]]` here.
```

Zero chips in the `<pre>`, zero in the `<code>`, zero in the paragraph, and the picker never opened in either code context.

**The escaping on that middle line is correct, not a regression.** Those runs genuinely *are* plain text - `[[` alone, an empty target, a whitespace-only target - and prosemirror-markdown escapes brackets in plain text precisely so the file reparses to the same literal characters. Verified against the real bundle: `\[\[x\]\]` parses back to the text `[[x]]` and re-serialises unchanged. The corruption this round fixes was links the user *meant* as links being escaped; non-links staying literal is the system working.

![inert](https://raw.githubusercontent.com/tomFelder/abstract-vscode-spike/52-c-wikilinks/docs/plans/52-verify/c-wikilinks/11-inert-in-code-and-empty-targets.png)

## Round-trip is byte-stable

Followed the hand-typed chip to Team Notes, came back (forcing a fresh parse from disk), then typed `Z ` in an unrelated paragraph so the autosave rewrote the whole file from the reparsed document:

```diff
5c5
< Code fence below. OPEN \[\[ then EMPTY ...
---
> Z Code fence below. OPEN \[\[ then EMPTY ...
```

**The only difference is my own nudge.** Type -> save -> reparse -> re-save is lossless for both link forms, the fenced block, the inline span and the literal bracket runs.

## Alias authoring - the gap is closed at both ends

The brief asked whether a light affordance fell out of the input-rule work. It did, and it was worth taking: the picker's query now splits at the first `|`, so the **target half** is what gets matched and the **alias half** is carried into the inserted node.

Before, the whole run `Q3 Plan|the plan` was searched as one string, matched nothing, and the picker offered to create a document literally named `Q3 Plan|the plan` - a name no filesystem accepts. Live, typing ` PICK [[Q3 Pl` then `|the summary`:

```json
{"open": true, "items": ["Q3 Plan", "Create \"Q3 Pl\""]}
{"open": true, "items": ["Q3 Plan - shown as \"the summary\"", "Create \"Q3 Pl\" - shown as \"the summary\""]}
```

Enter, then on disk:

```
... PICK [[Q3 Plan|the summary]]
```

So an alias is now authorable **two** ways - typed straight through, or through the picker - and both land unescaped.

![alias picker](https://raw.githubusercontent.com/tomFelder/abstract-vscode-spike/52-c-wikilinks/docs/plans/52-verify/c-wikilinks/12-picker-authors-an-alias.png)

## The duplicated ranking - tracked, and the guard strengthened

`reviewRailView.ts` is still owned by the parallel lane, so `rankWikilinkTargets` remains a verbatim copy of `filterMentions`. Deliberate follow-up work, to be done the moment that lane releases the file.

Meanwhile the differential test was widened where the validator said it was thin. The old version compared four names at the default limit, which by construction can never catch a **cap** divergence. It now sweeps list lengths either side of the cap (0, 1, 7, 8, 9, 30), seven queries, and explicit limits at 0, 1, cap-1, cap, cap+1 and past the end - and separately pins `WIKILINK_PICKER_LIMIT === MENTION_PICKER_LIMIT`, which is the one divergence a same-limit comparison is blind to no matter how many names it uses.

## Honestly not done

- **`arr[[0]]` typed in prose becomes a link to "0".** This is deliberate - it is exactly what the parser does on reload, so the alternative would be text that looks literal until you reopen the file and then turns into a chip. I judged a visible surprise better than an invisible one, but it *is* a surprise, and someone typing array syntax in prose will meet it.
- **The picker's ranking is still substring-only** - `[[wos]]` will not find "Weekly Operating Summary". Inherited from the mention picker, unchanged here.
- **No autocompletion of the closing `]]`**, and no rename-propagation. Unchanged from round 1.
- **I could not measure the suite with port 8090 free.** Both brokers holding it belong to the parallel lane in `52-b-val4` (PIDs 59197 and 65595, verified by their `--repo` paths). I did not kill another lane's processes to make my number prettier; see the counts in the PR comment.
- **A full application restart was not re-driven this round.** The document-switch reparse exercises the same parse-from-disk path and was verified, but the validator's restart check is stronger and I did not repeat it.
