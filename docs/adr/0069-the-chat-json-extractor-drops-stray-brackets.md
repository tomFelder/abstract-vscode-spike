---
number: 69
status: "**Done (plan 19 iter 4).** 0 core patches; branch `editor-review-6-parser-stray-closer`."
provenance: "plan 19, iter 4"
source: docs/07-decision-log.md
---

# The chat-JSON extractor drops stray brackets

**Harden the chat-JSON extractor to drop stray closing brackets, not just braces**

Continued from #66. While verifying multi-document review, gpt-4o-mini *reproducibly* emitted a complete object with a stray `]` on its trailing array (`{..."inserts":[]]}`) - distinct from the stray `}` #66 handled. The brace-only matcher extracted a string that still contained the stray `]`, so `JSON.parse` threw and the raw JSON leaked into the chat with no proposals. Generalised `extractBalancedJsonObject` to rebuild the object from the first `{` tracking BOTH brace and bracket depth (plus string/escape state) and **drop any closer that would go below zero**, so doubled `}}`/`]]` the model tacks on are discarded while real nested arrays/objects and braces-in-strings are preserved. TDD'd (stray-`]` + nested-array-intact for both parsers; 12 parser tests green).
