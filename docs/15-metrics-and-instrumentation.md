# 15 - The north star, the metric tree, and the instrumentation plan

Decided in the founder planning session of 9 Jul 2026. Today the product tracks **nothing** - there is no product analytics at all. This document defines what to measure, why each number exists, and how to wire it.

## 1. The north star

> **Approved agent proposals per user per week.**

Trust throughput. It is the product's whole thesis in one number: it only grows if documents are genuinely bound (liveness), the agent's work is genuinely good (quality), and the human genuinely trusts the review loop (the wedge). Thinking sessions count too - a thinking skill's edits land as proposals through the same review engine, so the ITE layer feeds the same number rather than needing its own.

Why not the alternatives:

- **Documents under management** (docs with live bindings + a schedule): a better *investor* optic - it looks like ARR-driving inventory - but it can grow while trust stagnates. Kept as a secondary/reported metric, never the steering one.
- **Time-to-all-clear**: D14 already settled this - promoted in the UX (Project Home shows "all clear in ~N min") but not the core metric.
- **Session time / DAU**: rewards the product being needy; P7 (calm by default) means success can look like *less* time in the app.

## 2. The metric tree

Four layers under the north star, plus guardrails that keep it honest.

### 2.1 Activation - the aha moment (T4)

> **First approved AGENT change on the user's OWN file** (not sample data).

- Target: reached within **10 minutes** of first open, via the D26 onboarding (demo CSV → generated report → provenance peek → one inline-diff iteration; the "own file" aha follows when they bring a real folder).
- T4's explicit mandate: confirm this event actually predicts retention. Until the correlation is measured, treat it as the best hypothesis, not gospel.
- Onboarding sub-funnel to instrument (T5): open → demo report generated → provenance peek hovered → first diff seen → first approve (sample) → first folder opened → first approve (own file). Every drop-off step is a design task.

### 2.2 Habit - the weekly ritual

> **Weekly all-clear completions**: the user opened the inbox/Project Home with items waiting and cleared them to zero that day.

This is killer flow ① instrumented. Secondary habit signals: thinking-skill sessions per week (the ④ flow), and scheduled-agent coverage (share of active projects with at least one agent on a trigger).

### 2.3 Retention - the proof

> **Week-4 retention of weekly-active reviewers** (users who had ≥1 approved proposal in a week and are still doing so four weeks later).

This is the number that validates T4, per its own mandate. For a friends-cohort beta the absolute numbers will be tiny; read them as case studies, not statistics - the instrumentation exists so the *shape* of usage is visible per user.

### 2.4 Guardrails - the metrics that keep the north star honest

- **Tweak + reject rate, healthy band ~5-25%.** Below ~5%: rubber-stamping - users aren't reading diffs, "trust" has become theatre, and the north star is inflating on garbage. Above ~25%: the agent isn't good enough to trust yet (P0 failure). Either end is an alarm even while the north star climbs.
- **Staleness escapes**: a doc exported/published/presented while a bound source was stale or a sync had failed - "never ship a stale number", measured. Target: zero; every occurrence is investigated like an incident.
- **"This was wrong" reports** (the gap-audit feedback verb, see [18-beta-plan.md](18-beta-plan.md)): count and read every one during beta.
- **Undo-after-approve rate**: how often users reach for the way back (plan 26 machinery). A spike marks a trust wound worth interviewing about.

## 3. Instrumentation: PostHog

**Tool decision: PostHog**, free tier, hosted (US or EU cloud).

Why PostHog over Mixpanel/Amplitude:

- Free tier (~1M events/month) comfortably covers a friends-cohort beta at zero cost, which matches the "validate before paying" stance.
- **Session replay is included** - and for the current problem ("the app breaks one step off the golden path and I can't see how people actually use it"), watching real sessions is worth more than any funnel chart.
- Works cleanly in Electron/local-first apps (posthog-js in the renderer; events also postable from the main process).
- Feature flags come free later (staged rollout of risky journeys), and self-hosting remains an option if the trust story ever demands it.
- Amplitude's free tier meters monthly tracked users aggressively; Mixpanel is fine but replay costs extra.

Implementation notes (for the plan that wires this):

- Ship with an explicit, plain-words consent moment in onboarding - a trust-first product must not track silently. Replay masks document text by default; **document content never leaves the machine as analytics**. Event properties carry counts, kinds and durations, never prose or figures.
- Most events derive naturally from the audit trail the product already writes (every proposal, approval, rejection and sync is already logged locally) - the analytics layer is largely a mirror of the lock/audit events plus UI funnel events, not new plumbing.
- Identify users by a stable anonymous ID at first run; tie to email at waitlist-redemption so cohort membership is known.

### 3.1 Core event dictionary (v1)

| Event | Key properties |
|---|---|
| `app_opened` | version, first_open? |
| `onboarding_step` | step name (per §2.1 funnel) |
| `project_opened` | doc_count, has_bindings?, is_first? |
| `change_created` | source kind (chat / fan-out / agent / hook), change kind (figure / meaning), confidence label |
| `change_resolved` | resolution (approve / tweak / reject), latency, bulk? |
| `run_started` / `run_finished` | scope size, cancelled?, failures, duration |
| `source_synced` | kind (file / api / mcp), ok?, staleness_age |
| `provenance_peeked` | hover vs click-through |
| `skill_invoked` | skill name (thinking skills flagged), duration |
| `all_clear_reached` | items cleared, time_to_clear |
| `export_or_publish` | format, provenance mode (clean / footnoted), stale_sources_present? (guardrail) |
| `undo_after_approve` | depth |
| `this_was_wrong_reported` | free-text ref (id only) |
| `model_configured` | provider (openai-oauth / openrouter-fallback), onboarding survey answers (daily-driver model, owned plans) |
| `model_spend` | provider, cost, running daily total, cap_hit? - enforces the fallback's ~$1/user/day fair-usage cap (doc 18 §2.1) and measures cap-hit frequency as a BYO-conversion signal |

### 3.2 Dashboards (one per tree layer)

1. **North star**: approved proposals per user per week, trended; split by proposal source kind.
2. **Activation funnel**: the §2.1 onboarding funnel with drop-off; median time-to-aha.
3. **Habit & retention**: weekly all-clear completions; W1-W4 retention curves of weekly-active reviewers.
4. **Guardrails**: tweak+reject rate against the 5-25% band; staleness escapes (target 0); "this was wrong" count; undo-after-approve rate.

## 4. Review cadence

During beta: look at the guardrail dashboard and session replays **weekly**; interview any user who hits a guardrail alarm or churns. The metric tree is itself a hypothesis - T4's predictive power, the 5-25% band edges, and the 10-minute activation target are all to be calibrated against the first real cohort and revised here.
