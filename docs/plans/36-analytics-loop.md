# Plan 36 - Product analytics: PostHog, consent-first, content never leaves the machine

> **For agentic workers:** implement with `superpowers:subagent-driven-development`; small, live-verified, stacked PRs off `main`.
> Context of record: [15-metrics-and-instrumentation.md](../15-metrics-and-instrumentation.md) (the metric tree, the event dictionary, the dashboards - that doc is the spec; this plan is its wiring order); the gate requirement in [18-beta-plan.md](../18-beta-plan.md) §2.2.

**Goal:** Every event in doc 15's dictionary flows to PostHog (free tier) behind an explicit consent moment, session replay works with document text masked, the four dashboards exist, and it is provably impossible for document content or bound figures to leave the machine as analytics.

**Why it gates the beta:** the product currently tracks nothing; without this, the beta produces anecdotes instead of learning, T4 can't be validated, and the golden-path breakages stay invisible.

## The privacy invariant (the one hard rule)

**Document content never leaves the machine as analytics.** Event properties carry counts, kinds, durations, ids and booleans - never prose, never figures, never file names beyond hashed/opaque ids. Session replay masks all document surfaces and the chat composer. This invariant gets an automated test (below), not just a code-review promise, because the product's whole pitch is trust.

## Global constraints

- Consent before a single event: a plain-words moment in first-run ("Help us improve Abstract - we count actions, never your words"), declinable, revisitable in Settings; declining disables capture entirely (not just replay).
- The audit trail is the substrate: proposal/approve/reject/sync events mirror the lock/audit records the product already writes - prefer one emitter at the audit layer over sprinkling capture calls through the UI.
- posthog-js in the renderer via the workbench's sanctioned dependency route (check how the fork vendors third-party libs - the PM bundle pattern in `lwd-pm-bundle-build.md` is the precedent if npm-at-build-time is unavailable); events from the main process go through the same single wrapper.
- One thin `IAnalyticsService` (our-surface, DI per repo conventions) wraps PostHog: the rest of the codebase never imports posthog directly, so the tool can be swapped and the no-consent state is one null-object.
- Tabs; nls strings; Australian English; no em dashes. `typecheck-client` + `valid-layers-check` clean per PR.

## Iteration plan

### Iteration 1 - The service, consent, and identity

- `IAnalyticsService` with `capture(event, props)`, gated on consent state; PostHog project created (free tier), keys in product config (they are publishable, not secrets).
- The consent moment in first-run + a Settings toggle; decline = null-object service.
- Identity: stable anonymous ID at first run; `identify` with email at waitlist-redemption only.
- Gate: unit tests (no capture before consent, none after decline); a live event visible in PostHog from a dev session.

### Iteration 2 - The event dictionary

- Wire every row of doc 15 §3.1: the audit-mirror events (`proposal_created`, `proposal_resolved`, `run_started/finished`, `source_synced`, `undo_after_approve`) from the audit layer; the UI funnel events (`app_opened`, `onboarding_step`, `project_opened`, `provenance_peeked`, `skill_invoked`, `all_clear_reached`, `export_or_publish`, `this_was_wrong_reported`, `model_configured`, `model_spend`) at their surfaces. Where a surface doesn't exist yet (onboarding steps, feedback verb), register the event name in the service's typed dictionary now so later plans emit without schema drift.
- **The privacy test:** a unit/integration test that walks every typed event through a property-linter asserting no property exceeds a length bound, none matches document-body text planted in the fixture, and file paths are hashed. New events fail the build until they pass the linter.
- Gate: a scripted core-loop session (open → chat → proposal → approve → export) produces the expected event sequence in PostHog, verified against a checklist; the privacy test is red-teamed by planting a canary string in a fixture doc and proving it never appears in any payload.

### Iteration 3 - Replay, dashboards, and the weekly ritual

- Session replay on (consent-gated), with document surfaces, the chat composer and source drawers masked; verify by replaying a session containing the canary string and confirming it is visually masked.
- Build the four dashboards from doc 15 §3.2 (north star, activation funnel, habit & retention, guardrails incl. the 5-25% tweak+reject band and staleness escapes); export their definitions/queries to `36-verify/dashboards.md` so they are reproducible.
- Document the weekly review ritual (doc 15 §4) as a short runbook: what to look at, what triggers a user interview.
- Gate: dashboards render with real dev-session data; replay masking proven with screenshots to `36-verify/`.

## Acceptance criteria

- [ ] No event leaves the machine before consent; decline is total; identity is anonymous until waitlist-redemption. _(iter 1)_
- [ ] Every doc-15 event wired or type-registered; the canary privacy test passes and gates new events. _(iter 2)_
- [ ] Replay masks all document content (proven visually); four dashboards live and reproducible; weekly runbook written. _(iter 3)_
- [ ] The rest of the codebase touches analytics only through `IAnalyticsService`.

## Verify approach

Live dev sessions checked against PostHog's live-events view per iteration; the canary red-team is mandatory before iteration 2 closes; screenshots and dashboard exports to `docs/plans/36-verify/`.
