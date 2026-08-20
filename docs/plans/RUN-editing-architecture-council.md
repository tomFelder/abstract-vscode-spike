# RUN: the editing-architecture council

A handoff prompt. Run it in a **fresh session on a Fable model**, on branch `fix/openrouter-curated-models`. Everything below the rule is the prompt; it is self-contained and assumes no conversation history.

---

You are chairing an expert council to architect the agentic editing layer of Abstract, a document editor forked from VS Code. You are working on branch `fix/openrouter-curated-models`. The user has explicitly authorised multi-agent work for this task.

## The goal

Produce the architecture for an editing layer where **one conversation can update a whole project of documents**, rewriting entire documents where the instruction calls for it, reviewed as line-by-line diffs. The north star is **the user's experience**, not architectural elegance: every recommendation must be justified by what the person using Abstract feels, sees and can trust. An architecture that is beautiful and produces a worse writing experience has failed.

## Required reading, before you form any opinion

1. **`docs/29-chat-quality-and-multi-doc-architecture.md`** is the brief. It contains the requirements (section 1), how the system works today (2), ten findings (3), what already works and must survive (4), how Cursor solves the same problems (5), eight decisions D1-D8 (6), and eleven open questions (7).
2. The code it points at, especially:
   - `src/vs/workbench/contrib/livingDocs/browser/livingDocsService.ts` (chat orchestration, prompts, edit queueing; ~6800 lines)
   - `src/vs/workbench/contrib/livingDocs/common/livingDocMarkdown.ts` (`parseChatResponse`, `applyBlockEdit`, serialisation)
   - `src/vs/workbench/contrib/livingDocs/browser/livingDocRender.ts` (`docReviewBar`, the inline diff surface)
   - `src/vs/workbench/contrib/livingDocs/browser/reviewRailView.ts` (the review rail and bulk verbs)
   - `scripts/lwd-model-broker.js` (the model broker and its two doors)

**Treat the brief as evidence, not scripture.** It already contained one materially wrong claim that was caught only by reading the code: it asserted that document-level review "does not exist today in any form" when in fact per-document approve/reject-all and next-changed-document navigation both ship. Assume there are more errors like that. Every load-bearing claim any panellist makes about the current system must be verified against the code, with a `file:line` citation. Assertions without citations do not enter the record.

## Ground rules

- **Thinking is Fable.** Spawn every panellist with `subagent_type: "general-purpose"` and `model: "fable"`. Strategy, analysis, design and judgement stay on Fable.
- **Research can be Opus.** Panellists may spawn their own `model: "opus"` sub-agents for mechanical work: reading a subsystem, sweeping the web for how a named product solves something, benchmarking a claim, enumerating call sites. Delegate the legwork, keep the reasoning.
- **No code changes in this run.** The deliverable is an architecture, not an implementation. The one exception is throwaway probes to verify a claim, which must not be committed.
- **Cost discipline.** Panellists should delegate reading-heavy work rather than filling their own context with it.

## Mechanics you will need

- Launch the panel in **one message with six parallel `Agent` tool calls** so they run concurrently.
- `ToolSearch("select:SendMessage,ListAgents")` first. **`SendMessage` is how you run the follow-up round**: it continues an existing panellist with its context intact, whereas a fresh `Agent` call starts from nothing and loses their analysis. `ListAgents` shows you who is running.
- Panellists run in the background; you are notified as each completes. Never invent or predict a panellist's findings before their report arrives.

## The panel

Six members, each anchored to decisions in the brief but explicitly invited to range outside them. Give each the goal, the required reading, the ground rules, and their own charter. Tell each of them: **you are not here to ratify the brief, you are here to reach your own conclusion, and saying "the brief is wrong about X" is a valuable outcome.**

1. **Agent systems architect.** Owns D4 (the loop, already decided in principle) and D5 (framework: hand-rolled vs Anthropic SDK tool runner vs AI SDK vs LangGraph). What is the tool surface? What bounds the loop: steps, tokens, wall clock, or a planner-declared scope agreed up front? How does a user see and steer a long run mid-flight? What survives of the existing fan-out machinery (batching, per-document attribution, partial success, surgical retry)?

2. **Applied LLM / inference engineer.** Owns D2 (the planner/apply split, decided: plan with a capable model, apply with a cheaper one) and D7 (cost and latency). What actually plays the apply role, given the broker fronts OpenRouter and a ChatGPT OAuth door and there is no Anthropic door? Is a hosted fast-apply available, or does this mean serving one? What is the fidelity bar, and **how is a bad apply detected rather than trusted**? Prompt caching is entirely absent today (F6): what does the caching and context strategy look like under an agent loop?

3. **Document and editor systems engineer.** Owns D1, the most consequential open decision: keep anchored search/replace, move to whole-document rewrite diffed locally, or structured operations over the existing block model. Weigh Cursor's published reasoning for full-file rewrites against this codebase's block model, its ProseMirror surface, its data bindings (`bind:` links that must never be clobbered), and byte-clean Markdown round-tripping. **Section 1.4 raises the bar**: a comment thread needs a change to be a stable, addressable object that survives revision.

4. **Review-experience designer.** Owns D6 and sections 1.2, 1.3 and 1.4: the three-level review hierarchy, the directional floating bars, and comment as a third verb alongside approve and reject. Much of this ships already, with deliberate design rules recorded in 1.3 that must be preserved or consciously revised. Design the review experience for a twenty-document change set. What does a change under discussion look like, and how can no bulk verb ever sweep it? This member owns the north star: if another panellist's proposal makes the experience worse, say so loudly.

5. **Retrieval and context engineer.** Owns D3 and section 1.1, scope inference. The requirement is *not* "always retrieve": an explicit attachment already is the scope, and sweeping the project in that case is a defect. How does the system classify an ask into the signals in 1.1 reliably enough that a misread is rare and recoverable? Exploit what a documents corpus has that a codebase does not: frontmatter, declared sources, and the wikilink graph. What satisfies "minimum sufficient context" concretely?

6. **Correctness and trust architect.** Owns D8. The audit trail is this product's commercial wedge, so an approval recorded for a change that never applied (#329) must become structurally impossible rather than merely unlikely. Related live defects: #303 (the assistant claims edits it never made, roughly half of turns), #334 (bulk confirm counts one set and approves another), #300, #318. What are the invariants, where are they enforced, and what does the test strategy look like? Verification design is in scope, including whether a second model pass earns its cost.

## Phases

**Phase 1, independent analysis.** All six in parallel. Each returns: their recommendation with reasoning, `file:line` evidence for every claim about the current system, explicit disagreements with the brief, the risks they see, and what they could not determine and why.

**Phase 2, chair review.** Read every report. Do not synthesise yet. Instead, interrogate: use `SendMessage` to push back on weak reasoning, unsupported claims, and hand-waves. Ask each panellist at least one hard follow-up. Where two panellists' recommendations are incompatible, tell each what the other said and make them argue it out. Two areas are near-certain to conflict and you should force them into the open:
- **D1 against D6/1.4**: whole-document rewrite versus a stable per-change identity that comment threads can attach to.
- **D7 against D4**: an agent loop multiplies turns, and a whole-document rewrite multiplies tokens. Something has to give.

**Phase 3, convergence.** Keep going until the panel either agrees or has a clearly articulated disagreement worth escalating to the founder. Record dissent; do not smooth it away. A recommendation the panel does not actually believe is worse than a documented split.

**Phase 4, deliverable.** Write `docs/30-editing-architecture.md` and add it to the index table in `docs/README.md`. It must contain:

- The recommended architecture, described so an engineer could start on Monday.
- **D1 through D8 each resolved**, with the reasoning and the rejected alternatives. D2 and D4 are already settled in principle; your job is to specify them, not revisit them, unless the panel finds a strong reason to reopen one, in which case say so explicitly.
- The UX specification: the review hierarchy, the directional bars, the comment verb, and what a project-wide edit feels like from the user's side, moment to moment.
- The invariants that make a silent wrong outcome impossible, and how they are tested.
- A **sequenced plan with a migration path**. The product ships today. Anything that requires a long-lived branch or a six-month flag is disqualified; say what lands first, what it unblocks, and what can be done incrementally behind the existing surfaces.
- Open questions for the founder, with the trade-off each one turns on, phrased so they can be answered without re-reading the whole document.
- Recorded dissent.

House style for the document: Australian English, no em dashes, one physical line per paragraph, and follow the conventions in `.claude/CLAUDE.md`.

## Finally

Report back to the user with: the recommendation in a few sentences, the two or three calls that most shape the product, where the panel split, and what you need from them to proceed.
