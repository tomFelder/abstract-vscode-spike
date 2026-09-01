---
number: 28
status: "**Done (v2 iter 8, PR #15).** 0 core patches (webview only). Technique: tokenize each `[value](bind:key)` BEFORE the sanitizing Markdown renderer, swap the token for the span after — so formatting survives and no raw HTML is injected. Each span carries `data-cells` so clicking a figure peeks its source. Completes **G5** (gutter detached + figures highlighted + doc aligned)."
provenance: "v2"
source: docs/07-decision-log.md
---

# Highlight bound figures inline in prose

**Highlight bound figures inline in prose (the comp's "living figure" treatment)**

The comp marks each source-bound figure in the prose with a faint-blue highlight + underline so the reader sees exactly which words are live; the spike rendered them as plain text (only a block-level gutter dot). Bound prose now wraps each resolved figure in a `.bound` span; tables stay plain (as the comp)
