---
number: 67
status: "**Done (plan 19 iter 3).** 0 core patches; branch `editor-review-4-inline-prominence`."
provenance: "plan 19, iter 3"
source: docs/07-decision-log.md
---

# Inline per-hunk Approve and Reject confirmed

**Inline per-hunk Approve/Reject confirmed working; provenance label cleaned**

E-C was enhance-not-rebuild: the inline accept/reject widget already existed and (post-#65) renders. Verified live that the in-editor **Approve changes** applies the edit (doc updates, rail count decrements, persists) and **Reject** discards it (diff vanishes, doc reverts) - the acceptance criterion "every inline diff has a working Approve/Reject at the diff" holds. Polish: the control-row label read "Tone rewrite from &lt;empty&gt;" for a chat edit on a plain doc (no source) - a dangling "from". Now it reads "Suggested edit from &lt;source&gt;" when a source exists, else just "Suggested edit"; added a calm hover lift on the reviewable block so it reads as one actionable unit while reading.
