---
number: 65
status: "**Done (plan 19 iter 2).** 0 core patches; branch `editor-review-1-inline-diff-anchor`."
provenance: "plan 19, iter 2"
source: docs/07-decision-log.md
---

# The inline diff anchor whitespace-collapses

**The inline diff anchor must whitespace-collapse to match the rendered PM node**

Live audit found the iter-1 premise was *false* for real prose: a chat/source edit's inline diff + Approve/Reject did **not** render in the editor for the brief sample - the change showed only in the rail. Root cause: the PM decoration bundle places an inline widget by **exact** match of `anchorText` against the live ProseMirror node's `textContent`, but source prose is wrapped one-sentence-per-line (house style) so the parsed block text carries hard newlines, while CommonMark renders those soft wraps as single spaces - so the node text is single-spaced and the anchor never matched. Earlier samples used single-line paragraphs, masking it. Fix is contrib-only (no offline PM-bundle rebuild): collapse the anchor's internal whitespace in `buildPmDecorationSpec` (`anchorText` + insert `afterText`) so it matches the rendered node text. TDD'd (wrapped-paragraph anchor test) + verified live (the blue→red edit now renders inline with its Approve/Reject in the document).
