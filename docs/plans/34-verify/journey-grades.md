# Plan 34 - Journey grades (iteration 1: Groups A and B)

This is the honest, evidence-backed grade for each of the ten aha-path journeys walked in iteration 1 - Group A (1a, 1b, 1c, 1d, 1w, 1x) and Group B (1e, 1f, 1g, 1h). Every grade traces to a real walk in the running web app driven through the chrome-devtools MCP, with screenshots in `docs/plans/34-verify/shots/`. Where a journey's surface does not exist, that is confirmed in the product, not read off the map.

Grades follow the plan rubric: WALKABLE (survives the golden path and the standard off-path probes), FRAGILE (golden path works, an off-path probe breaks it), BLOCKED (cannot complete even on the golden path), MISSING (the surface does not exist). Any data-loss finding is severity-1 regardless of grade.

Note on what was graded against: per doc 13 §2, decisions are the spec where they defer scope. D2/D3 (quick-start modal then Project Home) and 1w/1x (known GAP chips) are graded against what exists today, honestly.

## Summary table

| Journey | Title | Grade | Sev-1 |
|---|---|---|---|
| 1a | Open a project for the first time | FRAGILE | 0 |
| 1b | Create a new document - the template on-ramp | FRAGILE | 0 |
| 1c | Switch between projects from Home | WALKABLE | 0 |
| 1d | Organise files without breaking anything | MISSING | 0 |
| 1w | Project Home - the project's front door | MISSING | 0 |
| 1x | Grow a template from examples | MISSING | 0 |
| 1e | Iterate on a document via the chat rail | FRAGILE | 1 |
| 1f | Judge one proposal: approve / tweak / reject | FRAGILE | 0 |
| 1g | Dial the auto-apply policy | FRAGILE | 0 |
| 1h | Undo, history and versions - the way back | FRAGILE | 1 |

Severity-1 count: 2 (both are the same root cause - approved changes are not persisted, so they vanish on reload; recorded once under 1e and once under 1h because both journeys own a face of it).

## Cross-cutting findings (affect several journeys)

These recur across journeys and are called out once here, then referenced by id below.

**X1 - Approved changes do not persist across a reload (severity-1, lost work).** After approving a chat proposal on Board Note, the tightened paragraph is applied in the editor and logged in History with a real timestamp, but on page reload the document reverts to the original text, the on-disk `Board Note.md` is unchanged, and the real History entry is replaced by a seeded stack. New documents created via the New-document dialog (1b) also never appear on disk. This is lost work, not destroyed source data (the original file is intact), so it is severity-1 "lost approved work" rather than destructive corruption. It may be partly a web-build File System Access limitation - a desktop pass is needed to confirm whether writes land on disk there - but in the web build under test, every write is in-memory only. Repro under 1e/1h below.

**X2 - History shows fabricated versions with a mislabelled header (trust / P0).** On a fresh load, the History tab for Board Note shows a canned stack: v14 "Approved commentary rewrite - just now - Tom", v13 "Auto-refresh… - 2m ago", v12 "Edited What to watch - yesterday", v11 SNAPSHOT "Jun 12". The "just now" timestamp appears with no edit having been made this session, and the header reads "VERSION HISTORY - WEEKLY SUMMARY.MD" while the open document is Board Note. Design principle §2 "Real data only - no fabricated counts, no fake versions" and journey 1h's own note ("History silently shows FABRICATED versions") are violated live. Screenshot `1h-3-history-fabricated-stack.png`.

**X3 - The "Saved - vN" version chip is hardcoded to v14 everywhere.** Every document - Board Note, a brand-new template-generated doc (1b), a brand-new blank doc in an empty folder, a plain messy-folder .md - shows "Saved - v14" in the editor header. A new document should be v1; an approved edit should bump the number. The chip is a fixed string, not real state. This is the same fabrication class as X2, on the editor surface.

**X4 - Two chat surfaces, one of them stock Copilot.** The Review rail has an Abstract-native "Chat" sub-button (the real 1e surface: scope chip, @source mentions, proposal cards). But the workbench title bar also exposes a "Chat" tab that opens the raw upstream GitHub Copilot "Build with Agent" panel ("Generate Agent Instructions to onboard AI onto your codebase", "Plan agent", "sign in to use Copilot", disabled input). A beta user who clicks the obvious top-level Chat tab lands in developer-tooling chat that is gated on Copilot sign-in and has nothing to do with their document. Screenshot `1e-1-chat-tab-copilot.png`.

---

## 1a - Open a project for the first time · FRAGILE

**What was walked.** Opened the app at the correct entry (`http://localhost:8080/`). It lands on a cross-project "Home" ("Good morning, Tom", ALL PROJECTS with the Living Docs Sample card showing "7 docs - 1 source" and a second "sample-folder" card). Clicking the project card opens the workbench: Workspace file list on the left (7 docs under REPORTS, metrics.csv under SOURCES), a Living Document in the centre, and the Review rail on the right. Screenshots `1a-2-home-correct.png`, `1a-3-open-project-lands-editor.png`.

**Probe results.**
- Golden path: works - a real folder opens to a working editor in one click.
- D2/D3 conformance: opening a project lands directly in the **editor** (a document is auto-opened), not on **Project Home** (D2), and there is no **quick-start modal** first screen (D3). What exists is the older cross-project Home. This is the known 1w GAP surfacing here; graded honestly, the "land on Project Home" half of 1a is not built.
- Native folder picker (frame 2): "Switch folder…" produces no visible dialog in the web build (no quick-pick, no notification, no dialog element). This is the native-OS-picker path - not walkable in web, needs a desktop pass. Not graded as a product failure.
- Empty folder: the empty project appears on Home as "mount - 0 docs" but clicking the card does nothing (focus only, no navigation). There is no way to enter an empty project from Home and no empty-state landing. See `1b-3-empty-blank-doc-untitled.png` context and 1w below.
- Messy folder / T3 (mixed formats): opened `/tmp/abstract-walk-messy` (15 files, nested subfolders, odd-formatted .md, CSVs, .txt, .png, real .docx and .doc). Findings, screenshot `1a-4-messy-folder-T3.png`:
  - Nested subfolders are flattened - `subfolder-a/`, `reports/2025/`, `subfolder-a/deep/` show as one flat REPORTS list with no hierarchy.
  - Odd-formatted Markdown loses its title - `notes-odd.md` ("#Heading no space"), `messy-two.md` (leading blank lines) and `plain.md` (no heading) all render as "Untitled" in the list (three of them).
  - Non-Markdown files are absent - the CSVs, .txt, .png do not appear (there is no SOURCES section at all in this folder), and the `.doc`/`.docx` are silently skipped, not interpreted or converted. This is the concrete T3 answer today: **.doc/.docx are skipped, not gracefully imported.**
- Restart survival: reloading the page returns to Home rather than the previously open document; the workspace re-opens fine, editor state resets. Acceptable for a web reload.

**Grade rationale.** Golden path opens cleanly (FRAGILE not BLOCKED), but multiple off-path probes break: empty project is a dead-end from Home, the messy folder flattens structure and drops every non-.md file, and .doc/.docx are skipped. The Project-Home landing (D2) and quick-start modal (D3) are absent.

## 1b - Create a new document, the template on-ramp · FRAGILE

**What was walked.** "New document" on Home opens a real dialog: name field, "Blank document", and "OR START FROM A TEMPLATE" listing the three project templates (Client update, Meeting notes to SOP, Weekly report) with slot/source counts. Named a doc "Walk Test Weekly" and picked the Weekly report template (3 slots - 1 source). The doc was created, opened with the template scaffold (Highlights / Commentary / What to watch, "pending" bound-figure placeholders), and a chat task auto-started to generate the first draft from the template; it streamed and produced proposal cards for Commentary and What to watch through the review engine ("2 changes required across 1 doc - Approve all"). Screenshots `1b-1-new-doc-dialog.png`, `1b-2-template-draft-generated.png`.

**Probe results.**
- Golden path (template birth): works, and is far more built than the map's GAP chip - name-first, template picker, and a live review-engine draft. This alone is a strong on-ramp.
- Blank-document birth: broken name handling. In the empty folder I entered the name "First Doc" and chose Blank document; the file was created as "Untitled" - the name I typed was discarded (`1b-3-empty-blank-doc-untitled.png`). Name-first birth (a P0 Word/Docs muscle-memory promise) fails for blank docs.
- "From sources…" third birth option (map frame 1): not present - only Blank and Template. Missing sub-surface.
- Persistence: the created doc never appears on disk (see X1) - "Walk Test Weekly.md" was not written to the mounted folder. On reload it would be gone.
- The internal template brief/prompt is dumped verbatim into the chat rail (the whole "Generate the first draft… Template brief: …" text is shown to the user). A leak of internal plumbing (P5), polish not blocker.
- Version chip shows v14 on the brand-new doc (X3).

**Grade rationale.** Template on-ramp golden path is genuinely good, but blank-doc naming is broken, the doc does not persist (X1), and "From sources…" is missing - FRAGILE.

## 1c - Switch between projects from Home · WALKABLE

**What was walked.** The five-destination nav (Workspace, Home, Editor, Templates, Knowledge, Agents in the title bar; plus the activity-bar icons) is present and switching between Home and a project re-scopes the workbench (tree, breadcrumb, rail). Critically, I checked the map's claim that "two of five nav destinations are stubs": they are not.
- Templates (`1c`/Templates): a real page - "3 TEMPLATES", New Template, three template cards with descriptions, slot/source counts, Use Template / Edit. Screenshot via `1x-1` context.
- Agents: a real table (D16 table-not-graph) - 5 agents (Weekly refresh, Source-change watcher, Freshness sweep, Before-export gate, On-publish snapshot) with Trigger / Flow / Last run / Status, filters and New agent. Screenshot `1c-1-agents-nav-table.png`.
- Knowledge: a real table - 2 sources (market-research.md, metrics.csv) with Kind / Last synced / Freshness / Used-by, Project vs Organization tabs (the D13 org-library split), Add source.

**Probe results.**
- Golden path (switch project, browse destinations): works; all five destinations render real content.
- Rapid repeat / navigate-away-and-back: switching between Templates, Agents, Knowledge, Home and back is stable, no dead views.
- Multi-project switching from Home: the sample has one populated project plus a "sample-folder" card that says "Open to see counts" - clicking it did not obviously re-mount in this session; the primary switch (Home to project to Home) works. The v1 IA per D2/D3 (this cross-project Home is deferred to "once cloud") is a scope note, not a failure.

**Grade rationale.** Every nav destination is built and stable; the "40% of nav is a stub" concern from the map is stale. WALKABLE. (Freshness labels like "Synced 11 days ago" on a just-mounted file are slightly suspect but plausible, noted not graded.)

## 1d - Organise files without breaking anything · MISSING

**What was walked.** Attempted the frame-1 verb surface: right-click a file in the Workspace list to get Rename / Move to… / Duplicate / Delete plus the agentic verbs (Add to chat, Run agent on this). The Abstract Workspace file list is a custom list of buttons, not the VS Code explorer; a synthetic contextmenu on a file button produced an empty container and no menu items appeared. Screenshot `1d-1-file-context-menu.png` (no menu visible).

**Probe results.**
- Golden path (rename/move/delete via right-click): the described verb surface does not exist on the custom Workspace list. No context menu, so none of the frame-1 operations, the drag-to-move (frame 2) or the "lock sidecar followed the file - Undo" toast (frame 3) could be exercised.
- The dependency-warning-on-delete behaviour (D6) could not be reached because delete is not reachable.

**Grade rationale.** The journey's operating surface (file ops on the Abstract file list) is absent, so it is MISSING rather than FRAGILE. (VS Code's own explorer exists underneath but is not the surface the journey describes, and the Abstract Workspace list is what a user sees.) No data-loss because no destructive op is reachable.

## 1w - Project Home, the project's front door · MISSING

**What was walked.** Per D2, opening a project should land on Project Home (while-you-were-away, staleness blast radius, recommendations, recent files, "all clear in ~N min", and a whole-project chat composer per D21). Opening the sample project instead lands directly in the editor with a document already open (see 1a). There is no Project Home surface. The cross-project "Home" that does exist ("Good morning, Tom", ALL PROJECTS) is the older cross-project inbox, not the per-project front door: it has no while-you-were-away feed, no moved-source blast-radius card, no recommendations, no time-to-all-clear, and no project-scoped chat composer.

**Probe results.**
- Golden path (open project, see what ran / what is stale / what to do next): the surface does not exist; you land in a document instead.
- Empty-folder front door (frame 4: "Editor with no file = explorer + empty editor suggesting template/blank + chat"): not reached - an empty project cannot even be entered from Home (its card does not navigate; see 1a). New-document works from the button, but there is no empty-state front door guiding the first doc.
- D21 project chat / D24 ask-the-project: no whole-project chat composer exists on any front-door surface (the only project-scoped chat is the per-document rail).

**Grade rationale.** MISSING - the front-door surface described by 1w is not built; what exists is a different (cross-project) Home.

## 1x - Grow a template from examples · MISSING

**What was walked.** Per D4, the wizard should take 3-10 past documents, have the agent find commonalities (structure, recurring figures, tone), and propose a template (a skill.md with success examples). "New Template" on the Templates page instead opens a blank template-authoring document - a scaffold with "{{slot:document title}}" placeholders and HTML-comment authoring hints - in the editor. Screenshot `1x-1-new-template-scaffold.png`.

**Probe results.**
- Golden path (drop examples, analyse commonalities, propose template): the from-examples wizard does not exist. There is a manual template editor (author a skill.md by hand) but no "feed it examples and it learns the pattern" flow - frames 1-3 of 1x are absent.
- The "Edit" button on each existing template (the week-one offboarding concern - edit a wrong template) does exist as a manual editor, which is a partial answer to that gap.

**Grade rationale.** The example-driven wizard - the actual subject of 1x - is MISSING. Manual template authoring exists but is a different job.

## 1e - Iterate on a document via the chat rail · FRAGILE (severity-1: X1)

**What was walked.** Opened the Abstract-native chat (Review rail → Chat sub-button): "Ask the agent about this document, or @mention a source", an "Edit across:" scope control with "+ Add documents", @source attach chips, "+ Skill", "@ Mention", send. Sent "Tighten the Note to the board paragraph to be more concise, keep the meaning." The agent narrated its steps ("✓ Read metrics.csv, market-research.md", "✎ Proposed edit: Note to the board"), streamed a red/green inline diff into the exact paragraph, and produced a proposal card in the document (MEANING CHANGE - NEEDS YOUR CALL - High, one-line why, source citation, "+3 added - 2 removed - 85% confidence", Edit/Approve/Reject) mirrored in the rail ("1 change waiting on you - Approve all / Reject all / Review each"). A real model call hit the proxy (`POST /v1/messages 200`). Screenshots `1e-3-abstract-chat-rail.png`, `1e-4-chat-response.png`.

**Probe results.**
- Golden path: excellent - this is the foundational loop and it works end to end with a live model, diff-in-place, proposal card, rail mirror.
- Model error / timeout: killed the proxy, sent a prompt. The rail returned a real, named error: "The agent model is not reachable. Start the local proxy (scripts/lwd-anthropic-proxy.sh) and I can answer using this document and its sources." No silent hang, no "the agent errored", no data loss. This is a well-handled error path. Screenshot `1e-5-model-error-proxy-down.png`.
- Restart survival: **fails (X1)** - after approving the edit and reloading, the document reverts and the change is gone from editor and disk. Severity-1 lost work. Repro below.
- The obvious top-level "Chat" tab is stock Copilot, not this rail (X4).

**Severity-1 repro (X1, via 1e).**
1. Open the sample at `http://localhost:8080/`, open Board Note.
2. Review rail → Chat → send "Tighten the Note to the board paragraph to be more concise, keep the meaning."
3. Approve the proposal (paragraph becomes "On plan, no surprises. Momentum continues to build.").
4. Reload the page, reopen Board Note.
5. Observed: the paragraph is back to "Momentum is steady; we continue to track plan with no surprises this week."; `living-docs-sample/Board Note.md` on disk is unchanged. The approved edit is lost.

**Grade rationale.** Golden path and error path are strong, but the approved result does not survive a reload - FRAGILE with a severity-1 lost-work finding.

## 1f - Judge one proposal: approve / tweak / reject · FRAGILE

**What was walked.** The proposal card anatomy from 1e is exactly the 1f card: change kind (MEANING CHANGE), honest confidence label (High / 85% confidence), old vs new (red/green), source + freshness (metrics.csv, market-research.md), one-line why ("Removes redundancy and tightens to the essential meaning"), and Edit / Approve changes / Reject. Approving cleared the card, applied clean text, and logged a real History entry ("Approved - CURRENT - Board Note / b-3 - model - 12:40:36"). Screenshot `1h-1-history-after-approve.png`.

**Probe results.**
- Approve: works (card clears, text applies, history entry with real timestamp and provenance).
- Tweak/Edit (the "edit the proposal inline, then apply" version): an "Edit" button is present on the card. Per the map, "today Tweak just navigates to the doc". I did not fully exercise the inline-edit apply-with-edits flow this pass - flagged for iteration-2/3 detail; the button exists, its inline-edit behaviour is unverified.
- Reject: the button is present; the clean revert + optional-reason-to-audit flow (frame 3) was not exercised this pass beyond confirming the control exists.
- Persistence: the approve does not survive reload (X1) and the version chip does not bump (X3).
- Confidence label is honest (a label, not a fake percentage on the card headline - though "85% confidence" as a number does appear in the sub-line, which is closer to the "fake percentage" the map warns against; noted).

**Grade rationale.** Approve works and the card is well-formed; but persistence fails (X1), the version chip is fake (X3), and Tweak/Reject depth is unverified - FRAGILE.

## 1g - Dial the auto-apply policy · FRAGILE

**What was walked.** Looked for the frame-1 "While I'm away, the agent may… (ask first / auto-apply figures only / auto-apply everything)" dial in the document header. There is no such policy dial in the doc header. What the product does assert is the figure/meaning split, in the doc footer text: "Figures apply automatically; meaning-changes wait in the Review rail." The DOCUMENT AGENTS section in the rail (Strategy / Financial / Formatting agents with Run / Re-run / Apply fix, and a "RUN ON EXPORT: Formatting + Financial" policy line) is the built agent-policy surface. Screenshot `1g-1-document-agents.png`.

**Probe results.**
- Golden path (per-document three-position autonomy dial): the dial UI does not exist in the doc header. The figure-auto / meaning-waits behaviour is real and observed (the 1e meaning-change correctly waited for approval; the doc claims figures auto-apply), but the user-facing control to *dial* it per document (D9 "the human dials autonomy") is absent.
- A "RUN ON EXPORT" toggle exists for which agents run on export - a partial, different autonomy control.
- Running an agent (Strategy) works end to end with a live model (PASS "Claims are consistent with the decision stack", real `POST /v1/messages`). So the agent-run half is walkable; the policy-dial half is not.

**Grade rationale.** The behaviour the dial governs exists, but the dial itself (the journey's actual subject) is missing, so the user cannot dial autonomy per doc - FRAGILE (behaviour present, control absent).

## 1h - Undo, history and versions, the way back · FRAGILE (severity-1: X1; trust: X2)

**What was walked.** After approving an edit, opened History. Immediately after the approve it showed a real entry ("Approved - CURRENT - Board Note / b-3 - model - 12:40:36"). Pressed Cmd+Z in the editor to test undo-across-approve. Reloaded to test persistence. Screenshots `1h-1-history-after-approve.png`, `1h-2-after-undo.png`, `1h-3-history-fabricated-stack.png`.

**Probe results.**
- Cmd+Z across approve: does nothing - after Cmd+Z the approved paragraph still reads "On plan, no surprises. Momentum continues to build." The map's known gap ("today Cmd+Z does nothing after approve") is confirmed. (Caveat: editor focus was placed on the paragraph before the keypress; if a deeper focus nuance exists it would need a desktop pass, but the observed result is no revert.)
- Persistence across reload: **fails (X1)** - the approved edit and the real history entry are both gone after reload; the document reverts on disk.
- History honesty: **fails (X2)** - on fresh load, History shows a fabricated stack (v11-v14) with a "just now - Tom" entry despite no edit, and the header names the wrong file ("WEEKLY SUMMARY.MD" while Board Note is open). This is precisely the "History silently shows FABRICATED versions" trust failure the journey flags, and it violates the "no fake versions" design principle.
- Restore-a-version (frame 3, append-only restore = new version): not exercised because the stack is seed data and restoring a fabricated version would not be a meaningful test; flagged for a real-data pass once X1/X2 are fixed.

**Severity-1 repro (X1, via 1h):** same as the 1e repro above - approve, reload, the version and its history entry are lost.

**Grade rationale.** The highest-leverage journey in the product (the map's own words) is unmet on all three of its promises: undo-across-approve does nothing, versions do not persist, and History shows fabricated data. FRAGILE with a severity-1 lost-work finding and a live trust (fabricated-data) violation.

---

## Environment limits honestly noted (not graded as product failures)

- The native OS folder picker (1a frame 2, "Switch folder…") is not reachable in the web build - a browser cannot invoke the macOS folder dialog. Needs a desktop pass.
- X1 (writes not persisting to disk) may be partly a web-build File System Access limitation rather than a pure product bug; a desktop pass is needed to confirm whether approves and new docs land on disk there. It is recorded as severity-1 because in the environment under test the user's approved work is lost on reload, which is what a user would experience in this build.

## Evidence index (screenshots in shots/)

- `00-home-initial.png`, `1a-1-switch-folder.png` - taken against the broken `?folder=/static/mount` entry (environment gotcha, see environment.md), retained as evidence of the gotcha only.
- `1a-2-home-correct.png`, `1a-3-open-project-lands-editor.png`, `1a-4-messy-folder-T3.png` - 1a golden path, editor landing, T3 messy folder.
- `1b-1-new-doc-dialog.png`, `1b-2-template-draft-generated.png`, `1b-3-empty-blank-doc-untitled.png` - 1b dialog, template draft, blank-doc name lost.
- `1c-1-agents-nav-table.png` - 1c Agents nav table (nav is real).
- `1d-1-file-context-menu.png` - 1d, no context menu on the file list.
- `1e-1-chat-tab-copilot.png`, `1e-2-strategy-agent-run.png`, `1e-3-abstract-chat-rail.png`, `1e-4-chat-response.png`, `1e-5-model-error-proxy-down.png` - 1e core loop, stock-Copilot tab, agent run, error path.
- `1g-1-document-agents.png` - 1g document-agents surface.
- `1h-1-history-after-approve.png`, `1h-2-after-undo.png`, `1h-3-history-fabricated-stack.png` - 1h history/undo/fabricated stack.
- `1x-1-new-template-scaffold.png` - 1x new-template opens a manual scaffold, not the wizard.
</content>
