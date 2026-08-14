# WP-B residuals pre-build walk - 13 Aug 2026

Walked the real desktop app on `main` at `66fb4c15543` before writing anything, per `docs/plans/RUN-cursor-parity-remainder.md` §4. **All three residuals from #293 are real and reproduce.** They are the honest "Honestly not done" list that PR carried, now confirmed live rather than inherited.

## (a) Message bodies are not persisted - only tab metadata

1. Chat 1: asked *"List the three headings in this document, nothing else."* The model answered with all three headings; the transcript rendered.
2. `Cmd+T` → chat 2: asked *"Summarise this document in one sentence."* Answered.
3. `Cmd+T` → chat 3 (`New chat`, empty).
4. Killed the app and relaunched with the profile **reseeded** - `launch.sh --full --source-user-data-dir <previous run's user-data>` - because the slim clone excludes `User/workspaceStorage/`, which is exactly where `StorageScope.WORKSPACE` lives.

**Result:** all three tabs came back with their titles intact - `List the three headings in…`, `Summarise this document in…`, `New chat` - and **every transcript was gone**. Opening the first tab, which had a real question and a real answer before the relaunch, shows only the empty-state placeholder: *"Ask the agent about this document, or @mention a source to pull it in."*

`pre-02-tabs-restored-transcripts-lost.png`. The strip is restored, the conversation is not.

## (b) The many-tab state squeezes a tab to one character

`pre-01-third-tab-squeezed.png`. At three tabs in the default rail width the third collapses to `N…`. Nothing clips or overflows the panel, so this is a design problem rather than a layout bug - but a tab whose label is one letter and an ellipsis cannot be chosen deliberately.

The empty state is untested here because a single chat is not shown as a strip at all.

## (c) `getChatSessionsMentioning` has no caller

```
$ grep -rn "getChatSessionsMentioning" src
src/vs/workbench/contrib/livingDocs/browser/livingDocsService.ts:5397:	getChatSessionsMentioning(resource: URI): readonly IChatSession[] {
src/vs/workbench/contrib/livingDocs/common/livingDocs.ts:1413:	getChatSessionsMentioning(resource: URI): readonly IChatSession[];
```

The declaration and the implementation, and nothing else. It is the API that was meant to keep the old per-document thread history reachable once chat moved to the workspace, and no surface calls it.
