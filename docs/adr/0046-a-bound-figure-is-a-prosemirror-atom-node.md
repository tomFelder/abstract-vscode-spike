---
number: 46
status: "**Decided (plan 15 iter 1).** Requires an offline bundle rebuild (decision 43 process). Tier target: **our-surface** (vendored bundle + own renderer). Builds in iter 1 (the keystone proof: parse→node→serialize round-trip, re-read disk)."
provenance: "plan 15"
source: docs/07-decision-log.md
---

# A bound figure is a ProseMirror atom node

**A bound figure is a first-class ProseMirror atom inline node, not a decoration over a stock link**

Unifying on PM (keystone) needs `[label](bind:key)` to live *inside* the editor: show the resolved live value, be non-editable (driven by its source), open source-peek on click, and round-trip to `[label](bind:key)` on disk. Two ways: (a) an atom inline `boundFigure` node baked into the vendored bundle's schema + a markdown-it parse token + a serializer node; (b) keep the stock link (already round-trips, decision 43) and overlay an inline decoration + a `filterTransaction` for edit-protection. Tom's call: **(a)** — a real node gives clean edit-protection and resolved-value rendering as a first-class citizen rather than bolted-on display, and serializes deterministically back to the same on-disk syntax.
