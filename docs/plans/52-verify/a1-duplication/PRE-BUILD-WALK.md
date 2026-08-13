# WP-A1 pre-build walk - 13 Aug 2026

Walked the real desktop app on `main` at `c93c049610b` (OpenRouter door serving) **before** any code was written, per `docs/plans/RUN-cursor-parity-remainder.md` §4.

## Verdict: the duplication is real, and it has a constraint the plan did not know about

### 1. One change, two renderings, two live controls - confirmed

`pre-02-one-change-two-controls.png`. A single pending proposal on `Weekly Operating Summary`:

- **The document** renders the full widget: `MEANING CHANGE · NEEDS YOUR CALL`, a `High` confidence chip, the rationale sentence, `metrics.csv, market-research.md` source chips, the in-place diff (`Growth `~~`remained steady`~~` accelerated sharply this week, `~~`continuing`~~` surpassing the gradual climb `~~`seen`~~` observed since early Q2.`), the `Line 6` address, `+3 added · 3 removed`, and **Edit / Approve changes / Reject**.
- **The chat rail**, simultaneously, renders a card that repeats the whole new sentence verbatim and carries its own **Apply / Reject**.

### 2. The constraint: list-block targets have no inline diff at all

`pre-01-plain-md-list-change-no-inline-diff.png`. A proposal against the bullet list in `Appendix — Design Tokens` mounts **no** widget - the webview contains one `pm-num pending` gutter decoration and no `.d-o` / `.d-n` runs at all. The rail card is then the only legible copy of the change.

Controlled: paragraphs render in **both** a living document (`Weekly Operating Summary`) and a plain markdown document (`Executive Summary`, `d-o: "calm"` → `d-n: "understated"`). It is the block type, not the document type. Filed as #300.

Consequence for this work package: demoting the card must not make a list-targeted change unreadable. The acceptance list on #301 carries that as its own row.

### 3. The Review tab is a separate, deliberate surface

`pre-03-review-tab-full-card.png`. `Review each` switches to the Review tab, which shows the red/green diff, the `Why:` rationale, a risk line and `Approve & apply` / `Reject`. That is a review surface the user asked for, not accidental duplication, and it stays.
