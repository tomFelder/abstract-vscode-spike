# Plan 18 — Multi-document editing ("change it across these docs")

**Goal (Tom):** Add a folder (or several documents) to an agent chat as a *working set*, give one
instruction, and have the agent make the change across **all** of those documents at once — then review
the diffs the way Cursor does: per-change, per-document "approve all", and a chat-level "accept all".

**Worked example.** A project brief split across three Markdown docs — `Project Brief.md`,
`Executive Summary.md`, `Appendix.md`. The user adds the folder to the chat and says *"we've decided to
change the primary colour from blue to red."* The agent edits every affected doc. The user reviews:
approve a single diff, or "Approve all" within a doc, then move to the next doc and approve its diffs;
or hit "Accept all" in the chat to approve everything across every document at once.

This is a real capability gap, not polish. Follows the plan-17 loop ([[17-off-the-golden-path-loop]]).
Build/verify mechanics unchanged: `npm run watch` + `./scripts/code-web.sh` (http://localhost:8080)
driven by chrome-devtools MCP; OpenRouter proxy on :8090 for the model. Every PR gets before/after shots.

---

## 1. How Cursor does it (research, 2026-06-30)

Mirror these patterns; they are the user's reference point.

**Adding context.** Cursor uses `@`-mentions for **`@Files & Folders`** (e.g. `@auth.ts`, or a folder
`@src/components/`); folders can also be **dragged** into the chat. Adding a folder pulls its files in as
context, and the Agent can additionally discover related files on its own. Mentioned files/folders show
as **chips** in the composer above the prompt.

**Editing across files.** In Agent mode the model edits multiple files in one turn. Each edited file gets
**inline diff decorations** (green added / red removed) directly in that file's editor.

**Reviewing multi-file edits (the important part).**
- The chat shows a **list of changed files**, each with a `+N / -N` line-count summary.
- **Clicking a file opens its diff** so you can see the changes in place and step through them.
- Each hunk has inline **Accept / Reject** controls; each file has a **per-file Accept all / Reject all**;
  and there is a **top-level Accept all / Reject all** that applies to every changed file at once.
- An agent turn is a **checkpoint** you can restore to (undo all of that turn's edits together).

**Takeaways for Abstract:** (1) context is a *set* of files/folders shown as chips; (2) edits land as
reviewable diffs, never silently; (3) review is a three-tier accept model — **per-change → per-document →
all** — with a way to navigate to each changed document. Abstract already has tiers 1 and (partly) 3.

Sources: [Cursor — Reviewing & Testing Code](https://cursor.com/docs/agent/review) ·
[Cursor — Prompting agents / mentions](https://cursor.com/docs/context/mentions) ·
[Cursor — @Folders](https://docs.cursor.com/context/@-symbols/@-folders) ·
[Forum — multi-file diff review feedback](https://forum.cursor.com/t/i-dont-like-the-new-cursor-diff-view/145154) ·
[Forum — only some diffs shown across files](https://forum.cursor.com/t/only-some-diffs-are-shown-whhen-agent-makes-changes/152099).

---

## 2. What Abstract already has (reuse ~70%)

The engine and review surface were built for single-doc chat, but most of the parts generalise.

- **Proposal system** — `common/livingDocsModel.ts` `IProposedChange` (carries `docId` / `docTitle`,
  an edit `oldText`/`newText`/`blockId`, or an insert `afterBlockId`). Service APIs in
  `browser/livingDocsService.ts`: `getPendingForDoc(docId)`, **`getAllPending()`** (already cross-doc),
  `approve(id)`, `reject(id)`, **`approveAll(docId)`** (per-doc, exists ~line 1644). Proposals are NOT
  gated to the active doc — they carry their own `docId`.
- **Review rail already groups by document** — `browser/reviewRailView.ts` `_renderReview` buckets
  `getAllPending()` by `change.docTitle` and renders a per-doc group with a count + per-change
  approve/reject. This is the spine of the multi-doc review UI; it just needs the per-group "Approve all"
  / "Reject all" and a click-to-open.
- **Inline diffs render per document** — `browser/livingDocRender.ts` + the PM decoration spec
  (`common/livingDocPmDecorations.ts`) draw the green/red word-diff and the accept/reject widgets inside
  whichever doc is open. Open a different doc and its own pending diffs render. No change needed to show a
  second doc's diffs — only to *route the user there*.
- **Chat → proposal loop** — `_chatRespond` builds a transcript, calls the model via the proxy, parses
  the reply into edit/insert proposals, and queues them. Chat works on every doc (decision 48).
- **Multi-doc fan-out exists in the engine** — source-change propagation already updates figures across
  many documents (`agentOrchestrator.ts`), so touching N docs in one operation is established.
- **@-mention chips** — the composer already lists the folder's files as `@`-chips; today they attach a
  file as *grounding context*, not as an *edit target*.
- **`listDocuments()`** returns every doc in the folder with `resource` + `title` + `isLiving`.

## 3. The gaps to close

1. **A working set (edit targets), distinct from sources.** Sources are *data bindings* (csv/api);
   here we need "the documents this instruction should edit". Add the ability to put a **folder or
   several docs into the chat** as the working set, shown as chips ("Project Brief", "Executive
   Summary", "Appendix"), with adding a folder expanding to all its `.md` docs.
2. **Fan the chat edit across the working set.** `_chatRespond` edits the active doc only. When a working
   set is present, run the instruction against **each** doc (read its body, propose edits/inserts for it),
   producing proposals tagged with each doc's `docId`. Reuse the existing proposal queue + the
   established multi-doc fan-out machinery.
3. **Cursor-style review across documents.** In the Review rail: per-document group header gains
   **"Approve all" / "Reject all"** (wire to `approveAll(docId)` + a new `rejectAll(docId)`), shows the
   doc's `+N/-N`, and the header is **clickable to open that document** so its inline diffs are visible.
   In the chat: the proposal summary becomes **"Accept all (M changes · K docs)" / "Reject all"** spanning
   every doc, plus a compact changed-docs list. Approving a doc's changes clears that group; approving the
   last clears the rail.
4. **`rejectAll(docId)` + `rejectAllPending()`** service methods (only per-doc reject-all and a global
   accept exist today).

## 4. Decisions to confirm in iteration 1 (don't build before settling)

- **D-A — Working set vs sources.** Recommend a **separate "Working set" concept** (documents to edit)
  rather than overloading the source `@`-chips. In the composer: an "Add documents…/Add folder…"
  affordance that yields doc chips; sources stay a separate row. Confirm with Tom.
- **D-B — Implicit vs explicit set.** When no working set is added, chat stays single-doc (active doc) as
  today (backwards compatible). The fan-out only triggers when a set is present. Confirm.
- **D-C — How the model is asked.** One call per doc (simple, isolates failures, parallelisable) vs one
  call returning a per-doc map. Recommend **one call per doc** to start (reuses `_chatRespond` per doc;
  honest per-doc failure handling), revisit if latency is poor.
- **D-D — Living vs plain in a set.** Plain docs (no sources) get prose edits; living docs also get prose
  edits (the colour change is prose, not a figure). Both flow through the same proposal path.

## 5. Iteration plan (the loop)

Each iteration: smallest reviewable slice → live-verify with before/after shots → PR off `main`
(stacked). Suggested order:

1. **Settle D-A..D-D with Tom** + add a real **3-doc multi-file sample** (e.g.
   `living-docs-sample/brief/` with `Project Brief.md`, `Executive Summary.md`, `Appendix.md`, each
   mentioning a "primary colour: blue"). TDD the service surface.
2. **Working set in the composer** — add docs/folder to the chat; render chips; service holds the set.
   No fan-out yet (set is just displayed). Verify chips add/remove, folder expands to its `.md` docs.
3. **Fan the edit across the set** — `_chatRespond` (or a new `_chatRespondMulti`) runs the instruction
   over each doc in the set and queues proposals per `docId`. Verify "blue → red" yields proposals in all
   three docs (`getAllPending()` spans 3 docs). TDD with a stubbed model.
4. **Per-document review controls** — Review rail group header: `+N/-N`, **Approve all / Reject all**
   (add `rejectAll(docId)`), and click-header-to-open-doc. Verify approving one doc's group clears it and
   leaves the others; opening each doc shows its inline diffs.
5. **Chat-level Accept all / Reject all across docs** — the chat proposal summary approves/rejects every
   doc's changes at once; add `rejectAllPending()`. Verify one click clears all three docs + the rail.
6. **Navigation polish** — a changed-docs list in the chat (Cursor-style) that opens each doc; "approve
   all" advances to the next doc with pending changes. Verify the full worked example end-to-end.

## 6. Acceptance criteria (the worked example, verified live)

Open the `brief/` folder → add it to the chat → "change the primary colour from blue to red":
- [ ] Proposals appear in **all three** documents (`getAllPending()` spans 3 `docId`s); each doc shows
      its own inline red/green diffs when opened.
- [ ] **Per-change** approve/reject works (one diff at a time).
- [ ] **Per-document "Approve all"** clears that document's changes and leaves the others pending.
- [ ] Navigating to the **next document** shows its diffs; its "Approve all" works independently.
- [ ] **Chat "Accept all"** approves every change across every document in one action; "Reject all"
      discards them all.
- [ ] No working set added → chat still edits only the active doc (backwards compatible).
- [ ] Plan-17 HOLD intact: single-doc chat, source-peek, table rendering, calm shell all still pass.
- [ ] 0 added core patches (additive contribution), `typecheck-client` + `valid-layers-check` clean,
      service logic TDD'd.

## 7. Verify approach

`./scripts/code-web.sh ./living-docs-sample` + the OpenRouter proxy; drive with chrome-devtools (a11y
clicks reach the webview). Headless TDD for the service (`livingDocsService.test.ts`) with a stubbed
model so the fan-out + per-doc proposal routing is proven without the network. Desktop `code.sh`
real-disk smoke for the final iteration (`TMPDIR=/tmp`). Screenshots → `docs/plans/18-verify/`.

---

## Kickoff prompt (paste to start the loop)

> Execute `docs/plans/18-multi-document-editing-loop.md` as an overnight loop. Goal: let me add a folder
> (or several documents) to an agent chat as a working set, give one instruction, and have the agent make
> the change across all of those documents at once — reviewed the way Cursor does it (per-change approve,
> per-document "approve all", chat-level "accept all"). Start by settling decisions D-A..D-D with me and
> adding a real 3-document sample, then work the iteration plan in small stacked PRs off `main`, each
> verified live with before/after screenshots. Reuse the existing proposal/approve system, the Review
> rail's per-document grouping, and the engine's multi-doc fan-out — most of the spine already exists.
> Keep it 0-core-patch, typecheck + layers clean, and TDD the service. Don't regress the plan-17 work.
