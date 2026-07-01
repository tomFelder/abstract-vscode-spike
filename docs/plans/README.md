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
| [11-design-alignment-loop.md](11-design-alignment-loop.md) | The v2 shell pass — align the running app to the comp at >= 95%; in-surface panels (no editor splits), the tree-rail, calm header, detached gutter, remove VS Code optionality. **Done (`living-docs-design-v2`, PR #15).** |
| [12-design-alignment-v3-loop.md](12-design-alignment-v3-loop.md) | The v3 design loop — push to ~97% indistinguishable; fully close G4 (palette/quick-open keybindings, sash lock), 3-tab right rail, persistent tree-rail. **Done (`living-docs-design-v3`, PR #16).** |
| [13-real-documents-loop.md](13-real-documents-loop.md) | The v5 "Real Documents" loop — open/create a real folder and work in it (R1–R6: on-ramp, folder-reflecting Home, edit→disk, create doc, add/remove source, reference + @mention). **Done (`living-docs-realdocs`, PRs #18–#21).** |
| [14-chatdoc-loop.md](14-chatdoc-loop.md) | The v6 chat-on-document loop — reliable ProseMirror editing + chat (OpenRouter) that generates/revises with an inline diff + review card + accept/reject. **7 of 8 F-gates done** (`living-docs-chatdoc`, PR #22 merged + #23). |
| [15-unify-editor-f7-loop.md](15-unify-editor-f7-loop.md) | v6 completion — make ProseMirror the single editor for ALL docs (bound figures as an inline node, the proposal diff + gutter + source drawer inside PM, bundle as a webview resource), which closes gate **F7**. **Done.** |
| 16-calm-surface-loop · 17-off-the-golden-path-loop · 18-multi-document-editing-loop · 19-editor-led-review-loop | The calm-surface, off-the-golden-path, multi-document, and editor-led-review loops. **Done / landed on `main`** (see the decision log #54–#71). |

### Abstract UI Redesign (the live set — driven by the loop below)
| File | What it is |
|---|---|
| [20-abstract-ui-redesign-handoff.md](20-abstract-ui-redesign-handoff.md) | **Spec of record.** The design implementation handoff: product context (Part A), exact tokens (Part B), px-exact per-surface specs (Part C), code changes (Part D), build order + acceptance gates (Part E), resolved decisions (Part F). Companion pixels: `Abstract - UI Redesign.dc.html`. |
| [21-editor-rail-polish-loop.md](21-editor-rail-polish-loop.md) | Rows 2/3/5 — provenance **gutter** (30px column, dot + bar, hover→source), the **4b sans reading ramp**, and **＋ Skill** in the chat composer. Low-risk, our-surface. |
| [22-project-home-loop.md](22-project-home-loop.md) | Row 6a — the project **Home** on-ramp: greeting, **NEEDS YOU** cards, **ALL PROJECTS** grid, all from the real open folder. |
| [23-project-wide-fanout-loop.md](23-project-wide-fanout-loop.md) | Row 6b — the **fan-out hero**: one instruction across the project, decisions-understood + sub-agent swarm grid, from real run data (+ an ISMS sample). |
| [24-cross-document-review-loop.md](24-cross-document-review-loop.md) | Row 6c — the **cross-document review** surface: doc-nav rail + per-change cards with source + confidence, reusing the review engine. |
| [25-labeled-nav-loop.md](25-labeled-nav-loop.md) | Row 7 — the **76px labeled icon-nav** (Home · Editor · Templates · Knowledge · Agents). The one likely core seam; logged in the merge-tax ledger. |
| [RUN-abstract-redesign-loop.md](RUN-abstract-redesign-loop.md) | **The master loop prompt.** Paste into a fresh session to run plans 21→25 as an overnight, sub-agent-driven loop landing stacked PRs off `main`, each with before/after + comp-comparison images and a design-match score. |

## How to use a handoff
Paste the relevant file into a fresh Claude Code session. The handoffs are self-contained: repo /
branch / build / conventions / design source / ordered work items / verification. Plans 06–14 are
**done** (branches/PRs noted above); **[15](15-unify-editor-f7-loop.md) is the live one to run next**
(unify the editor surface so ProseMirror drives living docs too, then close F7 — the chat-on-document
loop starting from a freshly created folder).
