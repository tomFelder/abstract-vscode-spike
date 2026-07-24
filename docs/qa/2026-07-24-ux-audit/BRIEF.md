# UX/QA audit brief - 2026-07-24 full journey re-walk (desktop)

You are one of several Opus audit agents driving the **real Abstract desktop app** (this VS Code fork, built from sources at HEAD). Your job: walk your assigned journeys end-to-end like a real beta user, grade them honestly, and capture evidence. **Audit only - do not fix code, do not commit.**

## Why this audit

The last full walk (plan 34, 9 Jul) predates major merges: analytics (36), journey robustness (37), onboarding (38), the QA wave (#168-#182), the light path (plan 42, PRs 195-210), Editor v2 (plans 43-49, 23 PRs), and the beta-gate file-reality wave (PRs 246-251: desktop persistence, broker dual-stack, CORS, export images, external-edit floor). Prior grades in `docs/plans/34-verify/journey-grades.md` are the **baseline, not the truth** - many findings there (esp. X1 persistence) are believed fixed on desktop. Verify, don't assume, in either direction.

The owner's steer: **"the golden path is pretty robust but one step away from the golden path isn't ideal - functionality missing or non-obvious."** Your emphasis is exactly that: walk the golden path to confirm it, then spend most of your effort one step off it.

## Required reading (before launching)

1. `.claude/skills/launch/SKILL.md` - read fully; it is how you launch and drive the app.
2. `docs/20-journey-specs-aha-path.md` - the spec of record for journeys 1a-1h, 1p, D26 (per-journey golden path, states, off-path behaviours, acceptance criteria).
3. `docs/plans/34-verify/journey-grades.md` - the prior baseline for your journeys (grep for your journey ids).
4. `docs/16-principles.md` - the grading lens (P0-P10, design principles: real data only, honest errors, one review grammar).
5. Anything your assignment names (e.g. `docs/22-file-interop-and-project-layout.md`, `docs/27-data-flow-one-pager.md`).

## Environment

- Node 24 first: `export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"`
- Build is already compiled at HEAD - do NOT run compile yourself. If launch fails on missing output, report it and stop.
- **Own workspace copy** (writes land on disk now; do not fight other agents):
  `AUD=/tmp/audit-<yourgroup>; rm -rf $AUD; cp -R living-docs-sample $AUD` and launch with that path.
- Launch: `LAUNCH=.claude/skills/launch/scripts/launch.sh`, then per the skill:
  `INFO=$("$LAUNCH" -- "$AUD" | tail -n1)` - capture ports with jq, unique `PW_SESSION=<yourgroup>-$$`, drive with `npx @playwright/cli -s=$PW_SESSION`. Use `monaco-paste.sh` for chat input, `press` for keys. `fill`/`type` silently fail on Monaco.
- **Model broker policy:** do NOT pre-start the broker. First exercise a model flow cold and record what a stranger would experience (auto-start is itself under audit; `~/.abstract/openai-oauth.json` exists, so auth is present). If model flows are dead cold, that is a finding - then start `scripts/lwd-model-broker.sh` (background) and continue the rest of the audit with it up. Also probe the broker-down error path deliberately where your journeys call for it.
- Screenshot permission errors: fall back to DOM snapshots + text evidence; note it.

## Method (per journey)

1. **Golden path** exactly as specced. Confirm or refute the spec's acceptance criteria.
2. **Off-path probes** - at minimum, where applicable: reload/relaunch survival (and check the file on disk with `cat`); empty state; error state (broker down); cancel/Esc mid-flight; rename/odd names/unicode; doing it twice/in parallel; entering from the "wrong" door (how would a user find this feature unaided? is it discoverable?); small window; keyboard-only.
3. **Pixel/polish eye**: per the owner's standard, be picky - misalignment, truncation, inconsistent labels, stock-VS-Code leakage into the Abstract chrome, raw internal strings shown to users. Flag even if unrelated to your journey.

## Grading vocabulary (use both axes)

- **Plan-34 rubric** (comparability): WALKABLE / FRAGILE / BLOCKED / MISSING. Any data loss = severity-1 regardless.
- **Owner's categories** (the report axis): for each journey and each notable sub-surface, classify observations as one of: **BREAKS** (kills the experience), **INCOMPLETE** (surface exists, job cannot be finished), **PARTIAL** (works with real gaps), **RESOLVED** (a previously-reported issue now fixed - name the prior finding id), **COMPLETE** (works, survives off-path probes), **DELIGHTFUL** (genuinely exceeds expectation - call these out, they matter), **MISSING** (surface does not exist).

## Evidence & output

- Screenshots: `docs/qa/2026-07-24-ux-audit/<yourgroup>/shots/NN-slug.png` (numbered in walk order).
- Findings file: `docs/qa/2026-07-24-ux-audit/<yourgroup>/findings.md` - per journey: grade (both axes), what was walked, probe results (one bullet per probe, PASS/FAIL/absent), repro steps for every BREAKS/severity finding, screenshot refs, and an honest "not reached" list.
- **Final return message** (to the orchestrator): compact structured summary - per-journey grades, top 5 findings with severity, anything RESOLVED vs plan-34, anything DELIGHTFUL, anything you could not verify (with reason). No file dumps.

## Rules

- Real walks only - every claim traces to something you did in the running app or read on disk. Never grade off the code or the docs.
- Distinguish "not built" from "not reachable in my session" honestly.
- If the app or a whole surface fails to launch, capture the log tail and report; do not debug for more than ~10 minutes.
- Clean up when done: `npx @playwright/cli -s=$PW_SESSION close`, kill your app pid, `rm -rf` your runDir and `/tmp/audit-<yourgroup>`.
