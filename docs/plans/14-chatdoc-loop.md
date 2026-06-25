# 14 — Chat-on-Document loop (v6 / `living-docs-chatdoc`)

The core authoring loop, made reliable end-to-end: **create a new project folder on disk → edit a document
in a real ProseMirror editor → chat on top of that document to generate and revise its content, with proposed
changes shown as an inline green/red diff in the document AND a review card in the right-hand chat rail
(Copilot/Cursor-style), accept/reject, all in one continuing thread.** Off `main`. Model backend is
**OpenRouter** for *all* calls (Anthropic has no credits) via the existing localhost proxy's OpenRouter path.

This phase follows v5 ([[13-real-documents-loop.md]], R1–R6 merged): you can open/create a real folder, the
Home reflects it, edits persist, you can create docs and add sources/context + @mention — but the editor is a
janky `contenteditable`/`execCommand` webview and there is no working chat-on-document.

---

## Goal

Take Living Documents to a state where the **core authoring loop is reliable end-to-end** (the flow above).
Decided with Tom (2026-06-25):

- **OpenRouter is the model backend for every model/agent call** (Anthropic is out of credits). Route through
  the existing localhost proxy's OpenRouter path; make it the default; fail soft when the proxy/key is absent.
- **Real ProseMirror editor** — reverses the v2 "reuse VS Code primitives, no TipTap/PM" call (decision-era
  note in `06-design-notes`). The current editor is `contenteditable` blocks + `execCommand` persisting
  per-block on blur (Enter just blurs the block) — that is the "can't reliably edit" pain.
- **Native VS Code File Explorer comes back** — to create folders/files on disk. This **relaxes G4** (a
  deliberate reversal of the de-IDE decisions #25/#30 for functional power).
- The target is **chat-on-document** (Copilot/Cursor-style), NOT the Agents-screen "run an agent on a file"
  (explicitly out of scope for now). The chat: multi-turn thread; "generate me a top-10 list" → proposes doc
  content → accept; "change a couple of them" in the same thread → revise. Proposals render **two ways, per
  the designs**: an **inline green/red diff in the document** AND a **review card in the chat rail**, with
  **accept/reject**.

### Iteration 1 — settle + prove (minimal feature code)

Branch `living-docs-chatdoc` off `main`. Prove the three foundations before feature work:
1. **OpenRouter** — point the proxy/`_callModel` at OpenRouter; confirm a live round-trip from the running app
   (a chat message gets a real OpenRouter reply); define the no-key/no-proxy fail-soft.
2. **ProseMirror in the webview** — prove a real ProseMirror `EditorView` can be bundled into the livingDocs
   doc webview, render one real `.md`, edit it (Enter = new paragraph, a list, bold) and serialize back to
   Markdown that round-trips to disk (re-read to prove), preserving a bound figure as an inline node.
3. **Native Explorer** — re-enable VS Code's native File Explorer enough to create a folder + file on disk and
   open it as the project.

Then fill the function-gap map below (current chat/editor/diff engine vs each F-gate, status verified live)
and a ranked build order. Verify before assuming a gap — the v1 chat already proposes edits into the Review
rail and `sendChatMessage`/`_chatRespond` exist; the gaps are the ProseMirror surface, the inline diff, the
chat-rail review card, multi-turn-over-current-state, and OpenRouter.

### Acceptance criteria — the "F-gates"

Each verified live on a real folder with the OpenRouter proxy running, re-checked every iteration.

- **F1 — New folder/file on disk via the native Explorer.** Native VS Code File Explorer available; create a
  new folder + new `.md` on disk from it (no CLI) and open the folder as the project. (Relaxes G4.) The in-app
  Open/Switch folder + New document (R1/R4) still work too.
- **F2 — Reliable ProseMirror editor.** Docs open in a real ProseMirror `EditorView` (not
  `contenteditable`/`execCommand`): Enter = paragraph, lists/headings/bold/italic work, split/merge/delete
  stable, edits serialize to Markdown and persist to disk (re-read to prove). Bound figures render as a
  non-editable inline node and survive a round-trip. Editing a brand-new doc works.
- **F3 — Chat on the document (OpenRouter), multi-turn.** Right-rail Chat backed by OpenRouter holds one
  continuing thread; "generate me a top-10 list" returns proposed document content; a follow-up in the same
  thread ("change a couple of them") proposes a revision over the *current* doc state.
- **F4 — Inline green/red diff in the document.** A proposal renders inline in the ProseMirror doc as
  additions-green / deletions-red, in place (per the design comp) — not only as a rail list.
- **F5 — Chat-rail review card.** The same proposal shows as a review/summary card in the right-hand chat
  thread (Copilot/Cursor-style: what's changing, where), tied to the turn that produced it.
- **F6 — Accept / reject.** Accept applies the change to the ProseMirror doc + persists to disk (re-read to
  prove) and clears the inline diff; reject discards it and restores the doc. Per-change accept/reject AND an
  accept-all (per the comp).
- **F7 — End-to-end on a fresh project.** The whole flow runs from a *newly created* folder: create
  folder+doc → edit in ProseMirror → chat "generate…" → inline diff + chat card → accept → continue thread →
  revise → accept. No hand-editing of Markdown, no CLI.
- **F8 — OpenRouter everywhere, fail-soft.** Every model call routes through OpenRouter; no Anthropic
  dependency remains; with the proxy/key absent the chat degrades honestly (no fake replies, no silent fail).

### HOLD (regression gates, re-check every iteration)

- v5's **R1–R6** keep working (open/create folder, folder-reflecting Home, edit→disk, create doc, add/remove
  source, add/remove context + @mention).
- **G4 is explicitly REVISED** — the native File Explorer + on-disk file/folder creation are now *allowed* (a
  deliberate reversal of de-IDE decisions #25/#30; log it in `07-decision-log` + `03-merge-tax-ledger`).
- Keep the rest calm where it doesn't conflict: **G1** the editor stays one quiet writing surface (the inline
  diff is in-surface, never a split editor), **G2** calm header, **G5** detached gutter + inline figures
  preserved through ProseMirror, **G6** nav never blanks + no dev toasts.
- Settle in iteration 1 how the native Explorer and the custom tree-rail (Files/Context/Outline/Search)
  coexist (both, or Explorer for file-ops + rail for sources/@mention) — STOP and ask if non-obvious.

### Method

TDD all new service/pure logic (chat-proposal parsing, diff computation, accept/reject apply, ProseMirror↔
Markdown serialization) like the existing loop. Core patches allowed where the shell genuinely needs them
(re-enabling the Explorer container; bundling ProseMirror) — logged honestly in `03-merge-tax-ledger.md`.
Verify live: `code-web` + chrome-devtools (a11y-click reaches webview-internal surfaces; re-snapshot before
each click) **with the OpenRouter proxy running** so chat is real; re-read disk for every write; final desktop
`code.sh` smoke for native parity (Decision #38, "web drives, desktop proves disk"). Consult the DesignSync
"Workbench v2" comp for the inline-diff (green/red) + chat-review-card treatment. Post before/after
screenshots as PR comments (Tom reviews in the conversation). If an F-gate needs a product decision
(Explorer↔rail coexistence; per-change vs all-at-once accept UX; how a generative "create a list" maps onto
blocks; ProseMirror bundling approach), STOP and ask before building it.

---

## The /loop

> `/loop` Run one "chat-on-document" iteration. **ITERATION 1 (settle + prove, minimal feature code):** branch
> `living-docs-chatdoc` off `main`; prove (a) OpenRouter round-trips a live chat reply from the running app +
> define the no-key fail-soft, (b) a real ProseMirror `EditorView` can be bundled into the doc webview, edit a
> real `.md`, and serialize back to disk round-trip (re-read to prove) with a bound figure preserved, (c) the
> native Explorer can create a folder+file on disk and open it; then write the function-gap map in
> `docs/plans/14-chatdoc-loop.md` (engine vs F1–F8, status verified live) + ranked build order. **LATER
> ITERATIONS:** pick the single highest-impact unmet F-gate (suggested order: OpenRouter wiring → native
> Explorer/new-folder → ProseMirror editor → chat generative proposal → inline green/red diff → chat-rail
> review card → accept/reject → multi-turn-over-current-state → fresh-project end-to-end); brainstorm if
> non-trivial; build it (TDD for service/serialization/diff logic; core patches logged in
> `03-merge-tax-ledger.md`); verify live on a REAL folder via `code-web` + chrome-devtools with the OpenRouter
> proxy running (a11y-click for webview surfaces; re-snapshot before each click) and RE-READ disk for every
> write; AND re-check the HOLD gates (R1–R6 + the revised design gates); update `07-decision-log` +
> `06-design-notes` + `14-chatdoc-loop` + a clean `v6-log`; commit ONE change on the `living-docs-chatdoc` PR;
> AND post that iteration's before/after screenshots embedded in a PR comment with commentary. If an F-gate
> needs a product decision (listed in the goal), STOP and ask before building it. **Stop when F1–F8 all pass
> live on a freshly created folder with the OpenRouter-backed chat AND every HOLD gate still passes AND a
> desktop `code.sh` smoke confirms native parity, or after 25 iterations; then post a final readiness summary
> as a PR comment with the final shots.**

---

## Function-gap map (engine vs F1–F8) — _filled iteration 1 (2026-06-25), verified live_

Verified live on `code-web` against the real folder `/Users/tommy/Sites/.realdocs-test` with the
OpenRouter proxy running. Legend: ✅ proven this iter · 🟡 partial / foundation-only · ⬜ not started.

| F-gate | Needs | Status | Evidence / where (verified live unless noted) |
|---|---|---|---|
| F1 native-Explorer new folder/file | re-enable Explorer container; create on disk | ✅ **container back** · 🟡 disk-create unverified | Dropped `workbench.view.explorer` from `HideIdeContainersContribution`'s id list (`livingDocs.contribution.ts`). Live: the **Explorer icon is back in the activity bar** alongside Workspace/Home/Templates/Knowledge/Agents, with the tree-rail still default/selected (shot `v6-iter1-explorer-back.png`). Still to verify: New File/New Folder → on-disk → opens as project (desktop, real disk). |
| F2 ProseMirror editor | bundle PM into the doc webview; schema; MD serialize | ✅ **bundles+mounts+edits** · 🟡 disk re-read + remount | Vendored ASCII IIFE (`prosemirrorBundle.ts`, decision 43) decoded+inlined by `livingDocRender.ts` for **plain (non-living) `.md`**. Live on `Team Notes.md`: real `EditorView` renders heading/paragraph/bullet-list; typing works; **Enter = new paragraph** (outside a list) and **= new list item** (inside one) — shots `v6-iter1-pm-mounted/edited.png`. MD round-trip incl. `[x](bind:y)` link proven in Node. `pmEdit`→`saveRawText({silent})`→`IFileService.writeFile` (real disk per [[living-docs-v5-realdocs]] #38; web=memfs). **Two residuals → build order #1/#2:** (a) in-session reopen of the reused webview renders blank (re-inlining 367KB each render); (b) explicit desktop disk re-read not yet run. PM does NOT yet drive *living* docs (bound figures still the rich renderer). |
| F3 chat-on-doc (OpenRouter) multi-turn | OpenRouter wiring; thread over current state | ✅ **proven live (iter 2)** | `_chatRespond` now (a) sends the last ~6 turns as a transcript so a follow-up resolves over prior content (`_chatTranscript`, test "chat is multi-turn"), and (b) can **generate new content** via an `inserts` proposal kind, not just edit existing blocks. Live: "Add a Top-3 priorities list as a new section" → real OpenRouter (`gpt-4o-mini`) returned a section that queued as an insertion (shots `v6-iter2-*`). Decision 45. |
| F4 inline green/red diff | PM decorations/marks for add/del | ✅ **proven live (iter 2)** | `inlineDiff()` renders word-level green/red for edit proposals; generative insertions render **all-additions inline** (`renderInsertProposal`, green `.insertblock`) at their anchor in the document. Live: the proposed section showed inline in the doc with Approve/Reject before accepting. (Still the living-doc renderer, not the PM surface — that unifies in build-order #2.) |
| F5 chat-rail review card | Copilot/Cursor-style card per turn | ✅ **proven live (iter 2)** | `IChatMessage.proposedIds` ties a turn to its proposals; `reviewRailView` renders a Copilot/Cursor-style card per proposal (tag NEW CONTENT/EDIT + where + preview + Insert/Apply & Reject), reading the **live** pending change so it clears on accept/reject. Live verified. |
| F6 accept/reject | apply to PM doc + persist; per-change + all | ✅ **proven live (iter 2)** | Per-change approve/reject from both the inline control row and the rail card; plus `approveAll(docId)` wired to the rail "Approve all" (scoped to the active doc). Approving an insertion splices a new block + persists; the accepted Markdown renders as a real heading/list (renderer renders "rich" non-bound paragraphs as Markdown). Live: accepted the section, it landed rendered (shot `v6-iter2-accepted-rendered.png`). |
| F7 fresh-project end-to-end | the whole chain from a new folder | ⬜ | Depends on F1 (disk create) + F2 (living-doc PM) + the now-built F3–F6. |
| F8 OpenRouter everywhere, fail-soft | default backend; honest no-key | ✅ **proven live** | Proxy backend defaulted to OpenRouter (`lwd-anthropic-proxy.sh`, decision 44; key `~/.config/lwd-openrouter.key`). Live round-trip: `POST /v1/messages {claude-opus-4-8}` → real `gpt-4o-mini` reply in Anthropic Messages shape (`ROUNDTRIP_OK`). Every model call funnels through `_callModel`→proxy `/v1/messages`, so there is one chokepoint. Fail-soft already honest: `_hasModel` health-probe gate + explicit "agent model is not reachable" / "could not complete that" messages — no fake replies, no silent fail. |

## Ranked build order — updated iteration 2 (✅ = done)

- ✅ **F3 generative + multi-turn** (iter 2): `_chatRespond` carries prior turns + can generate new
  content via an `inserts` proposal kind. Verified live.
- ✅ **F4 inline diff for chat-generated proposals** (iter 2): insertions render all-additions inline at
  their anchor (`renderInsertProposal`). Verified live.
- ✅ **F5 chat-rail review card** (iter 2): per-proposal card tied to the turn (`proposedIds`), reading
  live pending. Verified live.
- ✅ **F6 accept/reject + accept-all** (iter 2): per-change from inline + rail card; `approveAll(docId)`.
  Verified live.

Remaining, highest-impact first:
1. **F2 robustness — PM remount + load-as-resource.** Blank-on-*close-then-reopen* (doc-switching works
   fine, verified iter 2). Stop re-inlining the 367 KB bundle on every `_render()`: load it once as a
   webview resource (`asWebviewUri` + `localResourceRoots`). The disk round-trip itself is **proven**
   (iter 2: edit survives a switch-away/back via `saveRawText`→`IFileService`; web=memfs, = real disk on
   desktop #38) — a desktop `code.sh` re-read is the final belt-and-braces.
2. **F2 coverage — PM drives *living* docs too.** Extend the PM surface to the living-doc path (bound
   figures as a non-editable inline node, gutter/provenance preserved) so editing is uniform and chat
   proposals can land in PM rather than the current living-doc renderer.
3. **F7 fresh-project end-to-end** smoke from a newly created folder (needs F1 disk-create + the above).

(F1 container + F8 done bar the desktop re-read; F3–F6 done iter 2.)

## Build / run (per the build memory)
- `nvm use 24.15.0` → `npm run watch` (background) → `./scripts/code-web.sh <folder>` (http://localhost:8080),
  **with the OpenRouter proxy running** so chat is live.
- Desktop parity / disk-proof: `./scripts/code.sh <folder>`.
- chrome-devtools a11y-click reaches webview-internal surfaces; re-snapshot before each click (uids change).
- Screenshot `filePath` must be inside a workspace root (e.g. `/Users/tommy/Sites/.lwd-shots/`), not `/tmp`.
