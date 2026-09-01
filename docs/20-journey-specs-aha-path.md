# 20 - Journey specs: the aha path (groups A + B, 1p, and the D26 onboarding)

This document is the buildable spec for the aha-path journeys - the ones that carry the beta gate ("a stranger brings a real folder and hits the aha without Tom in the room", [18-beta-plan.md](18-beta-plan.md) §1).
It executes task ② of the Journey Map brief ([13-journey-map-ratification.md](13-journey-map-ratification.md) §5) for the priority subset: **group A** (1a, 1b, 1c, 1d, 1w, 1x), **group B** (1e, 1f, 1g, 1h), the **provenance peek** (1p), and the **D26 onboarding flow**.
Non-aha-path journeys get their walk findings only ([plans/34-verify/journey-grades.md](plans/34-verify/journey-grades.md)); their specs follow when their fix loop is scheduled.

Each spec derives strictly from three sources and invents no product behaviour:

- The **job** and **golden path** come from the journey's card in [journey-map-v4.dc.html](journey-map-v4.dc.html).
- The **governing decisions** are cited as **map-D<n>** ([13-journey-map-ratification.md](13-journey-map-ratification.md) §2) and, where relevant, the merge/persistence semantics D7/D8/D22.
- The **findings each spec must cure** are cited by their journey section in the walk ([plans/34-verify/journey-grades.md](plans/34-verify/journey-grades.md)), including the cross-cutting X1/X2/X3/X4 and the fan-out silent-outage finding under 1s.

Where the walk found the surface **MISSING** (1d, 1w, 1x), the spec defines the **smallest walkable v1** consistent with the decisions, marked **[minimal v1]** - not the fullest frame of the card.

Analytics events are named per [15-metrics-and-instrumentation.md](15-metrics-and-instrumentation.md) §3.1; where a journey needs a step the dictionary does not yet name, the spec says so and defers the wiring to plan 36.

> **Update (12 Jul 2026, decision 162):** the beta targets the **Electron desktop build only**;
> the web build is a dev harness. Wherever an acceptance criterion below says "both the web and
> desktop builds" (the X1 persistence contract in §1e/§1h), read it as: **desktop must persist
> and rehydrate fully** (F19 + atomicity verification, issue #121); the web build needs only an
> honest "writes don't persist here" notice, not a fix.

A note on scope held throughout: per [13](13-journey-map-ratification.md) §2 and [16-principles.md](16-principles.md), decisions are the spec where they defer scope.
The version chip, History and Restore are graded and specified against the truthful state confirmed on the fresh build (X2/X3 struck; decisions 133/134 held), not the stale-build fabrications.

---

## 1a - Open a project for the first time

### The job

"I have a folder of real documents - get me working on it in one click." (card 1a)

### Governing decisions

map-D1 (projects nest: single file, flat folder, or folder-of-folders), map-D2 (opening a project lands on Project Home, not the editor), map-D3 (the first screen is a quick-start modal), test T3 (mixed-format folder open: .doc/.docx gracefully interpreted, never skipped).

### The golden path (card frames 1-4)

1. The launch door is a quick-start modal: recent projects plus **Open folder** (map-D3). This is the only cross-project launcher.
2. The native OS picker points at real files on disk; Markdown opens as-is, .doc/.docx are interpreted or converted on open (T3), the three shapes (single file, flat folder, folder-of-folders) all open cleanly (map-D1).
3. Opening lands on **Project Home** (map-D2, spec'd in 1w) - what ran, what is stale, recent files. The editor is one click deeper via a file.
4. All three folder shapes open without ceremony.

### States

- **Empty folder:** opening a folder with no documents lands on the empty-state front door (specified in 1w frame 4), never a dead card. The walk (1a) found the empty project reachable on Home but the card does nothing on click - that dead-end must resolve to the 1w empty front door.
- **Loading:** a large folder shows an honest indexing state, not a frozen blank; scale beyond plan 30's baseline is out of gate scope ([18](18-beta-plan.md) §3) but the state must not read as a hang.
- **Error (unreadable folder / permission denied):** a named error ("Abstract could not read this folder - {reason}"), never a silent no-op.
- **Mixed-format (T3):** .doc/.docx must not be silently skipped. For beta, migration is founder-led ([18](18-beta-plan.md) §3), so the walkable floor is: unsupported files appear in the tree marked "not yet imported" with a plain-words reason, rather than vanishing. Silent omission is the specific finding to cure (walk 1a: CSVs, .txt, .png, .doc, .docx all absent, no SOURCES section).

### Off-path behaviours to resolve

- **Nested subfolders flattened** (walk 1a): the tree must preserve hierarchy, not collapse `subfolder-a/`, `reports/2025/` into one flat REPORTS list.
- **Odd-formatted Markdown loses its title** (walk 1a): `#Heading no space`, leading blank lines, and no-heading files render as "Untitled". The list title must fall back to the filename, never a bare "Untitled" that erases which file it is.
- **Non-Markdown files dropped** (walk 1a): CSVs, .txt, images belong in a SOURCES section, not omitted.
- **Native picker unreachable in web** (walk 1a): this is an environment limit, not a product failure; the desktop build owns the OS picker. The spec targets desktop for the picker path.
- **Restart:** reloading returns to the launcher; acceptable, provided no unsaved work is silently lost (this couples to X1 - see 1e/1h).

### Merge / persistence semantics

None specific to open; the persistence contract lives in 1e/1h (X1).

### Analytics events

`app_opened` (version, first_open?); `project_opened` (doc_count, has_bindings?, is_first?).

### Acceptance criteria

- [ ] The launch door is the quick-start modal (recents + Open folder), per map-D3; the old cross-project Home is not the launch surface.
- [ ] Opening a project lands on Project Home (map-D2), not directly in a document.
- [ ] A nested folder opens with its hierarchy intact (subfolders are not flattened).
- [ ] A Markdown file with an odd or missing heading shows its filename in the tree, never a bare "Untitled".
- [ ] Non-Markdown files (CSV, txt, image) appear in a SOURCES section rather than being dropped.
- [ ] .doc/.docx appear marked "not yet imported" with a plain-words reason; they are never silently skipped.
- [ ] An empty folder lands on the empty-state front door (1w frame 4), not a dead card.
- [ ] An unreadable folder shows a named error, not a silent no-op.
- [ ] `app_opened` and `project_opened` fire with their properties.

---

## 1b - Create a new document: the template on-ramp

### The job

"Start my weekly report the way it should be born - structure, bindings and skills included." (card 1b)

### Governing decisions

map-D4 ("From sources…" is in scope for new-doc, plus the template-creator wizard - the latter is 1x). Muscle-memory principle: name-first birth (design principle, [16](16-principles.md) §2 "Word/Docs muscle memory wins ties").

### The golden path (card frames 1-4)

1. **＋ New** offers three births: **Blank document**, **From template…**, **From sources…** (map-D4).
2. A template = structure + bindings + skills; the picker shows each template with its binding/skill counts.
3. A wizard step attaches the sources the template expects - skippable, never a wall.
4. Name first (Word/Docs muscle memory); bound blocks are already dotted and live; a chat task drafts the first draft through the review engine.

### States

- **Empty:** no templates yet - the picker still offers Blank and From sources; it does not dead-end.
- **Loading:** the first-draft generation streams in the rail (couples to 1e streaming); a model error must name itself, not hang (see 1e error state).
- **Error:** the internal template brief/prompt must not be dumped verbatim into the chat rail (walk 1b: the whole "Template brief: …" text is shown - a plumbing leak, P5). Plain-words progress only.

### Off-path behaviours to resolve

- **Blank-doc name discarded** (walk 1b, severity: broken P0 muscle memory): a blank document created with a typed name became "Untitled". Name-first birth must hold for **all three** births, blank included.
- **"From sources…" missing** (walk 1b): only Blank and Template exist today; the third birth is absent. It must exist for map-D4 conformance; the walkable floor is "pick one or more sources → a doc is drafted from them through the review engine".
- **Doc does not persist** (walk 1b, X1): the created doc never lands on disk. Cured by the X1 persistence fix (1e/1h).
- **Version chip** on a brand-new doc reads honestly ("Saved", no version) per the fresh-build behaviour (X3 struck) - a new doc is not "v14".

### Merge / persistence semantics

The created file is written to disk on birth (X1 fix); a new document is v0/"Saved" until its first snapshot (map-D... n/a; per 1h/decision 134).

### Analytics events

`project_opened` is not this; birth is not yet a named event in [15](15) §3.1. Register a `document_created` (birth kind: blank / template / from-sources) with plan 36 rather than inventing an emitter now. The first-draft generation reuses `proposal_created` / `run_started`.

### Acceptance criteria

- [ ] ＋ New offers all three births: Blank, From template, From sources (map-D4).
- [ ] A typed name is kept for a blank document (name-first holds for blank, not just templates).
- [ ] "From sources…" drafts a document from selected sources through the review engine.
- [ ] The template first-draft streams as plain-words progress; the internal brief/prompt is never shown to the user.
- [ ] A newly created document persists to disk (X1) and survives reload.
- [ ] A brand-new document's chip reads "Saved" (no fabricated version number).
- [ ] `document_created` is registered for emission (plan 36).

---

## 1c - Switch between projects from Home

### The job

"Five projects, one glance - take me to the one that needs me." (card 1c)

### Governing decisions

map-D2/map-D3 (the cross-project Home is the seed of the cloud inbox, deferred to "once cloud", map-D5); the built cross-project Home earns its keep later.

### The golden path (card frames 1-3)

1. Home splits NEEDS YOU (attention queue with counts) from ALL PROJECTS (calm shelf).
2. One click swaps the whole workbench - tree, breadcrumb, rail badges all re-scope to the chosen project.
3. Five labelled destinations always visible (Home, Editor, Templates, Knowledge, Agents); Home is one click away.

### States

- **Empty:** a workspace with one project still renders ALL PROJECTS honestly; a second card that says "Open to see counts" is fine, provided clicking it mounts the project (walk 1c: the second "sample-folder" card did not obviously re-mount - that must resolve to a real mount).
- **Loading / error:** switching projects that fail to mount shows a named error, not a dead view.

### Off-path behaviours to resolve

- The map's "two of five nav destinations are stubs" concern is **stale** (walk 1c): Templates, Agents, Knowledge all render real content. No fix needed; the spec records this so the chip re-baseline is honest.
- Freshness labels on a just-mounted file ("Synced 11 days ago") are slightly suspect (walk 1c); this is a freshness-labelling consistency item shared with 1o/1p, not a 1c break.

### Analytics events

`project_opened` on each switch.

### Acceptance criteria

- [ ] All five nav destinations render real content (no stubs on the aha path).
- [ ] Switching a project re-scopes tree, breadcrumb and rail badges.
- [ ] A second project card mounts on click (no dead card).
- [ ] A project that fails to mount shows a named error.
- [ ] `project_opened` fires on switch.

---

## 1d - Organise files without breaking anything **[minimal v1]**

Walk grade: **MISSING** - the Abstract Workspace file list has no context menu, so none of the file operations, the drag-to-move, or the dependency-warning-on-delete are reachable (walk 1d).

### The job

"Rename, move, tidy - and trust that no binding or audit trail snaps." (card 1d)

### Governing decisions

map-D6 (deleting a doc with dependents: warn + list them; if the user proceeds, orphan gracefully - never block); the lock is rebuildable and travels with the file (doc 08).

### The smallest walkable v1

The full card offers Rename / Move to… / Duplicate / Delete plus the two agentic verbs (Add to chat, Run agent on this) and drag-to-move with a lock-followed-the-file toast.
The minimal v1 for the beta floor is the **provenance-safe destructive path**, because that is the one that can lose work:

1. A right-click context menu on the Abstract Workspace file list exposing at least **Rename**, **Delete**, and **Add to chat** (the 1m entry).
2. **Delete with dependents** implements map-D6 exactly: warn, list the dependent documents, and on proceed orphan gracefully with an Undo toast - never block.
3. **Rename** keeps bindings and audit intact (the lock follows the file); a toast confirms and offers Undo (→ 1h).

Move/Duplicate, drag-to-move, and "Run agent on this" are deferred past the beta floor; their absence must not dead-end (the menu simply does not list them yet).

### States

- **Empty:** an empty list has no menu items beyond "New document" - not a broken empty container (walk 1d: a synthetic contextmenu produced an empty container).
- **Error:** a rename/delete that fails on disk shows a named error and does not partially apply.

### Off-path behaviours to resolve

- **No context menu at all** (walk 1d): the menu must exist on the custom Workspace list, not only on VS Code's hidden explorer.
- **Delete unreachable** (walk 1d): map-D6's warn-and-orphan cannot be exercised because delete is not reachable; the minimal v1 makes it reachable and safe.

### Merge / persistence semantics

Rename/delete must be atomic on the lock (the file and its sidecar move/remove together, or neither does); Undo restores both. This is the "spec the merge" principle ([16](16) §3) applied to file ops.

### Analytics events

None named in [15](15) §3.1 for file ops; defer. Delete-with-dependents proceeding could reuse nothing today - register `document_deleted` (had_dependents?) with plan 36 if the guardrail wants it.

### Acceptance criteria

- [ ] A right-click context menu exists on the Abstract Workspace file list (Rename, Delete, Add to chat at minimum).
- [ ] Deleting a document with dependents warns and lists them, and on proceed orphans gracefully with Undo - never blocks (map-D6).
- [ ] Rename keeps bindings and audit intact; the lock follows the file; a toast offers Undo.
- [ ] Rename/delete are atomic on the lock (file + sidecar together) and reversible.
- [ ] A failed file op shows a named error and never half-applies.

---

## 1w - Project Home: the project's front door **[minimal v1]**

Walk grade: **MISSING** - opening the sample lands directly in the editor; the front-door surface does not exist, and the cross-project "Good morning, Tom" Home is a different (older) surface (walk 1w).

### The job

"Open the project and know in five seconds: what ran, what's stale, what to do next." (card 1w)

### Governing decisions

map-D2 (opening a project lands here, not the editor), map-D14 (time-to-all-clear is promoted in the UX, on Project Home), map-D21 (Project Home carries a whole-project chat composer), map-D24 (ask-the-project is critical v1; the Home chat defaults to whole-project scope). Couples to 1r (the per-project half of the morning inbox).

### The smallest walkable v1

The full card is four frames (while-you-were-away feed, moved-source blast radius, recommendations, empty-editor front door). The minimal v1 is the **landing + orientation floor** that satisfies map-D2 without building the full inbox:

1. Opening a project lands on Project Home, not the editor (map-D2).
2. Frame 1 floor: a **WHILE YOU WERE AWAY** section (agent runs since last open, with needs-you counts), a **RECENT** files row, and the **all-clear** promotion (map-D14) - honest empty state when nothing ran ("Everything is in sync").
3. Frame 1 also carries the **whole-project chat composer** ("Ask this project anything…") defaulting to whole-project scope (map-D21/map-D24). Asking a question answers read-only with file citations (the 2c mode); asking for a change opens a task tab.
4. Frame 4 floor: the **empty-project front door** - opening an empty folder lands here with "New from template / Blank document / …or ask me to create one", curing the 1a empty-folder dead-end.

Frame 2 (moved-source blast radius with "Update the 3") and frame 3 (recommendations) are deferred past the beta floor - they must not appear as dead affordances; they simply are not shown yet.

### States

- **Empty (nothing ran, no staleness):** the honest all-clear ("Everything is in sync"), not a fabricated feed.
- **Empty project (no docs):** the frame-4 front door, curing the 1a dead-end.
- **Loading:** an honest computing state for the while-you-were-away roll-up.
- **Error:** a project whose agent history cannot be read shows a named error in the feed, never a fabricated "0 waiting".

### Off-path behaviours to resolve

- **Lands in the editor, not Project Home** (walk 1w, walk 1a): the core map-D2 miss.
- **No whole-project chat composer** on any front door (walk 1w, walk 2c): map-D21/map-D24's front-door chat does not exist; the only chat is the per-document rail. The minimal v1 puts the composer on Project Home.
- **All-clear has no home** (walk 1r): map-D14's "all clear in ~N min" has nowhere to live until 1w exists.

### Merge / persistence semantics

The while-you-were-away feed is read from the run log / audit (real data only); it must not seed fabricated rows (the X2 lesson applied to the front door).

### Analytics events

`project_opened`; `all_clear_reached` (items cleared, time_to_clear) when the feed is driven to zero; the whole-project chat reuses `proposal_created` (source kind: chat) for change requests.

### Acceptance criteria

- [ ] Opening a project lands on Project Home, not directly in a document (map-D2).
- [ ] Project Home shows a real WHILE YOU WERE AWAY feed (agent runs + needs-you counts) with an honest empty state; no fabricated rows.
- [ ] The all-clear promotion (map-D14) is shown on Project Home.
- [ ] A whole-project chat composer defaults to whole-project scope (map-D21/map-D24); a question answers read-only with citations; a change request opens a task tab.
- [ ] Opening an empty folder lands on the empty-project front door (frame 4), curing the 1a empty-folder dead-end.
- [ ] `all_clear_reached` fires when the feed is cleared to zero.

---

## 1x - Grow a template from examples **[minimal v1]**

Walk grade: **MISSING** - "New Template" opens a blank manual template-authoring scaffold; the from-examples wizard (feed N docs → agent finds commonalities → proposed template) does not exist (walk 1x).

### The job

"Here are six past board notes - learn the pattern, make it the template we use from now on." (card 1x)

### Governing decisions

map-D4 (the template-creator wizard: N example docs → agent finds commonalities → a template that is a skill.md with success examples underneath). map-D20 (no recurring scheduled generation - out of scope, and not a duplicate of this).

### The smallest walkable v1

The full card is four frames (drop examples, commonalities found, propose skill.md, joins the ＋ New picker). The minimal v1 is the **end-to-end wizard on real files**, because the wizard is the entire subject of 1x:

1. Frame 1: a "New template - from examples" entry that accepts 3-10 past documents (.md at the floor; .docx deferred with the T3 migration story).
2. Frame 2: the agent analyses and **names what repeats** - shared structure, recurring figures worth binding, tone - through the review grammar (a change the user can adjust), never a black box.
3. Frame 3: it proposes a **skill.md** (description + rules + tone notes + success examples) as a plain, portable file in the project.
4. Frame 4: saved, it joins the ＋ New picker (1b).

The manual template editor that exists today (walk 1x) is a **different job** (author a skill.md by hand); it is kept as the "Edit an existing template" answer but is not the 1x wizard.

### States

- **Empty (fewer than 3 examples):** the wizard says it needs at least 3, rather than proposing from too little.
- **Loading:** the analysis streams (couples to 1e streaming); a model error names itself (see 1e error state) - and critically must not render as "no commonalities found" (the fan-out silent-outage lesson under 1s applies here too).
- **Error:** an unreadable example file is named and skipped, not silently dropped.

### Off-path behaviours to resolve

- **Wizard absent** (walk 1x): the from-examples flow does not exist; the minimal v1 builds it.
- **Manual editor is not the wizard** (walk 1x): kept, but labelled as editing, not learning.

### Merge / persistence semantics

The proposed skill.md is written as a real file (X1 fix applies); the template joins the picker only once saved to disk.

### Analytics events

`skill_invoked` (the analysis is a skill run); the resulting change reuses `proposal_created`. Template creation could register `template_created` (from: examples / blank) with plan 36.

### Acceptance criteria

- [ ] A "New template - from examples" wizard accepts 3-10 past documents.
- [ ] The agent names the commonalities (structure, recurring figures, tone) through the review grammar before proposing.
- [ ] The wizard proposes a real skill.md (description + rules + tone + success examples) written to the project.
- [ ] A saved template joins the ＋ New picker (1b).
- [ ] Fewer than 3 examples is refused with a plain-words reason; a model outage during analysis names itself and never renders as "no commonalities".
- [ ] The existing manual editor is retained but labelled as editing an existing template, not the wizard.

---

## 1e - Iterate on a document via the chat rail: diff on every turn

### The job

"Talk to the document; see exactly what would change, where it lands, before it lands." (card 1e). THE foundational journey - every other journey composes it.

### Governing decisions

map-D7 (changes stack like unstaged edits in git; approve = the commit; a newer change may supersede a pending one on the same span; no approval needed before re-prompting), map-D8 (editing text inside a pending change folds the edit into it - no rebase, no invalidation), map-D22 (the user can always edit a doc while a chat/run is in flight; keystrokes and pending changes coexist; spec the merge so it never becomes a data-loss bug). Everything routes through review ([16](16) P3).

### The golden path (card frames 1-4)

1. Ask in the rail; a scope chip states what the agent may touch (here, just this doc).
2. The agent narrates its steps while the red/green diff streams into the exact paragraph.
3. The change card sits **in the document**, with change kind, one-line rationale - never a preview pane.
4. Approved → clean text, a gutter dot for the receipt, the chat logs the version; loop again.

The walk confirmed this golden path works end to end with a live model (walk 1e): scope chip, @source mentions, streaming diff-in-place, change card, rail mirror.

### States

- **Empty:** an empty document or empty working set behaves as single-doc chat; no crash.
- **Loading / streaming:** the turn streams with a Stop control (couples to plan 27).
- **Error (model unreachable):** the rail returns the real, named error already observed (walk 1e): "The agent model is not reachable. Start the local proxy…". No silent hang, no "the agent errored", no data loss. **This is the reference standard** the fan-out path (1s) must match. On beta model access, this becomes the map-D15 pause-and-resume message when the OpenRouter cap is hit ([18](18) §2.1) - never a fatal error.
- **Paused (budget cap):** the run pauses safely, finished changes stay reviewable, the composer says so in plain words, and it resumes on rollover ([18](18) §2.1).

### Off-path behaviours to resolve

- **X1 - approved work lost on reload (severity-1):** after approving, the paragraph is applied in the editor and logged in History, but on reload the document reverts, the on-disk file is unchanged, and the History entry is replaced by a seeded stack (walk 1e re-verify: HELD on the fresh build). Every write is in-memory only in the web build. This is the single severity-1 and the first thing the fix loop resolves. A desktop pass is being checked separately to confirm whether writes land on disk there; the fix must make approved work survive a reload in **both** the web and desktop builds under test.
- **X4 - two chat surfaces:** the workbench title-bar "Chat" tab opens stock upstream GitHub Copilot (sign-in gated, developer-tooling), not the Abstract rail (walk 1e). A beta user who clicks the obvious top-level Chat lands in the wrong place. The stock surface must be removed or re-routed so the only Chat a user can reach is the Abstract rail.

### Merge / persistence semantics (the load-bearing spec)

- **map-D7 stacking:** re-prompting before approving is allowed; changes stack; a newer change on the same span supersedes the pending one; approve is the commit.
- **map-D8 fold-in:** if the user edits text inside a pending change, the edit folds into it - no rebase, no invalidation.
- **map-D22 coexistence:** the user may type while a run is in flight; keystrokes and pending changes coexist; edits fold in per map-D8. This merge must be specified and tested so it never becomes a data-loss bug (the decision-68 lesson, [16](16) §3 "spec the merge").
- **Persistence contract (the X1 cure):** approve writes the applied text to the document **on disk**, and records the version in the lock, atomically; a reload re-reads the persisted document and the real History. In-memory-only writes are a bug, not a build limitation, for anything the user approved.

### Analytics events

`proposal_created` (source kind: chat, change kind, confidence label); `proposal_resolved` (resolution: approve/tweak/reject, latency, bulk?); `run_started`/`run_finished` for the turn; `undo_after_approve` if the way-back is used.

### Acceptance criteria

- [ ] The chat rail proposes, streams a diff in place, and lands a card in the document - never a preview pane (golden path).
- [ ] An approved change **survives a page reload** in both the web and desktop builds under test - the on-disk document and the real History both reflect it (cures X1).
- [ ] A model-unreachable state returns a named, plain-words error with no data loss (the reference standard for 1s).
- [ ] Re-prompting before approving stacks changes; a newer change on the same span supersedes the pending one; approve commits (map-D7).
- [ ] Editing inside a pending change folds the edit into it - no invalidation (map-D8).
- [ ] The user can type while a run is in flight; keystrokes and pending changes coexist and merge without data loss (map-D22).
- [ ] The only reachable "Chat" surface is the Abstract rail; the stock Copilot chat is removed or re-routed (cures X4).
- [ ] `proposal_created` and `proposal_resolved` fire with their properties.

---

## 1f - Judge one change: approve · tweak · reject

### The job

"Give me enough to decide in five seconds - and let me edit the proposal, not just veto it." (card 1f)

### Governing decisions

map-D7 (approve = the commit), decision 131 (Tweak = amend-before-approve, verified live on the fresh build), decision 68 (the bullet-sibling data-loss bug, fixed in plan 31). Confidence is a label, never a fake percentage ([16](16) §2 "colour only ever means something"; card note).

### The golden path (card frames 1-3)

1. Card anatomy: change kind, honest confidence label (● pulled directly / ◐ inferred - needs your eyes), old/new, source + freshness, one-line why.
2. **Tweak** = edit the change inline, then apply - not navigation, not a veto; the edit is audited as "approved with edits".
3. **Reject** reverts cleanly; the optional reason becomes context for the next derivation.

The walk (1f re-verify) confirmed Approve works, Tweak is real (decision 131: pencil → in-place editor → Save & Approve / Cancel through the one approve path), and the chip is honest.

### States

- **Empty:** no pending change - the card region is absent, not a stale empty card.
- **Loading:** a change still streaming shows its streaming state before the Approve/Tweak/Reject controls settle.
- **Error:** approving a change whose apply fails must not half-apply (atomicity, [16](16) §3); a named error, the change stays pending.

### Off-path behaviours to resolve

- **X1 persistence** (walk 1f): the approve itself is sound but does not survive reload; cured by the 1e persistence contract.
- **Confidence sub-line is a fixed 85%** (walk 1f re-verify): every generated change showed "85% confidence" as a fixed number in the sub-line. The headline label is honest, but a fixed percentage is exactly the "fake percentage" the card warns against; it must either reflect a real signal or be replaced by the label alone.
- **Reject reason → audit** (walk 1f): the clean-revert + optional-reason-to-audit flow was confirmed present but not fully exercised; the spec requires the reason to land in the audit as next-derivation context.

### Merge / persistence semantics

Tweak folds the human edit into the approved commit (map-D8 shape, applied at approve time); approve is atomic (the whole change applies or none of it). Reject reverts with no residue.

### Analytics events

`proposal_resolved` (resolution: approve/tweak/reject, latency, bulk?) - the tweak+reject rate feeds the guardrail band (5-25%, [15](15) §2.4).

### Acceptance criteria

- [ ] The card shows change kind, an honest confidence **label** (not a fabricated percentage), old/new, source + freshness, and a one-line why.
- [ ] Tweak opens an in-place editor and applies through the one approve path, audited as "approved with edits" (decision 131).
- [ ] Reject reverts cleanly; the optional reason lands in the audit as next-derivation context.
- [ ] Approve/Tweak are atomic - a failed apply never half-applies and leaves the change pending with a named error.
- [ ] Approved (and tweaked) results survive reload (via the 1e persistence contract).
- [ ] `proposal_resolved` fires with resolution and latency, feeding the tweak+reject guardrail.

---

## 1g - Dial the auto-apply policy

### The job

"Decide, per document, what the agent may do without asking me." (card 1g)

### Governing decisions

map-D9 (autonomy is user-dialled: human-in-loop for everything at launch, then modes aligned with frontier-platform norms). The figure/meaning boundary is the product's central mechanic; it is policy the user dials, not a black box ([16](16) P9).

### The golden path (card frames 1-3)

1. One dial in the **doc header**, plain words, three positions: "ask me first - always" / "auto-apply figures only" (default) / "auto-apply everything, log it".
2. Figures flow in marked-and-reversible; mechanical work never queues on a human.
3. Meaning changes always wait - whatever the dial says, unless the gate is explicitly opened.

### States

- **Empty / default:** a document with no dial set defaults to "auto-apply figures only".
- **Error:** a figure auto-apply that fails is logged and reversible, not silently dropped.

### Off-path behaviours to resolve

- **The dial does not exist in the doc header** (walk 1g): the figure-auto / meaning-waits **behaviour** is real and observed (the meaning change waited; the footer states "Figures apply automatically; meaning-changes wait"), but the user-facing **control** to dial it per document is absent. The map-D9 promise ("the human dials autonomy") is unmet until the control ships.
- The Agents-nav policy dial (map-D... the 1q/1t "Auto-apply figures / Ask before applying / Draft only") exists and is the reusable control ([16](16) P2 - do not duplicate); the 1g spec is to surface that same policy per document from the doc header, not build a second dial.

### Merge / persistence semantics

The per-doc policy is stored on the document (in the lock), persists across reload (X1 fix), and travels with the file (couples to 1d rename/move atomicity).

### Analytics events

No dedicated event in [15](15) §3.1; the policy setting affects `proposal_created` (figures auto-applied vs meaning queued) which already carries change kind. Defer a `policy_changed` event to plan 36 if the guardrails want it.

### Acceptance criteria

- [ ] A three-position autonomy dial exists in the doc header, plain words (ask first / figures only / everything + log), map-D9.
- [ ] The dial reuses the existing agent policy control rather than duplicating it (P2).
- [ ] The default is "auto-apply figures only".
- [ ] Meaning changes always wait unless the gate is explicitly opened, regardless of the dial.
- [ ] Auto-applied figures are marked and reversible; each is logged.
- [ ] The per-doc policy persists across reload and travels with the file on rename/move.

---

## 1h - Undo, history and versions: the way back

### The job

"I approved 14 changes and one was wrong - get me back, and show me what this doc said last Tuesday." (card 1h). The highest-leverage journey in the product (card note).

### Governing decisions

Plan 26 (the trust spine: PM undo/redo, snapshot store in the lock, a truthful History tab with restore, a real Saved · vN chip), decisions 133/134 (the static v14/v13 sample deleted; History built from the live document's lock; real snapshot count). Built at the product layer, not deep VS Code undo ([16](16) §3 portability).

### The golden path (card frames 1-4)

1. Cmd+Z works **across approves**, not just keystrokes; the toast names what came back.
2. History: every version says who/what/why - auto-applies and approvals visibly distinct.
3. Click a version → see the doc then (read-only); Restore is a new version - history is append-only, nothing destroyed.
4. The "Saved · vN" chip is the everyday door into history, one click from the toolbar.

The walk (1h re-verify) confirmed frames 2-4 are truthful on the fresh build: honest empty state, real approve rows, a real "Before bulk approve" snapshot with a working Restore, an honest chip ("Saved" → "Saved · v1").

### States

- **Empty:** "No versions yet - changes you approve will appear here" (honest empty state, confirmed on the fresh build) - not the old fabricated v11-v14 stack.
- **Loading:** History reads from the lock; a lock that cannot be read shows a named error, not a fabricated stack.
- **Error:** a Restore that fails does not destroy the current version (append-only invariant).

### Off-path behaviours to resolve

- **X1 - none of it survives a reload (severity-1, HELD):** on the fresh build History is truthful, but after reload the chip resets to "Saved", the snapshot is gone, and the edits are lost (walk 1h re-verify). "The way back" evaporates when the session ends. Cured by the 1e persistence contract - snapshots and the version chip must be read from the persisted lock, not in-memory only.
- **Cmd+Z across approve does nothing** (walk 1h): frame 1's promise is unmet - after Cmd+Z the approved paragraph is unchanged. This is a separate editor-integration gap from persistence and must be fixed so undo crosses an approve, per plan 26 and [16](16) P8 ("undo works everywhere, including across approves").
- **X2 - fabricated History (struck):** resolved on the fresh build (decision 133); recorded so the re-baseline is honest. The fix loop must not regress it.

### Merge / persistence semantics

Snapshots and the Saved · vN chip are read from the persisted lock (X1 cure); Restore appends a new version equal to the restored one (append-only, nothing destroyed, map frame 3); undo/redo is PM history at the product layer, crossing approve boundaries.

### Analytics events

`undo_after_approve` (depth) - a guardrail signal ([15](15) §2.4: a spike marks a trust wound). Restore reuses the version machinery; a `version_restored` could be registered with plan 36.

### Acceptance criteria

- [ ] History shows a truthful timeline from the lock (honest empty state, real approve/snapshot rows) - never fabricated versions (holds decision 133).
- [ ] The Saved · vN chip reflects the real snapshot count (holds decision 134).
- [ ] Snapshots, the chip, and History **survive a reload** (cures X1, via the 1e persistence contract).
- [ ] Cmd+Z reverts across an approve, not just keystrokes, and the toast names what came back (map frame 1, plan 26).
- [ ] Restore creates a new version equal to the restored one; nothing is destroyed (append-only).
- [ ] `undo_after_approve` fires with depth.

---

## 1p - Trace a figure to its source: provenance peek

### The job

"Where is this number from, and how fresh is it? Answer on hover; prove it on click." (card 1p). The wedge in one journey.

### Governing decisions

Plan 29 (Knowledge as the real source library, hover freshness on bound figures, MCP resolution). map-D... n/a; graded against the decided v1 CSV depth (walk 1p). "Then vs now" is cheap because the lock already stores resolved + syncedAt (card note; doc 12 §3.1).

### The golden path (card frames 1-4)

1. Hover any bound figure: source, cell, freshness, how it landed - no click needed.
2. Click → the source drawer opens **on the exact row**, changed cells marked; CSV, API and MCP peeks all reach this depth.
3. "Then vs now": as-approved vs source-now - a published doc can prove what it said, when.
4. The gutter: one dot per receipt; click a dot → that block's audit trail, right there.

The walk (1p) confirmed the click-drawer works to real CSV depth: exact bindings, the applied row, freshness, and the "referenced by 2 documents" reverse list inline.

### States

- **Empty:** a figure with no binding shows no drawer (it is plain text), not an empty drawer.
- **Loading:** a source still syncing shows an honest "syncing" freshness, not a stale value presented as fresh.
- **Error / stale:** a stale or failed-sync source is marked amber (walk 1o/1p freshness labelling); the drawer must not present a stale value as current (guardrail: staleness escapes, [15](15) §2.4).

### Off-path behaviours to resolve

- **Hover peek (frame 1) not separately verified** (walk 1p): the click depth is load-bearing and confirmed; the hover-only peek must also answer source/cell/freshness without a click.
- **API / MCP equal-depth peeks** (walk 1p, card note): the sample only has a CSV source; api falls back to the CSV and mcp does not resolve. Equal-depth peeks per connector is the plan-29 fix; graded against v1 CSV depth it is met, but the beta floor still needs api/mcp to not present a fallback as if it were the real source.
- **"Then vs now" (frame 3) not surfaced** (walk 1p): the lock stores resolved + syncedAt, so it is cheap; the as-approved vs source-now comparison must be shown.
- **Freshness inconsistency across surfaces** (walk 1c/1o/1p): "Synced 4 min ago" in the library vs "Synced 11 days ago" in the drawer for the same file. Freshness must be consistent across every surface that shows it.

### Merge / persistence semantics

None specific; the peek reads the lock (resolved + syncedAt). The onboarding aha (D26) depends on this peek working on the demo CSV.

### Analytics events

`provenance_peeked` (hover vs click-through) - a step in the onboarding funnel ([15](15) §2.1); `source_synced` (kind, ok?, staleness_age) when a "Sync to report" is used.

### Acceptance criteria

- [ ] Hovering a bound figure shows source, cell, freshness and how it landed - no click.
- [ ] Clicking opens the source drawer on the exact row with changed cells marked (CSV depth confirmed; api/mcp reach the same depth or clearly mark a fallback).
- [ ] "Then vs now" shows as-approved vs source-now (map frame 3).
- [ ] Freshness labels are consistent across the library, the drawer, and the figure hover.
- [ ] A stale or failed-sync source is marked amber and never presented as current (staleness-escape guardrail).
- [ ] `provenance_peeked` fires with hover vs click.

---

## D26 - The onboarding flow (the two-wow, ten-minute, no-setup path)

### The job

"In my first ten minutes, with no setup, show me the magic twice." Two wow moments: the provenance peek and a single inline diff. (map-D26)

### Governing decisions

map-D26 (onboarding drives to the provenance peek via a demo CSV: chat generates a report from it, then onboarding prompts one iteration so the user also sees a single inline diff; two wow moments, ten minutes, no setup; instrumented as T5). Gate requirement [18](18) §2.4. Consent-first analytics ([15](15) §3; [18](18) §2.2). The aha metric (T4) is the first approved agent change on the user's **own** file - the onboarding's job is to make that reachable within 10 minutes ([15](15) §2.1).

### The golden path (the T5 funnel, [15](15) §2.1)

1. **Open** → a plain-words consent moment ("Help us improve Abstract - we count actions, never your words"), declinable ([18](18) §2.2).
2. **Demo report generated:** chat generates a report from a bundled **demo CSV** - no folder to open, no setup (this composes 1e's golden path on seeded data).
3. **Provenance peek hovered/clicked:** the user hovers/clicks a bound figure and sees the source drawer (this composes 1p) - wow moment one.
4. **First diff seen:** onboarding prompts **one iteration** ("try tightening this paragraph"); a single inline red/green diff streams into the exact paragraph (this composes 1e frame 2) - wow moment two.
5. **First approve (sample):** the user approves the single change (1f); it applies and logs a version (1h).
6. **First folder opened → first approve (own file):** onboarding hands off to "bring a real folder" (1a); the aha (T4) is the first approved agent change on their **own** file.

### States

- **Empty / no model configured:** the onboarding must reach a working model through the beta model-access doors ([18](18) §2.1; plan 35) - "Sign in with ChatGPT" or the included OpenRouter fallback - so the demo report can generate without the user crediting anything. If neither is reachable, the heuristic no-model fallback (doc 10) keeps the flow demoable rather than dead.
- **Loading:** the demo report and the diff stream (couples to 1e/plan 27); a model error names itself (1e error standard) and, if the cap is hit, pauses gracefully per map-D15 ([18](18) §2.1).
- **Consent declined:** the flow proceeds with capture disabled entirely (not just replay) - onboarding still works, it is simply not measured ([18](18) §2.2).
- **Error:** any step that fails names itself and offers a retry; onboarding never dead-ends silently.

### Off-path behaviours to resolve

- **Nothing orients today** (walk 2b): a fresh/messy folder open flattens structure, drops non-markdown, titles become "Untitled", and there is no "I found N numbers - link them?" moment. D26 does not depend on the messy-folder orientation (it uses a bundled demo CSV), but the hand-off to the user's own folder (step 6) inherits the 1a fixes (hierarchy, titles, sources) - the own-file aha is only reachable if 1a is walkable.
- **The onboarding surface does not exist** (implied by walk 1w/2b): D26 is net-new; it is built on the composed golden paths of 1e/1f/1h/1p, not new review machinery ([16](16) P3).
- **The survey** ([18](18) §2.4): which frontier model is the daily driver, which subscriptions owned, what is made weekly - captured and stored as `model_configured` properties.

### Merge / persistence semantics

The sample approve (step 5) exercises the 1e persistence contract on seeded data; the own-file approve (step 6) exercises it on the user's real file. The demo CSV is bundled and read-only; the generated report and its approve behave like any document (X1 cure applies).

### Analytics events

`onboarding_step` (step name per the §2.1 funnel: open → demo report generated → provenance peek hovered → first diff seen → first approve sample → first folder opened → first approve own file); `provenance_peeked`; `proposal_created` / `proposal_resolved`; `model_configured` (provider + survey answers). Every drop-off step is a design task ([15](15) §2.1).

### Acceptance criteria

- [ ] A plain-words consent moment precedes any event capture; declining disables capture entirely and onboarding still works.
- [ ] A bundled demo CSV generates a report via chat with no folder open and no setup.
- [ ] The user reaches the provenance peek (wow moment one) - `provenance_peeked` fires.
- [ ] Onboarding prompts one iteration producing a single inline diff (wow moment two).
- [ ] The user approves the single sample change; it applies, logs a version, and survives reload (X1 cure).
- [ ] Onboarding reaches a working model through the beta doors (Sign in with ChatGPT / included fallback / heuristic), never dead-ending on model access.
- [ ] A model error or budget cap during onboarding names itself and pauses gracefully (map-D15), never fatal.
- [ ] The onboarding survey (daily-driver model, owned subscriptions, weekly output) is captured to `model_configured`.
- [ ] Onboarding hands off to "bring a real folder" (1a); the own-file aha (T4) is reachable within 10 minutes.
- [ ] Each `onboarding_step` fires so every drop-off is visible (T5).

## Amendments

Entry re-sequenced by plan 42 on 20 Jul 2026: the walkthrough is demoted to an optional Home card, model access is deferred to first AI use, plain markdown is the entry default with living earned at first source bind, and the review rail starts quiet. See [docs/plans/42-light-path-loop.md](plans/42-light-path-loop.md) and the run tracker #196.
