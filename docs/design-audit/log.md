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
| 12 (v1 #2) | **functional focus** | **Apply-fix now edits the document** (criterion 3's open half). The Formatting agent's "Apply fix" button title-cases every flagged heading in place (`applySkillFix`), audits each, persists, and re-grades to PASS. Verified live: "2 heading-case fixes suggested" -> click -> "Key metrics"->"Key Metrics", "What to watch"->"What to Watch" (minor word stays lower), Formatting flips to PASS. Deterministic, TDD-covered. |
| 13 (v1 #3) | **functional focus** | **Source-peek + "Sync across" (criterion 4's signature interaction).** A "&#8646; Source" toolbar button opens the real source file (the CSV) beside the doc; `syncFromSources` re-derives this doc's figures and returns the old->new diff, surfaced as a "Synced N figures" banner (also recorded on the existing Refresh). Verified live: edit the CSV beside the doc -> Sync -> banner "metrics.mrr $61.0k->$90.0k, signups 540->720, ..." + the doc figures update. 2 new TDD tests. |
| 14 (v1 #4) | **functional focus** | **Context kinds (criterion 5).** A context-kind data-model extension (`IAddedContext` in the lock): the Context panel now renders the comp's **Images** (image-extension files), **Pasted text** and **Company knowledge** groups from real data, plus a working **"Add context"** form (`addContext` persists a typed item to the lock). Verified live: Add context -> "Company knowledge" note -> a new COMPANY KNOWLEDGE group appears, persisted. 2 new TDD tests. |
| 15 (v1 #5) | **v1 bar reached** | **Doc subtitle tracks the resolved week (criterion 6).** `_resolveSubtitle` refreshes a "Week N" subtitle from the primary source's latest `week` on load + sync. Verified live: sync to week 25 -> subtitle "Week 24..." -> "Week 25 - bound to metrics.csv". 1 new TDD test (71/71 suite green). **Remaining (deferred, infra):** the dev-build extension-activation toast (emmet/git-base/merge-conflict 404 in @vscode/test-web) is an upstream dev-web artifact, not a product dead-end - out of scope for the livingDocs contrib. |
| **v2-1 (audit)** | **~56%** (experience-weighted) | **v2 shell audit — no code.** Re-scored every surface weighting UX/UI/IA/visual (not behaviour). Content surfaces are 65-78 (Home 78, doc body 70, Templates/Knowledge/Agents 70); shell/IA surfaces are 18-50 (source-peek 18, interaction grammar 25, left rail 35, header 48, Context 50). **All 6 hard gates FAIL/PARTIAL** (see `v2-inventory.md`). The ~86 -> ~56 drop is the re-weighting, not a regression: v1 measured "does it work", v2 measures "does it feel like the comp". |
| **v2-2 (G1 fix)** | **~61%** | **Killed the #1 abrasion: split/blank panes.** Source-peek + "Sync across" now render **in-surface** (a styled source pane + floating ⟳ circle inside the one webview) instead of opening a `SIDE_GROUP` editor. Removed `revealSource`/`openSourceBeside`; added a pure `getSourcePeek` (TDD, 71/71 green). **0 core patches.** Verified live: open Source -> in-surface pane (no 2nd group, no blank pane) -> Sync (green confirmation) -> close. **G1 PASS** for source-peek (export-open still SIDE_GROUP, tracked). source-peek 18->78, interaction 25->30. |
| **v2-3 (tree-rail, G3)** | **~67%** | **Built the left tree-rail.** One `TreeRailView` with **Files / Context / Outline / Search** tabs + a folder tree (REPORTS + SOURCES), replacing the separate Documents + Context activity-bar containers (both deleted). Pure helpers `buildFileTree`/`buildOutline`/`searchTreeRail` in `common/treeRail.ts` (TDD, 74/74 green); `ILivingDocSummary` gained `sources`. **0 core patches.** Verified live: all 4 tabs + folder tree + doc-open from Files (opens clean, no split). **G3 MOSTLY PASS** (residual: the 76px labeled icon-nav restyle). left rail 35->75, Context 50->78. |
| **v2-4 (calm header, G2)** | **~70%** | **Calmed the doc header to the comp's single bar.** Removed Download (Present covers it) + the standalone Refresh button (the **sync pill is now the refresh**) + the persistent formatting-toolbar row (now a **floating selection toolbar**); Ask-AI/Source header buttons dropped (Chat rail + provenance dots are the comp's entries); raw-Markdown toggle moved to the footer hint. **0 core patches** (webview only). TDD: a render assertion for the calm bar (75/75 green). Verified live: single calm bar; **G1 still holds** — a provenance dot opens the in-surface source pane (one iframe, no split). **G2 PASS** (residual: the VS Code menubar still leaks above — a G4 item). header 48->85, interaction 30->35. |
| **v2-5 (remove IDE chrome, G4)** | **~73%** | **Removed the residual IDE chrome.** Three `studio.css` rules hide the modernUI **menubar** ("Application Menu" hamburger, which ignored `menuBarVisibility:hidden`) + the **Accounts** and **Manage(gear)** global activity-bar actions (Manage was the command-palette surface). With tabs/status/command-center/group-title already off, the shell now reads as a calm app, not an IDE. Tier: **styleOverrides-CSS**, 0 core patches. Verified live: chrome gone, doc opens clean (G1-G3 hold, G2 calm bar intact). **G4 MOSTLY PASS** (residual: raw `Ctrl+Shift+P` keybinding + pane-resize sashes — core-owned). interaction 35->70. |
| **v2-6 (kill ext toasts, G6)** | **~73%** | **Killed the dev-build ext-activation toasts.** Excluded the IDE-only builtins (`emmet`/`git-base`/`merge-conflict`) from the product via a 3-id denylist in the web `BuiltinExtensionsScannerService` — the **first v2 core patch** (tiny, surgical, product-correct: a word processor doesn't want them, and they were the ones whose web bundle 404s in the dev run). Verified live: **zero toasts on launch; the click-through is now clean** end-to-end. 75/75 green. **G6 PASS.** Mean holds (toasts aren't a per-surface score) but a hard gate flips + the stop-condition's "clean click-through" is satisfied. |
| **v2-7 (pin rail widths)** | **~74%** | **Pinned the shell to the comp's rail widths.** `StudioStartupContribution` now sets the tree-rail to 264px and the right rail to 392px via `IWorkbenchLayoutService.setSize` (after the rail is revealed + a layout tick, so the size restore doesn't clobber it). Verified live: right rail 282 -> 374px (the grid redistributes, so near- not exact-pixel), sidebar -> 252px, editor 718px (the 720px doc column still fits). 0 core patches (additive-contribution); 75/75 green; no gate regressions. right rail 65->75, left rail 75->77. The extra Skills tab is kept as a deliberate verification-feature departure. |
| **v2-8 (inline figures, G5)** | **~76%** | **Inline bound-figure highlighting** — the comp's "living figure" treatment. Bound prose now wraps each resolved figure in a faint-blue `.bound` span (underline + bg); the KPI table stays plain (as the comp). Technique: tokenize each `[value](bind:key)` before the sanitizing Markdown renderer, swap the token for the span after — formatting survives, no raw HTML injected; each span carries `data-cells` (click a figure -> peek its source). 0 core patches (webview). TDD: a render assertion (76/76 green). Verified live: "+18% / $48.6k / 427 / 2.4%" highlighted in the Highlights prose, single iframe, calm header. **Completes G5** (gutter detached + figures highlighted + doc aligned). doc editor 70->88. |
| **v2-9 (labeled icon-nav, G3)** | **~77%** | **The 76px labeled icon-nav.** `ACTIVITYBAR_WIDTH 48 -> 76` (second v2 core patch) so the grid allocates the comp's wider rail, + `studio.css` renders a text label under each icon (`::after { content: attr(aria-label) }`). Verified live: 76px rail with Workspace/Home/Templates/Knowledge/Agents labels, sidebar reflows with **no overlap**, doc/Home click-through clean. **Completes G3** (tree-rail iter 3 + icon-nav now). The guard test (activitybarPart.test) updated 48->76; activitybar 14/14 + livingDocs 76/76 green. left rail 77->90. **Gates now: only G4 is "mostly"** (palette keybinding + sashes residual). |
| **v2-10 (final re-verify + summary)** | **~82%** | **Cap iteration: no new build — full live re-verification + honest re-score + the readiness summary.** Re-drove every surface; the secondary surfaces (Templates/Knowledge/Agents/Present), now un-squeezed by the shell fixes, render full-width and faithful (re-scored 70->85/88/85/85; Home 78->80). Present modal re-verified live (destinations + WHO CAN ACCESS + preview + CTA). **Final gates: G1-G3 ✅, G4 mostly ✅, G5-G6 ✅; click-through clean.** Landed at ~82% (not the 95% bar) — the remainder is honest per-surface pixel-polish, with nothing squeezed/abrasive/IDE-leaking. 10-iteration cap reached. |

---

## Plan 9 — v1 functionality & UX loop (per-criterion scores)

The loop now scores the **7 v1 criteria** from `docs/plans/09-v1-functionality-handoff.md` (v1 = every line >= 85),
weighted to *behaviour*. Carrying the visual match forward at ~86% (design-audit landing, unchanged).

| # | v1 criterion | Iter 10 | 11 | 12 | 13 | 14 | Real / rough |
|---|--------------|:--:|:--:|:--:|:--:|:--:|------|
| 1 | Agentic loop is real (model-backed) | 86 | 88 | 88 | 88 | 88 | **Real.** Context "Review impact" rewrites (plan 10) *and* the Chat agent path both yield model rewrites that land in Review. |
| 2 | Chat is a working agent | 40 | 88 | 88 | 88 | 88 | **Real (live-verified).** Composer, `@mention`, model reply over doc+sources, tool-steps, proposed edits → Review. Rough: `@mention` chip-insert (no keystroke autocomplete); model pill static. |
| 3 | Skills run for real (+ Apply-fix) | 72 | 72 | 86 | 86 | 86 | **Real (live-verified).** Graders real; **Apply-fix edits the doc** (Formatting → PASS). Rough: a Strategy flag is a reason, not yet a one-tap structured fix. |
| 4 | Editor is a real editor | 72 | 72 | 72 | 86 | 86 | **Real (live-verified).** Toolbar + raw-Markdown + inline diff + clickable dots; **source-peek + "Sync across" figure diff**. Rough: side pane is a plain editor (not the comp's bespoke diff pane). |
| 5 | Context is complete | 70 | 70 | 70 | 70 | **86** | **Real (live-verified).** Linked/Referenced + now **Images / Pasted text / Company knowledge groups + Add context** (typed-context lock model). Rough: images are path/URL refs (no upload/preview). |
| 6 | No dead ends, no rough edges | 70 | 80 | 82 | 84 | **85** | Chat, Apply-fix, Source/Sync, Add-context all real controls; nav fix held; **subtitle now tracks the resolved week**; empty states read well. **Only blemish (deferred, infra):** the upstream @vscode/test-web extension-activation toast (not a product dead-end). |
| 7 | Core flows pass tests + live click-through | 80 | 85 | 86 | 88 | **88** | 11 new TDD tests across iters 11-15 (71/71 suite green) + clean live click-throughs each iteration. |

**v1 bar reached (iter 15):** all 7 criteria >= 85 (1=88, 2=88, 3=86, 4=86, 5=86, 6=85, 7=88). Every product surface
the comp implies is now functional and live-verified; the agentic loop is model-backed; no product control is a dead
placeholder; navigation never blanks. Visual match held at ~86%. The single deferred item is the upstream dev-web
extension-activation toast (an @vscode/test-web infra artifact, not a Living Documents defect).

**What works (iter 11):** open Weekly Summary → Chat tab → real composer with live `@metrics.csv` / `@market-research.md`
chips → send → model reply with a ✓/→ tool-step card → proposed Commentary rewrite queued (inline diff in the
editor + Review rail "1" + Documents "1 pending") → Approve all → applied to the prose, badges cleared, history kept.
**What's rough:** no keystroke-triggered `@mention` dropdown (chips + parse only); the model/agent pills are static;
extension-activation error toast still appears on load. Shots: `shots/iter11-chat-composer-before.png`,
`shots/iter11-chat-agent-reply.png`, `shots/iter11-chat-edit-applied.png`.

**Iter 12 (Apply-fix):** the Formatting agent's "Apply fix" title-cases flagged headings in place and re-grades to
PASS (`applySkillFix`, deterministic, audited, persisted). Shots: `shots/iter12-applyfix-before.png`,
`shots/iter12-applyfix-after.png`.

**Iter 13 (source-peek + Sync across):** "&#8646; Source" opens the real CSV beside the doc; `syncFromSources` returns
the old->new figure diff, surfaced as a "Synced N figures" banner (also recorded by Refresh). Shots:
`shots/iter13-syncacross-before.png`, `shots/iter13-sourcepeek-live.png`, `shots/iter13-syncacross-diff.png`.

**Iter 14 (Context kinds):** `IAddedContext` in the lock; the Context panel renders Images / Pasted text / Company
knowledge from real data + a working "Add context" form. Shots: `shots/iter14-context-before.png`,
`shots/iter14-context-added.png`.

**Iter 15 (subtitle tracks the week) — v1 bar reached:** `_resolveSubtitle` makes a "Week N" subtitle follow the
source's latest week on load + sync. Shots: `shots/iter15-subtitle-before.png`, `shots/iter15-subtitle-after.png`.

**Loop complete.** All 7 v1 criteria >= 85 across iters 11-15 (Chat agent, Apply-fix, source-peek + Sync-across,
Context kinds, dynamic subtitle). One deferred infra item remains: the upstream @vscode/test-web extension-activation
toast for unused first-party builtins (emmet/git-base/merge-conflict 404) - present in any `code-web.sh` run, not a
product dead-end; fixing it is a build/serve concern outside the livingDocs contrib + 0-core-patches scope.

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

---

## v2 Iteration 1 — shell audit (live, no code) · ~56% baseline

The opening iteration of the **v2 design-alignment loop** (plan 11). Audit-only: re-baseline every
surface against the "Agentic Workbench" comp **weighting the experience (UX/UI/IA/visual)**, not
behaviour (behaviour is held at the v1 bar). Full per-surface table + comp pixel spec + ranked gaps
live in [`v2-inventory.md`](v2-inventory.md). Screenshots: [`shots/v2-iter1/`](shots/v2-iter1/).

### Method
- Branch `living-docs-design-v2` off `main`. `code-web` on :8080, driven via chrome-devtools MCP;
  proxy healthy (`{"ok":true,"backend":"openrouter"}`). Cleared IndexedDB once to get a pristine
  first-run (the stale split groups otherwise persist — itself a finding).
- Pulled the comp `.dc.html` via DesignSync and extracted the pixel spec (48px bar / 76px icon-nav /
  264px tree-rail / 720px doc column + 30px gutter / 392px right rail).
- Walked Home → Editor (doc) → Source-peek → Context → Templates → Knowledge → Agents live.

### Headline
**The webview content of every surface is high-fidelity to the comp.** The entire gap is the
**shell**: VS Code's IA leaks through. Each surface is an *editor* in *editor groups*, behind an
*activity bar* (not the comp's icon-nav + tree-rail), under a leaking *menubar*; opening a source
*splits into a 2nd group and blanks a pane*. This is design-notes **D3** ("calm by construction, not
subtraction") stated as a measurement.

### Hard gates (live)
- **G1 (split/blank) — FAIL.** "⇆ Source" → `metrics.csv` in **Editor Group 2**, Group 1 **blank**
  (`shots/07`). Reload restored **3 stacked metrics.csv groups** (`shots/01`). #1 abrasion, confirmed.
- **G2 (calm header) — FAIL.** Doc editor has a **2-row header** (brand+synced+Present+Download+Refresh,
  then a formatting toolbar Heading/B/I/U/list/quote/Ask-AI/Source/`</>`); comp has only row 1's
  essentials. Menubar leaks above (`shots/06`).
- **G3 (tree-rail) — FAIL.** Activity-bar containers (Documents/Home/Context/Templates/Knowledge/
  Agents); no 76px labeled nav, no Files/Context/Outline/Search tree-rail, no folder tree.
- **G4 (no optionality) — FAIL.** Menubar, activity bar, split, drag, groups, tabs/close all live.
- **G5 (gutter detach + pixel-align) — PARTIAL/FAIL.** Dots in a thin margin, not the 30px detached
  column; no multi-line bar; doc not pixel-aligned.
- **G6 (no nav-blank + toast gone) — PARTIAL/FAIL.** Nav no longer blanks (iter-6 fix holds), **but**
  the `merge-conflict`/`emmet`/`git-base` activation toasts fire every load (`shots/01,05`).

### Scores (mean of Layout/Styling/Components/IA/Interaction-UX)
Source-peek **18** · Interaction grammar **25** · Left rail/nav **35** · Header **48** · Context **50**
· Right rail **65** · Doc editor **70** · Templates **70** · Knowledge **70** · Agents **70** · Present
**70\*** · Home **78**. **Overall ~56%** (\*Present not re-driven live this iter).

### Next (first code iteration)
Backlog #1 — **kill the split/blank-pane abrasion (G1)**: redesign source-peek + "Sync across" as an
in-surface panel, remove every `SIDE_GROUP` open, ensure no surface renders beside a blank group.
Fixing the editor-group model is also the lever that un-squeezes Templates/Knowledge/Agents and opens
the door to the tree-rail (G3).

---

## v2 Iteration 2 — kill the split/blank-pane abrasion (G1) · ~56% → ~61%

The first code iteration. Closed the #1 abrasion: source-peek + "Sync across" no longer open a VS Code
`SIDE_GROUP` editor (which left a blank pane and read as an IDE); they now render **in-surface** inside
the one document webview. Screenshots: [`shots/v2-iter2/`](shots/v2-iter2/).

### What changed (0 core patches — all inside the `livingDocs` contrib)
- **Service** (`livingDocsService.ts`): removed `revealSource` + `openSourceBeside` (both `SIDE_GROUP`
  `openEditor` calls) and the dead `_renderSourceMarkdown`; added a pure **`getSourcePeek(resource,
  cells)`** returning `{ source, rows:[{key,value,selected}], referencedBy }`. Interface updated in
  `common/livingDocs.ts` (new `ISourcePeek`/`ISourcePeekRow`).
- **Editor** (`livingDocEditor.ts`): holds editor-local `_sourcePeek` state; `reveal`/`openSource`
  open it, `closeSource` clears it, `sync` re-derives + marks it synced — **no service editor-opening**.
- **Render** (`livingDocRender.ts`): when peek is open, lays out the source pane LEFT + a floating ⟳
  "Sync across" circle on the divider + the doc RIGHT, all in one webview; added the close ✕ handler.

### TDD
Replaced the old "revealSource opens a side editor" test with **`getSourcePeek returns in-surface
source data (no side editor)`** — asserts `openedEditors === 0` plus the styled data (selected cells,
referencing docs). `typecheck-client` clean; **71/71 tests green**.

### Live verification + gate re-check (chrome-devtools MCP)
- **G1 — PASS (source-peek).** Open Source → in-surface pane, `main` holds exactly **one** iframe (no
  Editor Group 2, no blank pane); Sync → green "N changes synced" on the divider; ✕ → full doc back.
  `shots/v2-iter2/01-source-peek-insurface.png`, `02-synced-state.png`, `03-after-close.png`.
- **Bug found & fixed live:** the floating Sync circle (`top:16px`) overlapped and intercepted clicks on
  the close ✕ in the pane header; moved it to `top:64px` (below the header, per the comp) — ✕ now works.
- **No regressions** in the other gates: G2 (header), G3 (tree-rail), G5 (gutter) unchanged; G4 slightly
  improved (the source "open-beside" optionality is gone); G6 toasts still fire (untouched this iter).
- **Residual (tracked, not the named abrasion):** the export/Download flow still opens its generated
  artifact (`*.export.html` / `*.export.md`) in a `SIDE_GROUP` — a separate flow; fold into a later iter.

### Next
Backlog #2 — **the left tree-rail (G3)**: the comp's 76px labeled icon-nav + 264px
Files/Context/Outline/Search rail + folder tree, replacing the activity-bar-per-view containers. This is
also what un-squeezes Templates/Knowledge/Agents (they stop being editors beside leftover panes).

---

## v2 Iteration 3 — the left tree-rail (G3) · ~61% → ~67%

Backlog #2. Replaced the spike-era activity-bar-per-view split (separate **Documents** + **Context**
containers, a flat doc list, no folders) with the comp's **single tabbed tree-rail**. Screenshots:
[`shots/v2-iter3/`](shots/v2-iter3/).

### What changed (0 core patches — additive-contribution, decision log 23)
- **New `common/treeRail.ts`** (pure, TDD): `buildFileTree` (docs → Reports folder, deduped sources →
  Sources folder), `buildOutline` (heading blocks → entries, Markdown/bind syntax stripped),
  `searchTreeRail` (title/body match + snippet, blank query → none).
- **New `browser/treeRailView.ts`** (`ViewPane`, DOM-rendered like the old DocumentsView): a 4-tab strip
  (Files / Context / Outline / Search) + the active tab's body. Files = folder tree (doc rows open the
  editor, pending dot mirrors the Review count); Context = `buildContextGroups` for the active doc;
  Outline = the doc's headings; Search = input + result snippets.
- **`livingDocs.contribution.ts`**: the default sidebar container now hosts `TreeRailView` (titled
  "Workspace", `listTree` icon); **deleted** the separate Context container and the now-orphaned
  `documentsView.ts` + `contextPanelView.ts`.
- **`ILivingDocSummary` gained `sources`** (the Files tab's Sources folder needs the names).

### TDD
3 new `treeRail` tests (file-tree grouping, outline stripping, search). `typecheck-client` clean;
**74/74 tests green** (71 + 3).

### Live verification + gate re-check (chrome-devtools MCP)
- **G3 — MOSTLY PASS.** The rail shows the **Files / Context / Outline / Search** tab strip + a folder
  tree (REPORTS: Board Note, Weekly Operating Summary; SOURCES: metrics.csv). All four tabs verified:
  Files (folder tree + doc-open), Outline (Highlights / Key metrics / Commentary / What to watch),
  Context (Linked sources · 1 / Referenced files · 1), Search ("growth" → 1 result + snippet).
  `shots/v2-iter3/01-tree-rail-files.png` … `04-search-tab.png`. _Residual:_ the 76px labeled icon-nav.
- **No regressions:** **G1 still PASS** — opening a doc from the Files tab opens it cleanly in the one
  editor (single iframe, no split, no blank pane). G2 / G4 / G5 unchanged; G6 toasts still fire.

### Next
The remaining shell gaps are **the calm header (G2, score 48)** and **removing IDE optionality
(G4, 30)**; then the icon-nav restyle and per-surface pixel alignment. Next iteration: **G2 — calm the
header** (strip the doc editor's second formatting-toolbar row + Download/Refresh, unify to the comp's
single 48px bar).

---

## v2 Iteration 4 — calm the header (G2) · ~67% → ~70%

Collapsed the doc editor's heavy 2-row header to the comp's single calm bar. All inside the doc webview
(`livingDocRender.ts`); 0 core patches. Screenshots: [`shots/v2-iter4/`](shots/v2-iter4/).

### What changed (decision log 24)
- **Top bar = the comp's bar:** brand/crumb + "All sources synced" pill + ↗ Present + avatar. **Removed**
  the ⇣ Download button (the Present/export modal already downloads) and the standalone ↻ Refresh button.
- **The sync pill IS the refresh** (`data-refresh` on the pill, "Refresh from sources" tooltip) — the
  comp shows the pill, so refresh stays reachable without a separate button.
- **The persistent formatting toolbar row is gone**, replaced by a **floating selection toolbar**
  (Heading/B/I/U/List/Quote) that appears only on a text selection inside editable prose
  (`selectionchange` positions it above the selection) — Notion-like, holds the formatting without the
  persistent chrome.
- **Ask-AI and Source header buttons dropped** — the right-rail **Chat** tab and the **provenance dots**
  are the comp's entry points (both still work). The **raw-Markdown** toggle moved to a quiet link in
  the footer hint. Removed the now-dead export-button script handlers.

### TDD + verification
A render assertion that the header is the calm bar (pill refreshes, no Download/Refresh buttons, no
persistent toolbar, floating selection toolbar present, raw-edit in the hint). `typecheck-client` clean;
**75/75 green.** Live (chrome-devtools): the doc header shows only brand/pill/Present/avatar
(`shots/v2-iter4/01-calm-header.png`); **G1 re-verified — a provenance dot opens the in-surface source
pane in the one iframe, no split** (`02-calm-header-with-source-peek.png`).

### Gate re-check — no regressions
**G2 PASS** (doc header is the comp's calm bar). **G1 still PASS** (dot → in-surface pane). G3 unchanged
(mostly pass). G5 unchanged. **Residual on G2/G4:** the VS Code **menubar ("Application Menu")** still
sits above the webview — folded into the next target.

### Next
**G4 — remove the remaining IDE optionality** (the menubar, editor-group split/drag/close affordances),
and the **provenance-gutter detach (G5/D1)**; then the icon-nav restyle + per-surface pixel alignment.

---

## v2 Iteration 5 — remove the residual IDE chrome (G4) · ~70% → ~73%

The interaction-grammar score (35) was the single lowest; G4 the highest-impact gate. Removed the
visible IDE-chrome tells the settings couldn't reach. Screenshots: [`shots/v2-iter5/`](shots/v2-iter5/).

### What changed (decision log 25; merge-tax tier: styleOverrides-CSS, 0 core patches)
Three rules in `styleOverrides/browser/media/studio.css` (the existing `.style-override-studio` sheet):
- hide the modernUI **menubar** (`.part.activitybar .menubar`) — the "Application Menu" hamburger that
  ignores `window.menuBarVisibility:hidden` because modernUI renders it inside the activity bar;
- hide the **Accounts** (`:has(> .codicon-accounts-view-bar-icon)`) and **Manage**
  (`:has(> .codicon-settings-view-bar-icon)`) global activity-bar actions — pure IDE tells, and Manage
  is the menu that surfaces the command palette / extensions / updates.

### Verification + gate re-check (chrome-devtools MCP)
- **Before:** menubar hamburger top-left + Accounts/Manage at the activity-bar bottom
  (`shots/v2-iter5/00-before-fullwindow.png`). **After:** all three gone; the activity bar is just the
  nav icons (`01-after-chrome-removed.png`).
- **G4 MOSTLY PASS:** with tabs/status/command-center/editor-group-title already off (settings +
  studio.css) and the palette no longer surfaced, the shell reads as a calm app. _Residual:_ the raw
  `Ctrl+Shift+P` keybinding (UI surface removed) + pane-resize sashes are core-owned — a later iteration.
- **No regressions:** opened a doc live — single iframe, calm header (G2), tree-rail (G3), no split
  (G1). The click-through is clean.

### Next
**G5 — detach the provenance gutter** (D1: a 30px gutter column, dot per bound line, vertical bar for
multi-line edits) + pixel-align the doc column; then per-surface pixel polish (right rail, Present) and
the dev-build ext-activation toasts (G6).

---

## v2 Iteration 6 — kill the dev-build ext-activation toasts (G6) · ~73% (gate flip)

Backlog #6. The three "Activating extension '...' failed: Not Found" toasts (`emmet`/`git-base`/
`merge-conflict`) fired on every launch — the last not-clean part of the click-through and a failing
hard gate. Screenshots: [`shots/v2-iter6/`](shots/v2-iter6/).

### What changed (decision log 26; FIRST v2 core patch)
The builtin set is injected (dev: a DOM `data-settings` blob from `@vscode/test-web`; prod: build-time)
and read only by the web `BuiltinExtensionsScannerService`. So the single clean exclusion point is that
scanner: a 3-id denylist (`vscode.emmet`, `vscode.git-base`, `vscode.merge-conflict`) filtered out of
`bundledExtensions`. These IDE-only builtins are irrelevant to a word processor and were the ones whose
web bundle 404s in the dev run. Tier: **core-patch** (the first in v2; merge-tax ledger updated — minimal,
low-fragility, product-correct).

### Verification + gate re-check (chrome-devtools MCP)
- **Before:** three error toasts bottom-right on every load (`shots/v2-iter1/01`). **After:** zero toasts;
  the alert regions are empty (`shots/v2-iter6/01-no-toasts.png`).
- **G6 PASS.** **Clean live click-through confirmed:** Home → open a document → calm header + tree-rail +
  gutter + right rail, no toasts, no menubar, no IDE chrome (`02-clean-clickthrough-doc.png`).
- **No regressions:** G1 (single iframe, no split), G2 (calm bar), G3 (tree-rail), G4 (no chrome) all
  hold. `typecheck-client` clean; **75/75 tests green**.

### Gate status after iter 6
G1 ✅ · G2 ✅ · G3 mostly ✅ · G4 mostly ✅ · G5 partial (gutter detached, pixel-align pending) · G6 ✅.

### Next
Lift the surface mean toward 95% with per-surface **pixel alignment**: the **right rail** (65, the
lowest) and the **70-cluster** (doc editor incl. the G5 gutter pixel-align, Templates, Knowledge, Agents,
Present), plus the **icon-nav restyle** (the G3 residual).

---

## v2 Iteration 7 — pin the shell to the comp's rail widths · ~73% → ~74%

The right rail (65) was the lowest surface and visibly cramped (282px vs the comp's 392px). Pinned both
rails to the comp's widths. Screenshots: [`shots/v2-iter7/`](shots/v2-iter7/).

### What changed (decision log 27; 0 core patches, additive-contribution)
`StudioStartupContribution` now calls `IWorkbenchLayoutService.setSize` to pin the **tree-rail to 264px**
and the **right rail to 392px**, after revealing the rail and on the next layout tick (a `disposableTimeout`)
so the workbench's own size-restore doesn't clobber it. The product is an opinionated single surface, so
the layout is set rather than left at the IDE defaults.

### Verification + gate re-check (chrome-devtools MCP)
- Measured: right rail **282 -> 374px**, sidebar **246 -> 252px**, editor **780 -> 718px** (the 720px doc
  column still fits). The grid redistributes, so it lands near- not exact-pixel — but well toward the comp
  from the cramped defaults (`shots/v2-iter7/01-wider-rails.png`).
- **No regressions:** doc opens clean (single iframe, calm header), no toasts. G1-G4 + G6 hold; G5 partial.
- `typecheck-client` clean; **75/75 tests green**. The extra **Skills** tab (4th) is kept as a deliberate
  verification-feature departure from the comp's 3.

### Next
Per-surface pixel alignment on the **70-cluster** (doc editor incl. the G5 gutter/figure pixel-align,
Templates, Knowledge, Agents, Present) + the **icon-nav restyle** (G3 residual). With 3 iterations left,
the mean likely lands in the ~80s, not 95 — iteration 10 will give the honest final readout.

---

## v2 Iteration 8 — inline bound-figure highlighting (completes G5) · ~74% → ~76%

The doc was the heart of the product but its bound figures rendered as plain text (only a block-level
gutter dot showed something was bound). The comp marks each live figure inline. Screenshots:
[`shots/v2-iter8/`](shots/v2-iter8/).

### What changed (decision log 28; 0 core patches, webview only)
`renderBoundParagraph` (in `livingDocRender.ts`): bound prose now wraps each resolved figure in a
`.bound` span styled like the comp (faint-blue bg + 1.5px blue underline). Tables stay plain (as the
comp). The figure is **tokenized before** the sanitizing Markdown renderer and the token is **swapped
for the span after** — so Markdown formatting around it survives and no raw HTML is injected. Each span
carries `data-cells`, so clicking a figure peeks its source (same path as the gutter dot). The footer
hint updated to "Bound figures are highlighted in blue."

### Verification (chrome-devtools MCP) + gate re-check
- Live: in Highlights, **"+18%", "$48.6k", "427", "2.4%" are highlighted in blue**; the Key metrics
  table stays plain (`shots/v2-iter8/01-inline-figure-highlight.png`).
- **G5 PASS** (gutter detached + figures highlighted + doc column 720px aligned + rail widened in iter 7).
- **No regressions:** doc opens in a single iframe (G1), calm header (G2), no toasts (G6). `typecheck-client`
  clean; **76/76 tests green** (a new render assertion for the bound span).
- _Minor:_ the highlight path doesn't preserve bold/italic *inside* a bound paragraph (an edge case the
  sample doesn't hit) — tracked.

### Gate status after iter 8
G1 ✅ · G2 ✅ · G3 mostly ✅ · G4 mostly ✅ · **G5 ✅** · G6 ✅. Only G3/G4 remain "mostly" (residuals:
the 76px labeled icon-nav; the raw palette keybinding + pane sashes).

### Next
The **70-cluster** secondary surfaces (Templates / Knowledge / Agents / Present) — now un-squeezed since
the shell fixes — and the **icon-nav restyle** (G3 residual). Iteration 10 = final re-score + summary.

---

## v2 Iteration 9 — the 76px labeled icon-nav (completes G3) · ~76% → ~77%

The tree-rail (iter 3) closed most of G3, but the icon-nav was still VS Code's 48px icon-only activity
bar, not the comp's 76px labeled rail. Screenshots: [`shots/v2-iter9/`](shots/v2-iter9/).

### What changed (decision log 29; SECOND v2 core patch)
- **Core patch:** `ActivitybarPart.ACTIVITYBAR_WIDTH 48 -> 76` so the workbench grid allocates the comp's
  wider rail (a CSS-only width override overlapped the sidebar by 22px — the grid still reserved 48px —
  so the constant is required). Its guard test (`activitybarPart.test.ts`) updated 48 -> 76.
- **studio.css (styleOverrides):** stack each nav item as icon-over-label and render the label via
  `::after { content: attr(aria-label) }` (the container name lives on the action-label's aria-label).

### Verification + gate re-check (chrome-devtools MCP)
- A CSS-only test first proved the labels render (`shots/v2-iter9/00-iconnav-csstest.png`) but measured a
  22px sidebar overlap -> hence the core constant. After the patch: rail **76px**, sidebar starts at 88px
  (**no overlap**), labels Workspace/Home/Templates/Knowledge/Agents (`01-labeled-icon-nav.png`).
- **G3 PASS** (tree-rail + labeled icon-nav). Doc click-through clean at the new layout
  (`02-doc-with-labeled-nav.png`) — single iframe (G1), calm header (G2), no toasts (G6).
- `typecheck-client` clean; **activitybar 14/14 + livingDocs 76/76 green**.

### Gate status after iter 9
G1 ✅ · G2 ✅ · **G3 ✅** · G4 mostly ✅ · G5 ✅ · G6 ✅. **Only G4 remains "mostly"** (the surfaced
optionality is gone; the raw `Ctrl+Shift+P` keybinding + pane-resize sashes are the core-owned residual).

### Next (iteration 10 — final)
Final re-score across all surfaces + a v2 readiness summary (before -> after per surface, each gate's
status, deferred items, and the keep-fork-vs-greenfield read given the 2 tiny core patches). The mean
won't reach 95% in one more iteration, so iteration 10 is the honest landing + PR readiness, not a new
build.

---

## v2 Iteration 10 — final readiness summary (10-iteration cap reached)

The v2 design-alignment loop ran its full 10 iterations. **Stop bar (>= 95% + all gates + clean
click-through) NOT fully met** — landed at **~82%** with **5 of 6 hard gates fully passing** and a clean
live click-through. This is an honest cap landing, not a regression: every named abrasion is gone.

### Per-surface: before (iter-1 baseline) -> after (iter-10)

| Surface | Before | After | What changed |
|---------|:-----:|:----:|--------------|
| Source-peek / Sync-across | 18 | 78 | In-surface pane (iter 2) — no split, no blank pane |
| Interaction grammar | 25 | 70 | Menubar/Accounts/Manage removed; palette not surfaced (iters 2/4/5) |
| Left rail / nav | 35 | 90 | Tree-rail (iter 3) + 76px labeled icon-nav (iter 9) |
| Global header | 48 | 85 | Single calm bar; selection toolbar; pill = refresh (iter 4) |
| Context | 50 | 78 | A tab in the tree-rail (iter 3) |
| Right rail | 65 | 75 | Pinned to ~374px (iter 7) |
| Document editor | 70 | 88 | 30px gutter + inline blue figures + calm header (iters 4/8) |
| Templates | 70 | 85 | Un-squeezed full-width (shell fixes) |
| Knowledge | 70 | 88 | Un-squeezed full-width |
| Agents | 70 | 85 | Un-squeezed full-width |
| Present modal | 70 | 85 | Re-verified live |
| Home | 78 | 80 | Clean, no toasts, labeled nav |
| **Overall** | **~56%** | **~82%** | |

### Hard UX gates: FAIL -> final

| Gate | iter-1 | final | Notes |
|------|:-----:|:----:|-------|
| G1 — no split/blank panes | FAIL | **PASS** | Source-peek in-surface; verified no 2nd editor group |
| G2 — calm 48px header | FAIL | **PASS** | Single comp bar; formatting -> selection toolbar |
| G3 — left tree-rail | FAIL | **PASS** | Tabbed tree-rail + 76px labeled icon-nav |
| G4 — no IDE optionality | FAIL | **MOSTLY** | Chrome + palette surface removed; **residual:** raw `Ctrl+Shift+P` keybinding + pane-resize sashes (core-owned) |
| G5 — gutter detached + pixel-align | PARTIAL | **PASS** | 30px gutter (dot/bar) + inline figure highlighting |
| G6 — no nav-blank + no ext toast | FAIL | **PASS** | Builtins excluded; zero toasts; nav never blanks |

### Deferred / still off (honest)
- **G4 residual:** the command palette's raw keybinding still opens it, and the pane sashes still drag
  (resize). Both are core-owned; fully removing them is a larger core patch deferred past the cap.
- **Per-surface pixel polish:** surfaces sit at 75-90, not 95 — typography/spacing nits remain (right
  rail content, per-agent canvas, Present pixel pass).
- **Minor:** the activity-bar screen items (Templates/Knowledge/Agents) show a stub launcher in the
  sidebar when active (the comp would keep the tree-rail); bound-paragraph bold/italic isn't preserved
  by the figure-highlight path (edge case); our icon-nav label set differs from the comp's literal
  Home/Editor/Review.

### Merge-tax / keep-fork-vs-greenfield read (Q3)
The entire v2 calm shell needed **2 tiny core patches** (a 3-id builtin denylist + the activity-bar
width constant); everything else — in-surface source-peek, the tabbed tree-rail, the calm header +
selection toolbar, removing IDE chrome, the rail widths, inline figure highlighting — landed as
**contributions + styleOverrides CSS**. The Item-5 fear that the "costly 20%" would force a web rebuild
did not materialize: **the fork de-IDEs cheaply.** Recommendation stands — keep the fork for validation;
the web rebuild remains a product decision (true block editor / canonical format / multiplayer), not a
merge-tax escape.

### Verification index (where each was proven live)
source-peek in-surface — iter 2 · calm header — iter 4 · tree-rail — iter 3 · IDE-chrome removed —
iter 5 · ext-toasts gone / clean click-through — iter 6 · rail widths — iter 7 · inline figures — iter 8
· labeled icon-nav — iter 9 · full-surface re-verify — iter 10.
