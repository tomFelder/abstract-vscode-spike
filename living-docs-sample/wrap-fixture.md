---
title: Wrap Rule Fixture
---

# Wrap Rule Fixture

This document exists to test the D1 wrap rule for the numbered gutter (plan 45, criterion P9.4). At the 720px reading column the following paragraph is deliberately long enough to wrap over at least three visual rows, so the gutter must show exactly one number on the block's first row and a blank gutter on the wrapped rows below it. When the numbered gutter lands, this paragraph is the canonical check that numbering follows Markdown blocks rather than visual rows: one number per block, never one per wrapped line.

The quick brown fox jumps over the lazy dog while a curious cat watches from the windowsill, and across the quiet street a baker opens the shop before dawn, laying out warm loaves and pastries in neat rows so that the first commuters passing on their way to the early train can catch the scent of fresh bread drifting out through the propped-open door into the cold morning air, a small daily ritual that has repeated itself in this same corner for as long as anyone in the neighbourhood can remember.

A short line.

Another short line.

The second long paragraph is here to confirm that two adjacent wrapped blocks each get their own single number, with the blank-gutter rule applying independently to each, so that a reader scanning the rail sees a stable one-number-per-block address column no matter how the prose reflows at different window widths or reading-column measures. This sentence keeps going long past the point where it must wrap in order to guarantee the three-row minimum that criterion P9.4 requires for a meaningful test of the wrap rule.

- A short list item.
- Another short list item.
