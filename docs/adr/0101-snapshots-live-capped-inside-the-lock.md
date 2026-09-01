---
number: 101
status: "**Done (plan 26 iter 2).** 0 core patches; branch `26-history-undo`."
provenance: "plan 26, D26-A + D26-B"
source: docs/07-decision-log.md
---

# Snapshots live capped inside the lock

**Snapshots live in the lock as a capped `snapshots[]` (in-lock, not a `.history/` folder); autosnapshot triggers are refresh-with-changes, bulk approve, and publish, plus a manual "Save Version"**

Settled to the plan's own recommendations (unattended run). **D26-A (where snapshots live):** a `snapshots: ISnapshotEntry[]` array on `ILivingDocLock` (`{ id, label, at, via, body, auditIndex }`), `body` = the full serialised Markdown, capped at `SNAPSHOT_CAP = 50` with oldest-eviction (~1-5 KB each for beachhead docs). Chosen over a `.history/` folder of `.md` copies so no new sidecar artifact is introduced (avoids re-settling the sidecar/`files.exclude` question) and the lock stays the single durable home; `LOCK_VERSION` stays 1 (additive field, absent = empty, normalised on read in `coerceLock`). The `.md` remains canonical - deleting the lock loses history but never the document. The store sits behind the existing `ILockStore`/service seam so the backing can change without touching callers. **D26-B (autosnapshot triggers):** (1) a refresh/agent run that applies at least one change (one snapshot per doc per run, captures the PRE-refresh body, labelled "Before refresh"); (2) any bulk approve (`approveAll`/`approveAllPending`, captures the pre-approve body, "Before bulk approve"); (3) publish (also snapshots the published body, "Published"). Plain typing does NOT snapshot (PM undo covers it, decision 95). A manual "Save Version" action calls the same `saveSnapshot`. Restore routes through the one approve path: `rejectAll` first, write the body via the existing persist path, append an audit entry (`action: 'approved'`, `via: 'restore'` - a new audit `via`), then `_recomputeFreshness` so bindings that are now behind the sources re-flag (correct + visible). **Tier: our-surface** (model + service + lock-store only); 0 core patches. ~6 new unit tests (2 bundle, 4 service). The truthful History-tab UI + honest version chip (iters 3-4) are a later slice.
