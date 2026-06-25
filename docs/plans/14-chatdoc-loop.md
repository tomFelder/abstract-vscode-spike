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

## Function-gap map (engine vs F1–F8) — _to be filled in iteration 1, verified live_

| F-gate | Needs | Status | Evidence / where |
|---|---|---|---|
| F1 native-Explorer new folder/file | re-enable Explorer container; create on disk | _TBD iter 1_ | de-IDE `HideIdeContainersContribution` deregisters Explorer — revert for Explorer |
| F2 ProseMirror editor | bundle PM into the doc webview; schema; MD serialize | _TBD iter 1_ | today: `livingDocRender.ts` contenteditable + `execCommand`, persist-on-blur (`edit`→`editBlock`) |
| F3 chat-on-doc (OpenRouter) multi-turn | OpenRouter wiring; thread over current state | _TBD iter 1_ | `sendChatMessage`/`_chatRespond` exist (proxy `_callModel`); v1 chat proposes edits |
| F4 inline green/red diff | PM decorations/marks for add/del | _TBD_ | none today (edits queue to Review rail only) |
| F5 chat-rail review card | Copilot/Cursor-style card per turn | _TBD_ | `reviewRailView` Chat renders turns + tool-steps |
| F6 accept/reject | apply to PM doc + persist; per-change + all | _TBD_ | `approve`/reject of `IProposedChange` exists (rail) |
| F7 fresh-project end-to-end | the whole chain from a new folder | _TBD_ | — |
| F8 OpenRouter everywhere, fail-soft | default backend; honest no-key | _TBD iter 1_ | proxy had OpenRouter as a test backend ([[living-docs-model-impl]]) |

## Build / run (per the build memory)
- `nvm use 24.15.0` → `npm run watch` (background) → `./scripts/code-web.sh <folder>` (http://localhost:8080),
  **with the OpenRouter proxy running** so chat is live.
- Desktop parity / disk-proof: `./scripts/code.sh <folder>`.
- chrome-devtools a11y-click reaches webview-internal surfaces; re-snapshot before each click (uids change).
- Screenshot `filePath` must be inside a workspace root (e.g. `/Users/tommy/Sites/.lwd-shots/`), not `/tmp`.
