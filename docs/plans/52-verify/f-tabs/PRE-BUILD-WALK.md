# WP-F pre-build walk - 12 Aug 2026

Walked the real desktop app (`launch.sh -- living-docs-sample`, CDP-driven) **before** any code was written, per `docs/plans/RUN-cursor-parity-remainder.md` §4. Plan 52's declared centrepiece turned out to be already built, so every remaining row is treated as possibly-already-done until seen.

**Verdict: WP-F is genuinely missing. Both halves.**

| Probe | Observed | Expected (VS Code) |
|---|---|---|
| Single-click `Board Note`, then single-click `Executive Summary` in the Files tree | Three permanent tabs accumulate; `getComputedStyle(tab).fontStyle === 'normal'` on all three | One italic preview tab, reused by the second click |
| Right-click the `Board Note` tab | Nothing - `.context-view` stays empty | Document context menu + Close / Close Others |
| Right-click a tree row (control) | Menu renders: Open, Open to the Right, Rename…, Duplicate, Move to…, Bind Sources…, View History, Present, Delete… | - (this is the menu WP-F reuses) |

Screenshots: `pre-01-editor-one-tab.png` (one tab after opening the Editor), `pre-02-three-permanent-tabs.png` (three permanent tabs after two single-clicks), `pre-03-tab-rightclick-no-menu.png` (right-click on a tab, no menu).

`abstractTabStrip.ts` confirms the gap in code: `_renderTab` wires `MOUSE_DOWN` only, branching on middle-click and left-click, and `ITabModel` has no preview/pinned notion.
