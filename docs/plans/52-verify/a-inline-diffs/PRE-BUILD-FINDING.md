# WP-A pre-build finding: the centrepiece is already built (12 Aug 2026)

Plan 52 calls WP-A "the centrepiece" and a "render-layer rebuild", and §7 says *"WP-A is the wave: if anything must give, everything else gives first."* Before building, the live walk was run on `main`. **Most of WP-A already ships.** The plan was authored 3 Aug against a mental model that the editor-v2 wave (plans 43-49, merged 21-23 Jul) and the audit-fix wave (plan 50, merged to 4 Aug) had already overtaken.

## The walk

Launched on `main`, sample workspace, **OpenRouter door forced** (plan 52 §5). Opened *Weekly Operating Summary*, and asked in the rail composer:

> "In the Commentary section, change the sentence about growth to say growth accelerated sharply rather than remained steady."

Broker log: `/v1/messages backend=openrouter requested="gpt-5.6-sol" resolved=openai/gpt-4.1-mini`.

`current-state-inline-diff.png` is the result, unretouched.

## What WP-A asks for vs what already exists

| WP-A requirement | State |
|---|---|
| Pending proposals render **inside the ProseMirror editor** as diff blocks | **Exists.** The bundle's `setDecorations` hides the original block and mounts a host-rendered widget in its place (`lwdpm-entry.js` §"Decorations"). |
| Removed text **struck in red**, added text **in green**, in place | **Exists.** `.d-o` is `#CF5A53` + `line-through`; `.d-n` is `#2C8159` (`livingDocRender.ts:196-197`). Live: "Growth ~~remained steady~~ **accelerated sharply** this week, ~~continuing~~ **building on** the gradual climb". |
| Per-change accept/reject controls on the block | **Exists.** `Edit` / `Approve changes` / `Reject` on the widget (`pmEditWidgetHtml`). |
| An accept-all / reject-all bar when more than one is pending | **Exists.** The editor shows a sticky `1 change here` counter + `Approve all in this doc`. |
| Service mechanics reused unchanged | **Already true** - the widget posts to the existing `approve` / `reject` / `approveAllDoc` path. |
| **The chat cards demote to compact pointers that scroll to their change** | **NOT done.** The rail still renders a full card that repeats the proposed prose verbatim *and* carries its own `Apply` / `Reject` buttons - the same change, twice on screen, with two competing controls. |
| Keyboard chords for accept / reject / accept-all | **Not present** (no chord found; not implemented). |
| Approval-latency pass with measured numbers | **Not measured.** |

Beyond the table, the widget already carries more than WP-A asked for: a kind tag (`MEANING CHANGE · NEEDS YOUR CALL`), a truthful confidence chip (`High`), the model's rationale sentence, source chips (`metrics.csv, market-research.md`), the gutter address (`Line 6`), an `+2 added · 2 removed` count, and amend-before-approve (`Edit`).

## Honest re-scope

WP-A is **not** a rebuild. It is three gaps:

- **A1 - the duplication.** Demote the rail card to a compact pointer that scrolls to the change. This is the one that matters: two live controls for one change is exactly the "doesn't feel trustworthy" complaint that motivated the wave.
- **A2 - keyboard chords**, picked against VS Code collisions.
- **A3 - the latency pass**, with before/after numbers.

The wave's priority order (`A > B > C > D > E > F > G`) was set on the assumption that A was the expensive one. It isn't. **B (workspace chat tabs), D (files rail as a pure tree) and F (VS Code-style preview tabs) are now the largest genuinely-unbuilt items**, and the founder's "should feel like Cursor" verdict likely rests more on those than on A.

## Also visible in the screenshot

- The honest door messaging from plan 51 WP-D works: *"Signed in to ChatGPT, but the included model is serving · Details"*.
- The composer's model chip reads **Sol** - the model no ChatGPT account may call. On `main` that selection is un-servable; PR #288 is what makes the catalogue tell the truth about it.

## Recommendation

Do not run WP-A as written. Re-cut it to A1/A2/A3, re-run the priority call across the remaining packages with B/D/F as the real centre of the wave, and treat this document as the reason.
