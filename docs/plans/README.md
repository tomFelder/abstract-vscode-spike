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
| [06-format-implementation-handoff.md](06-format-implementation-handoff.md) | Implement the clean-file + lock-file format and the dependency graph per the approved spec (`docs/08`). Foundational. **Done (`living-docs-format`).** |
| [07-orchestration-handoff.md](07-orchestration-handoff.md) | Build the orchestration layer per spec (`docs/09`) — triggers (event/cron/heartbeat/manual), the cross-document graph event-bus, per-edge policy, and the verify gate (Skills as graders). **Done (`living-docs-orchestration`).** |
| [08-design-audit-handoff.md](08-design-audit-handoff.md) | The design-audit loop: drive the web build, diff against the DesignSync source, score and close gaps. **Done (`living-docs-design-audit`, PR #9).** |
| [10-anthropic-oauth-handoff.md](10-anthropic-oauth-handoff.md) | Wire Claude into the agentic features via a localhost Anthropic OAuth proxy (credential server-side). **Done (`living-docs-model`, PR #11).** See [`../10-model-integration.md`](../10-model-integration.md). |
| [09-v1-functionality-handoff.md](09-v1-functionality-handoff.md) | Take every core surface from "looks like the comp" to "works like a v1" — Chat agent, Apply-fix, editor source-peek/Sync-across, context kinds, polish. **Done (`living-docs-v1`, PR #13)** — all 7 v1 criteria >= 85. |
| [11-design-alignment-loop.md](11-design-alignment-loop.md) | **The live one to run next:** the v2 shell pass — align the running app to the comp at >= 95% (UX/UI/IA/visual). Kill the split-pane/blank-pane abrasion (in-surface panels, no editor splits), build the design's left tree-rail, calm the header, detach the provenance gutter, remove VS Code optionality. **Core patches now allowed where the design needs them**, logged in [03](03-merge-tax-ledger.md). |

## How to use a handoff
Paste the relevant file into a fresh Claude Code session. The handoffs are self-contained: repo /
branch / build / conventions / design source / ordered work items / verification. Plans 06–10 are
**done** (branches/PRs noted above); **[11](11-design-alignment-loop.md) is the live one to run next**
(the v2 design-alignment loop — iteration 1 is the audit, the first code iteration is the split-pane
redesign).
