# Plan 49-a validate round 2 (focused, K2.2 / D1)

Focused adversarial validation of the K2.2 fix on bundle 49-a (#239, PR #240). K2.2 was the only open box after round 1; the other 12 were validator-ticked. This is an independent live re-measurement, not a re-run of the fix agent's own probe.

## Live measurement (read straight off the rendered DOM)

Environment: `transpile-client`, then `TMPDIR=/tmp ./scripts/code-web.sh ./living-docs-sample --port 8083`, bare URL, Knowledge screen (Project scope). Glyph text was pulled from the SOURCE-cell span in the DOM and each codepoint decoded, so the evidence is the actual rendered character, not a screenshot guess.

| Source | Glyph (rendered) | Codepoint | KIND word | Glyph colour |
| --- | --- | --- | --- | --- |
| metrics.csv | `⊞` | U+229E (`&#8862;`) | Table | rgb(91,109,196) = #5B6DC4 (accent, value-feeding) |
| market-research.md | `◇` | U+25C7 (`&#9671;`) | Reference | rgb(163,168,178) = #A3A8B2 (quiet, context-only) |

Both rows pair the correct glyph to the correct word. The D1 symptom (the `⊞` table glyph preceding the "Reference" word) is absent. This matches the design mock in `docs/design/abstract-editor-v2/Abstract Editor v2.dc.html`: line 671 (`⊞` / Table) and line 692 (`◇` #A3A8B2 / Reference).

market-research.md is context-only in the sample data (it sits under the `"context"` block of `Board Note.lock.json`), so the fix's `kindCategory` classifies it Reference and draws `◇` quiet - correct.

## Screenshot-integrity audit

The fix agent's committed round-2 captures (`../round2/knowledge-full.png`, `../round2/knowledge-kind-cells.png`) were audited against this independent live capture. They are **genuine and current**, not stale or fabricated: same two rows, same glyphs, same KIND words, same sync labels ("context only" / "24d ago"), same "2 sources ... 18 bound figures" summary. The independent live capture reproduces them.

## Tests

`test.sh --grep "livingDoc"` broker-down: **351 passing** (350 + the new divergence-guard test that asserts glyph and word derive from one classification, guarding "`⊞` never precedes Reference"). `typecheck-client`: clean.

## Verdict

**PASS.** K2.2 ticked. All 13 boxes ticked.
