---
number: 151
status: "**Settled (plan 32); drawer + inline edits deferred to the second-half unit.**"
provenance: "plan 32, D32-B"
source: docs/07-decision-log.md
---

# The workflow canvas is read-only for now

**The Agents-screen workflow canvas is read-only for the validation phase - a horizontal node strip (comp style); editing happens through small inline controls (policy select, trigger field), and drag-editing is deferred**

Settled to the plan's stated recommendation (read-only strip; inline edits over a drag editor). This first-half unit does NOT build the iteration-3 detail drawer / inline controls (that is the second-half unit's scope); it records the settled shape now so the second half builds to it, and confirms the existing read-only canvas (`renderAgentCanvas`, the trigger -> sources -> agent -> verify -> policy -> documents -> review-rail strip) already matches D32-B's read-only intent. The one iteration-2 surface this half does add is the Home quiet attention line for a failed scheduled run ("Weekly refresh failed on Monday - view details", linking to Agents), which is real-data-only: rendered solely from the latest failed run via `getLatestAgentFailure`, absent when nothing failed (no fabricated activity). **Tier: our-surface, 0 core patches.** Verified: 2 render-harness tests (failure line present with the agent + day and a `goAgents` link when a run failed; NO failure line when nothing failed).
