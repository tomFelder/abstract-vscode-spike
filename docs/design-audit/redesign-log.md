# Design-match log — Abstract UI Redesign (plans 21-25)

Scores each built surface against its region of the companion pixels
`Abstract - UI Redesign.dc.html` (claude.ai/design project
`d198ca07-9eef-4d05-96e1-b383e6c19c03`), using the Part B tokens + Part C px specs in
`docs/plans/20-abstract-ui-redesign-handoff.md` as the rubric.

Reuse the conventions from the existing `docs/design-audit/` logs (v2/v3/v4): per-surface score,
a short gap backlog, and the iteration that closed each gap.

| Surface (plan) | Comp region | Baseline % | Final % | PR | Notes |
|---|---|---|---|---|---|
| Provenance gutter (plan 21 iter 1) | Editor / gutter of `Abstract - UI Redesign.dc.html` (the "Redesigned workbench" editor: 30px `flex:none` gutter, 9px accent dot, 3px attention bar) | ~60 (inline `-20px` padding dot, no gutter column, no bar, no hover-to-source) | 94 | #TBD | Real 30px reserved gutter column; 9px accent dot on bound line; 3px attention bar spanning a multi-line edit; no line numbers; prose verifiably not shifted; hover a marker opens source-peek. Remaining -6 = body font / reading ramp (owned by iter 2). |
| Reading ramp (plan 21 iter 2) | "Clean identity" (4b) card in `Abstract - UI Redesign.dc.html`: H1 30/1.12/600/-0.02em, H2 16/1.3/600, body 15.5px/1.7 at 720px column | ~88 (H1 was 27px/1.25/-.01em, H2 was 20px, body was 15px; all wrong) | 97 | #TBD | All three ramp values match the Part B type table exactly (verified via compiled JS). System-ui fallback vs Instrument Sans loaded face is the only residual gap (-3%), which is explicitly acceptable per the handoff. |

## Per-surface gap backlogs

### Reading ramp (plan 21 iter 2) — final 97%

Closed this iteration:
- H1: 27px/1.25/-.01em → 30px/1.12/-.02em (exact Part B spec; compiled and verified in `out/`).
- H2: 20px/1.3/600 → 16px/1.3/600 (section-label style, intentionally smaller than body per spec).
- Body: 15px/1.7 → 15.5px/1.7 (within the 15.5-16px spec range).
- Column max-width 720px was already correct (iter 1 locked it); not regressed.
- 30px gutter from iter 1 preserved; `.pmwrap .prose` override not touched.

Remaining gap:
- Font family: comp uses loaded Instrument Sans; we ship system-ui fallback. Explicitly documented as acceptable in the handoff. No engineering action needed.

### Provenance gutter (plan 21 iter 1) — final 94%

Closed this iteration:
- 30px `flex:none` gutter column left of the 720px reading column; prose never shifts when markers toggle (verified: prose text left edge identical across plain / bound / edited paragraphs).
- 9px accent dot (`oklch(0.55 0.13 255)`) vertically centred on a source-bound line (was an 8px dot at `left:-20px` in the prose padding).
- 3px attention bar (`oklch(0.66 0.16 45)`) spanning the rows of a multi-line edited paragraph (was absent).
- Hover a marker → source-peek drawer (same `reveal` message the bound figure fires; was not wired).
- No line numbers anywhere.

Remaining gap (deferred to the owning iteration):
- Reading type ramp: the live body is `system-ui` at 15px/1.7; the comp/handoff want the 4b sans ramp (H1 30/600/-0.02em, H2 16/1.3/600, body 15.5-16/1.7). **Owned by plan 21 iteration 2** (do not fix here).
- A *bound* multi-line paragraph under a pending edit uses the edit-widget bar (not a node-anchored bar) because PM reports an atom's label as empty text; acceptable and matches how the inline edit widget already anchors. No visible gap.
