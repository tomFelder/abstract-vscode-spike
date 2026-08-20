# 29. Chat quality and the multi-document editing architecture

**Status:** diagnosis + brief for an outside architect. Written 20 Aug 2026 against `main` at `f8f0078cd4c`.
**Audience:** an expert being asked to architect the agentic editing layer. Assumes no prior knowledge of this fork.

## Why this document exists

The founder's verdict on the current chat is that the results are poor, and the target is explicit: it should work like Cursor. One conversation should be able to update an entire project of documents, edit several documents at once, rewrite a whole document where that is what the instruction calls for, and show line-by-line diffs for review.

The current implementation cannot get there by tuning. It is a single-shot HTTP call that asks a model to return a JSON blob inside prose, and its edit contract cannot express a whole-document rewrite at all. This document states what is actually broken and why, what is already built and worth keeping, how Cursor solves the same problems, and the architectural decisions that need making. It is deliberately opinionated about the diagnosis and deliberately neutral about the solution.

One finding has already been fixed (F1 below). Two of the eight architectural decisions were settled by the founder on review of the first draft and are recorded in 1.4; the rest are open.

## 1. What the product must do

Stated requirements, from the founder. Items in *italics* are the founder's own qualifications, added on review of the first draft.

1. A single chat updates an entire **project** of documents, not one document, *when the scope has been made explicit*.
2. Multiple documents are edited **in one turn**, *where those documents were `+`-added to the chat context, their folder was added, or the prompt said so in words*.
3. A whole document can be rewritten when the instruction calls for it, not only a paragraph.
4. Changes are reviewed as **line-by-line diffs**.
5. The overall feel is Cursor's, including *the agent loop: the model should iterate, as Cursor's agent does, rather than answering in one shot*.

### 1.1 Scope inference

This is a first-class requirement rather than an implementation detail, and it is the founder's sharpest note on the first draft.

> "The chat should be smart. If a user explicitly adds files then it is likely that we don't need to grep the entire project, but if the prompt explicitly calls for it such as 'update the whole project' then we should be smart enough to interpret the difference. We only want to pull in the minimum context required to complete the task at any given moment to best manage the context window. There is a balance here but the goal is to appear intelligent and genuinely helpful to the user."

Three signals make scope explicit, and the system must distinguish them from an ambiguous ask:

| Signal | Scope |
|---|---|
| Documents `+`-added to the chat context | Exactly those documents. Do not sweep the project. |
| A folder added to the chat context | That folder's documents. |
| The prompt says so in words ("update the whole project") | Discover the scope, project-wide. |

The operative constraint is **minimum sufficient context**: pull in the least that completes the task at each moment, not everything that might be relevant. That makes context budgeting a product requirement about feeling intelligent and fast, not merely a cost optimisation. It also means an over-eager retrieval layer is a defect, not a safe default.

### 1.2 The review hierarchy

Requirement 4 expands into three nested levels, all of which must exist:

| Level | Controls | State today |
|---|---|---|
| **Individual edit** | Line-by-line diff with a local approve/reject on each change. | **Ships.** Inline diffs render in place in the ProseMirror surface with per-change accept/reject (plan 52 WP-A). |
| **Document** | `< prev doc` / `next doc >` navigation, plus "approve all in this doc" and "reject all in this doc". | **Mostly ships.** Per-document "Approve all {N}" and "Reject all" are in the review rail (`reviewRailView.ts:703,716`); a "Next document" button steps to the next document with pending changes (`livingDocRender.ts:1605`, `_openNextChangedDoc`). There is **no previous-document control**. |
| **Whole change set** | "Approve all", reachable from the chat. | **Ships.** `approveAllEverywhere` on the editor action bar (plan 19), and chat-level Accept all / Reject all across the whole working set (plan 18). |

This is Cursor's review model, and it is the shape a twenty-document change set has to be reviewable in. **The important correction to the first draft is that this is largely built already.** The gap is not the controls; it is that the three levels are not modelled as one coherent change set, which is how #334 happens: the bulk confirm counts one set and approves another because the count is read before an `await` and the apply re-reads after it. Add a previous-document control and make the levels agree, rather than building this layer again.

### 1.3 Requirements that follow but are not yet stated

- **An edit representation that scales.** Requirements 2 and 3 together rule out the current contract, which can only express "replace this exact quoted sentence" (see F7).
- **A cost and latency envelope.** The founder's framing: *"we need to be smart about what we request and feed into the prompt to be sure the cost and speed are balanced well for the user."* Whole-document rewrites across a project multiply both, so this is coupled directly to 1.1.
- **Truthful accounting.** This product's differentiator is that the audit trail can be trusted. An architecture that silently drops edits (as today's does) attacks the one thing that makes the product defensible.

### 1.4 Already decided

Two of the decisions in section 6 were settled by the founder on review, and are recorded here as constraints on the architecture rather than open options:

- **A planner/apply split (D2).** *"We should plan with a more intelligent model and then apply those changes with a cheaper model."* This is Cursor's architecture and is now the intended one here.
- **An agent loop (D4).** *"We certainly want the model to perform loops as the Cursor agent does."* Single-shot is ruled out.

Both have consequences the architect should price in: the loop needs a cost ceiling to satisfy 1.1, and the apply model needs a second serving path in the broker.

## 2. How it works today

There is **no agent framework**. No LangChain, no LangGraph, no Vercel AI SDK. `@anthropic-ai/sdk` is a dependency but the chat path does not use it. The whole thing is hand-rolled `fetch` against a local Node process.

```
livingDocsService.ts ──POST /v1/messages──▶ scripts/lwd-model-broker.js ──▶ OpenRouter (metered, founder-funded)
  (renderer, ~6800 lines)      (localhost:8090)   (plain Node, no deps)   └──▶ Codex / ChatGPT OAuth (user's own plan)
```

The broker speaks the **Anthropic Messages shape** as its internal contract and translates to whichever door is live. Door selection is per request (`selectBackend()`), preferring the user's ChatGPT subscription when a valid token bundle exists, else the metered OpenRouter fallback.

**One chat turn, end to end:**

| Step | Where |
|---|---|
| Serialise the document, read every attached source, render the last 6 transcript turns | `livingDocsService.ts:5981` |
| Build a system prompt asking for `{"reply", "edits":[], "inserts":[]}` as text | `livingDocsService.ts:5966` |
| Stream one POST; fall back to a buffered call; one silent retry on transport failure | `_chatModelCall` `:5239` |
| Parse tolerantly, degrading to plain prose on malformed JSON | `parseChatResponse`, `common/livingDocMarkdown.ts` |
| Match each edit to a block by fuzzy token similarity (> 0.5) | `_queueChatEdit` `:6201` |
| Queue as a pending proposal; apply on approve by exact substring match | `applyBlockEdit`, `common/livingDocMarkdown.ts` |

The document itself is a **block model** (`doc.blocks`, each with an id, type, text, and any data bindings), serialised to Markdown with YAML frontmatter. An edit names a heading plus the exact prose it wants to replace.

## 3. Findings

Ranked by estimated impact on answer quality.

### F1. The picked model was discarded, and the default was a small model. **FIXED**

The OpenRouter door built its upstream body with a hardcoded `OPENROUTER_MODEL` (`openai/gpt-4.1-mini`) and never read the caller's `model`. Every turn on the included door ran on that model regardless of what the composer's picker said. The Codex door had always honoured the id; only this path threw it away, and the code documented the gap ("ADVISORY for the openrouter backend").

Fixed on branch `fix/openrouter-curated-models`: the resolved id is now load-bearing on both doors, and the door serves a curated allowlist (`scripts/lwd-openrouter-models.js`) rather than one hardcoded model. A model is added by editing the registry, or with zero code by overlaying `~/.abstract/models.json` → `openrouter.models`. `GET /models/openrouter/catalogue` intersects the curated list with OpenRouter's live index so a candidate's slug is confirmed before promotion.

**Note for the architect:** the client's `DEFAULT_MODEL` is still `claude-opus-4-8` (`livingDocsService.ts:202`), a name that routes nowhere because there is no Anthropic door. It resolves to whichever door is live and lands on that door's default. Whether to add a first-party Anthropic backend is an open decision.

### F2. No tool use and no structured outputs

The model is asked to emit a JSON object inside a prose response, and `parseChatResponse` **silently degrades to a plain answer** when that JSON is malformed or truncated. Nothing reconciles the prose against what was actually queued.

This is the mechanism behind **issue #303** (the assistant claims edits it never made, in roughly half of turns). The reply says "I've updated that section", the `edits` array never parsed, nothing is queued, and the user is told the work is done. The API has `output_config.format` and `strict: true` tool use built for exactly this; neither is used anywhere in the contrib.

### F3. `max_tokens: 1024`

`MODEL_MAX_TOKENS = 1024` (`livingDocsService.ts:203`), for a reply that must carry the full replacement text of every paragraph it touches, plus rationales, plus the conversational reply. The OpenRouter door applies it verbatim. A two-paragraph rewrite overruns it, the JSON truncates mid-string, and F2's tolerant parser turns the truncation into a chatty non-answer. This is a hard ceiling on requirement 3 (whole-document rewrites) as well as a quality bug.

### F4. The reasoning parameters are dead

`thinking: {type:'adaptive'}` and `output_config: {effort:'low'}` are set on every call (`:5146`, `:5188`) but **the broker forwards neither**. The OpenRouter body is `{model, max_tokens, messages, usage}`; the Codex body is `{model, input, store, stream, instructions}`. Nothing is configuring reasoning depth today. If a first-party Anthropic door is added, `effort: 'low'` is also the wrong default for document rewriting.

### F5. Single-shot, with no verification pass

One call, parse, queue, done. The only retry is for transport failure. A structurally invalid answer is never re-asked, and nothing checks that a proposed edit's anchor still matches the document before it is queued or applied. This is the family that **#329** (a moved anchor is silently dropped and recorded as `approved`) and **#300** (a proposal on a list block renders no diff) live in.

### F6. No prompt caching

`cache_control` appears nowhere in `src/` or `scripts/`. Every turn re-sends the entire document, the full text of every attached source, and the transcript as a fresh user message. On any conversation past a few turns this is the dominant cost and latency, and it grows monotonically. It is also the single cheapest fix on this list.

### F7. The edit contract cannot express what the product needs

An edit is `{heading, oldText, newText}`. `oldText` must quote the live prose, is matched to a block by fuzzy token similarity, then applied by exact substring (`blockText.indexOf(old)`). When the anchor is not found, `applyBlockEdit` **returns the block unchanged** and the caller records the change as approved anyway (#329).

Three consequences. It cannot express a whole-document rewrite (requirement 3). It cannot express a structural change such as reordering sections or splitting a document. And it fails silently rather than loudly, which is the worst available failure mode for a product whose pitch is a trustworthy audit trail.

### F8. Whole document plus all sources in every prompt

There is no context management. The prompt is assembled by concatenation and bounded only by the fan-out's token budget (default 24k, `livingDocs.fanoutContextBudget`). There is no chunking, no summarisation, no relevance filtering, and no notion of which *part* of a document an instruction concerns.

### F9. Fan-out routes edits back to documents by title string

`_chatRespondMulti` matches each returned entry to a document by lowercased title (`:6150`). Two documents with the same title in a project collide; a model that paraphrases a title loses its edits silently (`if (!target) { continue; }`).

### F10. There is no retrieval. The working set is assembled by hand

`getWorkingSet` reads a map the user populates through `addToWorkingSet` via attach chips and `@`-mentions. To "update an entire project" today, the user must manually attach every document. This is the largest single gap against requirement 1, and nothing in the codebase addresses it.

Note the nuance in 1.1: the fix is **not** "always retrieve". An explicit attachment already *is* the scope, and sweeping the project in that case is the wrong behaviour. What is missing is the classifier that tells the two asks apart, and the retrieval path behind only one of them.

## 4. What already exists and is worth keeping

The expert should not start from zero. `_chatRespondMulti` is a genuinely considered multi-document implementation, and several of its properties are hard-won:

- **Token-budgeted batching.** Documents are packed into batches under a configurable budget; a document too large for the whole budget is never sent and says so rather than being silently dropped.
- **Per-document attribution with partial success.** A batch that fails records exactly which documents failed, keeps every proposal other batches landed, and offers a surgical retry that re-runs only the failures (#123).
- **Honest terminal states.** A model outage, a spent budget cap, and a clean run with no changes are three visibly different outcomes. The code goes to real lengths to ensure an outage can never render as "no changes proposed".
- **A per-document policy dial.** A document marked "never change this" is skipped, and the refusal is spoken rather than silent (#257).
- **A working audit trail** with proposal/resolution records on disk.
- **The review hierarchy is largely built.** Inline diffs render in place with per-change accept/reject (plan 52 WP-A); per-document approve/reject all and a next-changed-document step exist in the review rail; chat-level and editor-level bulk verbs span the whole working set. See 1.2 for what is actually missing. What is *not* built is the whole-document rewrite case (F7).
- **A per-request door abstraction** in the broker that already handles two upstreams with different wire shapes, plus metering, a daily spend cap, and entitlement tracking.

The weakness is not the orchestration. It is the edit representation, the absence of retrieval, and the single-shot call underneath.

## 5. How Cursor solves these problems

Grounded in Cursor's own engineering write-ups; sources at the end.

### Two models, split by job  *(adopted, D2)*

Cursor separates **planning** from **applying**. A frontier model reasons about what should change and produces a conversational, abbreviated edit. A separate, specialised **apply model** (a fine-tuned Llama-3-70B) takes that plan plus the current file and emits the result. The apply step is treated as mechanical and is optimised for speed rather than intelligence.

### Full-file rewrite, not search/replace diffs

This is the finding most directly at odds with the current implementation. Cursor deliberately chose full-file rewrites over diff formats, for three reasons:

1. **Diffs constrain reasoning.** More output tokens mean more forward passes to get the answer right.
2. **Training distribution.** Models have seen far more whole files than diffs, so full rewrites are closer to what they do naturally.
3. **Line-number reliability.** Diff formats force the model to commit to exact positions early in generation, and models are bad at counting lines.

The third point generalises directly to this codebase: `oldText`-must-quote-exactly is the same class of brittleness as a line number, and F7 is the same failure Cursor designed around.

### Speculative edits make full rewrites affordable

The obvious objection to rewriting whole files is cost and latency. Cursor's answer is **speculative edits**, a variant of speculative decoding that uses the existing file as draft tokens. Because most of an edited file is identical to the original, this reaches roughly 1000 tokens/second, around a 13x speedup. This is what makes the "rewrite the whole thing" strategy practical rather than theoretical.

### Retrieval instead of stuffing

Cursor builds a **Merkle tree** over the repository to detect changes cheaply, chunks files with tree-sitter, embeds them with a custom model, and stores the vectors in a per-codebase namespace. On a request it embeds the query, does nearest-neighbour search, and reads the matching files locally. The agent **retrieves what it needs** rather than being handed everything up front. Background sync walks only the Merkle branches whose hashes differ, so re-indexing is incremental.

This is the direct answer to F8 and F10.

### An agent loop, not a single call  *(adopted, D4)*

Composer/Agent mode is a tool-calling loop: the model searches, reads, edits, and re-reads across multiple turns within one user request, creating files and editing across several of them in a single operation.

## 6. The decisions this needs

These are the questions the architecture has to answer. **D2 and D4 are now settled** (see 1.4) and are kept in the table as constraints; **D3, D6 and D7 have been narrowed** by the founder's notes and now carry a stated direction rather than an open field. D1, D5 and D8 remain genuinely open.

| # | Decision | Options | Notes specific to this codebase |
|---|---|---|---|
| **D1** | **Edit representation** | (a) keep anchored search/replace, hardened; (b) whole-document rewrite, diffed locally; (c) structured block operations against the existing block model | The block model is an asset (b) and (c) can both exploit: blocks have stable ids, so a rewrite can be diffed back to block-level changes for the existing review UI. (b) is Cursor's answer and the only one that satisfies requirement 3 cleanly. |
| **D2** | **One model or two** | ~~single frontier model~~; **planner + apply split (DECIDED)** | Settled (1.4): plan with the more capable model, apply with a cheaper one. Open sub-question: is a hosted fast-apply available, or does this mean training/serving one? The broker's door abstraction makes adding a second serving path tractable. |
| **D3** | **Retrieval and scope inference** | manual working set (today); keyword/grep; embeddings + vector store; hybrid | **Narrowed by 1.1.** Retrieval must not fire when the user has already made scope explicit, and must satisfy *minimum sufficient context*. So the question is not only "which retriever" but "how does the system classify the ask" (explicit attachment vs folder vs project-wide wording vs ambiguous). A documents project is far smaller than a codebase, so full-corpus embedding is cheap; documents also carry frontmatter, sources and a wikilink graph a code retriever would not have. |
| **D4** | **Execution model** | ~~single shot~~; **tool-calling agent loop (DECIDED)** | Settled (1.4): the model iterates as Cursor's agent does. Open sub-question: what bounds the loop? A loop over N documents needs a cost and step ceiling to satisfy 1.1, and the existing daily spend cap is a per-request meter, not a per-task budget. |
| **D5** | **Framework** | continue hand-rolled; Anthropic SDK tool runner; Vercel AI SDK; LangGraph | Hand-rolled has kept the broker dependency-free and testable with `node --test`, which is genuinely valuable and should not be given up lightly. Weigh against the cost of rebuilding streaming, tool loops, and retries. |
| **D6** | **Review at scale** | **the three-level hierarchy in 1.2, which mostly ships already** | **Specified by 1.2, and largely built.** All three levels exist; the missing control is previous-document. The real work is modelling the pending set as one change set so the levels cannot disagree, which is what #334 is: a count read before an `await` and an apply that re-reads after it. Treat this as hardening, not new construction. |
| **D7** | **Cost and latency envelope** | prompt caching; incremental context; batching; speculative apply | **Narrowed by 1.1 and 1.3**: the founder's bar is that cost and speed feel balanced *to the user*, which makes this a perceived-quality requirement, not just a bill. F6 (no prompt caching anywhere) is unimplemented and cheap. A whole-project rewrite without caching would be prohibitively expensive on any frontier model, and an agent loop (D4) multiplies the turn count that caching pays off against. |
| **D8** | **Verification** | none (today); anchor re-validation; a second model pass; deterministic post-checks | The audit trail is the product's trust wedge, so "we recorded an approval that did not happen" (#329) must become structurally impossible, not merely unlikely. |

## 7. Open questions for the architect

1. Is the block model the right substrate for edits, or should the unit of change be the whole document with block-level diffing done locally after the fact? (D1)
2. Can a whole-project rewrite be made affordable without a speculative-apply path, or does that capability gate the requirement?
3. Given the planner/apply split is decided, what plays the apply role? A hosted fast-apply, a small commodity model prompted for mechanical merge, or something trained? What is the fidelity bar, and how is a bad apply detected rather than trusted?
4. How does the system classify an ask into the scope signals in 1.1, reliably enough that a wrong call is rare and recoverable? A misread that sweeps the project is expensive; one that under-scopes silently does less than the user asked.
5. What bounds the agent loop: step count, token budget, wall clock, or a planner-declared scope agreed up front? How does the user see and steer it mid-run?
6. Should the broker gain a first-party Anthropic door, or stay a two-door proxy? The planner/apply split makes this a question about two serving paths, not one.
7. How much of the existing fan-out machinery (batching, attribution, partial success, surgical retry) survives a move to a retrieval-driven agent loop?
8. The three-level review in 1.2 mostly ships. How is the pending set re-modelled as one change set so the levels cannot disagree, given #334 is exactly that failure today?
9. What is the migration path? The product ships today; this cannot be a rewrite behind a six-month flag.

## Appendix A: file map

| Concern | File |
|---|---|
| Chat orchestration, prompts, edit queueing | `src/vs/workbench/contrib/livingDocs/browser/livingDocsService.ts` (~6800 lines) |
| Response parsing, document serialisation, `applyBlockEdit` | `src/vs/workbench/contrib/livingDocs/common/livingDocMarkdown.ts` |
| Model broker, door selection, metering | `scripts/lwd-model-broker.js` |
| Curated OpenRouter catalogue | `scripts/lwd-openrouter-models.js` |
| ChatGPT OAuth door | `scripts/lwd-openai-oauth.js` |
| Broker tests (`node --test`, no build needed) | `scripts/test/lwd-*.test.js` |

## Appendix B: reproducing the findings

```sh
# Which model actually served a turn (watch broker stdout):
#   [lwd-proxy] /v1/messages backend=openrouter requested="..." resolved=...

# Confirm a candidate model's slug against OpenRouter's live index before promoting it:
curl -s localhost:8090/models/openrouter/catalogue | jq

# Expose unvalidated candidates for a validation walk:
LWD_OPENROUTER_INCLUDE_UNVALIDATED=1 node scripts/lwd-model-broker.js

# The broker suites (34 tests, no workbench build):
for t in scripts/test/lwd-*.test.js; do node --test "$t"; done

# F6: no prompt caching anywhere
grep -rn cache_control src/ scripts/    # returns nothing
```

## Appendix C: related issues

| Issue | Relationship |
|---|---|
| **#303** | The assistant claims edits it never made. The direct symptom of F2 + F3. |
| **#329** | A moved anchor is dropped and recorded as `approved`. F7 and F5. |
| **#300** | A proposal on a list block renders no inline diff. F7. |
| **#334** | Bulk-approve counts one set and approves another. Review-layer, adjacent to D6. |
| **#318** | The unit suite talks to a real model when port 8090 is busy. Blocks trustworthy measurement of any change here. |

No open issue tracks chat answer quality as such. #303 is the only one that touches it, and it describes a symptom rather than the cause.

## Sources

- [Editing Files at 1000 Tokens per Second, Cursor](https://cursor.com/blog/instant-apply)
- [How Cursor built Fast Apply using the Speculative Decoding API, Fireworks AI](https://fireworks.ai/blog/cursor)
- [Securely indexing large codebases, Cursor](https://cursor.com/blog/secure-codebase-indexing)
- [How Cursor Actually Indexes Your Codebase, Towards Data Science](https://towardsdatascience.com/how-cursor-actually-indexes-your-codebase/)
- [Search, Cursor Docs](https://cursor.com/docs/agent/tools/search)
