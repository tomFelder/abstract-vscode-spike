---
number: 66
status: "**Done (plan 19 iter 2).** 0 core patches; branch `editor-review-3-chat-parse-robust`."
provenance: "plan 19, iter 2"
source: docs/07-decision-log.md
---

# The chat-edit JSON parser brace-matches

**The chat-edit JSON parser must brace-match, not slice to the last `}`**

While verifying rail-to-editor navigation, the cheap model intermittently emitted a *valid* `{"reply":"","edits":[...],"inserts":[]}` followed by a **stray trailing `}`**. `parseChatResponse`/`parseMultiChatResponse` sliced `indexOf('{')..lastIndexOf('}')`, so the extra brace made the slice invalid JSON, `JSON.parse` threw, and the tolerant fallback leaked the raw JSON envelope into the chat with **no proposals queued** - a silent, intermittent failure of the core chat-edit flow that everything in plan 19 sits on. Fix: a shared, string-aware `extractBalancedJsonObject` that brace-matches the first complete object from the first `{` (tracking string state + escapes), so trailing junk, prose wrapping, and braces-in-strings all parse; an unbalanced (truncated) stream still degrades to a plain answer. TDD'd (trailing-brace + braces-in-strings cases for both parsers) + verified live (the edit now parses and queues reliably).
