---
number: 73
status: "**Done (plan 21 iter 1).** 0 core patches; branch `redesign-21-1-provenance-gutter`."
provenance: "plan 21, iter 1"
source: docs/07-decision-log.md
---

# The provenance gutter is a reserved 30px column

**Provenance gutter is a real 30px reserved column; a bound multi-line paragraph's edit-bar anchors on the visible widget, not the hidden node**

Rebuilt the gutter to the C2 spec: `.pmwrap` is a flex row centring a `[30px gutter][720px reading column]` group, where the gutter is the reading column's reserved 30px `padding-left` (`box-sizing:content-box`, `max-width:750px`), so the prose is verifiably never shifted when markers toggle. Markers are ProseMirror node decorations painting into that column via `::before`: a **9px** accent dot (`oklch(0.55 0.13 255)`) vertically centred on a source-bound line, and a **3px** attention bar (`oklch(0.66 0.16 45)`) spanning the rows of a multi-line edited paragraph. No line numbers. Hovering a marker fires the same `reveal` message the bound figure click already fires (delegated `mouseover` gated to the gutter x-zone), opening the source-peek drawer. `IPmGutterMarker` became a discriminated union `{kind:'dot',keys,recent} | {kind:'bar',anchorText}` (TDD'd in `livingDocPmDecorations.test.ts`: dot markers, multi-line→bar, single-line→no-bar, bound+edited→dot-only). **Key finding defaulted safely:** PM renders a `bound_figure` atom's label as EMPTY in `node.textContent`, so a *bound* multi-line paragraph's collapsed anchor (which keeps the label) never equals the node text - the same latent gap the inline edit widget has for bound blocks. Rather than change the existing text-anchor matching (risking the shipped edit-widget behaviour), the bar is rendered as a `pm-edit-bar` class on the edit's **visible widget** (`.editblock`), resolved host-side from the bar anchor→edit id in `renderPmDeco`. The bundle only needs the dot keys; the offline PM bundle was rebuilt + re-emitted (round-trip + `bound_figure` + `table_block` checks pass). Verified live at 1440x900: bound line shows the 9px dot, prose left edge unchanged vs plain paragraphs, clicking the bound figure opens the source drawer; the 3px bar spanning a 145px multi-line edit confirmed via the real compiled bundle + real render CSS. Design-match 94% vs the C2 gutter region (the -6 is the body font/reading ramp, which iteration 2 owns).
