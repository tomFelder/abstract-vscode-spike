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
| 9 | Right rail — Review | 60 | 60 | 50 | 60 | 45 | **55** | `shots/baseline/10-review-app.png` (empty state) |
| 10 | Right rail — History | 92 | 92 | 92 | 92 | 90 | **92** | `shots/baseline/09-history-app.png` |
| 11 | Right rail — Skills | 88 | 90 | 88 | 90 | 85 | **88** | `shots/baseline/08-skills-app.png` |
| 12 | Present / export modal | 85 | 85 | 75→85 | 80 | 78→85 | **80** → **85** (iter 4) | `shots/baseline/11-present-app.png` → `shots/iter4-present-after.png` |

**Overall: ~78%** (mean of the twelve). The app is a genuinely high-fidelity recreation — most
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
2. **Review rail populated diff/approve** (55) — make the pending-review state reachable (out-of-sync
   fixture) and verify the approve/reject flow matches the comp. Core flow.
3. ~~**Global top bar** (cross-cutting) — add the unified 48px top bar to the screen webviews.~~
   **DONE (iter 3):** added to Home/Templates/Knowledge/Agents.
4. ~~**Workflow canvas** (72) — verify the open-agent canvas renders.~~ **DONE (iter 4 → 80):**
   verified rendering + functional; design-divergence (pipeline vs 3-column) noted.
5. **Navigation blank-out bug** — screen launchers blank the main area after a doc editor was opened.
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

### Notes for next session

- DesignSync target confirmed: project `d198ca07-9eef-4d05-96e1-b383e6c19c03`, file
  `Living Documents - Workbench.dc.html`. Reference screenshots also live under `screenshots/` in that
  project (home / inline-diff / wb-editor-chat / wb-history / wb-source / wb-canvas-outputs /
  chat-approveall) — useful rendered-state references.
- Do **not** `pkill` the chrome-devtools Chrome (drops the MCP for the session). Close pages via MCP.
- The Context panel reads the **active editor** — open the doc from the Documents list first.
- Web build caches builtin-extension scan + theme in IndexedDB and `product.json` at server start.
