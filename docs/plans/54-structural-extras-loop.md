# Plan 54 - Structural extras: permissions, templates from examples, starters, tidy artefacts

**Status:** authored 3 Aug 2026; run last of the round (plans 51 → 52 → 53 → 54). **Decisions:** 180 (artefacts under `.abstract/`), plus the per-WP decisions this wave records. **Protocol:** decision 174. **Run prompt:** §6 below.

## 1. What this wave is

The founder's scratchpad items that are real product structure rather than core-loop feel: agents get per-source permissions, templates learn from examples, the Review surface stops being empty-handed, and the app's droppings consolidate. Each package is independent; none blocks daily use, which is why they run last.

## 2. Work packages

| WP | What |
|---|---|
| **A - Per-source agent permissions** | Every source attached to an agent carries a permission: **read** (view), **read-write** (edit), or **read-write-delete** (admin). Default: read. The agent editor's Sources node shows and edits the level per source; the policy table gains the vocabulary. Enforcement is real, not decorative (the WP-E lesson, decision on #257): an agent run attempting a write against a read source refuses with a named reason and an audit row; delete likewise above its level. Schema: the agents registry entry gains a versioned `sources: [{ path, access }]` shape with migration from the current path list. |
| **B - Template from examples** | The F18 wizard (designed in plan 37 / doc 17 §5, never built): a "New from Examples" door on the Templates screen accepts 2-5 existing documents, sends them through the broker with a synthesis prompt, and returns a draft template with `{{slot}}` placeholders where the examples diverge and shared prose where they agree; the user previews and edits before saving as a normal `*.template.md`. Honest failure: examples too divergent → a named "these don't share a shape" refusal, never a garbage template. Works on the OpenRouter door. |
| **C - Review starters** | The Review surface's Skills fold ships a small placeholder pack so it is never empty-handed - e.g. "Tighten Prose", "Check Figures Against Sources", "Consistency Pass" - each a real runnable skill with honest, modest prompts, clearly labelled as starters. Boundary (planning-spine decision, 9 Jul): the real thinking-skills default pack remains the founder's own design exercise - these are scaffolding, and the PR must not editorialise a skill philosophy. |
| **D - Artefact tidy** | Inventory every path the app writes (lock sidecars, `assets/<doc>/`, exports, `.abstract/knowledge/`, `~/.abstract/*`, `data/<workbook>/`). Doc 22's conventions are the spec: app-internal caches and state consolidate under the workspace `.abstract/` (hidden, decision 180); user-facing artefacts (exports, extracted CSVs, assets) stay visible beside their documents; lock sidecars stay beside their doc (format spec, doc 08). The WP lands: the inventory table in the PR, any stragglers moved with migration, and a decision-log row recording the final map. The Tidy verb's missing door (#262 item) gets its entry point here if #262 didn't already land it. |

## 3. Sequencing

All four packages are disjoint: **A** (agents contrib + registry), **B** (templates screen + broker prompt), **C** (skills fold content), **D** (service write-paths). Run up to 3 lanes; C is small enough to ride with B's lane. `livingDocsService.ts` changes route through the orchestrator as additive methods. Core-patch budget: **0**.

## 4. Acceptance floor

- [ ] A: a read-only source survives an agent run untouched, the refusal is user-visible with a named reason and an audit row; read-write allows edit but refuses delete; migration keeps every existing agent working unchanged; relaunch persistence.
- [ ] B: three real example docs in → a template with sensible `{{slot}}`s out, previewed, edited, saved, then used via the normal Use flow to birth a correct new doc; the divergent-examples refusal proven with a deliberately mismatched set.
- [ ] C: the starters run end-to-end on a real doc via the OpenRouter door and produce proposals that flow through the normal review loop; each is visibly labelled a starter.
- [ ] D: the inventory table on the PR matches reality (validator `cat`s and `ls`es); no app-internal file is visible in the Files tree; nothing user-facing got hidden; migration is lossless on a populated real folder.
- [ ] Every WP: before/after screenshots on the PR; issues closed only on validator-confirmed PASS.

## 5. Verification traps

Plan 50 §4 applies in full (TMPDIR, node 24, compile-before-launch, webview CDP targets, broker respawn, ≤3 instances). Wave-specific: agent-run enforcement (WP-A) and synthesis (WP-B) need the live OpenRouter door - budget real model calls inside the $1/day cap and batch validator walks; WP-D's migration probes run on a COPY of a populated folder (`cp -R` the sample), never in place, and diff the tree before/after.

## 6. RUN (paste into a fresh session)

Execute **plan 54** (`docs/plans/54-structural-extras-loop.md`) until its §4 floor is ticked or honestly parked, as one continuous unattended run. You are the Fable orchestrator: plan, dispatch, adjudicate, never implement. Implementers and adversarial validators are separate Opus sub-agents (`model: "opus"`); a validator never sees its implementer's conversation.

Step 0: create the wave umbrella issue (title "Structural extras: permissions, template-from-examples, starters, artefact tidy (plan 54)", body = §2 + §4) and per-WP issues; read plan 50 §4. Per WP: draft PR with its checklist → Opus implementer (worktree) pushes with before/after screenshots → independent Opus adversarial validator rebuilds, launches desktop, and walks the WP's journeys golden-path-plus-off-path (relaunch, `cat` on disk, cancel, empty state, deliberately hostile inputs - a mismatched example set for B, a delete-hungry agent for A) and is the ONLY party that ticks boxes, evidence attached. Implementer and validator argue on the PR. Max 3 fix rounds then park. Squash-merge on PASS; rebase live lanes after any merge; run touched suites on post-merge main.

Enforcement claims (WP-A) and refusal claims (WP-B) are the wave's trust surface: the validator must attempt the forbidden action and screenshot the refusal, not infer it from code. Conclude with the closing summary on the umbrella (every PR, every walk verdict, the WP-D artefact map) and a founder push notification. Iteration budget 20. No checkpoints, no AskUserQuestion.
