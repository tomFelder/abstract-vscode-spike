# Living Documents — design-audit log

Tracking the gap between the running app (`living-docs-design-audit` branch, web build at
`http://localhost:8080` via `./scripts/code-web.sh ./living-docs-sample`) and the **Claude Design**
(DesignSync project "Agentic Workbench" `d198ca07-9eef-4d05-96e1-b383e6c19c03`, file
`Living Documents - Workbench.dc.html` — the locked hi-fi comp; its inline styles are the pixel spec).

**Goal:** >= 90% visual + functional match, surface by surface, with core flows working.
Each surface scored 0-100 = avg of five dimensions: **Layout**, **Styling**, **Components**,
**Information architecture (IA)**, **Behaviour**. Overall = mean across surfaces. Scoring is honest:
a surface that looks right but whose flow doesn't work is dragged down by Behaviour.

Viewport for all shots: **1440x900**, system Chrome via chrome-devtools MCP.

---

## Score trajectory (overall)

| Iteration | Overall | Note |
|-----------|---------|------|
| 1 (baseline) | **~78%** | Full survey, baselines seeded below. |
| 2 | **~80%** | Context panel 48 -> 80: now groups Linked sources + Referenced files (was a flat list that omitted the doc's bound sources entirely). |
| 3 | **~81%** | Global top bar added to all four screens (Home/Templates/Knowledge/Agents) — brand + crumb + sync pill + Present + avatar. Lifts Home 82->85, Templates 88->89, Knowledge 80->83, Agents 82->84. |
| 4 | **~82%** | Present modal WHO CAN ACCESS now shown for every export (was site-only) 80->85; workflow canvas verified rendering + functional 72->80. |
| 5 | **~83%** | Knowledge verified: Project tab's Strategy + Q3 OKRs (KR bars) + metrics are built 83->88; editor top bar gains the TS avatar (consistency) + gutter dots / inline-diff / approve-reject verified built 80->84. |
| 6 | **~84%** | **Functional fix:** the navigation blank-out bug is resolved — screens (Templates/Knowledge/Agents) now render reliably after a document editor was open (was: blank main area). Verified live + auto-figure sync + agent run/canvas flow. MCP restored. |
| 7 | **~86%** | **Core flow verified live:** Review rail 55->82 — Review impact queues pending meaning-changes (inline + right rail, old→new diff, confidence, risk); **Approve applies & clears**, **Reject discards & reverts**. The product's central approve/reject loop works end-to-end. |
| 8 | **~86%** | **Functional audit:** editor raw-Markdown editing verified (round-trips to the clean-file bind-link format). All core flows now confirmed functional. Pinned down that Chat/History/Skills tab bodies are *intentionally static comp reproductions* — composer + Apply-fix/Run/Re-run not wired (only Approve-all/Review-each are). Honest scoring note below; no inflation. |
| 9 | **~86%** | **Skills tab made functional** (was static): real deterministic graders — Financial reconciles all 12 bound figures (PASS) + working Re-run; Formatting flags the 2 sentence-case headings (live count) + Run; Strategy honestly reports NO MODEL. Closes the iter-8 functional gap. Skills score now *earned*, not just visual. |
| 10 | **~86%** | **Final re-score + summary** (10-iteration cap reached). All core flows live-verified functional. Honest landing: ~86% — short of the 90% early-exit; remaining gap is model-gated/data-model work, documented below. |
| 11 (v1 #1) | **functional focus** | **Chat is now a real model-backed agent** (was a static comp reproduction). Live composer + `@mention` chips + tool-step rendering; the agent replies from the document + sources via `_callModel`, and any prose edit it proposes queues into the Review rail (inline diff + Approve/Reject + Approve-all). Verified live (OpenRouter test backend): a "tighten the Commentary" ask produced a real rewrite, queued it, and Approve applied it to the prose. Closes the biggest dead-control (criterion 2 + criterion 6). |

---

## Plan 9 — v1 functionality & UX loop (per-criterion scores)

The loop now scores the **7 v1 criteria** from `docs/plans/09-v1-functionality-handoff.md` (v1 = every line >= 85),
weighted to *behaviour*. Carrying the visual match forward at ~86% (design-audit landing, unchanged).

| # | v1 criterion | Iter 10 (start) | Iter 11 | Real / rough |
|---|--------------|:--:|:--:|------|
| 1 | Agentic loop is real (model-backed) | 86 | **88** | **Real.** Context "Review impact" rewrites (plan 10) *and* now the Chat agent path both yield model rewrites that land in Review. |
| 2 | Chat is a working agent | 40 | **88** | **Real (live-verified).** Composer, `@mention`, model reply over doc+sources, tool-steps, proposed edits → Review, Approve-all/Review-each. Rough: `@mention` is chip-insert + parse (no keystroke autocomplete); model pill is static. |
| 3 | Skills run for real (+ Apply-fix) | 72 | 72 | Graders real (Financial/Formatting/Strategy). **Open:** Apply-fix doesn't yet edit the doc. Next lever. |
| 4 | Editor is a real editor | 72 | 72 | Toolbar + raw-Markdown + inline diff real. **Open:** source-peek + "Sync across" pane; clickable provenance dots. |
| 5 | Context is complete | 70 | 70 | Linked sources + Referenced files real. **Open:** Pasted text / Images / Company knowledge + Add context (needs context-kind model ext). |
| 6 | No dead ends, no rough edges | 70 | **80** | Chat (the largest dead control) is now real; nav fix held; subtitle tracks resolved week. **Open:** dev-build extension-activation error toast still shows. |
| 7 | Core flows pass tests + live click-through | 80 | **85** | Chat flow has 5 new TDD tests (40/40 green) + a clean live click-through. |

**What works (iter 11):** open Weekly Summary → Chat tab → real composer with live `@metrics.csv` / `@market-research.md`
chips → send → model reply with a ✓/→ tool-step card → proposed Commentary rewrite queued (inline diff in the
editor + Review rail "1" + Documents "1 pending") → Approve all → applied to the prose, badges cleared, history kept.
**What's rough:** no keystroke-triggered `@mention` dropdown (chips + parse only); the model/agent pills are static;
extension-activation error toast still appears on load. Shots: `shots/iter11-chat-composer-before.png`,
`shots/iter11-chat-agent-reply.png`, `shots/iter11-chat-edit-applied.png`.

**Next (highest lever):** criterion 3 **Apply-fix** — make a Formatting/Strategy suggested edit actually edit the doc
(reuse the chat→`IProposedChange`→approve path just proven), then criterion 4 source-peek/Sync-across.

---

## Iteration 1 — baseline survey (all surfaces)

Surveyed every surface in the comp's set and seeded baselines. **No gap closed this iteration** — per
the handoff, iteration 1 is the survey. Iteration 2 attacks the lowest-scoring, most-visible gap.

### Baseline scores

| # | Surface | Layout | Styling | Comp. | IA | Behav. | **Score** | Shot |
|---|---------|:--:|:--:|:--:|:--:|:--:|:--:|------|
| 1 | Home dashboard | 75→88 | 88 | 90 | 82 | 75 | **82** → **85** (iter 3) | `shots/baseline/01-home-app.png` → `shots/iter3-home-after.png` |
| 2 | Document editor (rendered) | 78 | 82→84 | 75→82 | 85 | 78→84 | **80** → **84** (iter 5) | `shots/baseline/02-editor-app.png` → `shots/iter5-editor-topbar-after.png` |
| 3 | Templates (run wizard) | 90 | 88 | 90 | 88 | 86 | **88** → **89** (iter 3) | `shots/baseline/03-templates-app.png` → `shots/iter3-templates-after.png` |
| 4 | Knowledge (decision stack) | 82 | 85 | 72→88 | 85→90 | 78→88 | **80** → **83** (iter 3) → **88** (iter 5, verified) | `shots/baseline/04-knowledge-app.png` → `shots/iter5-knowledge-project.png` |
| 5 | Agents list | 85 | 84 | 85 | 78 | 80 | **82** → **84** (iter 3) | `shots/baseline/05-agents-app.png` |
| 6 | Workflow canvas | 75→80 | 75→82 | 70→78 | 75→80 | 65→80 | **72** → **80** (iter 4, verified) | `shots/iter4-canvas-verified.png` |
| 7 | Context panel | 50 | 55 | 35 | 55 | 45 | **48** → **80** (iter 2) | `shots/baseline/06-context-app.png` → `shots/iter2-context-after.png` |
| 8 | Right rail — Chat | 90 | 92 | 90 | 90 | 85 | **90** | `shots/baseline/07-chat-app.png` |
| 9 | Right rail — Review | 60→85 | 60→85 | 50→85 | 60→85 | 45→80 | **55** → **82** (iter 7, verified live) | `shots/baseline/10-review-app.png` → `shots/iter7-review-populated.png` |
| 10 | Right rail — History | 92 | 92 | 92 | 92 | 90 | **92** | `shots/baseline/09-history-app.png` |
| 11 | Right rail — Skills | 88 | 90 | 88 | 90 | 85→90 | **88** (now functional, iter 9) | `shots/baseline/08-skills-app.png` → `shots/iter9-skills-functional.png` |
| 12 | Present / export modal | 85 | 85 | 75→85 | 80 | 78→85 | **80** → **85** (iter 4) | `shots/baseline/11-present-app.png` → `shots/iter4-present-after.png` |

**Overall (after iter 7): ~86%** (baseline was ~78%). The app is a genuinely high-fidelity recreation — most
surfaces are 80-92. The number is dragged down by three real holes: the **Context panel**, the
**populated Review rail**, and the **workflow canvas** (unverified).

### Cross-cutting findings (affect multiple surfaces)

- **Global top bar is missing on every non-editor surface.** The design has a single 48px top bar
  across *all* screens (`L` logo, "Opportunity OS / {crumb}", green **"All sources synced"** pill,
  **Present** button, **TS** avatar). In the app this bar exists **only inside the document-editor
  webview** — Home / Templates / Knowledge / Agents render without it. This is the most pervasive
  layout gap and lowers Layout on surfaces 1, 4, 5.
  *Design feature not yet built (as a global chrome element).*
- **Left-rail IA diverges from the comp.** The design is a single 264px tree-rail with tabs
  **Files / Context / Outline / Search** and a folder tree (Reports / Clients / Sources / Templates).
  The app uses the VS Code activity bar as the icon-nav (intentional, per arch decision) but splits
  the rail into separate containers — **Documents** (flat list of 2 docs, no folders) and **Context**
  (separate icon) — with no Outline or in-rail Search, and no source/template folders. IA divergence.
- **Navigation bug: launcher screens blank out after opening a doc.** From a clean load, clicking an
  icon-nav screen (Templates/Knowledge/Agents) renders its main-area webview correctly. But once a
  Living Document editor has been opened, clicking a screen's "Open X" launcher leaves the **main area
  blank**. Reproduced on Templates, Knowledge, and Agents; a page reload restores rendering.
  *Bug in built behaviour — strong candidate for an early iteration.*
- **Builtin-extension error toasts on load** ("Activating extension 'vscode.merge-conflict' /
  'git-base' / 'emmet' failed: Not Found"). Cosmetic noise from deregistered builtins; not in the
  design. Minor, but pollutes first impression.

### Per-surface diff notes

**1. Home** — Strong match: greeting + summary strip, QUICK START (3 cards), YOUR PROJECTS 2x2 grid
with per-project "since your last visit" + approval pills + Review/Open buttons, "All·4 / Needs
approval·2" filter. Gaps: (a) no global top bar; (b) the Context panel + right rail are visible
flanking Home, but the design shows Home full-bleed (icon-nav + centered 1080px content only — the
tree rail is hidden via `notHome` and no right rail). Behaviour of "Open project"/"Review change"
buttons not yet verified.

**2. Document editor** — Has the doc top bar (branding/sync/Present/Download/Refresh), a formatting
toolbar (Heading/B/I/U/List/Quote/Ask AI/raw-markdown), rendered title + bound subtitle, Highlights,
KPI table (Metric/Previous/Current/Change), Commentary, What to watch, provenance hint footer.
`Refresh from sources` works (sync status flipped to "2 documents synced"). Gaps vs design: no
**doc tab bar** (design shows Weekly Summary.md / Q2 Strategy.md / metrics.csv tabs), no
**provenance gutter dots**, no **source-peek pane** + **"Sync across" circle** on a divider, KPI table
styling plainer than the comp. The design's editor also leads with a tabbed document surface rather
than a formatting toolbar.

**3. Templates** — Near-exact match to the comp's "Run template — Weekly report" wizard: numbered
steps (1 Template ▾, 2 Prompt + 🎙 Voice, 3 Sources + add source), Generate draft, and a live
**Draft preview** with "ALL SLOTS RESOLVED" badge, green=filled-from-source highlighting, Review diff →
/ Export. Highest-fidelity surface. Minor: the sidebar "Open Templates" launcher is extra chrome the
design doesn't have.

**4. Knowledge** — Matches the ENDURING (Mission/Vision) + HOW WE OPERATE (Values/Principles) +
"How this is used" + DECISION STACK (Mission&Vision → Strategy → OKRs&KPIs) blocks, plus the
Organization/Project toggle + Edit. **Needs scroll-verification:** the comp also has DIRECTIONAL
(Product Strategy wedge/moat/expand) and MEASURABLE (Q3 OKRs with KR progress bars + Activation /
Net retention / Time-to-trust metrics) — these were not visible in the captured viewport; confirm
they render below the fold or are missing.

**5. Agents list** — Table with AGENT/TRIGGER/**POLICY**/FLOW/LAST RUN/STATUS and filters
(All·5/Scheduled·2/Event·3/Needs approval·0), "+ New agent", per-row "open ↗". The app actually
carries *more* than the comp (added POLICY column + lifecycle agents from the orchestration build:
Source-change watcher, Freshness sweep, Before-export gate, On-publish snapshot). Gaps: comp's FLOW
is specific ("metrics.csv → Weekly Summary.md"); app shows generic "all sources → all documents".
Filter labels differ (comp: Scheduled/Triggered/Needs approval·1).

**6. Workflow canvas** — **Not captured.** The Agents list footer says "open an agent to see its flow
on the canvas, then Run now"; the orchestration build (PR #6) reportedly added this. The comp's canvas
has SOURCES → agent → DOCUMENTS columns, a Run-now control, and a run-complete banner with Review →.
Verify it renders and scores it next time it's the top gap.

**7. Context panel** — **Biggest gap.** App shows a near-empty panel: heading "CONTEXT / Sources that
shape this document." + one item ("market-research.md · current") + "Review impact (up to date)". The
comp is a rich, multi-category inventory of *everything the agent can see*: **LINKED SOURCES·3**
(metrics.csv live, crm.api, kpi.webhook with freshness dots), **REFERENCED FILES·2**, **PASTED TEXT·1**,
**IMAGES·2** (thumbnails), **COMPANY KNOWLEDGE·3** (auto-attached), and a "+ Add context" button. This
surface is central to the product's "what the agent sees / freshness" value prop.

**8. Right rail — Chat** — Near-exact: agent activity feed (@mentions, tool-call checklist
"Read metrics.csv · 12 rows / Diffed against last sync / Found 3 changed values"), applied-figure
chips (MRR 12%→18% applied, Signups 312→427 applied), "⚠ Commentary rewrite Review →", run summary
("3 changes · Approve all / Review each"), follow-up Q&A, and a composer (Sonnet 4.5 ▾ · Agent ▾ · ↑).

**9. Right rail — Review** — Shows the **empty state** ("No changes waiting…"). The comp's populated
Review is the core approval flow: "Pending review / metrics.csv changed · 3 cells / COMMENTARY·REWRITE
/ old→new text / CONFIDENCE High 0.93 / RISK Medium / Approve change / Reject". Could not reach the
populated state — the sample doc is already fully synced, so `Refresh from sources` produces no
pending diff. **Functional behaviour of the approve/reject flow is unverified** → low Behaviour score.
Reaching + verifying this (e.g. an out-of-sync source fixture) is a priority.

**10. Right rail — History** — Exact match: version timeline v14 CURRENT (Approved commentary rewrite)
/ v13 (Auto-refresh ⟳ Weekly refresh) / v12 (Edited "What to watch") / v11 ★ SNAPSHOT (Created from
template), with authors + timestamps.

**11. Right rail — Skills** — Near-exact: DOCUMENT AGENTS (Strategy agent ⚠ 1 flag + Apply fix,
Financial agent PASS + Re-run, Formatting agent + Run), RUN ON EXPORT toggle (Formatting + Financial),
"+ Add skill from library". Minor: comp's Strategy card also has a "View in Knowledge →" link.

**12. Present / export modal** — Strong match: "Present & export", SEND A COPY TO list (Google Docs /
Sheets / Word / Excel / Hosted web page), selected-format detail with doc preview + "4 source-linked
blocks included" + Export CTA + "Provenance & approval history are retained on export." **Gap:** the
comp has a **WHO CAN ACCESS** scope row (Workspace only / Anyone with link / Public + a public URL +
Copy) that the app's modal does not show.

### Prioritized gap backlog (lowest score x most visible first)

1. ~~**Context panel** (48) — build the full multi-category context inventory.~~ **DONE (iter 2 → 80):**
   grouped Linked sources + Referenced files. Remaining: Pasted text / Images / Company knowledge +
   "Add context" (deferred — no sample data).
2. ~~**Review rail populated diff/approve** (55) — make the pending-review state reachable and verify
   the approve/reject flow.~~ **DONE (iter 7 → 82):** verified live via Context → Review impact;
   Approve applies, Reject reverts. Remaining: model-quality suggestion wording.
3. ~~**Global top bar** (cross-cutting) — add the unified 48px top bar to the screen webviews.~~
   **DONE (iter 3):** added to Home/Templates/Knowledge/Agents.
4. ~~**Workflow canvas** (72) — verify the open-agent canvas renders.~~ **DONE (iter 4 → 80):**
   verified rendering + functional; design-divergence (pipeline vs 3-column) noted.
5. ~~**Navigation blank-out bug** — screen launchers blank the main area after a doc editor was opened.~~
   **DONE (iter 6):** webview recreated on becoming visible; live-verified across screens.
6. **Editor extras** — ~~provenance gutter dots~~ (verified built, iter 5), ~~avatar~~ (added, iter 5);
   remaining: source-peek pane + "Sync across" circle (doc tab bar is the workbench's editor tabs).
7. ~~**Present modal** — add the WHO CAN ACCESS scope selector.~~ **DONE (iter 4):** shown for all exports.
8. ~~**Knowledge** — confirm the DIRECTIONAL (Strategy) + MEASURABLE (OKRs) sections.~~
   **DONE (iter 5):** verified built on the Project tab.

---

## Iteration 2 — Context panel: group Linked sources + Referenced files (48 → 80)

**Surface:** Context panel (lowest baseline, highest visibility — central to the "what the agent
sees" value prop).

**Diff (baseline vs design).** The panel iterated **only `doc.context`** (influence files) and
**omitted `doc.sources` entirely** — so the document's primary bound data source (`metrics.csv`) never
appeared, leaving a one-row panel. The design groups context by kind: **LINKED SOURCES · N** (the
bound data sources, with a "feeds N blocks" sub-label + freshness dot) then **REFERENCED FILES · N**
(influence files), each row carrying a kind icon and a green/amber status dot.

**Change (TDD).**
- New pure builder `common/contextGroups.ts` → `buildContextGroups(doc, freshness)` returns
  `[{label, items:[{name, kind, detail, changed}]}]`: a **Linked sources** group from `doc.sources`
  (kind via `sourceKindOf`; `detail` = `live · feeds N blocks` for files, derived by counting blocks
  whose binds fall in the source's namespace; `changed` from `freshness.staleBindings`) and a
  **Referenced files** group from `doc.context` (`changed` from `freshness.staleContext`). Pure +
  DOM-free so it is unit-tested directly.
- 3 new tests in `livingDocsService.test.ts` (snapshot-style `deepStrictEqual`): fresh grouping for a
  bound doc; a changed value source + changed context source flipping both rows to `changed`; an api
  source grouped with its kind. **All 30 LivingDocsService tests pass.**
- `contextPanelView.ts` rewritten to render the groups — `LABEL · count` headers (JetBrains Mono),
  rows with a kind icon (file `⊞` / api `⇄` / mcp `◷` / reference `▢`, Unicode-escaped to keep
  source ASCII-only), a name + freshness sub-label, and a status dot. "Review impact" retained.
- **0 added core patches**; all inside the `livingDocs` contrib.

**Result.** The panel now shows `metrics.csv` (LINKED SOURCES · 1, "live · feeds 2 blocks") and
`market-research.md` (REFERENCED FILES · 1, "current") — matching the design's grouped, iconed,
freshness-dotted structure. Per-dimension: Layout 85 / Styling 85 / Components 70 / IA 85 /
Behaviour 85 → **80**. Held below 90 honestly: the design also shows **Pasted text / Images /
Company knowledge** groups and a **+ Add context** button — the sample document carries no such data,
so fabricating those rows would be dishonest placeholder UI. They remain deferred until the sample
(or model) provides that context. Typecheck clean; tests green.

**Before:** `shots/baseline/06-context-app.png` · **After:** `shots/iter2-context-after.png`.

> **Tooling note.** The chrome-devtools MCP server disconnected mid-iteration (the page dropped to
> `about:blank` and the server died — not a `pkill`). The after-shot is the handoff's prescribed
> fallback: the panel's **exact output DOM + injected CSS rendered to PNG via Playwright** (faithful
> to the production render code, populated with the real sample doc's values), not a live-workbench
> capture. A fresh session restores the MCP for live shots.

---

## Iteration 3 — global top bar on all four screens (Home/Templates/Knowledge/Agents)

**Gap:** the cross-cutting layout hole from iter 1 — the comp's 48px top bar (brand `L` +
"Opportunity OS" + per-screen crumb on the left; "All sources synced" pill + Present + `TS` avatar on
the right) appeared **only inside the doc-editor webview**. Home and the three screens rendered with
no top bar, so the app's chrome was inconsistent surface-to-surface.

**Change (TDD).**
- New `topBar(crumb)` + `withTopBar(html, crumb)` helpers in `screenRender.ts`; `renderScreenHtml`
  now prepends the bar as the first flex child of every screen (crumb = Home / Templates / Knowledge
  / Agents). Reuses the editor's exact `.topbar/.brand/.logo/.pill/...` styling for consistency;
  Present posts the same `present` message the host already handles. 0 added core patches.
- New `screenRender.test.ts` (5 tests): each screen renders the bar with the right crumb + sync pill
  + Present control + avatar, and **exactly one** bar per screen. **52 tests pass** (47 prior + 5).

**Result.** Home / Templates / Knowledge / Agents now all carry the design's top bar (see after-shots).
Lifts the Layout dimension on those surfaces: Home 82→85, Templates 88→89, Knowledge 80→83,
Agents 82→84. **Overall ~80 → ~81.**

*Honest caveat:* the bar renders inside each screen's webview (matching the doc editor's approach), so
it spans the editor content area rather than the full workbench width over the activity bar / right
rail. That matches the comp visually within the content column; a true full-width chrome bar would be
a larger, riskier change (likely a core patch) and is intentionally not attempted.

**After:** `shots/iter3-home-after.png`, `shots/iter3-templates-after.png` (rendered from the real
`renderScreenHtml` output via the Playwright fallback — exact for these pure-HTML screens; the
chrome-devtools MCP remains down this session).

---

## Iteration 4 — Present modal WHO CAN ACCESS for all exports (80→85) + workflow canvas verified (72→80)

**Primary gap (Present modal).** The WHO CAN ACCESS scope selector
(Workspace only / Anyone with link / Public) existed but was gated to the **Hosted web page**
(`'site'`) choice only — so the default Google Docs export showed no access control, while the comp
surfaces it for every destination.

- `renderPresentModal` now renders WHO CAN ACCESS for **all** export choices; the shareable-URL row
  (`opportunity-os.live/...` + Copy) is gated to non-workspace scopes (`link`/`public`) since a
  workspace-only copy has no public URL — both design-aligned and sensible. 0 added core patches.
- New `livingDocRender.test.ts` (2 tests via the public `renderLivingDocHtml`): WHO CAN ACCESS shows
  for every `PresentChoice`; the URL row appears for link/public and is hidden for workspace-only.
  **54 tests pass.** After: `shots/iter4-present-after.png` (isolated render of the exact modal markup).

**Secondary (workflow canvas — verified, not previously captured).** Rendered the open-agent canvas
(`renderAgentCanvas`) for the first time. It is well-built and functional: header (back / Run now /
status), a run-complete banner with **Review →**, and the full loop on a dotted-grid canvas —
**Trigger → Sources → agent → Verify → Policy gate → Documents → Review rail** — now also carrying
the iter-3 top bar. Re-scored **72 → 80**.
*Honest divergence note:* the comp's canvas is a **SOURCES → agent → DOCUMENTS** 3-column flow with
per-source / per-document live-status cards (e.g. "metrics.csv · changed 2m ago", "Weekly Summary ·
2 applied · 1 to review"). The app shows a richer **loop pipeline** (adds the Verify + Policy gates
from the orchestration spec) but its Sources/Documents nodes list names without per-item run results
— and `IAgentRun` only carries applied/queued **totals**, not a per-doc breakdown, so faithful
per-doc statuses can't be shown without a data-model change. Left as a deliberate, defensible
alternative rather than fabricating per-doc rows. Shot: `shots/iter4-canvas-verified.png`.

**Overall ~81 → ~82.** Typecheck clean; 54 tests green.

---

## Iteration 5 — Knowledge verified (83→88) + editor top-bar avatar & verification (80→84)

A verification-led iteration: two surfaces the **baseline under-scored as "unverified"** turned out to
be substantially built. Corrected the scores with captured evidence, plus one consistency fix.

**Knowledge (83 → 88).** The baseline flagged the comp's DIRECTIONAL (Product Strategy) + MEASURABLE
(Q3 OKRs) sections as "needs scroll-verification". Rendering the **Project** tab
(`knScope: 'project'`) confirms they are fully built and match the comp: Product Strategy
(Wedge / Moat / Expand), Q3 OKRs with KR progress bars (KR1 18/25, KR2 +13%, KR3 94%), and the
Activation / Net retention / Time-to-trust metric cards. The app splits the stack across the
Organization (enduring) and Project (directional + measurable) tabs — a faithful read of the comp's
own scope toggle. Shot: `shots/iter5-knowledge-project.png`.

**Document editor (80 → 84).** Verified the editor already renders the comp's hallmark provenance
affordances: a **blue gutter dot** on every bound block (`.pdot`, carrying `data-cells` for
provenance), and a **pending meaning-change rendered inline as a word-level diff** (red strike /
green add) with **Approve changes / Reject** controls — i.e. the review flow lives in the editor, not
only the rail. One real gap remained: the editor top bar had the sync pill + controls but **no user
avatar**, unlike the four screens (iter 3) and the comp. Added the `TS` avatar (+ `.av` style) to the
editor top bar; 1 new test asserts it. Shot: `shots/iter5-editor-topbar-after.png`.
*Remaining editor gap:* the comp's **source-peek pane + "Sync across" circle** (open a CSV beside the
doc and apply edits with a diff) is not confirmed built — the next editor target.

**Overall ~82 → ~83.** 55 tests pass; typecheck clean. 0 added core patches.

> **Re-scoring note.** Iterations 4-5 surfaced a pattern: the app is **more complete than the baseline
> scored** — several surfaces (canvas, Knowledge project tab, editor diff/approve) were scored low only
> because they were *unverified*, not because they were missing. The biggest genuinely-open item is the
> **populated Review rail** (55), whose approve/reject logic is in fact built + unit-tested (service
> level) and rendered in the editor — what's unverified is the *right-rail* presentation of a pending
> change, which needs **live workbench driving** (blocked while the chrome-devtools MCP is down). A
> fresh session (restoring the MCP) is the clean way to live-verify it and re-audit at full fidelity.

---

## Iteration 6 — fix the navigation blank-out bug (functional/UX), live-verify core flows

*(MCP restored this session — live driving is back.)* Focus per the goal's functional + "does it feel
nice" criteria, not just visuals.

**The bug (baseline backlog #5, now reproduced live).** After a Living Document editor is open,
clicking a screen launcher ("Open Agents/Templates/Knowledge") — or just switching to that
activity-bar container — left the **main area blank**. A reload was the only recovery. This breaks a
core navigation flow and made the screens feel unreliable.

**Root cause.** `ScreenEditor` (and `LivingDocEditor`) host their content in a low-level webview via
`createWebviewElement` + `mountTo`. When the pane is hidden by another editor in the group and later
re-shown, the webview's `<iframe>` is DOM-re-parented, which **reloads it blank**, and the low-level
webview does not re-apply its HTML. Nothing re-issued `setHtml`, so the screen stayed empty.

**Fix.** `screenEditor.ts`: recreate the webview fresh (new `createWebviewElement` + `mountTo` +
`setHtml`, old one disposed via a `MutableDisposable`) both on `setInput` and on becoming visible
(`setEditorVisible(true)`). Mirrors the recreate-on-render pattern used by `imageCarouselEditor`.
0 added core patches.

**Verification (live, the right test for a webview-lifecycle fix).**
- Repro before: open Weekly doc -> Agents -> "Open Agents" -> blank (this session + iter 1).
- After: open Weekly doc -> Agents -> screen renders the full agent table; Templates spot-checked the
  same way -> renders. Shot: `shots/iter6-nav-fixed.png`. **55 tests pass; typecheck clean; no
  regressions.** (No unit test added — this is webview re-parent lifecycle, exercised via the live
  flow; the contrib's editors have no unit harness and mocking the webview/group is brittle.)

**Also verified functionally this iteration:**
- **Auto-figure sync:** appended new weeks to `metrics.csv`; on open the doc's bound figures
  re-resolved to the latest values ($52.0k -> $55.8k MRR, signups, churn, deltas) while the Commentary
  (a meaning statement) correctly stayed put. The freshness/auto-apply behaviour works.
- **Agent run / canvas:** opened the `Before-export gate` (ask-before-apply) canvas, **Run now** ->
  "Run complete" banner with a **Review ->** action. The run + canvas + navigation flow works.

**Review rail — honest status (still ~55, not reachable live here).** The populated approve/reject
state could not be produced in this headless web build: (a) figure bindings **auto-resolve to the
latest source on every render**, so there is never a standing figure delta for an agent to queue
(the `ask-before-apply` run reported `0 queued`); (b) the rail's hero state is a **meaning rewrite**,
produced by the `reviewImpact` pass which needs a **language model** the web build lacks (it shows a
visible "no model" heuristic state). The approve/reject + queueing **logic is unit-tested at the
service level** (orchestration tests: ask-before-apply queues; approve applies + clears), and the
in-editor inline-diff + Approve/Reject UI is built (iter 5). So this is an **environment limitation,
not an app defect** — confirming the populated rail needs a model-backed run or a seeded out-of-sync
fixture. Recommend a small dev affordance (e.g. a "simulate pending change" seed) to make this
demoable.

**Overall ~83 -> ~84** (resolved a cross-cutting functional defect; core flows live-verified).

---

## Iteration 7 — the Review rail / approve-reject flow, verified live end-to-end (55 → 82)

The product's central premise — *an agent proposes changes; you review old→new with provenance and
approve or reject* — was the last unverified core flow (and the biggest score deficit). Found the
right trigger and drove the whole loop live.

**How it's reached (no model needed).** `reviewImpact` (the Context panel's **"Review impact"**
button) falls back to treating each non-bound prose paragraph as an influence target when no lock
claims are authored, and the no-model `_heuristicImpact` always produces a "...revisit whether this
still holds" suggestion. So changing the context source (`market-research.md`) then clicking
**Review impact** queues real pending meaning-changes — no language model required. (The earlier
*agent* path queued 0 because figures auto-resolve; this is the correct entry point.)

**Verified live (the flow the goal calls "core flows functional"):**
1. Changed `market-research.md`, opened the doc, clicked **Review impact** → **2 pending meaning
   changes** queued for Commentary + What-to-watch.
2. They render **both inline in the editor** (amber gutter bar, word-diff, "Tone rewrite from
   metrics.csv, market-research.md · +1 added · 0 removed · 50% confidence", Approve/Reject) **and in
   the right Review rail** ("Review **2**", "2 changes need approval", per-change card: old text →
   new text, Why, Confidence 50%, Risk: narrative, Source, **Approve & apply** / **Reject**) — matching
   the comp's Pending-review structure.
3. **Approve & apply** on Commentary → the rewrite applied to the document, the card cleared, the rail
   count dropped to **1**. Persisted.
4. **Reject** on What-to-watch → the paragraph reverted to its original text, the rail emptied
   ("No changes waiting"). The approved Commentary change stuck.

Shot: `shots/iter7-review-populated.png` (the populated rail + inline pending changes).

**Score 55 → 82.** Layout/Styling/Components/IA all match the comp (85+); Behaviour now *verified
working* (80). Held below the high-80s only because the **suggestion wording is heuristic** ("revisit
whether this still holds") rather than a model-quality rewrite (e.g. the comp's "Growth accelerated
sharply") — a model-availability gap in the headless build, not a flow/UI defect. With a model wired
in, this surface is ~90.

No code change this iteration — it is a functional verification that corrects a conservative
"unverified" baseline with live evidence. The sample workspace was restored to pristine afterward.

**Overall ~84 → ~86.**

---

## Iteration 8 — functional audit: what genuinely works vs. what's a static mockup

Per the goal's "core flows functional / does it feel nice" bar (not just visual match), a deliberate
pass over every interactive control to separate *real* functionality from comp-faithful presentation.

**Verified functional (live):**
- **Editor — raw-Markdown editing.** The `</> Edit raw Markdown` toggle round-trips: rendered view <->
  the real clean-file source (frontmatter + inline `[value](bind:key)` links + the bind-linked table).
  Shot: `shots/iter8-editor-rawmarkdown.png`.
- **Review / approve-reject** (iter 7), **auto-figure sync** + **agent run/canvas** (iter 6),
  **navigation across surfaces** (iter 6), **Context grouping** (iter 2), **Approve all / Review each**
  in the Chat tab (wired via `data-approve-all` / `data-go-review`). These are the product's core loop
  and they work.

**Found to be intentionally static (comp reproductions, per the code's own comment "Static
comp-faithful tab bodies"):** the **Chat composer** ("Ask the agent…" is display text, not an input)
and the **Skills** tab's **Apply fix / Run / Re-run** buttons (no handlers). The Chat conversation +
Skills cards are hardcoded to mirror the comp exactly. Against the **design-match** goal these are
faithful (the comp's own chat/skills are non-interactive prototype UI), so their visual/structure/IA
scores stand. Against a **full-product functionality** bar they are unwired — recorded here as the
main known gap, not silently scored as working.

**Scoring honesty.** No scores changed this iteration: the core flows that *should* work do (verified),
and the static tabs already reflect comp-fidelity rather than claimed interactivity. The functional
gap (composer + skills actions) is logged explicitly rather than hidden. Net overall unchanged (~86).

**Two known, deliberately-not-fixed items** (out of scope / not product defects): the dev-build
extension-activation toasts ("merge-conflict / git-base / emmet … Not Found") are a `@vscode/test-web`
artifact (those builtins are bundled in a packaged build), and the doc **subtitle** ("Week 24") is
static frontmatter that doesn't track the latest resolved week.

**Remaining path to ~90 (for iters 9-10):** wire the Skills/Chat actions to real (model-gated)
behaviour, OR build the editor **source-peek + "Sync across"** pane (the last comp feature), OR enrich
the **Context** sample with pasted-text/images/company-knowledge (needs a small model extension). The
biggest honest lever is a **language model** wired in — it lifts Review-rail suggestion quality,
Chat, and the Skills graders together.

---

## Iteration 9 — make the Skills tab genuinely functional (was a static mockup)

Directly closes the functional gap flagged in iter 8: the Skills tab was hardcoded HTML with dead
buttons. Now it grades the **active document** live with real, deterministic checks.

**Change (TDD).**
- New `getSkillReport(resource)` on the service (+ `ISkillCheck` type on the interface): runs the
  document's Skills as graders over its current state.
  - **Financial** (deterministic): every bound figure must resolve to a source value. For the sample
    that is **"All 12 linked figures reconcile with sources." → PASS**; a doc with an unresolvable bind
    (`metrics.unknown`) reports **"1 of 2 figures do not reconcile…" → FLAG**.
  - **Formatting** (deterministic): a title-case house-style check on headings. The sample's
    sentence-case "Key metrics" + "What to watch" yield **"2 heading-case fixes suggested." → FLAG**
    (matches the comp's "2 fixes" exactly).
  - **Strategy**: needs a model to test claims against the decision stack → honest **NO MODEL** state
    (no fabricated flag/Apply-fix).
- 2 new tests (`getSkillReport` for the bound doc + the unresolvable-bind doc). **57 tests pass.**
- `reviewRailView.ts`: the Skills tab is now data-driven from `getSkillReport` of the active editor's
  document (injected `IEditorService`; re-renders on active-editor change). **Run / Re-run** buttons
  re-grade the live document (`data-skill-run` -> re-render); verified live (clicking Re-run re-grades
  cleanly). Empty state when no Living Document is active. 0 added core patches.

**Result.** The Skills surface went from a fully static mockup to genuine functionality: 2 of 3 skills
are real deterministic verdicts on the live doc, the 3rd is honestly model-gated, and the Run buttons
work. Matches the comp's layout *and* its "2 heading-case fixes" — now computed, not hardcoded.
Shot: `shots/iter9-skills-functional.png`.

**Score:** Skills stays **88** but is now *earned* (functional, not just visual) — resolving the iter-8
honesty caveat. Overall **~86** (the figure was already counting Skills at 88; this restores its
integrity). The remaining static surface is the **Chat composer** (a real agent chat is model-gated).

---

## Iteration 10 — final re-score, trajectory, and summary

The loop hit its **10-iteration cap** at **~86%** (the >=90% early-exit was not reached). Honest final
scorecard, after all the verification and fixes:

| Surface | Baseline | Final | What moved it |
|---|:--:|:--:|---|
| Home dashboard | 82 | **85** | global top bar (iter 3) |
| Document editor | 80 | **84** | avatar + gutter/diff/raw-edit verified (iter 5, 8) |
| Templates | 88 | **89** | top bar (iter 3) |
| Knowledge | 80 | **88** | OKRs/Strategy verified built (iter 5) |
| Agents list | 82 | **85** | top bar + nav-bug fix (iter 3, 6) |
| Workflow canvas | 72 | **80** | verified functional (iter 4) |
| Context panel | 48 | **80** | grouped Linked sources + Referenced files (iter 2) |
| Right rail — Chat | 90 | **88** | trimmed: composer is comp-static (model-gated) |
| Right rail — Review | 55 | **82** | approve/reject verified live (iter 7) |
| Right rail — History | 92 | **92** | (faithful from baseline) |
| Right rail — Skills | 88 | **88** | now *functional* graders, not just visual (iter 9) |
| Present / export modal | 80 | **85** | WHO CAN ACCESS for all exports (iter 4) |

**Overall: ~78% -> ~86%.** Every **core flow is functionally verified live**: figure auto-sync,
the review/approve-reject loop, agents run + canvas, cross-surface navigation (bug fixed), context
inventory, raw-Markdown editing, and the Skills graders.

### Why ~86% and not 90% (honest)
The remaining gap is concentrated in a few surfaces whose lift is **model-gated or needs a data-model
change**, not polish:
- **Context (80):** the comp also shows Pasted-text / Images / Company-knowledge groups; the data model
  only carries file-path context, so rendering those faithfully needs a small model extension (not
  fabricated rows).
- **Review (82):** the approve/reject flow works, but the *suggestion wording* is heuristic ("revisit
  whether this still holds") vs the comp's model-quality rewrite.
- **Chat (88):** composer is an intentionally static comp reproduction; a real agent chat is
  model-gated.
- **Canvas (80):** a deliberate loop-pipeline alternative to the comp's 3-column source->doc layout.
- **Editor (84):** the comp's source-peek + "Sync across" side pane is not built.

**The single biggest lever to clear 90% is wiring a language model** — it simultaneously lifts the
Review suggestion quality, the Chat composer, and the Strategy skill. Next after that: the editor
source-peek pane, and a context-kind model extension for the Context groups.

### Deferred (documented, not hidden)
Editor source-peek + Sync-across pane; Context pasted-text/images/company-knowledge groups + Add-context;
Chat composer + Strategy skill (model); dev-build extension-activation toasts; dynamic doc subtitle.

### Core-flow verification index (where each was proven)
auto-figure sync — iter 6 · review/approve-reject — iter 7 · agent run + canvas — iter 4/6 · navigation —
iter 6 · context grouping — iter 2 · raw-Markdown editing — iter 8 · Skills graders — iter 9.

---

### Notes for next session

- DesignSync target confirmed: project `d198ca07-9eef-4d05-96e1-b383e6c19c03`, file
  `Living Documents - Workbench.dc.html`. Reference screenshots also live under `screenshots/` in that
  project (home / inline-diff / wb-editor-chat / wb-history / wb-source / wb-canvas-outputs /
  chat-approveall) — useful rendered-state references.
- Do **not** `pkill` the chrome-devtools Chrome (drops the MCP for the session). Close pages via MCP.
- The Context panel reads the **active editor** — open the doc from the Documents list first.
- Web build caches builtin-extension scan + theme in IndexedDB and `product.json` at server start.
