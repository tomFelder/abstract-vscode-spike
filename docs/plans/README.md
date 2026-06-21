# Plans & handoff prompts

The prompts that drove (and will drive) the spike, kept verbatim so the thinking is reproducible.
These are the canonical copies; mirrors live in `~/.claude/plans/` for clean-session pickup.

| File | What it is |
|---|---|
| [00-spike-plan-and-outcomes.md](00-spike-plan-and-outcomes.md) | The original master plan (context, the vertical slice, the implementation plan, the reuse map) with the **spike outcomes + Item-5 de-IDE findings** appended. |
| [01-items-0-5-handoff.md](01-items-0-5-handoff.md) | The continuation prompt that drove items 0-5 (Markdown-by-default, fan-out, WYSIWYG, live API, export, Studio skin), with a "how it went" footer. **Done.** |
| [02-studio-de-ide-handoff.md](02-studio-de-ide-handoff.md) | The Studio de-IDE handoff (Documents home, real theme, branded header, gutter redesign, Download-as-Markdown, merge-tax ledger). **Done (PR #2, merged).** |
| [03-merge-tax-ledger.md](03-merge-tax-ledger.md) | Not a handoff — the running ledger of every change by tier (settings/theme/CSS/additive/core-patch). **0 added core patches** through the build-out round; the keep-the-fork recommendation. |
| [04-file-format-options.md](04-file-format-options.md) | The interim file-format options memo (Item G). **Superseded** by [`../08-living-documents-format-spec.md`](../08-living-documents-format-spec.md), which resolved the decision (Option 10). |
| [05-next-phase-handoff.md](05-next-phase-handoff.md) | The design-match + build-out handoff (what shipped this round) plus the **P0/P1/P2 backlog** toward a design-partner pilot. **Done (this branch).** |
| [06-format-implementation-handoff.md](06-format-implementation-handoff.md) | **The live one to run next:** implement the clean-file + lock-file format and the dependency graph per the approved spec (`docs/08`). Foundational — everything else builds on it. |
| [07-orchestration-handoff.md](07-orchestration-handoff.md) | **Runs after 06:** build the orchestration layer per spec (`docs/09`) — triggers (event/cron/heartbeat/manual), the cross-document graph event-bus, per-edge policy, and the verify gate (Skills as graders). Hard-depends on 06's graph. |

## How to use a handoff
Paste the relevant file into a fresh Claude Code session. The handoffs are self-contained: repo /
branch / build / conventions / design source / ordered work items / verification. **[06](06-format-implementation-handoff.md)
is the live one to run next**, then **[07](07-orchestration-handoff.md)** builds the orchestration layer on top.
