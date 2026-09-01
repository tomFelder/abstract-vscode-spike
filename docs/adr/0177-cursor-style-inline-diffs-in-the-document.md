---
number: 177
status: "**Decided.** [plans/52-cursor-parity-loop.md](plans/52-cursor-parity-loop.md) WP-A."
provenance: "founder"
date: 2026-08-03
source: docs/07-decision-log.md
---

# Cursor-style inline diffs in the document

**The approval UX target is Cursor-style inline diffs IN the document: pending proposals render as red/green diff blocks in place with per-change accept/reject and accept-all; the chat cards demote to compact pointers; the review engine (approve/reject/audit/bulk-confirm) is reused unchanged**

The founder's verdict on the existing card flow: mechanically present, but the loop doesn't feel light or trustworthy enough for daily use - "just like Cursor" chosen over polishing cards or a hybrid. Render-layer rebuild, not a review-engine rewrite, keeps the trust grammar and audit intact.
