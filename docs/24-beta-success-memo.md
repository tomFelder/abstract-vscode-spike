# 24 - The beta success memo: what must be true

Decided 12 Jul 2026 (decision 157). This is the pre-registered answer to **"what am I really
trying to answer with the beta?"** - written *before* the first stranger so a friendly cohort
cannot validate the idea by default. The beta gates on T4 ([18-beta-plan.md](18-beta-plan.md) §1);
**the raise gates on this memo.** Targets are the founder's to tune before cohort 1 starts -
but tune them now, not after seeing the data.

## 1. The three questions (not just activation)

1. **Does it activate?** Can the target user (tech-savvy, non-technical, doc 14 §2.1) reach the
   aha on their own file, unaided? *(Necessary, already the beta gate - but proves readability,
   not a business.)*
2. **Does it retain - is it a habit?** Do they come back and run the *same* work again next week?
   The product thesis is recurring trusted work (VP3); a tool used once per document is a novelty.
   **This is the raise's centrepiece.**
3. **Will it grow and be paid for?** Do users pull in others without being asked, and does anyone
   put money down when given a real way to?

Everything measured maps to a value hypothesis in [23](23-validation-thesis-and-value-hypotheses.md)
§3, so the beta *ranks the VPs* - the raise narrative leads with whichever survives.

## 2. The funnel: targets and kill thresholds

Assumptions: cohort 1 ≈ 10 hand-onboarded users, growing to ~25 by week 8-10. "Activated" = T4.
All numbers exclude the founder and count from each user's own week 1. Guardrails
([15](15-metrics-and-instrumentation.md) §2.4) apply throughout: tweak+reject inside 5-25%,
zero data-loss incidents, no staleness escapes.

| Stage | Metric (event source, doc 15) | Target | Kill threshold |
|---|---|---|---|
| **Activation** | % onboarded reaching T4 within 48h unaided (after cohort 1's assisted sessions) | ≥ 60% | < 30% after the plan-37 fixes have landed |
| **Value repeat** | % activated with a *second* approved change on a *different* day in week 1 | ≥ 70% | < 40% |
| **Habit (the raise bar)** | % activated who re-run/re-derive the **same document** in ≥ 3 of their first 4 weeks (VP3) | ≥ 40% | < 15% |
| **Depth** | median approved changes per active user per week (the north star) | ≥ 5 | < 2 |
| **Trust** | `undo_after_approve` + "this was wrong" reports per 100 approvals | ≤ 3, all read + answered | a single unexplained data-loss report = stop-ship |
| **WTP** | % of week-4+ actives converting to the charged API tier (§4) within 30 days of it existing | ≥ 25% | 0 conversions from ≥ 10 offered |
| **Growth pull** | % of actives who *unprompted* ask for an invite for someone else, or intro one | ≥ 30% | ≈ 0 and no organic waitlist movement |
| **Sentiment** | "How disappointed if you could no longer use it?" (Sean Ellis, asked at week 4) | ≥ 40% "very" | < 20% "very" |

**VP-ranking cuts** (plan 36 dashboards, doc 23 §4.3): bound-vs-unbound docs (VP2), repeat-run
rate (VP3), single-vs-multi-doc sessions (VP4), skills touched (VP5), import/export direction
(VP6). No target - the *ordering* is the finding.

**Kill rule:** any two kill thresholds hit simultaneously, with their upstream product blockers
already fixed, means the wedge as framed is wrong - stop widening the cohort and re-frame (the
VP ranking says toward what) rather than push growth on a leaking bucket.

## 3. What "growth" means at this size

Not curves - **mechanics**. The beta proves growth if, concretely:

- **Acquisition works outside the founder's network:** by ~week 8, at least 5 users arrived via a
  path that isn't a personal friend (waitlist stranger, referral-of-referral, a user's colleague).
  Cost proxy: warm-intro effort per activated user, trending down.
- **The artifact advertises:** exported/shared documents are the surface non-users see. Track
  whether any inbound names a document they received ("X sent me their board pack from this").
- **Retention precedes referral pushes:** no referral programme until the habit bar holds -
  growth spend on a leaking bucket is the classic seed mistake.

## 4. The willingness-to-pay sequence (decision 158)

1. **Included tier (free, capped):** OpenRouter fallback at ~$1/user/day (doc 18 §2.1) - the
   "check it out" path; cap-hit frequency is itself conversion data.
2. **BYO subscription (free to us):** Sign in with ChatGPT for real usage (plan 35; #120 must
   close first).
3. **Fast-follow, mid-beta - the real WTP test:** one or two **charged metered API routes** (e.g.
   Claude and GPT frontier tiers at cost + margin, billed simply). This is a rehearsal of the
   launch model (bundled allowance + usage top-up, doc 14 §5) and produces the strongest possible
   raise evidence: *beta users paid money during the beta*.
4. The founding-member pre-order page stays available as a secondary signal but is no longer the
   primary WTP instrument.

Plain-words rule holds: pricing is presented as "included / your subscription / pay-as-you-go for
frontier models" - never tokens.

## 5. What the raise deck may claim, and the evidence behind each claim

| Deck claim | Evidence required (from §2/§3) |
|---|---|
| "Non-technical users reach the aha unaided" | Activation ≥ target, with T5 funnel + session replays |
| "It becomes a weekly habit" | Habit bar met; north-star depth trend up and to the right |
| "They trust it with work that matters" | Guardrails held; provenance/export-gate usage; zero data loss |
| "They pay" | §4 step-3 conversions (real revenue, however small) |
| "It spreads" | §3 mechanics observed, named examples |
| "We know what to build next" | The VP ranking + per-face retention cut (which persona retains → chapter-2 GTM, doc 23 Q9) |

The greenfield pitch inherits the *learnings*, not the code (doc 23 Q2): journey grammar, review/
provenance mechanics, funnel numbers, VP ranking, and the collaboration survey data (VP7).

## 6. Operating cadence

- **Weekly** (doc 18 §4, extended): guardrail dashboard + replays; every "this was wrong" and
  every churned user interviewed; **this memo's table updated in-place** - the memo is a living
  scoreboard, not a time capsule.
- **Week 4 and week 8 checkpoints:** formal read against §2; widen the cohort only if activation
  + value-repeat hold; trigger §4 step 3 (charged routes) once ≥ 10 users are week-2+ active.
- **The raise decision** is taken against §5's table, not against enthusiasm.
