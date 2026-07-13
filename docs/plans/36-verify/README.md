# Plan 36 verify - what the founder needs to do (iteration 3 unblock)

This folder is the reproducible evidence for plan 36 (product analytics).
Iterations 1 and 2 are wired and tested; iteration 3 (a live PostHog project, session replay, the four dashboards) is blocked on one manual step only you can do.

## The one blocked step: create the PostHog project and paste the key

The analytics service is built and consent-gated, but it ships with an obvious placeholder key, so it never actually sends anything yet (it does not fake a connection).
To turn it on:

1. Create a free PostHog account at https://posthog.com (US or EU cloud - either is fine; the free tier covers a friends-cohort beta).
2. Create a project. In Project Settings, copy the **Project API key** (it starts with `phc_`).
   This key is *publishable*, not a secret: it can only write events, never read them, so it is safe to commit to `product.json`.
3. In `product.json`, replace the placeholder:

   ```json
   "posthog": {
     "projectApiKey": "phc_REPLACE_ME",
     "host": "https://us.i.posthog.com"
   }
   ```

   Paste your real `phc_...` key in place of `phc_REPLACE_ME`.
   If you chose EU cloud, set `host` to `https://eu.i.posthog.com`.
4. Rebuild and run Abstract, accept the analytics consent prompt on first run, and open PostHog's **Activity** (live events) view.
   You should see `app_opened` and the other events arrive as you drive the core loop.

Until you do this, everything else works: the consent moment shows, the Settings toggle works, the anonymous id is minted, the privacy linter runs - but no network call is made (the service logs at trace and drops).

## How it is safe (the privacy invariant)

Document content never leaves the machine as analytics.
Every event property is a count, a flag, a short controlled label, or an opaque hashed id - never prose, never a bound figure, never a file path.
This is enforced by an automated property-linter that every event must pass before it is sent; a canary test plants confidential document text into every event slot and proves it can never survive to a payload.
The linter also rejects any property that looks like a path (contains `/` or `\`) or is too long to be an enum value.

## What still needs you (iteration 3, not done this session)

- Session replay: turn it on in PostHog and confirm the masking config hides document surfaces + the chat composer (the plan asks for a canary-in-a-replay screenshot).
- The four dashboards (doc 15 §3.2): north star, activation funnel, habit & retention, guardrails. Their query definitions will be exported to `36-verify/dashboards.md` once a real project exists to build them against.
- The weekly review runbook (doc 15 §4).

These are iteration 3 and are intentionally not stubbed with fake data.
