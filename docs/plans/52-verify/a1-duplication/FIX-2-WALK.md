# WP-A1 fix round 2 - the stale report, walked before and after, 13 Aug 2026

Validator 2 refused one acceptance row on `38ed25b4875` - *"nothing becomes unreachable"* - with a repro that strands a reader on a change they cannot see. This is that repro, walked twice on the real desktop app (OpenRouter door serving): once on the **pre-fix** build and once on the **fixed** build, with the same prompts, the same document and the same clicks.

Both runs used a throwaway copy of `living-docs-sample` outside both checkouts, because the walk mutates a file on disk.

## The repro

1. Open `Weekly Operating Summary`, ask chat for a paragraph edit in Commentary. The surface mounts an inline widget and reports it; the transcript pointer routes to `document`.
2. **Close the tab.**
3. **Rewrite that paragraph on disk**, outside Abstract, so the proposal's anchor no longer matches anything.
4. Open a second document (so the transcript is on screen again) and **click the pointer**.

## Before - the reader is stranded

| Step | Observed |
|---|---|
| after the proposal | pointer `EDIT Commentary → Line 6 +3 -3`, tooltip *"Go to this change in the document, where it can be read and approved."* (`document`); document `[data-approve]` = `["fc88a5e3-…"]`, `.editblock` = 1 |
| after closing the tab | pointer **still** reads `document` - the report outlived the surface that made it |
| **first click** | `rail {"cards":0}` (Review never opened, rail stayed on Chat), `doc {"approves":0,"editblocks":0}`. Stable across four samples at +1s, +2s, +3s, +4s |
| second click | `rail {"cards":["Commentary"]}` - Review opens. **It self-heals on the second click, which is exactly why the defect hides.** |

`fix2-01-before-pointer-still-says-document.png`, `fix2-02-before-stranded-nothing-on-screen.png`, `fix2-03-before-second-click-self-heals.png`.

The second screenshot is the whole defect in one frame: the document is scrolled to Commentary, the paragraph reads *"This paragraph was rewritten outside Abstract…"*, there is no widget and no diff on it, and the rail is sitting on **Chat** with nothing revealed. The reader clicked a pointer and landed on nothing.

## After - the first click lands somewhere readable

| Step | Observed |
|---|---|
| after the proposal | pointer `EDIT Commentary → Line 6 +2 -2`, tooltip `document`; `[data-approve]` = `["06ee625a-…"]`, `.editblock` = 1 |
| after closing the tab | pointer reads *"Go to this change - in the document if it previews there, otherwise in Review."* - i.e. **`unknown`**. The memory did not outlive the surface. |
| **first click** | `rail {"cards":["Commentary"]}`, rail switched to **Review**, scrolled to the Commentary card with the full red/green diff, the `Why:`, `High` confidence, `Risk: narrative` and **Approve & apply / Reject**. Stable across four samples at +1s … +4s |

`fix2-04-after-first-click-lands-in-review.png`.

The route flipping from `document` to `unknown` **at the moment the tab closed** is the fix visible from outside: the pointer stopped claiming a destination it could no longer vouch for, and the click then asked the live surface instead of a memory.

## The healthy path, checked for regression

A second proposal was made against `Executive Summary` (a plain paragraph, widget mounts). Clicking its pointer:

- navigates the editor to that document (tab switches when the click comes from another document);
- **flashes the widget** - `.lwd-focus-flash` observed by a 40 ms in-page poller, `maxFlash: 1`;
- leaves the rail on **Chat**, `.ldr-card` count `0` - Review is **not** opened.

`fix2-05-after-healthy-route-unchanged.png` catches it mid-flash. A control (clicking a Review card's diff, a path this fix does not touch) flashes identically, confirming the measurement.

So the 250 ms re-check added to the click costs the healthy path nothing visible: the scroll-and-flash is asked for before the wait begins, and all the wait delays is the decision to *also* open Review - which on a live widget is a decision to do nothing.

## What was NOT walked

- **Two editor groups showing the same document.** Closing one retires the report even though the other is still watching it, so the next click waits for a fresh report (up to 1.5 s) and may open Review as well as flashing the widget. One-sided and self-correcting on the next render, but it is a real behaviour and it was not exercised live.
- **The `&amp;` entity Review card** (validator finding 4). Not walked, and deliberately not fixed - see the PR comment for why it is not an escaping bug.
