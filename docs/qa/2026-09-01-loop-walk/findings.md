# 2026-09-01 loop walk: the opening off-path walk of the editing surfaces

Ticket #376 of plan 56. The brief was to walk the editing surfaces off the happy path and file what breaks, fixing nothing. This is the walk log, the issues it produced, and the list of things that must be pulled into the running wave.

Walked on branch `loop56/376-opening-walk` at fresh `main` (`431c6103683`), against the web build (`./scripts/code-web.sh ./living-docs-sample`, bare URL `http://localhost:8080/`), driven over CDP. Model door: the broker on 8090, `openai-oauth` in dynamic mode, signed in, serving `Sol`.

## What this environment could and could not test

Two facts about the web build shaped the whole walk, and both need saying before the findings are read.

**The broker does not start itself here.** The Electron main process is what supervises the broker (issue #169), so in the web build nothing is listening on 8090 and every model call fails with `ERR_CONNECTION_REFUSED` until `./scripts/lwd-model-broker.sh` is run by hand. That is a dev-harness fact, not a product defect, but it means a fresh web build looks completely dead on the chat surface and no one should read that as a finding.

**Nothing persists to disk.** The sample folder is served in memory by `@vscode/test-web`, which the editor itself flags in the toolbar: `Changes live only in this tab` (`livingDocRender.ts:1728`, whose title attribute reads "Dev harness: this web build keeps your changes in memory only... The desktop app saves to disk"). `git status living-docs-sample/` stayed clean through every approve in this walk. So every finding below about the document is a finding about the in-editor document model, which is where the review surfaces live and is the right place to catch them, but the persist paths themselves were not exercised. **The desktop app needs its own walk for anything that touches the file on disk** - that includes #357 (frontmatter), #366 (atomic saves), and the content-integrity issue this walk filed as #393.

## Walk log

### 1. Chat, about thirteen states

Empty Enter, whitespace-only Enter, and empty send-button click are all refused correctly and add no turn. The send button is not disabled while they are refused, so it reads as live and does nothing (filed in #401).

An ask with no attachments answers correctly. An ask with an attachment works too: clicking the `@metrics.csv` chip and asking for a value from the file produced a `Read metrics.csv` step and the right number, `48600`. The `@` name is then shown twice in the turn, once as the attachment chip and once inside the message text, because clicking the chip both attaches the file and inserts its name into the composer.

Cancel mid-turn works: a `Stop` square replaces send while streaming, clicking it ends the turn cleanly and badges it `STOPPED`. Sending while a previous turn is running is correctly refused, but silently - the text stays in the composer with no acknowledgement (#401).

Reload mid-turn is handled honestly. The interrupted turn comes back annotated `The app closed before the agent replied. Ask again to re-run this.` That notice is then destroyed by the next message and never returns (#397).

The chat log's scrolling is broken in a way that is hard to miss once seen. It pins to the bottom correctly *while* a reply streams, and then snaps to `scrollTop` 0 the instant the turn settles, throwing the reader hundreds of pixels above the answer they just watched arrive. In a conversation taller than the rail, sending a message also jumps to the top and stays there for the whole turn, so pressing Enter looks like it did nothing at all (#391).

The agent's prose is written as plain text, so every markdown mark the model emits is displayed raw. This happens unprompted: asking for a one-sentence summary of `Team Notes.md` returned `The team reviewed the *meaning-change* approval flow this week.`, asterisks and all (#392).

### 2. Change review, about fourteen states

Zero, one and three pending changes; approve from the rail card; approve from the inline document card; reject with a reason; reject cancelled with Escape; deciding the same change twice; deciding it from the other surface.

The safe cases are safe. Rejecting opens a reason box (`Why reject this change? (optional - Enter to reject, Escape to cancel)`) and Escape genuinely cancels. Re-clicking a detached Approve button on an already-decided change is a no-op, and so is reaching for the inline card's button after deciding the same change in the rail. Nothing double-applied anywhere.

The unsafe case is content. Asking for the three bullets under `## This week` to be rewritten and approving all three turns the bulleted list into a single run-on paragraph, sentences colliding mid-line, bullets gone. The same bug in its minimal form destroys a blockquote: `WAS > A blockquote, for good measure.` / `NOW A blockquote, kept for good measure.` and after approve the block is a bare paragraph, while the change's own `Why` line claims it is "preserving the blockquote". Whether the marker survives turns out to be a coin toss between runs, which is the argument that the fix cannot live in the prompt (#393).

While changes are pending, the document lies about its own contents. An inline diff card replaces the block it is anchored to, so three changes on one list block render as one card and the section's other two bullets simply are not on screen. Decide one and the next card mounts over the text just approved, while the bullet that card is *about* is shown a second time, live and unmarked, below it (#394).

The rail's progress line rewinds. With three changes from three separate turns it reads `0 of 3 decided`, then `0 of 2`, then `0 of 1`. `ChangeStore.reviewProgress()` (`changeStore.ts:324`) builds its universe from sets that still hold an open change, so a set whose only change was just decided drops out of both the numerator and the denominator (#396).

And the decision you just made is never acknowledged in the chat. The `APPROVED` receipt appears only for turns restored from the persisted transcript; a turn decided in the current session carries no badge, through re-renders and through further messages, until the app restarts (#400).

### 3. Bulk verbs, about seven states

With zero pending, no bulk verb renders anywhere. Correct - no dead affordance.

With one pending, both verbs appear. `Approve all 1...` confirms with `Approve 1 change? A version snapshot is taken first, so you can restore.`, Cancel genuinely leaves the change pending, and confirming approves it and writes the snapshot. `Reject all...` confirms with `Reject 1 change? The documents are left unchanged.` and clears the queue. **The confirms are now custom in-app dialogs, not native OS dialogs** - #370 appears to have been fixed on this path and is worth a verify-close.

What the sentences say matches what happens. The rough edges are copy and layout only: plural "documents" for one document, an action button reading `Approve All` under a sentence reading `Approve 1 change?`, a generic `Info` dialog title on a verb that writes to the document, and a foot row that collapses into three wrapping columns at the default rail width (all in #401).

### 4. Reload, five states

Reloading with nothing pending, with one change pending, mid-turn, after an approve, and after a restore.

Pending changes are dropped on reload, and the transcript says so accurately: `PAST - Proposed 1 change. It was never approved or rejected, and changes waiting for review are cleared when the workspace closes.` That is the right behaviour and the right sentence.

What is lost is the record of what happened. The agent's step receipts (`Read metrics.csv`, `Proposed edit: This week`) are not persisted with the turn, so after a reload the answer stands alone with no provenance behind it (#398). And the interrupted-turn notice disappears for good once another message follows it (#397).

Tab order scrambles on every reload. Four tabs opened as `Team Notes | Appendix.md | Board Note.md | Weekly Summary.md`, came back as `Team Notes | Weekly Summary.md | Board Note.md | Appendix.md`, and scrambled again on the next two reloads. Inactive tabs also show basenames while the active one shows its title. That is #297, already open.

### 5. Multi-window: not testable here, and saying so plainly

Two browser tabs on the same served workspace are two entirely separate workspaces. Each tab gets its own in-memory file system from `@vscode/test-web`, and the change journal lives under the workspace folder (`changeStoreHomeFor(folder)` in `livingDocsService.ts:1290`), so the two tabs have two unrelated journals.

Confirmed empirically rather than assumed: a change proposed in tab A left tab B reading `No changes waiting.` with no delay and no reconciliation, because tab B never had a way to see it.

**So the web build cannot test #359 or #360 at all.** Concurrent-decision loss has to be walked on the desktop app, two windows on one real folder. Ticket #386 should not be closed on web-build evidence.

### 6. History and the restore promise, five states

The bulk-approve confirm promises "A version snapshot is taken first, so you can restore", and within a session that promise is kept. After an approve, History shows `Current version`, an `Approved - Team Notes / b-3 - model` entry with a `This Was Wrong` button, and a `Before bulk approve - Bulk approve` entry with `Restore`. Restore confirms accurately (`Replaces the current body. Pending changes will be rejected. This is recorded in the audit trail.`), reverts the body, and records a `Restored` entry.

The presentation is broken though. Any row carrying an action button has its label squeezed to about four characters and wrapped one word per line, with `Approved` clipped to `Appro`. Rows without a button render fine in the same list, which makes it unmistakable (#399).

### 7. The loop's own reliability

Worth separating from the surfaces. The natural collective phrasing for a multi-item edit - `Rewrite the three bullets under "This week" so each one names a concrete outcome` - failed to anchor in five of six attempts across the walk, including four consecutive `Retry` presses on the same turn and one attempt on a pristine document straight after a reload. Quoting a single bullet from the same block succeeded first time, every time. The failure card's own reason string also has no plural form, so three misses would read `3 quoted text that is not in the document` (#395).

### Console

No error storm from the living-docs code. The only errors across the whole walk were upstream VS Code web shutdown noise (`Long running operations during shutdown are unsupported in the web`), an IndexedDB-closed log write during teardown, and a 404 on a static asset.

## Issues filed

| # | Title | Gate-blocking |
| --- | --- | --- |
| [#391](https://github.com/tomFelder/abstract-vscode-spike/issues/391) | [chat] The chat log snaps back to the top the instant a turn settles, throwing the reader off the reply they just asked for | Yes |
| [#392](https://github.com/tomFelder/abstract-vscode-spike/issues/392) | [chat] The agent's reply is rendered as plain text, so every model-emitted markdown mark shows as raw syntax | No |
| [#393](https://github.com/tomFelder/abstract-vscode-spike/issues/393) | [editor] Approving changes on a bulleted list collapses the list into one run-on paragraph | Yes |
| [#394](https://github.com/tomFelder/abstract-vscode-spike/issues/394) | [review] The inline diff card masks its whole block, so untouched siblings and already-approved text vanish from the document mid-review | No |
| [#395](https://github.com/tomFelder/abstract-vscode-spike/issues/395) | [loop] An ask that names several items in one block reliably fails to anchor, and Retry does not recover it | Yes |
| [#396](https://github.com/tomFelder/abstract-vscode-spike/issues/396) | [review] The "N of M decided" counter erases every decision when the changes came from separate turns | No |
| [#397](https://github.com/tomFelder/abstract-vscode-spike/issues/397) | [chat] The "app closed before the agent replied" notice is erased by the next turn, leaving a user message with no reply forever | No |
| [#398](https://github.com/tomFelder/abstract-vscode-spike/issues/398) | [chat] The agent's step receipts do not survive a reload - the record of what it read and what it proposed is dropped | No |
| [#399](https://github.com/tomFelder/abstract-vscode-spike/issues/399) | [history] Any History row that carries an action button has its label shredded to one word per line, and "Approved" is clipped to "Appro" | No |
| [#400](https://github.com/tomFelder/abstract-vscode-spike/issues/400) | [chat] A decision made in this session never gets its receipt - the APPROVED/REJECTED line only appears after a restart | No |
| [#401](https://github.com/tomFelder/abstract-vscode-spike/issues/401) | [polish] Six off-path rough edges on the composer and the bulk-verb surfaces | No |

Two comments were added to #393 with further evidence: a minimal blockquote repro, and the observation that marker survival is nondeterministic between runs.

## Known defects reproduced, not re-filed

- **#297** (tab restore fidelity). Reproduced three times. Tab order scrambled on every reload, and inactive tabs showed basenames (`Appendix.md`) while the active tab showed its title (`Team Notes`).
- **#322** (chats with a shared first-message prefix get identical titles). The restored chat strip held three tabs all titled `Tighten the approval-flow b...`.
- **#378** (rename proposal to change). The composer's standing promise still reads `Edits land as proposals you review - nothing applies silently.` Already ticketed in this wave.

Not reproduced, because the surface was not reached or the web build cannot show it: #319, #320, #299, #333, #357, #359, #360, #303.

## Apparently fixed, worth a verify-close

**#370** (bulk approve and delete confirms render as native OS dialogs, inconsistent with the custom chrome and invisible to automation). Both bulk confirms on this walk were custom in-app modal dialogs, fully visible to the accessibility tree and driveable over CDP. Worth folding into the verify-close ticket #379 rather than closing on this evidence alone, since only the two bulk-verb confirms were exercised, not the delete confirm.

## Gate-blocking

Three findings should be pulled into the running wave. Each of them sits on the flagship journey, a stranger's first agentic edit on a real folder.

1. **#393 - approving a change destroys the block's structure.** "Ask for a rewrite, approve it" is the one motion the product is built on. On a bulleted list it merges the items into an unreadable run-on paragraph; on a blockquote it strips the quote. It is content destruction on the happy path, and today whether it happens depends on whether the model echoed two characters back. This is the most serious thing the walk found.

2. **#395 - the natural way to ask for a multi-item edit does not work.** Five failures in six attempts on the archetypal phrasing, with a Retry that repeated the failure four times running. A stranger's first ask has a good chance of ending in an amber error card with no working recovery.

3. **#391 - the chat log throws the reader off the reply.** The answer scrolls out of sight the instant it finishes, and once the conversation is taller than the rail, pressing Enter appears to do nothing. This is the first screen a stranger sees and its most basic behaviour is wrong.

Also to schedule, though not gate-blocking: **#392** (raw markdown in the agent's prose) is the loudest quality tell on that same first screen, and it argues directly against the "documents, not markup" positioning.

## Follow-up walks this one could not do

- **Desktop, two windows, one real folder** - the only way to test #359/#360 and to close #386 honestly.
- **Desktop, persisted markdown** - the only way to confirm what #393 writes to disk, and to exercise #357 and #366.

## Screenshots

| File | What it shows |
| --- | --- |
| `01-chat-scroll-snaps-to-top-on-settle.png` | The settled state of #391: the reply is 843px below the fold and the log is showing the top of the conversation. |
| `02-chat-reply-raw-markdown.png` | #392: `**Living** documents stay *current*.` with a raw dash list and backticks. |
| `03-two-bullets-vanish-while-changes-pending.png` | #394: one inline card between "This week" and "Snippets", beside a rail listing three changes. |
| `04-list-collapsed-to-runon-paragraph.png` | #393: the three-item list after approving all three changes, now one paragraph. |
| `05-blockquote-lost-on-approve.png` | #393's minimal case: block 8 after approve, no blockquote rule. |
| `06-decided-counter-rewinds.png` | #396 and #401 item 6: `0 of 1 decided` with two already decided, and the three-column foot squeeze. |
| `07-history-rows-shredded.png` | #399: a shredded row with a button and a correct row without one, in the same list. |
