# 25 - Why Abstract (the one-pager)

The canon's front page. If a new team member reads one document, it is this one. Everything here
is elaborated elsewhere ([14](14-product-strategy.md) strategy, [23](23-validation-thesis-and-value-hypotheses.md)
validation, [24](24-beta-success-memo.md) proof bar); nothing here should ever contradict them.

## The problem, in the user's words

> "My job runs on documents - the weekly pack, the client update, the quote, the policy set - and
> the numbers in them live somewhere else. Word can't see my folder. ChatGPT can't be trusted with
> it: I paste things in one at a time, it regenerates what I didn't ask it to touch, it makes
> things up, and next session it remembers nothing. I know these AI tools could do 10x more for me
> - I've felt it - but the versions that actually work belong to programmers, in a terminal.
> Meanwhile I'm the one who ships a stale number to the board."

Two gaps, one product: the **trust gap** (AI that applies-and-hopes is unusable for work your
reputation rides on) and the **harness gap** (the agentic tooling that closed that gap for
programmers - Claude Code, Cursor - never shipped for everyone else).

## Who hurts (the faces)

People who own **recurring, high-stakes, data-fed documents** and live in Word/Docs:

- **The chief of staff / ops generalist** - the weekly pack from other people's numbers. *Leads
  the wedge* (weekly cadence forms the habit).
- **The services operator** (agency, consultancy, professional services) - **quotes, proposals,
  SOPs, project/service docs**: template-born, high volume, margin rides on speed and
  consistency, every one assembled from the last one. The purest template + skills use case.
- **The PM / consultant / strategy thinker** - documents as thinking; the ITE joy story.
- **The compliance manager** - 24 policies, one meeting ripples through all of them. The demo.
- **The fund ops / IR lead** - LP letters where every number is checkable. Highest WTP, slowest
  procurement; deliberately later.

Defined by AI posture, not title: tech-savvy, non-technical, frontier-AI-frustrated ([14](14-product-strategy.md) §2).

## Why now

Frontier models crossed the document-work capability threshold in ~2024-25 - but only for people
who could drive them through a terminal harness. The window: platforms (OpenAI, Microsoft, Google)
are bolting AI *onto* documents chat-first, apply-and-hope; none has a trust grammar, and their
architecture (regenerate, don't propose) structurally resists one. Recurring bound documents
compound into switching costs (a year of provenance in the locks nobody else can reconstruct).
The window is real and it is not forever - speed to a defensible position is the strategy.

## Why this wedge

**Trust is the product: provenance + diff + approval.** Anyone can generate text. A document where
every number traces to a source, every change was reviewed, and nothing is ever silently wrong is
the thing the incumbents can't retrofit and the users can't get elsewhere. The wedge is the demo
(hover a number → its source), the habit (Monday takes 90 seconds), and the moat. The category it
opens - the Integrated Thinking Environment - is the mission; the wedge earns the right to it.

## Why us

A year of the founder doing exactly this work in Cursor - strategy docs, reports, policies, whole
folders under agents - proves the *workflow*; only the harness was inaccessible. The spike then
proved the *engine* (agent → diff → approve → provenance, real model, real data, 0 core patches),
and this docs corpus was itself managed by the method it describes (the doc-set test,
[23](23-validation-thesis-and-value-hypotheses.md) §4b). We are not guessing the workflow works;
we are packaging a proven one for the people locked out of it.

## Why it's valuable (what they pay for)

Time plus reputation insurance on the work their job depends on: the scariest recurring hours
become 90 seconds of review, and "I never ship a stale number" becomes checkable. Priced like the
tools they already expense (~$20-40/seat, workbench-not-tokens, [14](14-product-strategy.md) §5).

## What winning looks like

North star: **approved agent changes per user per week** ([15](15-metrics-and-instrumentation.md)).
Near term: the beta clears [24-beta-success-memo.md](24-beta-success-memo.md) - activation, the
weekly habit, real WTP, organic pull - which funds chapter 2: the cloud-first greenfield rebuild
(collaborative, agents that run while your laptop is closed), then the floor widens to
spreadsheets and decks. Local → cloud → everyone who works in documents.
