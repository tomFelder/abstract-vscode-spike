# Plan 34 - Journey grades (iteration 1: Groups A and B)

> **RESOLUTION NOTE (re-verify, fresh build 9 Jul 22:57, post plan 26-33 merges).** The iteration-1 walk ran against stale compiled output from 7 Jul, predating the merges. The re-verify below re-tested every stale-suspect finding on the fresh build. Outcome: **X2 (fabricated History stack + wrong-doc header) and X3 (hardcoded "Saved · v14" chip) were stale artefacts - both are gone on the fresh build** (decisions 133/134 held). History now shows a truthful timeline (honest empty state, real approve/snapshot rows, working Restore), and the chip is real (`Saved` at 0 snapshots, `Saved · v1` after a snapshot is taken). Two plan-31 behaviours that were unverifiable at merge time (backend down) now pass live: **Tweak (decision 131)** opens an in-place editor with Save & Approve/Cancel, and **bulk-approve confirm (decision 132)** fires the real-count dialog with the snapshot reassurance. **X1 (approved work lost on reload) HELD on the fresh build** - it is real, not a stale artefact, and remains the single severity-1. Full re-verify evidence is in the "RE-VERIFY (fresh build)" subsections under X1/X2/X3, 1e, 1f and 1h below; screenshots `reverify-1`..`reverify-6`. The original iteration-1 text is preserved verbatim; amended grades are marked inline and struck through in the table.

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
| 1f | Judge one proposal: approve / tweak / reject | ~~FRAGILE~~ → FRAGILE (amended: Tweak now verified live, chip is honest; still FRAGILE for X1 persistence) | 0 |
| 1g | Dial the auto-apply policy | FRAGILE | 0 |
| 1h | Undo, history and versions - the way back | ~~FRAGILE (sev-1: X1, trust: X2)~~ → FRAGILE (amended: X2 fabrication gone, History is truthful; still FRAGILE for X1 persistence) | 1 |

Severity-1 count: 2 (both are the same root cause - approved changes are not persisted, so they vanish on reload; recorded once under 1e and once under 1h because both journeys own a face of it). **Re-verify amendment: X1 held on the fresh build (still 2 sev-1 faces of one root cause); X2 and X3 were stale artefacts and are struck from the trust findings - the fresh build's History and version chip are truthful.**

## Cross-cutting findings (affect several journeys)

These recur across journeys and are called out once here, then referenced by id below.

**X1 - Approved changes do not persist across a reload (severity-1, lost work).** After approving a chat proposal on Board Note, the tightened paragraph is applied in the editor and logged in History with a real timestamp, but on page reload the document reverts to the original text, the on-disk `Board Note.md` is unchanged, and the real History entry is replaced by a seeded stack. New documents created via the New-document dialog (1b) also never appear on disk. This is lost work, not destroyed source data (the original file is intact), so it is severity-1 "lost approved work" rather than destructive corruption. It may be partly a web-build File System Access limitation - a desktop pass is needed to confirm whether writes land on disk there - but in the web build under test, every write is in-memory only. Repro under 1e/1h below.

**X1 - RE-VERIFY (fresh build): HELD, still severity-1.** On the fresh 9 Jul build I re-ran the full loop on Board Note: sent "Tighten the Note to the board paragraph…", a live model call produced the proposal, approved it (paragraph became "On plan, no surprises."), History showed a real "Approved · Board Note / b-3 · model · moments ago" row. Then reloaded and reopened Board Note: the paragraph reverted to "Momentum is steady; we continue to track plan with no surprises this week.", History reverted to "No versions yet", and `living-docs-sample/Board Note.md` on disk was still the original text (checked directly - unchanged). I also drove a bulk approve of two meaning changes: the chip advanced to "Saved · v1" and a "Before bulk approve" snapshot with a working Restore appeared in History - but after reload the chip was back to "Saved", the snapshot gone, and both edits lost. Every write (approve, bulk-approve snapshot, manual save) is in-memory only in the web build. This is unchanged by the merges and is the loop's single severity-1. Screenshots `reverify-2-history-real-entry.png`, `reverify-3-reload-reverted-x1.png`, `reverify-6-history-snapshot-restore.png`.

**X2 - History shows fabricated versions with a mislabelled header (trust / P0).** On a fresh load, the History tab for Board Note shows a canned stack: v14 "Approved commentary rewrite - just now - Tom", v13 "Auto-refresh… - 2m ago", v12 "Edited What to watch - yesterday", v11 SNAPSHOT "Jun 12". The "just now" timestamp appears with no edit having been made this session, and the header reads "VERSION HISTORY - WEEKLY SUMMARY.MD" while the open document is Board Note. Design principle §2 "Real data only - no fabricated counts, no fake versions" and journey 1h's own note ("History silently shows FABRICATED versions") are violated live. Screenshot `1h-3-history-fabricated-stack.png`.

**X2 - RE-VERIFY (fresh build): STALE ARTEFACT, resolved.** On the fresh build the fabrication is gone. On a fresh load of Board Note, the History tab reads header "VERSION HISTORY · BOARD NOTE" (correct doc name, not "WEEKLY SUMMARY.MD") and body "No versions yet - changes you approve will appear here." - no v11-v14 stack, no "just now · Tom" phantom entry. After a real approve the timeline shows only real rows ("Current version / CURRENT", "Approved · Board Note / b-3 · model · moments ago", and after a bulk approve a real "Before bulk approve" SNAPSHOT row with Restore). This matches decision 133 (the static v14/v13 sample is deleted; History is built from the live document's lock). X2 is struck as a stale-build artefact. Screenshots `reverify-1-history-empty-honest.png`, `reverify-2-history-real-entry.png`, `reverify-6-history-snapshot-restore.png`.

**X3 - The "Saved - vN" version chip is hardcoded to v14 everywhere.** Every document - Board Note, a brand-new template-generated doc (1b), a brand-new blank doc in an empty folder, a plain messy-folder .md - shows "Saved - v14" in the editor header. A new document should be v1; an approved edit should bump the number. The chip is a fixed string, not real state. This is the same fabrication class as X2, on the editor surface.

**X3 - RE-VERIFY (fresh build): STALE ARTEFACT, resolved.** On the fresh build the chip is honest. Board Note with no saved versions shows just "Saved" (no version number). After I drove a bulk approve that took a snapshot, the same chip advanced to "Saved · v1" - a real count from the lock, not a fixed string. This matches decision 134 (real snapshot count, no fabricated "v14"). The number is ephemeral only because of X1 (it resets to "Saved" after reload, since the snapshot is in-memory), but the chip itself is truthful, not hardcoded. X3 is struck as a stale-build artefact. Screenshots `reverify-3-reload-reverted-x1.png` (chip "Saved"), `reverify-6-history-snapshot-restore.png` (chip "Saved · v1").

**Tweak / decision 131 - RE-VERIFY (fresh build): WALKABLE.** Plan 31's Tweak was untestable at merge (backend down). On the fresh build with the proxy up: on a pending Asks proposal I clicked the card's pencil "Edit"; the proposed text became an in-place editable region (contenteditable, focused) and the Approve/Reject buttons were replaced by "Save & Approve" / "Cancel" - exactly the D31-A shape, editing the proposed text (not the read-only doc). Clicking "Save & Approve" applied the text through the one approve path and cleared the card. (I could not inject amended keystrokes into the deep cross-frame contenteditable via script, so the audit `via: 'tweaked'` marker was not directly observed, but the interaction shape and the amend-then-approve completion are confirmed.) Screenshot `reverify-4-tweak-applied.png`.

**Bulk-approve confirm / decision 132 - RE-VERIFY (fresh build): WALKABLE.** Also untestable at merge. On the fresh build I generated two meaning changes in one doc and clicked "Approve all in this doc": a modal fired reading "Approve 2 changes including 2 meaning changes? A version snapshot is taken first, so you can restore." - real counts, snapshot reassurance, through the platform dialog. Approving then created the promised "Before bulk approve" snapshot in History with a working Restore. Figures-only sets are not gated (the confirm is meaning-change-conditioned by design). Screenshots `reverify-5-bulk-approve-confirm.png`, `reverify-6-history-snapshot-restore.png`.

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

**1f - RE-VERIFY (fresh build).** Two of the three unverified points are now cleared. Tweak is real (decision 131, see the Tweak re-verify under X3): the card's Edit opens an in-place editor with Save & Approve / Cancel and the amend routes through the one approve path. The version chip is NOT fake on the fresh build (X3 struck): it reads "Saved" at 0 snapshots and "Saved · v1" after one. The card confidence sub-line ("85% confidence") is still a fixed 85% on every proposal I generated (noted, not graded as sev-1). Grade stays FRAGILE, now solely because of X1 persistence loss - the approve itself and its Tweak variant are sound.

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

**1h - RE-VERIFY (fresh build).** The trust violation (fabricated History) is gone - X2 struck. On the fresh build History is truthful end to end: honest empty state, real approve rows, a real "Before bulk approve" SNAPSHOT with a working Restore, and a live "Current version / CURRENT" head (decision 133). The version chip is honest (X3 struck, decision 134). Two of the three promises this journey owns are now met on the surface: versions record truthfully, and Restore is present and wired. What still fails: (1) X1 - none of it survives a reload, so "the way back" evaporates when the session ends (severity-1, held); (2) undo-across-approve (Cmd+Z) was not re-tested this pass but is a separate editor-integration gap, not a fabrication. Grade stays FRAGILE, but the reason has shifted from "fabricated data + no persistence" to "truthful data that does not persist". This is a meaningfully better failure than iteration 1 recorded.

---

## Environment limits honestly noted (not graded as product failures)

- The native OS folder picker (1a frame 2, "Switch folder…") is not reachable in the web build - a browser cannot invoke the macOS folder dialog. Needs a desktop pass.
- X1 (writes not persisting to disk) may be partly a web-build File System Access limitation rather than a pure product bug; a desktop pass is needed to confirm whether approves and new docs land on disk there. It is recorded as severity-1 because in the environment under test the user's approved work is lost on reload, which is what a user would experience in this build.

# Iteration 2 - Groups C, D, E, F + candidates (fresh build)

Walked on the fresh 9 Jul 22:57 build with the model proxy up. Same rubric. Where a decision defers scope (D16 table-not-graph, D18 light audit, D20 no scheduled generation), the journey is graded against the **decided v1 scope** (doc 13 §2), not the map's fullest frame. X1 (approved work lost on reload) is a cross-cutting severity-1 that recurs wherever a journey writes; it is noted per journey but counted once (it is the same root cause re-verified in Part 1).

## Iteration-2 summary table

| Journey | Title | Grade | Sev-1 |
|---|---|---|---|
| 1i | One chat, three docs - review at any granularity | WALKABLE | 0 (X1 applies) |
| 1j | Project-wide run - the fan-out swarm | WALKABLE | 0 (X1 applies) |
| 1k | The cross-document review pass | WALKABLE | 0 (X1 applies) |
| 1l | Parallel chats - tabs in the rail | MISSING | 0 |
| 1m | Pull files & folders into the chat | WALKABLE | 0 |
| 1n | Inspect the context - what does it see? | PARTIAL/MISSING (Context tab exists, no pre-flight/trim) | 0 |
| 1o | Knowledge - the library of sources of truth | FRAGILE | 0 |
| 1p | Trace a figure to its source - provenance peek | WALKABLE | 0 |
| 1y | The document's sources rail - always-on inputs | MISSING (sources shown, no doc-scoped rail with verbs) | 0 |
| 1q | Put a document on a schedule | FRAGILE | 0 |
| 1r | The morning inbox - 90 seconds to done | PARTIAL | 0 |
| 1s | Watch, cancel, recover | FRAGILE | 0 |
| 1t | Manage a project's agents & workflows | WALKABLE | 0 |
| 1z | Usage, cost & the starved run | MISSING | 0 |
| 1u | Present, export, publish | FRAGILE | 0 |
| 1v | Interrogate the audit trail | MISSING | 0 |

Candidates probed: **2c (ask-the-project, D24 critical v1)** - the read-only "answer with citations, no proposals" mode is not a distinct surface; the chat rail always drives toward proposals (see 1v/2c note). **2b (first-run orientation)** - nothing orients on a fresh/messy folder open (see 2b note); this was confirmed in iteration 1's messy-folder probe (flattened, non-md dropped, no "I found N numbers - link them?").

## Group C - Across documents (1i-1l)

### 1i - One chat, three documents changed, review at any granularity · WALKABLE

**What was walked.** On Board Note's chat rail the "Edit across:" / "+ Add documents" control opens a menu ("Add all documents in the folder" + each doc). I built a three-doc working set (Board Note current + Weekly Operating Summary + Team Notes; the chips show "Editing: ▤ Weekly Operating Summary × ▤ Team Notes ×" with a "+ Add"). Sent one instruction ("Add a one-sentence Momentum note to each… keep it consistent"). A live model call produced a **per-file ledger** in the rail: "2 changes across 2 documents", with per-doc rows "▤ Weekly Operating Summary +1 -0 →" and "▤ Team Notes +1 -0 →", plus the three bulk verbs "Accept all / Reject all / Review each". Each change also rendered as an in-doc card with Insert/Reject (per-diff granularity). Clicking a per-doc row navigated into that document with its change shown in context, "1 change here", "Next document →" wayfinding, and "Approve everywhere". Approving one doc drained the ledger to "1 change waiting on you" and the Review tab count from "Review 2" to "Review 1". Screenshots `1i-1-multidoc-ledger.png`, `1k-1-perdoc-approve-drained.png`.

**Probe results.**
- Golden path (one instruction, three docs, three granularities): works end to end - this diff / this file / everything are all present, exactly the Cursor-for-prose grammar the map describes. Genuinely strong; far past the PARTIAL chip.
- Honest scoping: the model applied to 2 of the 3 (the current doc Board Note was not given a change) and **said so in plain language** ("the user said 'all three' but only two documents are in the working set") - honest degradation, not silent drop.
- Empty working set / invalid: not separately broken - a single-doc scope simply behaves as 1e.
- Persistence: approved cross-doc edits are subject to X1 (lost on reload), same as 1e.

**Grade rationale.** Every granularity works with a live model, the ledger drains truthfully, wayfinding is real. WALKABLE (X1 is the shared persistence caveat, not a 1i-specific break).

### 1j - Project-wide run, the fan-out swarm · WALKABLE

**What was walked.** Agents nav → "✦ Run Across the Project". A dedicated agent-run screen streamed live: header "✦ Agent run · Live", a source-cited instruction ("Extract the decisions from the 3 March security review…"), "1 DECISION UNDERSTOOD" with "transcript · line 14" provenance, "Orchestrating 7 sub-agents reading every document in parallel · 0/7 done", and the **swarm grid** - one tile per document (7 tiles) each moving through "reviewing…". A "Stop run" button was present throughout. On completion: "7 sub-agents finished · 7/7 done", each tile resolved to "no change" (·) or "✓ 1 change", and a summary "1 changes proposed in 1 documents · 0 working · 6 unchanged" with "Review Across the Project →" handing off to 1k. Screenshots `1j-1-swarm-live.png`, `1j-2-swarm-complete.png`.

**Probe results.**
- Golden path (whole-project fan-out with real per-doc states and source grounding): works, live-verified, matches the plan-23 demo screen and decision 83 (real source line). The "no change" tiles build trust as designed.
- Cancel mid-run: a "Stop run" control is present live (the safety half, 1s); the sample run finished too fast to catch a mid-flight cancel state this pass - flagged, the affordance exists.
- Scale: the sample is 7 docs; the map's own note warns 50 docs is serial/unbounded today - not reachable in this folder, not graded here.
- Persistence: proposals from the run are subject to X1 on reload.

**Grade rationale.** The wedge demo works end to end with a live model, honest per-doc states, real provenance, and a cancel affordance. WALKABLE.

### 1k - The cross-document review pass · WALKABLE

**What was walked.** The 1j "Review Across the Project →" handoff lands in a dedicated review screen ("Review project update"): a left doc checklist with counts ("Team Notes 1", "0 of 1 reviewed"), a global progress header ("1 reviewed") with an honest bulk door ("Accept All Remaining (1)"), "DOCUMENT 1 OF 1" wayfinding, and per-change cards in the document's own context using the **same card grammar as 1f** (MEANING CHANGE, ● High confidence, "decision · line 14" provenance, Open in document ↗ / Edit / Accept / Reject). "Accept All Remaining" fired the decision-132 bulk confirm ("Approve 1 change including 1 meaning change? A version snapshot is taken first…"); approving reached a clean done state ("✓ All changes reviewed - Every proposed change across 1 document has been actioned"). Screenshots `1k-2-crossdoc-review-pass.png`.

**Probe results.**
- Golden path (order by document, per-diff/per-file/bulk, momentum footer, done→clear): works, matches D10 (order by document) and the 1k frames. The per-card Edit is the decision-131 Tweak affordance inside the cross-doc card, with "Open in document ↗" as the secondary link - exactly as decided.
- Inferred/low-confidence gating (1k frame 3): this run produced only High-confidence changes ("All changes look confident"), so the ◐ "needs your eyes" gate was not exercised; the confident-path bulk accept is present and honest.
- Persistence: X1 applies to the approved results.

**Grade rationale.** A real, complete cross-doc review surface with one review grammar everywhere. WALKABLE.

### 1l - Parallel chats, tabs in the rail · MISSING

**What was walked.** The chat rail holds a single continuous thread. There is no tab strip, no "+" to start a second thread, no per-task tabs. The Chat/Review/History sub-buttons are surface toggles, not chat tabs; the working set persists within the one thread. While a run is in flight (the streaming state has a "■ Stop"), the composer is not blocked, but there is no way to open a *second* thread to work a parallel task. Screenshot `1l-1-single-thread-no-tabs.png`.

**Probe results.**
- Golden path (open a second tab, keep the first running, each with its own working set): the tabs surface does not exist. Frames 1-4 of 1l (tab strip, per-tab spinner, done-badge, chronological collision handling) are all absent.
- The composer does stay usable during a run (a partial answer to the "blocked composer kills the calm promise" concern), but that is single-thread behaviour, not parallel tabs.

**Grade rationale.** The journey's surface (rail tabs) is not built. MISSING (matches the GAP chip).

## Group D - Context & trust (1m-1p, 1y)

### 1m - Pull files & folders into the chat · WALKABLE

**What was walked.** The chat composer offers @-mention attach buttons (@market-research.md, @metrics.csv, @Team Notes.md, @Weekly Summary.md), a "+ Add documents" / "+ Add" menu ("Add all documents in the folder" + each doc), and a "@ Mention" button. Selected docs land as removable chips above the composer ("Editing: ▤ Weekly Operating Summary × …") - the working set is the single source of truth for what the chat may touch. The menu dedupes already-added docs.

**Probe results.**
- Golden path (@-mention + chips + add-folder): works - two of the three routes (type-@ mention, add-menu) are real and were exercised in 1i. The chips are removable and scope the run.
- Right-click "Add to chat" (frame 1, the third route): the explorer verb surface is absent (confirmed under 1d) - so drag-from-tree and right-click Add are the missing routes.
- Folder cost preview ("12 files · ~9k words"): the add-folder menu offers "Add all documents in the folder" but I did not see the up-front files/words cost the map shows - a polish gap, not a break.

**Grade rationale.** Two routes land the working set reliably and it governs scope; the right-click/drag routes are missing but @-mention fully substitutes. WALKABLE.

### 1n - Inspect the context, what does it see? · PARTIAL (leaning MISSING for the pre-flight/trim frames)

**What was walked.** The "◉ Context" button in the Workspace toolbar opens a doc-scoped panel (see 1y - this is really the 1y sources rail). Per D12, 1n's Context tab is the *per-task* "what the agent sees now, each togglable, each sized" inspector living with the chat tab. That per-task inspector does not exist: there is no list of every input (instructions, knowledge, working set, this doc) with on/off toggles and word-sizes, no "HEAVY CONTEXT · the agent may skim" honest-budgeting warning, and no pre-flight recap card ("before this run the agent will read: 24 documents ◇ 3 sources"). The working-set chips are the closest surface but they only list attached docs, not the full context with sizes or a prune control.

**Probe results.**
- Golden path (see exactly what it looks at, prune it): the togglable/sized Context tab is not built. Frames 1-3 (togglable inputs, heavy-context warning, pre-flight recap) are absent.
- What exists is the doc's sources panel (1y), which is a different D12 home.

**Grade rationale.** The per-task context inspector - the actual subject of 1n - is not built; PARTIAL only because the doc's sources panel shows *some* of what feeds the doc. The trust promise ("no hidden context, ever; prune before it acts") is unmet.

### 1o - Knowledge, the library of sources of truth · FRAGILE

**What was walked.** The Knowledge nav is a real library table: "2 SOURCES" with SOURCE / KIND / LAST SYNCED / FRESHNESS / USED BY columns (metrics.csv FILE, Synced 4 min ago, Fresh, 2 docs; market-research.md likewise), Project / Organization tabs, and "+ Add source". Selecting a source shows a real per-source detail: "USED BY 2 DOCUMENTS" listing Board Note and Weekly Operating Summary with their exact bound keys (metrics.mrr, metrics.churn, …) and "Open document ↗" / "Detach" per doc - the reverse-dependency answer (frame 3). The Organization tab is an honest "Organization knowledge SOON" stub (D13 org library, in-scope-as-architecture per conflict C3, not a beta gate). "+ Add source" opens a dialog to bind a folder data file or paste an API endpoint URL to a chosen document. Screenshots `1o-1-knowledge-add-source.png`, and the in-doc source drawer `1p-1-source-drawer-provenance.png`.

**Probe results.**
- Golden path (see every source with kind/freshness/health; per-source reverse lookup): works - the library, freshness labels, and "which docs depend on this" are all real.
- Connect flow (frame 2: pick kind → auth → test fetch shows a real value): partial - you can bind a file or paste an API URL, but there is no connector catalogue (Sheets/CRM/Stripe/MCP), no auth step, and no "test fetch shows a real value before it binds". API/MCP depth is not reachable.
- Conflicts (frame 4: SOURCES DISAGREE → proposal with both provenances): not present - no conflict surface exists.
- Freshness honesty: labels like "Synced 4 min ago / Fresh" are plausible; the in-doc drawer separately showed "Synced 11 days ago" for the same file (a freshness-labelling inconsistency across surfaces - noted, minor).

**Grade rationale.** The library, freshness and reverse-lookup are genuinely built (far past the GAP chip), but the connect-a-live-source flow is file/URL-only with no auth/test-fetch, and conflict resolution is absent. FRAGILE (the core reads well; the "connect anything" half and conflict half are missing).

### 1p - Trace a figure to its source, provenance peek · WALKABLE

**What was walked.** Clicking a bound figure ($48.6k MRR) in the editor opens a full in-document **source drawer**: "⊞ metrics.csv · source · 12 rows" with a "⟳ Sync to report" action, the complete CSV (weeks 13-24) with the applied latest row (week 24: 48600/427/2.4/205), a "BOUND FIGURES · 6" table mapping each key to its resolved value (metrics.mrr → $48.6k, metrics.mrr.prev → $41.2k, …), a "REFERENCED BY · 2 DOCUMENTS" reverse list (Board Note, Weekly Operating Summary), and a freshness stamp ("metrics.csv · mrr · Synced 11 days ago"). Screenshot `1p-1-source-drawer-provenance.png`.

**Probe results.**
- Golden path (click a figure → source drawer on the exact row, changed cells, freshness, how it landed): works to CSV depth - the exact bindings, the applied row, and freshness are all shown. This is the wedge in one journey and it is real.
- Hover peek (frame 1: source/cell/freshness on hover, no click): the click-drawer is confirmed; a hover-only peek was not separately verified this pass (the click depth is the load-bearing one).
- API / MCP peeks at equal depth (the map's own gap): the sample only has a CSV source; api/mcp equal-depth peeks are not reachable in this folder. Graded against the decided v1 CSV depth, this is met.
- "Then vs now" point-in-time (frame 3): not separately surfaced in the drawer I opened; the lock stores resolved+syncedAt so it is cheap, but the "as approved vs source now" comparison was not visible.

**Grade rationale.** The click-to-source-drawer provenance peek works at real CSV depth with the reverse lookup inline. WALKABLE for the v1 (CSV) scope.

### 1y - The document's sources rail, always-on inputs · MISSING (a partial sources panel exists)

**What was walked.** The "◉ Context" toolbar button opens a doc-scoped panel: "LINKED SOURCES · 1" (metrics.csv, "live · feeds 1 block", × remove, + Add source) and "REFERENCED FILES · 1" (market-research.md, "current", × remove, + Add context). This is the D12 "doc's left rail lists its linked sources" idea, and it carries binding counts, freshness words, and per-source verbs. Screenshot `1y-1-sources-context-rail.png`.

**Probe results.**
- Golden path (linked data sources AND watched documents, each with binding count/freshness/health, one-click refresh): partially present - linked sources and referenced files are shown with freshness and a binding count ("feeds 1 block"), and remove/add verbs exist. But **watched documents with change-hooks** (frame 1/3, e.g. "▤ strategy.md · watched · hook: 'launch date'" that fires a proposal) are absent - the rail is sources+references only, no watched-doc-with-hook concept. There is no "View bindings · N → light up the bindings in the text" verb, and no "Refresh now" on a stale source in this panel.
- The contrast with per-task context (frame 4) holds in the product: this doc panel is separate from the chat working set, matching D12.

**Grade rationale.** A doc-scoped sources panel exists and is useful, but the defining 1y feature - watched documents with change-hooks proposing knock-on edits through the review grammar - is not built, and the binding-lightup verb is absent. Graded MISSING for the journey's actual subject (watched-doc hooks), with the honest note that the linked-sources half is real. (Softer than MISSING on the sources half; recorded MISSING because the change-hook mechanism, the reason 1y is its own journey, does not exist.)

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
