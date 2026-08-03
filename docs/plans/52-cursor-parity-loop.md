# Plan 52 - The core loop feels like Cursor

**Status:** authored 3 Aug 2026; run after plan 51 (a working model door is this wave's test harness). **Decisions:** 177 (inline diffs), 178 (workspace chat tabs), 179 (wikilinks), 180 (files rail). **Protocol:** decision 174. **Run prompt:** §7 below.

## 1. What this wave is

The founder's verdict on the 3 Aug triage: the mechanics of the core loop exist, but the loop doesn't feel lightweight, fast, or trustworthy enough to use daily - "it should be just like Cursor". This wave rebuilds the feel of chat → proposal → approval, and lands the small editor-grammar pieces (wikilinks, find, preview tabs) that make the surface behave like a modern document tool instead of a demo. Journey-completeness-over-feature-count (doc 16) governs: a package is done when its journey re-walks clean and *fast* on desktop.

## 2. Work packages

| WP | What | Owner lane |
|---|---|---|
| **A - Inline diffs in the document** (the centrepiece) | Pending proposals render inside the ProseMirror editor as Cursor-style diff blocks - removed text struck in red, added text in green, in place - with per-change accept/reject controls on the block and an accept-all / reject-all bar when more than one is pending. The chat cards demote to compact pointers that scroll to their change. The service mechanics (`approve()`, `reject()`, audit trail, bulk-approve confirm for meaning changes, reject reasons) are reused unchanged - this is a render-layer rebuild, not a review-engine rewrite. Keyboard: accept/reject the focused change and accept-all get chords; the implementer picks them against VS Code collisions and records the choice on the PR. Acceptance: propose → the exact change is visible in place → accept lands with no perceptible delay → doc, lock and History agree; reject removes cleanly; both survive relaunch. | editor webview |
| **B - Workspace chat tabs** | Chat detaches from the document: chats belong to the workspace, shown as a tab strip in the chat rail; **Cmd+T opens a new chat** (chat/rail focus; the global Cmd+T stops opening file search on Abstract surfaces); documents join a chat via the existing @-mention/attach chips. Persistence per workspace; the old per-doc thread history stays readable as "chats mentioning this doc". Empty and many-tab states designed calm (cap visible tabs, overflow menu). | chat rail |
| **C - [[Wikilinks]]** | Typing `[[` in the editor opens the filtered doc picker (reuse the mention picker's ranking); accepting inserts `[[Doc Name]]`, stored exactly so in the Markdown (Obsidian-compatible), rendered as a navigable link chip; click opens the doc; a link to a non-existent doc renders visibly unresolved and clicking it creates the doc (Obsidian behaviour). Serialisation round-trips; exports resolve wikilinks to plain readable text/links, never leaking chip markup. Coexists with `bind:` values and `{{slot}}` tokens untouched. | editor webview |
| **D - Files rail = a pure tree** | The Reports section dissolves - the Files tab becomes a plain file explorer of the real folder hierarchy. Recents leaves the tree (its own compact strip or tab - implementer picks against the pixels, records on the PR, cap 5). Sources moves into the Context tab. The tree reclaims the freed width. Dotfiles stay hidden (decision 180). | tree rail |
| **E - Find & replace in the editor** | Cmd+F with editor focus opens a find widget on the ProseMirror surface: live match count, next/previous, replace, replace-all; Esc closes and returns focus. Project-wide search stays where it is (Files-tab filter). | editor webview |
| **F - Tabs behave like VS Code's** | Single-click in the tree opens a **preview tab** (italic title, reused by the next preview open); editing the doc or double-clicking pins it. Right-clicking a tab shows the document context menu (the tree's menu - Open to the Right, Rename, Duplicate, Move, Bind Sources, View History, Present, Delete - plus Close / Close Others). `abstractTabStrip.ts` currently handles only click/middle-click. | tree rail |
| **G - Small truths** | (1) Live-repro the founder's "outline doesn't load" on desktop - fix it or record the non-repro with evidence. (2) The History tab states what it records ("model-driven changes and snapshots - your own typing isn't logged") and the wave records a decision on whether manual-edit snapshots join it. (3) An approval-latency pass: measure and remove any perceptible lag between accept and the document settling. | tree rail |

## 3. Sequencing and lanes

Up to 3 concurrent lanes (≤3 desktop instances): **Lane 1 - editor webview** (PM bundle + editor render): **A → C → E**. **Lane 2 - chat rail** (`reviewRailView.ts`): **B**. **Lane 3 - tree + tabs** (`treeRailView.ts`, `treeRail.ts`, `abstractTabStrip.ts`): **D → F → G**. File ownership is law (plan 43 discipline); `livingDocsService.ts` changes route through the orchestrator as additive methods. Core-patch budget: **0** - the tab strip, rails and editor are fork-owned; escalate on the umbrella if that proves wrong. If budget runs short, priority: **A > B > C > D > E > F > G**.

## 4. Acceptance floor (each WP's PR carries its rows)

- [ ] A: the walk "ask for a change in chat → see the exact diff in the document → accept it" completes with every keystroke visible in a screen recording or screenshot sequence; accept feels instant; reject + relaunch persistence proven; bulk meaning-change confirm still fires; audit rows unchanged in shape.
- [ ] B: Cmd+T opens a fresh chat without losing the previous one; two chats hold different attach sets concurrently; relaunch restores tabs; old per-doc history reachable.
- [ ] C: `[[` picker inserts a working link; the raw file on disk carries `[[Doc Name]]`; unresolved link creates on click; md/docx/html exports read cleanly.
- [ ] D: the rail shows exactly the folder's hierarchy; Recents and Sources live in their new homes; no Reports vocabulary anywhere; nothing regresses in the doc context menu.
- [ ] E: find hits across the whole doc with live count; replace-all round-trips to disk correctly.
- [ ] F: preview→pin behaviour matches VS Code's (italic, reuse, pin on edit/double-click); tab right-click menu actions all work on the tab's doc.
- [ ] G: outline verdict with evidence; History labelled honestly; latency numbers before/after on the PR.

## 5. Verification traps

All of plan 50 §4 (TMPDIR, node 24, `npm run compile`, launch skill, webview CDP targets `tab-list`→`tab-select`, ProseMirror needs real-DOM event dispatch inside `#active-frame`, native confirms via osascript, ≤3 instances). Wave-specific: the PM bundle rebuild recipe is `docs/lwd-pm-bundle-build.md` if the diff/find/wikilink plugins need it; screenshots of in-editor states must be taken from the webview target, not the outer page; model-backed walks use the OpenRouter door (plan 51 landed it) - never the founder's OAuth bundle.

## 6. Budgets and stop conditions

Iteration budget **30** (dispatch → validate → adjudicate; fix rounds count). Stop when every WP is ticked-or-parked or budget spent. Parking is honest: unticked boxes stay unticked with notes on the umbrella.

## 7. RUN (paste into a fresh session)

Execute **plan 52** (`docs/plans/52-cursor-parity-loop.md`) until its work packages are ticked or honestly parked, as one continuous unattended run. You are the Fable orchestrator: plan, dispatch, adjudicate, never implement. Implementers and adversarial validators are separate Opus sub-agents (`model: "opus"`); a validator never sees its implementer's conversation.

Step 0: confirm plan 51's wave concluded (a working model door is the test harness; if it parked at founder-smoke-pending, the OpenRouter door must at least round-trip); create the wave umbrella issue (title "Core loop: Cursor parity (plan 52)", body = §2 table + §4 floor) and per-WP issues A-G, each carrying its acceptance rows; read plan 50 §4. Then run the lanes of §3: per WP, open a draft PR with its checklist → Opus implementer (worktree) builds and pushes with before/after screenshots embedded → an independent Opus adversarial validator rebuilds, launches the desktop app, and re-walks the WP's journeys - golden path plus off-path probes (relaunch + `cat` the file on disk, empty state, broker-down, cancel/Esc, twice-in-a-row, rapid tab switching) - and is the ONLY party that ticks boxes, with screenshots or recordings as evidence. Implementer and validator argue on the PR itself. Max 3 fix rounds then park. Squash-merge on PASS; every live lane rebases after any merge; run the touched test suites on post-merge main (the plan 40 semantic-merge lesson).

WP-A is the wave: if anything must give, everything else gives first. Validation is the product - a validator that only reads the diff has failed; accept-latency claims need measured numbers on the PR. Conclude with one fresh validator re-walking the full core loop (open project → chat → inline diff → accept → export) on a clean profile on final main, posting the closing summary (every PR, every re-walk verdict, parked items) on the umbrella, and push-notify the founder. Iteration budget 30. No checkpoints, no AskUserQuestion.
