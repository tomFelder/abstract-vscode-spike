# 14 - Product strategy: the category, the wedge, the market, the money

This is the product spine.
Every future plan, design pass and agent loop should be checkable against this document, [15-metrics-and-instrumentation.md](15-metrics-and-instrumentation.md) and [16-principles.md](16-principles.md).
It records the strategic decisions made in the founder planning session of 9 Jul 2026, building on the Journey Map v4 ([13-journey-map-ratification.md](13-journey-map-ratification.md)) and the north-star narrative ([12-north-star-and-future-features.md](12-north-star-and-future-features.md)).

## 1. The category: the Integrated Thinking Environment (ITE)

Abstract's category is not "a better word processor" and not "an AI writing tool".
It is the **Integrated Thinking Environment**: the place where an individual thinks, is interviewed, challenges their own reasoning, and runs agentic processes - with all their context, notes and raw data in one folder - then exports the output into whatever their organisation uses.

The mission in one line: **what Claude Code and Cursor gave technical users in the terminal, Abstract gives everyone in a word processor.**

Technical users already live this way: they work in an agent harness with skills, sub-agents, loop engineering and context engineering, and it has transformed how they think and produce.
That capability is currently gated behind the terminal.
Abstract removes the gate.
The user gets the benefits - being interviewed to sharpen an idea, having a skill run a repeatable process, having agents work for them overnight, having their whole corpus as context - inside a calm document surface, with the context windows, model choice and orchestration abstracted away.
That is the literal product name: **Abstract abstracts the agentic stack away.**

The output loop matters: Abstract is where the individual works and thinks; the artifact then flows **out** - exported or published - back into whatever the organisation runs on (Google Docs, Microsoft, email).
Abstract is the hub where the work is made trustworthy; it does not need to be where the organisation reads it (yet).

### Category vs wedge

The ITE is the category and the mission - the fundraise narrative, the reason this is a platform and not a reporting tool.
It is **not** the v1 spearhead.

The **wedge** stays what the spike proved and the site sells: **trust in recurring, multi-document work** - provenance + diff + approval, documents bound to live sources, an agent that does the mechanical work and shows receipts.
The wedge is the demo, the activation flow, and the habit that drives the north-star metric.
Leading v1 with "a place to think" would compete head-on with the chat apps on their home turf and abandon the defensible provenance moat; leading with trust gives the thinking layer a beachhead to grow from.

The analogy to hold: Figma's mission was "design for everyone"; its wedge was collaborative vector editing.
Abstract's mission is "agentic thinking for everyone"; its wedge is documents you can trust.

Concretely, the thinking layer enters v1 as a **default skills pack** - a small set of thinking skills (brainstorm, stress-test, interview-me, summarise-my-thinking and similar) shipped as plain skill.md files in every new project, and **"the thinking session" is promoted to killer flow ④** (see §3).
The design of the individual skills is a separate founder exercise; the slot, the packaging and the principle are decided (see [17-primitives.md](17-primitives.md)).

## 2. The market

### 2.1 Who it is for now (the beta market)

The target market is defined by **AI posture, not job title**:

> Tech-savvy knowledge workers who already use frontier AI every day - ChatGPT desktop, Claude desktop, increasingly Cowork - who know they could get more out of these tools but can't figure out how.
> They are aware of Claude Code, curious about it, and scared of the terminal.
> They have **felt the ceiling** of chat-based document work: iterate on a doc and the whole thing regenerates; the context window fills; quality degrades; it starts hallucinating - and they don't know why, because nobody should have to understand context windows to write a strategy.

Job titles that cluster here: SaaS product managers, consultants, project managers, customer success managers - anyone who spends serious time in documents, thinks strategically, builds reports, or regenerates a project update on a weekly cadence.

This posture definition matters for design: the beta cohort is **tech-savvy, not technical**.
They tolerate - and enjoy - more power showing through than the eventual mass-market floor will.
The P5 plain-words bar (no cron, no tokens, no git verbs) is set for the eventual floor; during beta it is a direction, not a straitjacket (see [16-principles.md](16-principles.md)).

### 2.2 The persona archetypes (from the Journey Map)

Within that market, the map's "accountable operator" faces remain the use-case archetypes:

- **The strategy thinker** (Tom's own daily use): writes strategy documents, uses the product as a thinking partner - the ITE face, and the joy story.
- **The chief of staff / ops generalist**: the weekly pack; assembles other people's numbers into recurring narrative. Fear: Sunday night. **This face leads the wedge**, because weekly cadence is what forms the morning-all-clear habit and drives the north-star metric.
- **The compliance manager** (the ISMS origin story): 24 policies, quarterly audits, decisions land in meetings and must ripple through everything. Fear: an auditor finds a stale clause. **The flagship demo** (transcript fan-out) and the founder-authentic story - but quarterly cadence makes it a demo face, not a habit face.
- **The fund ops / IR lead**: LP letters where every number is checkable by someone with money at stake. Highest willingness to pay, most conservative procurement - deliberately third.

Shared traits (ratified from the map): owns recurring docs whose numbers live elsewhere; pays in reputation, not time; lives in Word; success in their words is "I never ship a stale number", "Monday takes 90 seconds, not Sunday night", "I can prove any figure on demand".

### 2.3 The eventual floor

The long-term market is **all knowledge workers who work in documents, spreadsheets or decks**.
That breadth is the unicorn arc, not the v1 scope; each widening of the floor is earned by the preceding beachhead.

## 3. The killer flows

Four moments carry the product; everything else must not embarrass them.

1. **The morning all-clear** (1w + 1r) - the HABIT. Overnight work → 90-second review → "all clear". Why they come back tomorrow. Design it to feel like inbox-zero.
2. **Transcript fan-out → cross-doc review** (1j → 1k) - the DEMO. One meeting recording updates 24 policies with receipts. Why they tell their boss.
3. **The provenance peek** (1p) - the TRUST moment. Hover a number, see its source and freshness. What they show a colleague first; it demos in 5 seconds. Design it to feel like x-ray vision.
4. **The thinking session** (new) - the JOY. Invoke a thinking skill; the product interviews you, stress-tests you, and the resulting document is better than what you'd have written alone - with every change still landing through review. Why the product becomes part of how they think, not just how they report.

Delight = relief, not fireworks: the product's emotional payload is "nothing is silently wrong" (flows 1-3) and "I think better here" (flow 4).

## 4. Positioning

**The one-line contrast:** chat tools made conversation first-class and demoted documents to artifacts; legacy tools take documents seriously but only one at a time; Abstract makes the document the first-class citizen of agentic work.

Against each alternative:

- **vs ChatGPT / Claude desktop**: they regenerate; Abstract proposes diffs into a persistent document with receipts. They lose context; Abstract's project folder *is* the context, managed for you.
- **vs Word / Google Docs + bolted-on AI**: single-doc, apply-and-hope. No provenance, no review grammar, no multi-doc agency.
- **vs Cursor / Claude Code**: the capability ceiling Abstract aims at, but terminal-gated and IDE-shaped. Abstract is the same power, de-IDE'd - "an IDE turned ITE".
- **vs Notion AI**: a workspace with AI sprinkled in; Abstract is agent-native at the core, with trust as the interface.

The defensible wedge remains **provenance + diff + approval trail** (doc 00) - anyone can generate text; a document you can trust, where every number traces to a source and every change was reviewed, is the moat.

## 5. The business model

**Charge for the workbench, not the tokens** - the Cursor model, decided 9 Jul 2026:

- **Beta**: free. Model usage funded by the founder through the OpenRouter fallback, with users preferentially bringing their own OpenAI subscription via OAuth (see [18-beta-plan.md](18-beta-plan.md) for the full auth stance and its risks).
- **Launch**: per-seat pricing where the seat includes a **bundled usage allowance**; heavy users (many agents running) pay for usage on top. The beta-era auth is replaced wholesale at this point with metered routing across the popular model APIs, as Cursor does - usage tracked and deducted from the account.
- **Model routing as margin and as product**: skills and agents are packaged with the model tier their purpose needs - a cheap model for mechanical formatting, a frontier model for strategic work - and Abstract varies this invisibly. The user buys outcomes, not tokens; the routing is part of "Abstract abstracts it away".
- **Later tiers**: a power/upper tier and a **teams tier** aligned with the cloud chapter (below).

Explicitly rejected: **usage-based pricing as the primary axis.**
It would put the north-star metric (more approved proposals) directly at war with the customer's bill.
Also rejected for beta: paste-your-own-API-key - the target user might obtain a key but will not credit an API account; subscription is the only mental model they own.

The public FAQ currently says "per-seat with usage on top" - close, but it should be reframed to the bundled-allowance model (see [19-website-feedback.md](19-website-feedback.md)).

## 6. The arc: local → cloud → floor

**Chapter 1 (now, the beta): the local fork.**
V1 is the VS Code fork run locally - "a local, non-technical Cursor for documents".
Single-player, folder-on-disk, agents run while the project is open (D5).
This retires open question Q3 (fork vs greenfield) for v1: the fork **is** the beta vehicle; the merge-tax ledger discipline continues so the option to rebuild stays cheap.

**Chapter 2 (post-raise): the cloud.**
Venture funding and a team unlock: agents running in the cloud (while your laptop is closed - D5's open question becomes the paid feature), cloud document infrastructure, and real-time team collaboration.
The identity-keyed format is already CRDT-ready (doc 08 §3.7); D23 keeps approve-from-anywhere portable; D25 sequences collaboration as publish-and-comment before multiplayer.
The single-player-free → team-paid arc maps exactly onto the local → cloud architecture story.

**Chapter 3: the floor widens.**
All knowledge workers; documents, then spreadsheets and decks as first-class living surfaces.
Platform features (doc 12 §3.4: connector catalogue, Abstract as an MCP server, template/skill sharing) turn the product into infrastructure.

## 7. Platform risks (recorded honestly)

- **Model-access policy risk**: the beta's BYO-subscription path (OpenAI Codex-style OAuth) is not officially sanctioned for third-party usage billing, and Anthropic banned the equivalent outright in Feb-Apr 2026. Accepted knowingly as a beta-only stance with the OpenRouter fallback ready; the launch model (metered routing) does not depend on it. Detail in [18-beta-plan.md](18-beta-plan.md).
- **Upstream fork tax**: every VS Code merge re-imports IDE-ness; mitigated by the merge-tax ledger (plans/03) and the 0-core-patch discipline, and bounded in time by chapter 2.
- **Frontier-platform squeeze**: the chat vendors are moving toward documents (Canvas, Artifacts, Cowork). Abstract's answers: the trust grammar (they apply, we propose), multi-doc agency, and files-on-disk portability (P6) - all things a chat surface structurally resists.
- **Single-founder concentration**: the docs in this set exist partly so the project survives context loss; keep them current.

## 8. What we deliberately do not build (reaffirmed)

Doc 12 §4 stands: no general chat assistant, no no-code automation builder, no IDE affordances, no proprietary binary format.
One addition: **no second pathway for a job that already has a clean route** (P2, D20) - the discipline that keeps the surface calm as scope grows.
