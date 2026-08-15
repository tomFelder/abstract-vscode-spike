# WP-G + A2 + A3 pre-build walk - 14 Aug 2026

Walked the real desktop app on `main` at `2c878908250` before writing anything, per `docs/plans/RUN-cursor-parity-remainder.md` §4.

## G1 - "the outline doesn't load" does NOT reproduce on the obvious path

`pre-01-outline-does-load.png`. Opened `Appendix — Design Tokens`, clicked the **Outline** tab: it renders the document's headings immediately - `Appendix — Design Tokens`, `Colour tokens`, `Usage notes`.

So the founder's complaint is **conditional on something this walk did not do**. That makes G1 a hunt, not a fix: the package's job is to find the condition or record a defensible non-repro. Candidates worth trying, since each changed recently in this wave: a **restored** tab after a relaunch (restored inactive tabs are known not to have had a `setInput`, #297); a **preview** tab (single-click, #296); a document with no headings; switching documents rapidly; the Outline tab left open across a document switch; a document whose headings changed since it was opened; and the split-group case.

## G2 - History's empty state is partly honest, and silent on the important half

`pre-02-history-empty-state.png`. The tab reads:

```
VERSION HISTORY · APPENDIX — DESIGN TOKENS
✎ Save version
No versions yet - changes you approve will appear here.
```

"changes you approve" is true as far as it goes. What it does not say is what plan 52 §2 row G asks it to say: that **your own typing is not logged**. A user reading this has no way to know whether their manual edits are being recorded, and the honest answer today is that they are not.

## A3 - latency has never been measured

No before/after numbers exist for the approve path anywhere in the wave's record. The plan asks for measured numbers, not an impression.

## A2 - no chords exist

No keyboard chord for accept, reject or accept-all. The wave's precedent for taking a chord is additive registration at weight 1000 (`Cmd+T` for a new chat, #293; `Cmd+F` is being taken the same way in WP-E), so the mechanism is settled - the choice of chords, and checking them against VS Code collisions, is the work.
