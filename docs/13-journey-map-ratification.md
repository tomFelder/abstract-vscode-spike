# 13 - Journey Map v4: ratification into the repo

This document ratifies the **"Abstract - the crucial customer journeys" low-fi map v4** (9 Jul 2026) into the repo's documentation set, per the map's own handoff brief. The map itself is preserved verbatim as the companion visual: [journey-map-v4.dc.html](journey-map-v4.dc.html). It was produced in Claude Design across 8-9 Jul 2026, with Tom's review decisions folded in as D1-D26 and product principles P0-P10 ratified in v3/v4.

**What ratification means here:** the decisions and principles in the map are now binding repo truth, on equal footing with [07-decision-log.md](07-decision-log.md). Conflicts with existing repo docs are flagged below, not silently overwritten. The map's brief mandates three tasks in order: ① ratify the decision log (this document) · ② expand every journey 1a-1z into a detailed spec with acceptance criteria · ③ build against those specs, keeping the BUILT/PARTIAL/GAP chips updated as truth. Task ② is future work; see the note on re-baselining below. **Update (12 Jul 2026):** the walk
(task ②'s first act) is **done** — plan 34 graded all 26 journeys
([plans/34-verify/journey-grades.md](plans/34-verify/journey-grades.md): 7 WALKABLE · 8 FRAGILE ·
2 PARTIAL · 9 MISSING) and the aha-path specs exist ([20-journey-specs-aha-path.md](20-journey-specs-aha-path.md));
the fixes are plan 37, prioritised in [21-beta-v1-prioritization.md](21-beta-v1-prioritization.md).

## 1. The map in one view

Six MECE journey groups, read left to right as a lifecycle, plus a first-principles group Ø:

| Group | Theme | Journeys |
|---|---|---|
| Ø | First principles: persona, killer flows, adoption levers, candidates, gap audit | 2a-2f candidates |
| A | Get work in (projects, files, the on-ramp) | 1a-1d, 1w, 1x |
| B | The core loop (one doc: chat, diff, approve) | 1e-1h |
| C | Across documents (the wedge: multi-doc agency) | 1i-1l |
| D | Context & trust (what it knows, where numbers live) | 1m-1p, 1y |
| E | Living documents (agents, schedules, the inbox) | 1q-1t, 1z |
| F | Work goes out (export, present, interrogate) | 1u-1v |

The persona, killer flows and aha metric from group Ø are ratified and expanded in [14-product-strategy.md](14-product-strategy.md). The principles P0-P10 are ratified and expanded in [16-principles.md](16-principles.md).

## 2. The ratified decisions (D1-D26)

These are Tom's decisions, recorded 8-9 Jul 2026 in the map, now repo truth. Where a decision touches an existing repo doc, the affected doc is named.

| # | Decision | Affects |
|---|---|---|
| D1 | Projects nest: a folder-of-folders opens as one tree; any subfolder can also open as its own project with its own knowledge/agents/skills. | New scope; extends decision 39 (folder is the project) |
| D2 | Opening a project lands on **Project Home** (what ran, what's stale, recent files), not the editor. | Restructures the built Home (plan 22, doc 11) - see conflict C2 |
| D3 | The first screen is a **quick-start modal** (recents + open folder), not "Home". | Same as D2 - see conflict C2 |
| D4 | "From sources…" is in scope for new-doc; plus a **template-creator wizard**: N example docs → agent finds commonalities → template (a skill.md with success examples underneath). | Extends plan 28 / decision 56 |
| D5 | Local-first reality: agents likely only run while the project is open; local server / cloud agent runner is an open architecture question for later. | Constrains plan 32 / doc 09; feeds the cloud chapter in doc 14 |
| D6 | Deleting a doc with dependents: warn + list them; if the user proceeds, orphan gracefully - never block. | Doc 08 dependency model |
| D7 | Proposals stack like unstaged changes; approve = the commit; a newer proposal may supersede a pending one on the same span; no approval needed before re-prompting. | Review engine semantics (decisions 17/45/52) |
| D8 | Editing text inside a pending proposal folds the edit **into** the proposal - no rebase, no invalidation. | Review engine semantics |
| D9 | Autonomy is user-dialled: human-in-loop for everything at launch, then modes aligned with frontier-platform norms (plan mode / auto-accept, à la Claude Code). | Doc 09 policy model |
| D10 | Cross-doc review is ordered **by document** - least context-switching; confidence flags still gate within each doc. | Plan 24 cross-doc review |
| D11 | Chats are scoped per-task; conflict UI deferred past v1 - collisions resolve chronologically (later proposal lands), history keeps both. | New scope (parallel chats, 1l) |
| D12 | The doc's left rail shows its **sources** (linked data sources + watched docs with change-hooks); **context** is per-task and lives with the chat tab. | New surface (1y); doc 09 trigger taxonomy |
| D13 | An **org library** sits above projects: brand, values, mission, KPIs, initiatives, tone, formatting rules - present in every project of the workspace. | New scope; extends plan 29 Knowledge - see conflict C3 |
| D14 | Time-to-all-clear is not THE core metric but is promoted in the UX, on Project Home. | Superseded in part: the core metric is now defined - see doc 15 |
| D15 | Usage, tokens remaining and cost are visible in Settings; a starved run pauses safely and resumes - never dies. | Plan 30/32 run machinery |
| D16 | Agent graph view is a beta-period bet: v1 ships the table (or a very simple graph); prove the power version with real customers. | Plan 32 stretch scope |
| D17 | Published/exported artifacts are **static snapshots** (source links end at publish); when the doc changes, prompt to Republish - sync is a human act. | Conflicts with doc 12 §3.3 and the live website - see conflict C1 |
| D18 | Audit v1 is light: last-changed + numeric +added/−removed inline; no full diff-interrogation while the human is deeply in the loop. | Defers doc 12 §3.2 audit chat |
| D19 | No up-front cost estimates; instead an always-glanceable trio: session usage, context window, budget used - all in Settings, and the context window also lives in the chat as a filling ring. | Plan 30; supersedes any cost-estimate design |
| D20 | No recurring scheduled document **generation** until users ask: creating the same doc from a template already works - don't build a duplicate pathway (P2). | Constrains plan 28/32 |
| D21 | Project Home carries chat: users can talk to the whole project and ask questions of it from the front door. | New surface (1w); pairs with D24 |
| D22 | The customer is always right: the user can **always edit a doc while a chat/run is in flight** (the Cursor workflow); keystrokes and pending proposals coexist, edits fold in per D8. Spec the merge explicitly so it never becomes a data-loss bug. | Review engine semantics; relates to decision 68 (list-sibling bug class) |
| D23 | Mobile is out of scope for v1, but confirmed as the direction: the review/approve API is designed as a **portable act** from day one. | Architecture constraint on plan-26-style work |
| D24 | "Ask the project" is a critical v1 use case; the Home chat defaults to whole-project scope in v1. | New v1 scope (2c ratified in) |
| D25 | Collaboration v1: publish, and readers add comments on the published doc; the author sees them back in their surface and can feed each comment into the chat as a prompt to resolve. Full multiplayer later. | Sequences doc 12 §3.3 comments/multiplayer |
| D26 | Onboarding drives to the provenance peek via a **demo CSV**: chat generates a report from it, then onboarding prompts one iteration so the user also sees a single inline diff in their first ten minutes. Two wow moments, ten minutes, no setup. | New v1 scope; instrumented as T5 |

## 3. Open tests (T1-T5)

Validation work logged in the map, each needing pass/fail criteria at spec time:

- **T1 - Editor fundamentals** (2d): paste from Word with fidelity, tables, images, headings, find-and-replace. A disqualifier if weak (P10); audit before beta.
- **T2 - Migration in** (2e): .docx/.doc/Google Docs/Notion → Markdown with structure preserved; measure fidelity on real beachhead documents.
- **T3 - Mixed-format folder open** (1a): a real folder containing .doc/.docx must be gracefully interpreted/converted/imported on open, not skipped; resolve in-place read vs convert-on-import.
- **T4 - Aha metric**: instrument "first approved **agent** change on the user's **own** file (not sample data)" and confirm it predicts retention. Expanded in [15-metrics-and-instrumentation.md](15-metrics-and-instrumentation.md).
- **T5 - Onboarding flow** (D26): demo CSV → report → one inline-diff iteration; measure time-to-first-approve in the first session.

## 4. Candidate journeys - dispositions

All six Ø candidates were settled in v4:

- **2a Colleague in the loop** → decided (D25): publish + comments-on-published, fed back through chat; multiplayer later.
- **2b First-run orientation** ("the agent reads your folder") → keep; wireframe next design pass. Converts the empty-start problem into a wow moment.
- **2c Ask the project** → ratified into v1 (D24).
- **2d Editor fundamentals** → not a feature, a disqualifier; logged as T1.
- **2e Migration in** → important; logged as T2/T3.
- **2f Approve from anywhere** → out of scope for v1, direction confirmed (D23).

## 5. Conflicts flagged (per the brief: flag, don't overwrite)

**C1 - Publish: static vs living.** D17 says published/exported artifacts are static snapshots with a deliberate human Republish act. But journey 1u frame 3 (in the same map) shows a published page that "re-renders on every approved change", doc 12 §3.3 implies the same, and abstractdocs.com markets "publish to web" under the living-documents pillar. **Ratified resolution: D17 wins.** Published artifacts are static and stamped "verified as of {date}"; the product prompts Republish when the source doc changes. The website copy and doc 12 §3.3 need updating (see [19-website-feedback.md](19-website-feedback.md)).

**C2 - Home: what the first screen is.** Docs 11/12 and plan 22 describe the built Home (NEEDS YOU + ALL PROJECTS) as the landing surface. D2/D3 restructure this: a thin **quick-start modal** is the launch door; **Project Home** (new, per 1w: while-you-were-away, staleness blast radius, recommendations, project chat) is where opening a project lands; the current cross-project Home earns its keep later, "once cloud-based" (D5). **Ratified resolution: D2/D3 win.** The built Home is not wasted - it becomes the seed of the cross-project inbox - but the v1 information architecture is quick-start modal → Project Home → editor.

**C3 - Org library.** D13 introduces a knowledge layer **above** projects (brand, values, mission, KPIs, tone, formatting rules, present in every project). No repo doc models this; plan 29's Knowledge is project-scoped. **Ratified resolution: in scope as architecture** (the layering must not preclude it) **but not a beta gate.** See [17-primitives.md](17-primitives.md).

**C4 - Portfolios (folder of folders).** D1 extends "the folder is the project" (decision 39) to nesting: any subfolder openable as its own project. Doc 08's format spec doesn't address lock-file scoping across nested projects. **Flagged for spec work** when portfolios are implemented; not a beta gate.

## 6. Re-baselining the BUILT / PARTIAL / GAP chips

The map's chips describe the product as of ~8 Jul 2026. Since then, plans 26-33 have all merged (PRs 88-113): history/undo/snapshots, streaming + cancel, templates, knowledge/MCP, performance, review quality, orchestration and shell integrity all landed with 0 core patches. Two truths must be held together when re-baselining:

1. **The plans are complete** - the features named in many GAP/PARTIAL chips now exist on `main`.
2. **The journeys are not** - Tom's assessment (9 Jul): the app is a golden-path alpha; one step off the path and it breaks. Plan-completion is not journey-completion.

The re-baseline exercise is therefore not "flip chips to BUILT" but **walk each journey end to end, off-path included, and grade it**. That walk is the first act of the map's task ② (journey specs with acceptance criteria) and the core of the beta gate in [18-beta-plan.md](18-beta-plan.md). This gap between the two truths is itself ratified as an engineering principle (journey-completeness over feature-count) in [16-principles.md](16-principles.md).
