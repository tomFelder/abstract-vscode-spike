---
number: 64
status: "**Settled (plan 19 iter 1).** To build."
provenance: "plan 19, E-A/B/C/D"
source: docs/07-decision-log.md
---

# The editor is a first-class review surface

**Editor becomes a first-class review surface, contrib-first, both surfaces equal**

Plan-19 iter-1 settled with Tom: **E-A** the rail keeps every plan-18 action (inline approve/reject, per-doc + chat-level Approve/Reject all) *and* gains navigate-to-inline-diff; clicking a rail change entry **navigates only** (moves+focuses the editor on that change), it does not approve - approval happens wherever the user then acts. **E-B** the editor action bar ("Approve all in this doc / Next document with changes / Approve all everywhere") lives in the **in-webview calm toolbar** (the existing `.etoolbar` right side), not the editor header chrome - contrib-only, no core patch. **E-C** the inline per-hunk Approve/Reject affordance **enhances the existing** `pmEditWidget`/`pmInsertWidget` (hover/prominent + reliably wired), not a rebuild. **E-D** inline-in-editor wins; contrib-first, take a minimal *logged* core webview patch only if genuinely needed. Audit finding: the inline accept/reject widgets, the `approve`/`reject`/`approveAll`/`rejectAll`/`approveAllPending`/`rejectAllPending` service methods, and the webview↔host `approve`/`reject` message protocol already exist (plan 18) - plan 19 is navigation wiring + the editor action bar + making the inline affordances prominent/reliable, plus at most a tiny "next doc with pending changes" service helper.
