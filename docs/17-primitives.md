# 17 - The primitives: skills, agents, sources, templates

The agentic layer has been under-designed relative to the document layer - it barely appears in the Journey Map wireframes and has no dedicated repo doc.
This document fixes that: it defines the ontology, the user-facing vocabulary, and where the thinking layer plugs in.
Decided in the founder planning session of 9 Jul 2026.

## 1. The four primitives

Everything agentic in Abstract reduces to four things, and all four are **plain files in the project folder** (P6 - the user can always walk away with them, share them, or read them).

| Primitive | What it is | On disk |
|---|---|---|
| **Skill** | A reusable instruction file: a described process the model can run, optionally with success examples attached. | `*.skill.md` |
| **Agent** | A skill **running on a trigger** - cron/heartbeat/schedule, a hook (source changed, doc changed), or on demand - with a scope, a policy dial, and almost certainly tool calls. | agent definition file (currently `agents.json`; should become per-agent files) |
| **Source** | External truth the project binds to: a file, an API, an MCP connector. Carries kind, freshness, health and auth. | lock entries + Knowledge registry |
| **Template** | A skill specialised for **document birth**: structure + bindings + skills, presented to users as its own thing. Underneath, it is a skill.md with success examples (D4). | `*.skill.md` under templates |

The composition rule that generates the whole system:

> **agent = skill + trigger + scope + policy (+ tools)**

An agent is not a new kind of thing; it is a skill given autonomy.
This keeps the mental model small and the files portable, and it means every capability added to skills (better examples, model routing, org-library context) automatically accrues to agents and templates.

The interaction rule that keeps it safe:

> Whatever invokes a skill - a human in chat, a schedule, a hook, a fan-out - its writes land as **proposals through the one review engine** (P3), gated by the policy dial (P9).

## 2. User-facing vocabulary (decided)

**Keep "Skills" and "Agents" as user-facing words for v1**, alongside "Sources" and "Templates".

Rationale: the beta market is AI-fluent - these words are becoming vernacular precisely through Claude Code and ChatGPT, and renaming them would cost clarity ("wait, is a 'routine' an agent?").
P5's plain-words bar applies to the *mechanics* - no cron strings, no token counts, no git verbs - not to the nouns.

Two refinements:

- **Templates are presented as templates**, never as "skills", even though that is what they are underneath. Implementation ontology and user ontology don't have to match; the map's 1x already shows the wizard revealing "board-note.skill.md" only at the final, curiosity-rewarding step.
- **Triggers speak human**: "every Monday at 7am", "whenever metrics.csv changes", "only when I ask" (1q). The word "agent" is fine; the word "cron" never appears.

Revisit the nouns only when the floor broadens beyond AI-fluent users.

## 3. The thinking-skills layer (the ITE made concrete)

The category-vs-wedge decision ([14-product-strategy.md](14-product-strategy.md) §1) enters the product here.

**Every new project ships with a default skills pack** - a small set of thinking skills that help with the *act of thinking*: brainstorming, stress-testing, interviewing the author to sharpen an idea, summarising a body of thinking.
These are ordinary skill.md files: visible, editable, forkable, deletable - the user's first evidence that skills are just files they own.

Decided boundaries:

- The **slot, packaging and principle are decided**; the design of the individual skills is a separate founder exercise and is deliberately **not** sketched here or elsewhere until that exercise happens.
- Thinking skills produce document changes like everything else: **through the review engine**. A stress-test that wants to rewrite your weakest paragraph proposes a diff; a brainstorm that wants to append options proposes an insertion. No side-channel outputs.
- "The thinking session" is killer flow ④; `skill_invoked` events (thinking skills flagged) feed the metric tree (doc 15 §3.1).

Between **skills, sources and agents, the product becomes a genuine thinking place**: the skills carry the processes, the sources carry the raw truth, and the agents carry the processes forward in time.

## 4. The org library (D13)

A knowledge layer **above** projects: brand, values, mission, KPIs, initiatives, tone of voice, formatting rules - present in every project of the workspace, with project Knowledge beneath it able to override locally.

Status: **ratified as architecture, not a beta gate** (conflict C3 in doc 13).
What this means practically for v1 engineering: context assembly must be **layered** (org → project → task, per D12's split) even while the org layer is empty, so that adding the org library later is filling a slot, not a refactor.
The org library becomes product surface in the cloud chapter, where a workspace exists to hang it on.

## 5. What exists today vs the model

Honest inventory, so the gap is a work list rather than a surprise:

- **Skills**: exist as files and run through review (Skills panel folded into Review, decision 31); no default pack, no thinking skills, no success-examples convention yet (D4's template wizard defines it).
- **Agents**: `agents.json` roster + table exists; triggers exist as scaffolding, but source-watch → graph-walk → dirty-marking only recently landed (plan 32) and needs journey-hardening; the graph view stays a table for v1 (D16).
- **Sources**: file is deep (94% provenance match), API partially real, MCP parses but doesn't resolve; equal-depth provenance peeks per connector is the promise to keep (plan 29 scope).
- **Templates**: nav destination built (plan 28); the from-examples wizard (1x/D4) is designed, unbuilt.
- **Org library**: nothing; slot reserved per §4.

## 6. Principles applied to this layer

- A skill or agent must never be able to bypass review, whatever tools it holds (P3, engineering §3).
- An agent's policy dial is set where the schedule is set - permission and cadence are one decision (1q frame 3, D9).
- Model routing per skill purpose (cheap model for formatting, frontier model for strategy - doc 14 §5) lives at this layer and is invisible to the user: they buy the outcome, not the token.
- Every run, whatever triggered it, gets the same receipts (1t frame 3): automation earns trust exactly the way humans do - through the audit trail.
