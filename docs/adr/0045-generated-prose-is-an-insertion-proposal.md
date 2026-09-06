---
number: 45
status: "**Done (v6 iter 2).** 0 core patches (our surface). TDD (3 service tests: multi-turn transcript, insert+approve splices a block, accept-all). UI: `renderInsertProposal` (inline green), `IChatMessage.proposedIds` → per-turn review card in `reviewRailView`, `approveAll(docId)`. Verified live on `.realdocs-test` with OpenRouter: \"add a Top-3 priorities list\" → real `gpt-4o-mini` section → inline + rail card → Approve → landed rendered + persisted (shots `docs/v6-verify/v6-iter2-*`). _Residual: the chat proposes onto the living-doc renderer, not yet the PM surface (build-order #2)._"
provenance: "v6"
source: docs/07-decision-log.md
---

# Generated prose is an insertion proposal

**Generative chat content is an "insertion" proposal that reuses the existing review/approve machinery**

F3 needs the chat to *generate* content ("make me a top-3 list"), not only rewrite existing prose. Rather than a separate flow, model it as a new shape of the existing `IProposedChange`: `insert: true` + `afterBlockId` + `newText` (no `oldText`). It then flows through the SAME inline diff (rendered all-additions), chat-rail review card, and approve/reject as a source-driven edit. Multi-turn: send the last ~6 turns as a transcript so "change a couple of them" resolves over the current doc. How a list maps onto blocks: keep the generated Markdown as ONE inserted block and render "rich" non-bound paragraphs (lists/headings/multi-line) as rendered Markdown, so the model's loose-list output is not split into "1. 1. 1."
