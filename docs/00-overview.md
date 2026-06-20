# 00 — Overview

## The product idea

**Opportunity OS / Living Documents** is an AI-native, **non-technical-friendly word processor**
for business/office users. The core ideas:

- Documents stay **bound to live data sources** (a CSV, an API, a CRM, a sheet).
- An **agent keeps the document current** as those sources change.
- **Every change surfaces as an auditable red/green diff that a human approves** before it lands.

The defensible wedge is **provenance + diff + approval trail** — *not* faster generation. Anyone
can generate text; the value is a document you can trust, where every number and claim traces back
to a source and every change was reviewed.

**Beachhead:** recurring, data-linked reports — weekly operating summaries, LP letters, client
updates, board notes. Documents that are re-written on a cadence from the same underlying numbers.

**Audience:** people who live in **Microsoft Word, Google Docs, and Notion** — emphatically *not*
developers. This audience expectation is the single most important design constraint and the
source of the central risk (see [04](04-risks-and-predictions.md), [05](05-open-questions.md)).

## The core loop (the thing the whole spike exists to prove)

```
metrics.csv week-24 row changes (MRR 41.2k -> 48.6k, signups 312 -> 427, churn 3.1 -> 2.4)
   -> the bound "Weekly Summary" doc re-derives its blocks
        - the Highlights figure (12% -> 18%) is FIGURE-only / low-risk -> AUTO-APPLIES
        - the Commentary "steady" -> "accelerated sharply" is a MEANING change -> WAITS in the review rail
   -> a human approves -> applied to the doc, an audit entry recorded,
      and a provenance link ties the Commentary back to the MRR row in the CSV
```

This loop ran end-to-end on a real model/API call against real data in the spike.

## Why VS Code was the base (and the honest caveat)

The spike forked a very recent VS Code build (`code-oss-dev` 1.126.0, which ships an "Agent Host").

**Why it's a credible engine:**
- The agent -> diff -> approve -> provenance loop is **~70% already built**: an Agent Host
  (Anthropic protocol), chat-editing sessions with per-file accept/reject + an auto-accept
  controller (≈ "low-risk auto-applies, meaning-changes wait"), a decorations engine for inline
  diffs + gutter provenance, and `ILanguageModelToolsService` + MCP for binding external sources.
- The editor is **not locked to Monaco** — clean `EditorPane`/`EditorInput` abstraction; many
  non-text editors already exist (notebook, settings, terminal, merge, image).
- The three-pane workbench (activity bar / side bar / editor / auxiliary bar) maps ~1:1 onto
  "Direction 01 — The Workbench" design.

**The caveat (named from the start, now evidenced):** the product's north star is calm,
"not an IDE," non-technical — and that fights VS Code's deeply embedded IDE-ness. Every upstream
merge re-introduces the IDE chrome (Cursor's tax). The honest arc was always: **spike on VS Code
to prove the engine, then decide** keep-the-fork vs rebuild-the-shell-on-web. The spike's job was
to de-risk the engine, not to commit to the fork. See [03](03-learnings.md) / [05](05-open-questions.md).

## What the spike set out to do

A **real thin vertical slice** (not a faked shell): prove the loop runs on a real model call
against real data, then extend it (multi-doc, WYSIWYG, live API, export) and stress-test the
de-IDE-ing. It deliberately left out: full WYSIWYG maturity, templates/knowledge/agents screens,
real auth/persistence hardening, and committing to a file format.

## Design source

The visual design lives in the Claude Design project **"Agentic Workbench"**
(projectId `d198ca07-9eef-4d05-96e1-b383e6c19c03`): a one-pager pitch, a four-direction
exploration (**01 Workbench** / 02 Studio / 03 Source-of-Truth / 04 Review Inbox), and the
**Workbench hi-fi**. Direction 01 is the locked choice. The spike's shell does not yet match the
hi-fi — closing that gap is the next phase.
