# WP-G + A2 + A3 implementer's walk - 14 Aug 2026

The real desktop app (`launch.sh --repo /Users/tommy/Sites/abstract-wt/52-g`), driven by CDP against a throwaway workspace at `/tmp/wp-g-ws` - a copy of `living-docs-sample` plus one fixture of my own (`No Headings.md`). The repo's sample was not touched. This is the implementer's walk; the independent validator's walk is the one that ticks boxes.

Machine for every timing below: Apple M4 Pro, 48 GB, macOS 26.6.2, Electron dev build from `out/` (not a packaged release).

## G1 - the outline verdict

**The founder's complaint reproduces, on one path the pre-build walk did not take: the Outline does not follow the words as you write them.**

### What was wrong

Open a document, click Outline, rename a heading. The heading changes on the page and on disk; the Outline keeps the old name. Write a new section and it never appears. Reopening the document was the only cure, which is exactly what "the outline doesn't load" feels like from the writing seat - you look at the rail for the section you just wrote and it is not there.

Recorded live, before the fix, with the Outline tab open the whole time and no tab switch:

```
document on disk : ## What to watch CLOSELY      <- typed a moment earlier
Outline rail     : "What to watch"               <- the name it had when the tab was activated
```

Switching away and back repaired it, which is the tell: the rail was correct at `setInput` and never heard anything afterwards.

### Why

Live typing persists through `saveRawText(..., { silent: true })`. That path re-parses the document and updates `_docs`, so `getDoc()` was always correct - but it deliberately does **not** fire `onDidChange`, because that event re-renders the document webview and remounting ProseMirror mid-keystroke would take the caret with it. Every other surface that reads the parsed document redraws on that same event, so suppressing it for the editor's sake silently froze the Outline too. A view lying about a model that was right all along.

### The fix

A narrow second event, `ILivingDocsService.onDidChangeDocumentBody`, fired **only** from the silent branch and carrying the docId. The tree rail subscribes; the editor pane deliberately does not, which is what keeps the caret where the silent save was invented to keep it. The rail redraw is scoped to the Outline tab and the active document, and coalesced through a 200ms `RunOnceScheduler` so a burst of keystrokes costs one render.

`g1-outline-follows-typing.png` - "Usage notes and pitfalls" appears in the rail as it is typed, caret still in the heading, document still saving.

### Every path tried

| Path | Result |
| --- | --- |
| Open a document, click Outline | loads |
| Preview tab (single click from the tree, #296) | loads |
| Pinned tab (double click) | loads |
| Document with no headings | honest "This document has no headings yet." |
| Rapid document switching (5 tabs, no waits between) | loads, and names the right document |
| Outline left open across a document switch | follows the switch |
| Restored **active** tab after a relaunch (`--full --source-user-data-dir`) | loads |
| Restored **inactive** tab, then activated (#297) | loads |
| Split group, switching by clicking a tab | follows |
| **Headings changed since the document opened (live typing)** | **did not update - the defect, now fixed** |
| Split group, clicking **into** the other group's document surface | Outline keeps showing the previously active document - a second, separate condition, see below |

`g1-restored-tabs.png`, `g1-split-group.png`.

### A second condition found, deliberately not fixed here

In a split, clicking **inside** the other group's document does not make that group active (`activeGroups: [false, true]` stayed put), so the Outline - and every other rail that tracks "the active document" - keeps showing the group you left. Clicking that group's **tab** activates it and the Outline follows correctly, so the affordance most people use is sound.

Left alone on purpose: the cause is group activation on webview focus, not the Outline. A fix there changes which document the Context, History and Review rails answer for as well, and the document surface fires focus on every remount, so it needs its own change and its own walk rather than a rider on a package about small truths.

## G2 - History says what it records

Both states now carry the same sentence, so the promise does not change shape once the timeline fills up:

> Recorded here: changes you approve or reject, and versions you save with Save version. Your own typing is not recorded - it is saved to the document, but it never becomes a version on its own.

The empty state's first line is now just "No versions yet." with the sentence beneath it; the populated state carries the sentence under the header, above the timeline. `g2-history-empty.png`, `g2-history-populated.png`.

The old line - "No versions yet - changes you approve will appear here." - was true and incomplete. It named one input and stayed silent on the one a writer most needs answered, and the only way to discover the answer was to lose something.

### Recommendation: should manual-edit snapshots join History?

**No - not as an automatic per-edit record. Yes to making the existing manual pin easier to reach.**

The case for logging typing is real: the asymmetry is odd, and a writer who spends an hour rewriting a section has no way back to what they had. But an automatic keystroke-versioned History would break the three things this tab is actually for.

1. **It would drown the signal.** History exists to answer "what did the agent change, and did I agree?". That is a handful of rows a week. Typing produces a save every few hundred milliseconds; even coalesced to a row a minute, a morning's writing buries every approval under sixty rows of "you typed". The reviewable trail is the product's trust wedge, and its value is that it is short enough to read.
2. **The rows would not be answerable.** Every other row in this timeline is a decision with a counterpart - Approved/Rejected, and a Restore or a "This Was Wrong" beside it. "You typed" has no decision in it and nothing to disagree with, so it would be the only row in the tab that is merely noise about yourself.
3. **The real need is undo, and undo already exists.** "Get me back to what I had" during a writing session is served by the editor's own undo stack, which is finer-grained and closer to hand than any timeline row.

What is genuinely missing is not a log but a **cheap, well-placed pin**. `Save version` already does exactly the right thing and is already offered for every open document, living or plain - it is just quiet and unexplained. So the recommendation is:

- Keep History a record of **reviewed change and deliberate versions**. Do not auto-log typing.
- Make `Save version` legible and reachable: it now gets named in the scope sentence, which is a start; a keyboard chord and a prompt at natural boundaries (before a bulk approve, before an export) would finish it.
- If a safety net for long unpinned sessions is wanted later, the right shape is an **automatic snapshot at a boundary** (first edit after an approve; before an export), recorded as a version with a `via` that says what caused it - one row with a reason, not a keystroke log.

## A3 - measured approval latency

**Nothing needs improving. The numbers say so.**

**What was timed:** inside the document webview, from the user's gesture (`mousedown` on the inline widget's Approve, or the `keydown` of a chord) to the moment that change's inline widget is gone from the ProseMirror surface - a `MutationObserver` on the surface, both timestamps from the same `performance.now()` clock, so there is no cross-frame skew. That is the user-perceptible end of an approve: the proposal UI has retired and the approved words are in the document.

**What it excludes:** the model round trip before the change exists (10-20s, network-bound and not what "approval latency" means), and the async disk write and rail re-render that follow the surface update.

**Samples** (11 in total, real proposals from real round trips):

| Path | n | min | median | max |
| --- | --- | --- | --- | --- |
| Click "Approve changes" on the inline widget | 3 | 28 ms | 30 ms | 32 ms |
| Chord `Cmd+Enter` (accept) | 6 | 15 ms | 17.5 ms | 32 ms |
| Chord `Cmd+Backspace` (reject) | 1 | 17 ms | 17 ms | 17 ms |
| `Cmd+Shift+Enter` accept-all of 2 changes, timed from the confirm click | 1 | 126 ms | 126 ms | 126 ms |

Every single-change path lands inside 32 ms - under two frames at 60Hz, which is below the threshold at which a person perceives delay at all. The chord is consistently a little faster than the click, which is what you would expect: it skips hit-testing and the button's own event plumbing. The bulk path costs ~126 ms for two changes because it re-serialises the document and takes a version snapshot first; still well under the ~100-200 ms band where an interaction starts to feel like it has a cost, and it is the one path that already asks a question first.

**Conclusion: no optimisation is warranted.** There was no "before and after" to report because there was nothing worth changing - the measurement is the deliverable, and it says the approve path is not where the time goes. The time in this loop is entirely the model round trip.

## A2 - approval chords

| Action | Chord | Command |
| --- | --- | --- |
| Approve the next pending change | `Cmd+Enter` | `livingDocs.review.approveChange` |
| Reject the next pending change | `Cmd+Backspace` | `livingDocs.review.rejectChange` |
| Approve all changes in this document | `Cmd+Shift+Enter` | `livingDocs.review.approveAllChanges` |

All three registered **additively at weight 1000** - the `Cmd+T` precedent (#293) - with no core patch. Which change a single-change chord acts on is the first still pending for the document, in the order every surface already draws them (`chordTargetChange`, unit-tested): pressing accept twice accepts the top two, so the reader never has to guess which of five proposals the key hit.

### The collision check

Every one of these keys is spoken for somewhere in the stock IDE, so rather than take them outright the chords are **gated**: `abstractHasPendingChanges && !inputFocus && !listFocus`. While the active document has nothing waiting on you the key is not ours at all and the stock command resolves exactly as before - which is also what makes "a chord with nothing pending" harmless by construction rather than by an early return.

| Chord | Stock binding | Why it does not collide |
| --- | --- | --- |
| `Cmd+Enter` | `editor.action.insertLineAfter`, when `editorTextFocus` | excluded by `!inputFocus` |
| | chat / terminal-chat / notebook / merge-editor / markers / comments / search-editor entries | all inside containers this shell deregisters |
| `Cmd+Backspace` | `deleteAllLeft`, when `textInputFocus` | excluded by `!inputFocus` |
| | `moveFileToTrash`, when `filesExplorerFocus` | the stock Explorer is deregistered here, and the tree rail never sets that key (grep: no hits under `livingDocs/`) |
| | terminal / debug / notifications / tunnels / preferences | unreachable surfaces in this shell |
| `Cmd+Shift+Enter` | `editor.action.insertLineBefore`, when `editorTextFocus` | excluded by `!inputFocus` |
| | **`list.toggleSelection`, when `listFocus`** | **genuinely reachable** - the Files tab is a workbench list. Weight 1000 would have beaten it, so we stand down instead: `!listFocus` leaves the tree its own key. Applied to all three chords so the rule is one sentence - these are the writing surface's chords - rather than a special case. |

`!inputFocus` is what makes the document surface work while the composer does not: `inputFocus` is bound from `isEditableElement(activeElement)`, and with the ProseMirror webview focused the active element is the `<iframe>`, which is not editable. Keys pressed inside the webview still reach the keybinding service because `WebviewElement.handleKeyEvent` re-dispatches them onto the host window as emulated keyboard events.

### Walked, including every off-path case

- **Document focused, change pending.** All three fire. `Cmd+Enter` accepted (15-32 ms), `Cmd+Backspace` rejected (17 ms) and left the surrounding text untouched, `Cmd+Shift+Enter` opened the confirm.
- **Accept-all with a meaning change pending - the confirm fires.** `Approve 2 changes including 2 meaning changes? A version snapshot is taken first, so you can restore.` `a2-acceptall-confirm.png`. It routes through the same `bulkApproveConfirm` the rail's button uses; a chord is easier to press than a button is to click, so the net is not skipped on the excuse that the user asked for speed.
- **Nothing pending.** All three pressed with the caret in a plain paragraph, and again with the caret inside the metrics table: the file is byte-identical afterwards in both cases. The key falls through to the stock behaviour, which is the point.
- **Focus in the chat composer.** All three pressed with a pending change: nothing was approved or rejected.
- **Focus in the tree.** All three pressed with a pending change: nothing approved, nothing rejected, and all 12 workspace files still present afterwards (no `moveFileToTrash`).
- **During a streaming reply.** All three pressed while a reply was in flight: no dialog, no document mutation, and the reply completed normally and produced its change.

## Environment notes for whoever walks this next

- The confirm dialog is a **native** modal by default, invisible to CDP - `document.querySelector('.monaco-dialog-box')` finds nothing and the page screenshot shows no dialog, but `modal-dialog-visible` appears on the workbench root. Set `"window.dialogStyle": "custom"` in the run profile's `settings.json` to make it DOM-driveable. The document context menu is native for the same reason; `"window.menuStyle": "custom"` fixes that one.
- `location.reload()` on the workbench page does not reliably reload the dev build. Relaunch instead, and `npm run compile` first.
- The included model (OpenRouter) failed roughly one call in two or three during this session with `fetch failed` / http 502. It is upstream flakiness, not the app - the app reports it honestly as "The model call failed." with a Retry.
