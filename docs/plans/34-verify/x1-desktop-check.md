# X1 desktop check - does the "approved work lost on reload" finding reproduce in the desktop app?

**Verdict: X1 does NOT reproduce on the desktop app. It is a web-build File System Access artefact, not a product bug.**

On the desktop build, an approved chat edit lands on disk in the `.md` file and survives a full quit + relaunch.
The web build's data loss comes from its in-memory / File System Access file provider, not from the approve/persist code path (which is shared by both builds).

## What was tested

- Date: 2026-07-10, macOS (darwin 25.6.0), Apple Silicon.
- Build: the current compiled `out/` on branch `34-journey-walk` (the same build the web re-verify ran against).
- App: Code OSS launched from sources via the repo `launch` skill into an isolated throwaway profile with debug ports (each launch gets a fresh `--user-data-dir`, so nothing carries over between launches except what is on disk).
- Folder: a pristine copy of the sample at `/tmp/x1-desktop-sample` (via `cp -r`), so the shipped `living-docs-sample/` stayed untouched (confirmed byte-check at the end).
- Model: the same live proxy on `127.0.0.1:8090` the web walk used (`anthropic/claude-sonnet-4.6` via OpenRouter). The desktop workbench reaches it through the same default `http://localhost:8090` the web build uses (`livingDocsService.ts:134`).
- Driven with `@playwright/cli` over CDP.

## The exact repro (matches the 1e / 1h repro in journey-grades.md)

1. Opened `/tmp/x1-desktop-sample` in the desktop app, opened **Board Note** (paragraph read the original "Momentum is steady; we continue to track plan with no surprises this week.").
2. Review rail -> Chat -> sent "Tighten the Note to the board paragraph to be more concise, keep the meaning."
3. A live model call produced a real proposal (MEANING CHANGE - NEEDS YOUR CALL - High, red/green diff in place, "+2 added / -2 removed / 85% confidence", rail mirror "1 change waiting on you"). New text: "On plan, no surprises."
4. Approved the proposal from the card. The editor paragraph updated to "On plan, no surprises." and the chip stayed "Saved".
5. **Checked the `.md` file on disk with `cat` (step a).**
6. **Fully quit the app, relaunched into a fresh throwaway profile, reopened Board Note (step b).**

## Disk-file evidence (the load-bearing result)

### (a) After approve, before any reload - the approved text landed on disk

`cat "/tmp/x1-desktop-sample/Board Note.md"` (relevant section):

```
## Note to the board

On plan, no surprises.
```

- `grep "On plan, no surprises"` -> **present** (approved text on disk).
- `grep "Momentum is steady"` -> **gone** (original text replaced).

The lock sidecar was written too - `Board Note.lock.json` `audit[]` gained a real entry:

```json
{
 "time": "2026-07-09T22:35:49.359Z",
 "docTitle": "Board Note",
 "blockId": "b-3",
 "action": "approved",
 "oldText": "Momentum is steady; we continue to track plan with no surprises this week.",
 "newText": "On plan, no surprises.",
 "via": "model"
}
```

This is the exact opposite of the web build, where journey-grades.md records that after approve `living-docs-sample/Board Note.md` on disk was **unchanged**.

### (b) After a full quit + relaunch into a fresh profile - the approved text survived

Reopened Board Note in the relaunched app: the paragraph still read "On plan, no surprises." (screenshot `x1-desktop-08-after-relaunch.png`). Because the relaunch used a brand-new throwaway `--user-data-dir` with no carried-over workspace storage, the only possible source for that text is the on-disk file. Confirmed the file still held the approved text after the quit.

## Why the web build loses it and the desktop build does not

The approve path is `LivingDocsService._persist()` (`src/vs/workbench/contrib/livingDocs/browser/livingDocsService.ts:3105`):

```ts
private async _persist(state: IDocState): Promise<void> {
    const serialized = serializeLivingDoc(state.doc);
    state.rawText = serialized;
    await this._files.writeFile(state.uri, VSBuffer.fromString(serialized));
    await this._lockStore.write(state.uri, state.lock);
}
```

The code is identical for both builds - it writes through `IFileService.writeFile(state.uri, ...)`. What differs is the **FileSystemProvider** behind `state.uri`:

- **Desktop:** `state.uri` is a real `file://` URI backed by the local disk provider, so the write lands on disk. Confirmed above.
- **Web (`code-web.sh`):** the mount is served through a File System Access / in-memory provider; the write is in-memory only, so it evaporates on reload. That is the web-build limitation journey-grades.md flagged (see "Environment limits honestly noted"), now confirmed as the cause.

So X1 is a **web-build File System Access artefact**, not a product defect in the approve/persist logic.

## One surprising secondary observation (not X1, and not a data-loss bug)

The **document body and the lock audit persist to disk correctly**, but the **History tab timeline does not rehydrate** from the persisted lock audit on a cold reopen. After the relaunch, with the audit entry sitting in `Board Note.lock.json` on disk, the History panel rendered empty (screenshots `x1-desktop-09` / `x1-desktop-10`; DOM eval confirmed no timeline rows, only the "Chat / Review / History" tab labels). The approved work itself is safe on disk - this is a UI-rehydration gap in the History view (it appears to build the timeline only from the in-session lock after an approve happens that session, not from the persisted `audit[]` on a fresh open), not lost work. Worth a follow-up so the History timeline reads the on-disk audit on open, but it is a display bug, not a persistence bug, and it does not change the X1 verdict.

## Cleanup

- Desktop app fully quit; both throwaway profiles removed.
- `/tmp/x1-desktop-sample` deleted.
- The shipped `living-docs-sample/Board Note.md` verified pristine ("Momentum is steady..." intact).
- The running gulp watch, the web server on :8080, and the proxy on :8090 were left untouched.

## Bottom line

- **X1 reproduces on desktop: no.** Approved edits write to the `.md` file on disk and survive a full quit + relaunch.
- The web build's "lost on reload" behaviour is a File System Access provider limitation, on a persist path that is otherwise correct.
- Follow-up (separate, non-blocking): History timeline does not rebuild from the on-disk lock audit on a cold reopen - a display-rehydration gap, not data loss.
