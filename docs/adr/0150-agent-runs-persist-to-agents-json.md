---
number: 150
status: "**Done (plan 32, iter 2; validator-round fixes applied).** Branch `32-orch-first-half`."
provenance: "plan 32, D32-A"
source: docs/07-decision-log.md
---

# Agent runs persist to agents.json

**Agent runs persist to `agents.json` (no new file): `IAgentRun` gains `via` (trigger kind), `docsTouched`, `failed`/`error`, and a `skippedReason`; the log is capped at the last 50 runs with oldest-eviction and reloads on `ensureLoaded`**

Settled to the plan's iteration-2 recommendation. The registry file's on-disk shape becomes `{ agents, runs }` (a legacy bare array still reads as `{ agents, runs: [] }`, so existing workspaces upgrade silently and `LOCK_VERSION`-style bump is not needed). Every trigger kind (cron / heartbeat / event / manual) records one run through `AgentOrchestrator.runAgent`; `getRuns()` returns the log newest-first, `getRunsForAgent(id)` filters it. Truthful automation: a clean run records `applied`/`queued`/`docsTouched` and no `error`; a failed run records `failed:1` + the `error` string; an overlap-skip records `skippedReason:'still-running'` with zero counts. The full run-log UI (relative time, via, outcome counts, failure line, "N queued" link into the review surface) is the plan's iteration-3 detail drawer and is deliberately left to the second-half unit; this half lands the persisted model + the last-run canvas banner that already ships. **Tier: our-surface, 0 core patches.** Verified: 7 fake-clock orchestrator tests (persist + trigger/outcome counts, 50-cap oldest-eviction newest-first, reload-on-ensureLoaded, overlap-skip vs manual-always-honoured, failure-string recorded + surfaced, failure clears on a clean re-run); a validator-round fix then hardens two edges - the overlap guard is ref-counted per agentId so a manual run overlapping a scheduled run keeps the still-running marker up (a second scheduled trigger in that window still records a skip), and the event/heartbeat run clears only the dirty keys it snapshotted at run start (`clearDirtyKeys`) so a concurrent source event that interleaves mid-run is not dropped - adding 3 more orchestrator tests (14 new for the unit overall).
