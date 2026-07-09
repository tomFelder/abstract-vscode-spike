# 18 - The beta plan: gate, model access, cohort, onboarding

Decided in the founder planning session of 9 Jul 2026.
Honest starting point: the waitlist is live and public, the cohort is friends, and the app - despite plans 26-33 all being merged - is a **golden-path alpha**: it works when driven correctly and falls over one step off the path.
This document defines what must be true before the first person outside the founder's driving gets in.

## 1. The gate, in one sentence

> **A stranger can bring a real folder and hit the aha moment (T4: first approved agent change on their own file) without Tom in the room.**

Everything below derives from that sentence.
The gate is explicitly **not** "plans 26-33 complete" (they already are) and not "all journeys done" - it is the smallest set of things that make the aha reachable, observable and survivable.

## 2. Gate requirements

### 2.1 Bring-your-own subscription (model access)

The founder cannot fund API-priced usage for a cohort, and the target user will not credit an API account - subscription is the only mental model they own.
Decided stance:

- **Strip the Anthropic usage path.** Anthropic banned subscription OAuth in third-party tools (terms updated Feb 2026, enforced Apr 2026), and the existing Console-billed OAuth burns API credit nobody is funding. Remove it for beta.
- **Add OpenAI OAuth as the primary path**: users sign in and model calls draw on their own ChatGPT Plus/Pro/Team subscription (the Codex-token pattern; the Hermes agent demonstrates it working today).
- **Keep OpenRouter as the founder-funded fallback/demo tier** for users without a suitable subscription - but on a *good* model, not the cheapest available: P0 says the bar is "more reliable than ChatGPT", and a bottom-shelf model poisons the one thing the beta must prove. Per-user budget caps, with the D15/D19 pause-and-resume machinery making starvation safe.
- **No paste-your-own-API-key.** Rejected: the cohort can obtain keys but won't credit accounts, and it fights the non-technical promise.

**Recorded risk (accepted knowingly):** no OpenAI OAuth surface *officially* sanctions a user's subscription paying for a third-party app's model calls - "Sign in with ChatGPT" is identity-only, and the Codex token is the unofficial exception that currently works.
Anthropic's ban is the precedent for how fast this can close.
Mitigations: this is a **beta-only stance** (the launch model is metered routing per doc 14 §5, independent of any OAuth); the OpenRouter fallback keeps every user functional if the path closes overnight; and an official BYO-subscription partnership goes on the watch list once there is traction to bring to that conversation.

### 2.2 Product analytics

PostHog wired per [15-metrics-and-instrumentation.md](15-metrics-and-instrumentation.md): the event dictionary, the four dashboards, session replay with document text masked, and a plain-words consent moment in onboarding.
Without this the beta produces anecdotes instead of learning; it gates.

### 2.3 Journey robustness (the alpha → beta line)

Not all journeys, and not journeys made *great* - journeys made **walkable**:

- Walk every mapped journey (1a-1z) end to end, off-path included, and grade it against the re-baselining rule in doc 13 §6.
- Every GAP that sits **on the path to the aha** gets at least a partial fill; every PARTIAL on that path gets its broken off-path states fixed (empty states, error states, cancels, recoveries).
- Journeys not on the aha path need a floor, not a ceiling: they may be thin, but they must not fall over or dead-end without explanation.

This work is task ② of the Journey Map brief (per-journey specs with acceptance criteria) executed with a beta-gate priority order: A and B groups first (get work in, core loop), then D (trust), then C (across documents), then E/F.

### 2.4 Onboarding (D26 + the survey)

- The D26 flow built and instrumented (T5): demo CSV → chat generates a report → provenance peek → one prompted iteration → single inline diff. Two wow moments, ten minutes, no setup.
- **The onboarding survey**: which frontier model is your daily driver, which subscriptions do you own, what do you make weekly? Answers stored as `model_configured` properties (doc 15) - this is the data that decides which provider partnership matters and which templates to build first.

### 2.5 The feedback verb

A "**this was wrong**" action on any applied change (from the map's gap audit) - because a beta whose whole thesis is trust needs an in-product way to report broken trust, and every report is read (doc 15 §2.4).
A thin version suffices: flag + optional comment, lands in analytics and a founder-visible log.

### 2.6 Thinking-skills pack

The default pack present in new projects ([17-primitives.md](17-primitives.md) §3), pending the founder's skill-design exercise.
Gates because killer flow ④ should exist from the first cohort - even a two-skill pack makes the ITE story demoable.

## 3. Explicitly not gating (lands during or after beta)

- **Scale work beyond plan 30's baseline** - no beta user has a 300-file folder on day one; the big-folder first-open (gap audit) is a fast-follow.
- **Scheduling depth** - local-first reality (D5) means agents only run while the project is open; the morning all-clear is demoable via on-open heartbeats; cloud agents are chapter 2.
- **Migration tooling (T2/T3)** - start manual: the founder personally converts each early user's folder. It is founder-led onboarding *and* the migration research, and it defers building convert-on-import until its shape is known.
- **Mobile approvals (D23)**, **org library (D13)**, **agent graph view (D16)**, **conflict UI (D11)**, **full audit chat (D18)** - all sequenced by their decisions.
- **Word-grade editor excellence (T1)** - the *audit* happens pre-beta (it is a disqualifier check, P10); the fixes it surfaces are prioritised by severity, with paste-fidelity issues treated as gating and polish items not.

## 4. The cohort and the motion

- **Cohort 1: friends from the waitlist**, onboarded personally, one at a time - "bring a real project; the first document is the demo" (the site's own promise, kept literally).
- Each onboarding is a research session: watch the T5 funnel live, note every off-path stumble, collect the survey.
- Weekly: guardrail dashboard + session replays reviewed; every "this was wrong" report and every churned user interviewed (doc 15 §4).
- Growth stays gated and personal until the aha funnel converts without founder assistance - that conversion, not a date, is what widens the funnel.

## 5. Sequencing (the work between here and the first stranger)

1. **Journey walk + grading** (2.3) - produces the honest work list and re-baselined chips.
2. **Model access swap** (2.1) - OpenAI OAuth in, Anthropic usage out, OpenRouter fallback hardened with caps.
3. **PostHog + consent + event dictionary** (2.2) - so everything after this point is measured.
4. **D26 onboarding + survey + feedback verb** (2.4, 2.5).
5. **Journey robustness fixes** in the 2.3 priority order, validated against their specs.
6. **T1 editor audit**; fix gating findings.
7. **Thinking-skills pack** dropped in when the founder's design exercise lands (parallel to 5-6).
8. First stranger.
