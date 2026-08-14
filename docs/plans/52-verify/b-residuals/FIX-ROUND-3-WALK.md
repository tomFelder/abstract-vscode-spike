# Fix round 3 - the close guard, walked from every route

Issue #312, PR #313. The validator would ship everything in this package except one thing: closing a chat destroyed the conversation instantly, from disk, with no question and no undo - and fix round 2 is what made that reachable for the sole chat.

Real desktop app, real model (the included door), own broker on **:8091** so the parallel lane's broker on :8090 was never touched. Fixture: a throwaway copy of `living-docs-sample` at `/tmp/52b-r3-fixture`. Dialogs driven with `"window.dialogStyle": "custom"` so the confirm is real DOM rather than an OS sheet CDP cannot see.

## The repro, rebuilt exactly

A sole chat holding four messages - two questions, two answers, the last of them a real proposal **approved through Review -> "Approve & apply"**. Read straight out of `state.vscdb` before touching anything:

```
role=user                                      "Which sections does this document have?"
role=assistant via=model                       "The document has the following sections: ..."
role=user                                      "In the Commentary section, change the sentence ..."
role=assistant via=model proposed=1 approved=1 "Updated the Commentary section to reflect the ..."
```

The tab carries no `×` and there is no overflow chip, so the only route is gear -> Advanced (VS Code) -> Command Palette -> **Close Chat**. Before this round that closed it on the spot, leaving `transcripts []`.

## Every route, walked

| route | what it asked | outcome |
| --- | --- | --- |
| **palette**, sole chat with 4 messages | *Close the chat "Which sections does this do…"? This is your only chat, so an empty one opens in its place. Its 4 messages are deleted from this workspace and cannot be brought back.* | Cancel -> `state.vscdb` still holds all 4 messages incl. the `approved=1` record |
| **overflow submenu**, a chat I was NOT in | named **that** chat, not the one on screen: *Close the chat "Which sections does this do…"? Its 4 messages ...* while the rail showed "What does the Wha…" | Cancel -> all 3 chats, 8 messages, still on disk |
| **tab ×**, a chat with 2 messages | *Close the chat "What does the What to watch…"? Its 2 messages ...* | confirmed -> closed, and only that one |
| **picker submenu** at a **157px** rail (no `×` anywhere on screen) | *Close the chat "How many rows does the Numb…"? Its 2 messages ...* | Cancel -> both chats intact |
| **tab ×** on an EMPTY "New chat" | **nothing at all** - no dialog | closed on the click |

Confirming really does close: the submenu confirm took the sessions list from three titles to two and removed that chat from `livingDocs.chatTranscripts` as well, leaving the active chat where it was. And the sole-chat sentence is true rather than reassuring - after confirming it, storage read `sessions ["New chat"]`, `transcripts []`.

## The palette claim, made true rather than corrected

The validator found the stock palette answered "No matching commands" for `>Close Chat` **and for the shipped `>New Chat`**. The cause was ours: this shell curates the palette by keeping `Abstract`-categorised commands and demoting everything else behind the "All Commands..." wall, and these two chat commands were the only fork commands registered with **no category at all**. The wall built for stock IDE noise was hiding our own commands.

With the category added, the curated palette returns `Abstract: Close Chat` and `Abstract: New Chat ⌘T`. Note `Cmd+Shift+P` is removed at the core seam in this fork, so the palette itself is opened from gear -> Advanced (VS Code) -> Command Palette.

## Numbers

| Command | Result |
| --- | --- |
| `./scripts/test.sh --grep "livingDoc"` | **431 passing, 0 failing** (port 8090 free; branch was 429, `main` 414) |
| `npm run typecheck-client` | exit 0 |
| `npm run valid-layers-check` | exit 0 |
| `git diff --name-only origin/main` outside `livingDocs/` + `docs/` | empty |

An earlier run of the same suite on the same code gave **411 passing / 20 failing**, every failure carrying real model prose in its diff - the documented #318 leak, with :8090 held by another worktree's broker at the time. The 431/0 above was measured after that port was free.
