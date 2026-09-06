---
number: 183
status: "**Decided.** Amends D5 in [30-editing-architecture.md](../30-editing-architecture.md) without reopening it; binds plan 56 and successors."
provenance: "founder, grilling session"
date: 2026-09-01
---

# LangGraph is a revisit trigger, not a destination

**The agent loop stays hand-rolled. LangGraph and LangChain are recorded as a revisit trigger with named conditions, not as a declared destination, so no seams are built toward them now.**

The founder raised adopting LangChain or LangGraph "ultimately", with a minimal hand-rolled loop first. That contradicts D5 in the architecture of record, which rejected LangGraph as the wrong weight class, the Vercel AI SDK because the provider abstraction is something this product already owns, the SDK tool runner, and the upstream `agentHost` subsystem. The kernel merged under D5 in plan 55.

Three frictions decided it beyond deference to the earlier ruling. **A second persistence layer**: LangGraph's principal value over a hand-rolled loop is durable execution - checkpointers, interrupts, resume - but the architecture already builds that substrate and declares the change store the single authority for counts, verbs, receipts and the audit trail. A checkpointer would be a competing store of run state, which is exactly the two-records-that-can-disagree shape invariant I2 exists to eliminate. **Where the loop lives**: it sits in the `common/` layer, which must run unmodified in both the desktop renderer and the browser, so a heavy graph runtime becomes a large renderer dependency in a VS Code fork, with packaging consequences. **The broker is the control point**: it owns metering, the daily spend cap and the spend audit, and anything that takes ownership of model calls either routes through it or bypasses the product's only economic control - the precise reason `agentHost` was rejected.

The swap is already cheap by construction, which is why building toward it now would be waste. The kernel is a few hundred lines with an injected model client and tool registry; if LangGraph ever wins, the tools, the change store and the broker all survive and only the kernel is replaced.

Conditions that would reopen this: multi-agent supervision beyond a single planner; human-in-the-loop interrupts the change store cannot express; or cross-session durable runs. Absent one of those actually arriving, the answer stays hand-rolled.
