# Plan 19 — Editor-led review ("review the change in the document, not just the rail")

**Goal (Tom):** Make the **editor** (the middle document pane) a first-class place to review multi-document
agent changes - inline, in full document context - **without taking anything away from the chat/review
rail**.
Both surfaces do the heavy lifting; the user chooses where to work.
Most people will stay in the chat and approve there; but you should always be able to jump to a change's
inline diff and read the surrounding document, which is how you get the most out of the platform.

Follows the plan-18 loop ([[18-multi-document-editing-loop]]).
Build/verify mechanics unchanged: `npm run watch` + `./scripts/code-web.sh ./living-docs-sample/brief`
(http://localhost:8080) driven by chrome-devtools MCP; OpenRouter proxy on :8090 for the model.
Every PR gets before/after shots, stacked off `main`.

---

## 1. The target experience (both surfaces, user's choice)

- The review rail stays a full review workbench (approve/reject inline cards, per-document "Approve all",
  chat-level "Accept all") **and** becomes a navigator: every suggested change is clickable and jumps the
  editor to that document, scrolled to / focused on that change as an inline diff in full context.
- I can reach **any** suggested change across **any** document from the rail.
- In the **editor** itself, each inline diff carries its own Approve / Reject affordance hovering at/around
  the diff, so I approve a change while reading the surrounding document.
- Resident **in/around the editor** I also get:
  - "Approve all changes in this document"
  - "Next document with changes" - cycles the editor pane to the next changed doc and shows all its inline
    diffs
  - "Approve all changes across all documents"
- So I can do the entire review from the document pane, cycling doc -> doc, approving inline or in bulk -
  and equally do it all from the rail. Same engine, two surfaces.

## 2. Core-patch posture (changed from plan 18)

Getting the review truly inline in the editor is the priority.
Try contrib-only first (the ProseMirror inline-diff decorations + accept/reject widgets and the calm
in-webview toolbar already live in the `livingDocs` contrib).
But if a core change to the webview / editor chrome is genuinely needed to make the inline affordances and
the editor action bar work well, **take it** - keep the patch minimal and log it in the merge-tax ledger
(`docs/07-decision-log.md`, the decision-22 rationale) as evidence toward the fork-vs-greenfield question
(Q3).
Do not contort the contrib to avoid a clean small core patch.

## 3. Reuse, don't rebuild (most of the spine exists)

The engine is done (plan 18).
Reuse the existing service methods - `approve`, `reject`, `approveAll(docId)`, `rejectAll(docId)`,
`approveAllPending()`, `rejectAllPending()` - and the existing PM inline-diff decorations + accept/reject
widgets (`common/livingDocPmDecorations.ts`, `browser/livingDocRender.ts`).
This phase is the editor inline surface + the navigation wiring between rail and editor, plus at most a tiny
service helper (e.g. "next doc with pending changes") if it truly belongs in the service (TDD it if so).
**Start by auditing what inline diff + accept/reject already renders in the webview before building
anything.**

## 4. Decisions to confirm in iteration 1 (don't build before settling)

- **E-A - Both surfaces first-class (decided).** The rail keeps all plan-18 approve/reject + bulk actions
  **and** gains navigate-to-inline-diff; the editor gains the full inline review surface. Confirm only the
  detail: clicking a rail card moves the editor without approving (recommend yes - navigate-only; approval
  happens wherever the user then acts).
- **E-B - Editor action-bar placement.** Recommend a calm action bar inside the document webview (where the
  formatting toolbar lives) for "Approve all in this doc / Next document / Approve all everywhere"; confirm
  vs the editor header chrome (which may be the part that needs the core patch).
- **E-C - Inline per-hunk affordance.** Verify the existing accept/reject widgets; scope = make them
  hover/prominent + reliably wired; confirm enhance-not-rebuild.
- **E-D - Core patch (decided).** Inline-in-editor wins; contrib-first, take a minimal logged core webview
  patch if needed.

## 5. Iteration plan (the loop)

Each iteration: smallest reviewable slice -> live-verify with before/after shots -> PR off `main` (stacked).
**Merge note:** these are stacked branches; when landing them, merge bottom-up to `main` (or retarget each
to `main`) so they don't cascade into intermediate branches - plan 18 hit exactly this (needed a fixup PR).

1. **Settle E-A..E-D + audit the existing surface.** Verify the existing inline-diff + accept/reject surface
   live in the webview (screenshot it). Nail the webview-driving approach (let the service worker register;
   do **not** hard-reload with `ignoreCache`).
2. **Rail -> editor navigation.** A rail change entry, clicked, navigates the editor to that doc and scrolls
   to / focuses that specific change's inline diff (thread a focus-change-id through the render path). Rail
   approve/reject stays exactly as is.
3. **Inline per-hunk Approve / Reject** hovering at the diff in the document, wired to `approve(id)` /
   `reject(id)`; approving the last change in a doc feels complete. (Core webview patch acceptable here if
   needed - log it.)
4. **Editor action bar:** "Approve all changes in this document" (`approveAll`) + "Next document with
   changes" (advance the editor pane to the next pending doc and render its diffs).
5. **Editor "Approve all across all documents"** (`approveAllPending`) + the full cycle-through: next-doc
   updates the editor pane, shows its diffs, with a clear "all reviewed" end state. Approving the last change
   in a doc can auto-offer the next doc.
6. **Full E2E both ways.** Open `./living-docs-sample/brief`, give one cross-doc instruction, then (a) review
   entirely from the rail, and (b) review entirely from the editor - navigate from a rail entry -> inline
   approve one -> "approve all in this doc" -> "next document" -> "approve all everywhere". Before/after
   shots for both paths.

## 6. Acceptance criteria (verified live)

- [ ] Clicking a change in the rail opens its document in the editor and focuses that change's inline diff
      in full context.
- [ ] Every inline diff in the document has a working Approve / Reject affordance at the diff.
- [ ] The editor hosts "Approve all in this document", "Next document with changes", and "Approve all across
      all documents", all working.
- [ ] I can complete the entire multi-document review from the editor by cycling doc -> doc.
- [ ] The rail still does everything it did in plan 18 (nothing removed); both surfaces drive the same
      engine.
- [ ] Plan-17 + plan-18 HOLD intact (single-doc chat, working set, fan-out, 3-tier approve, calm shell).
- [ ] `typecheck-client` + `valid-layers-check` clean; any core patch is minimal and logged in the ledger.

## 7. Verify approach

`./scripts/code-web.sh ./living-docs-sample/brief` + the OpenRouter proxy on :8090; drive with chrome-devtools
(it reaches inside the webview iframe - prior plans drove source-peek that way; just let the SW register, no
`ignoreCache` reloads).
The cheap test model covers ~2/3 docs per run, so use a directive instruction to reliably get edits, and rely
on TDD for any deterministic service logic.
Desktop real-disk smoke (`TMPDIR=/tmp` via `code.sh`) for the final iteration since this touches the editor
persistence surface.
Screenshots -> `docs/plans/19-verify/`.
Log decisions + any core patch in `docs/07-decision-log.md` (continue from #63).

---

## Kickoff prompt (paste to start the loop)

> /goal Make the EDITOR (the middle document pane) a first-class place to review multi-document agent changes
> - inline, in full document context - WITHOUT taking anything away from the chat/review rail. Both surfaces
> do the heavy lifting; the user chooses where to work. Most people will stay in the chat and approve there;
> but you should always be able to jump to a change's inline diff and read the surrounding document, which is
> how you get the most out of the platform.
>
> /loop Execute `docs/plans/19-editor-led-review-loop.md` as an overnight, self-paced loop on the Abstract
> VS Code fork. Build it as small stacked PRs off `main`, each TDD'd where it touches the service, each
> verified live with before/after screenshots posted as PR comments. When landing the stack, merge bottom-up
> to `main` so it doesn't cascade into intermediate branches (plan 18 needed a fixup PR for exactly this).
> Don't regress plan 17 or plan 18 - the review rail KEEPS everything it gained in plan 18 (chat thread,
> per-document and chat-level Approve all / Reject all); this phase ADDS the editor surface and the navigation
> between them. Reuse the existing approve/reject/approveAll/rejectAll/approveAllPending/rejectAllPending
> service methods and the existing PM inline-diff decorations + accept/reject widgets - audit what already
> renders before building. Getting the review inline in the editor is the priority: try contrib-only first,
> but take a minimal, logged core webview patch if that's what it needs. Settle decisions E-A..E-D with me in
> iteration 1, then work the iteration plan. Verify on `./scripts/code-web.sh ./living-docs-sample/brief` +
> the OpenRouter proxy; drive the webview with chrome-devtools (let the service worker register, no
> ignoreCache reloads). Screenshots to `docs/plans/19-verify/`; log decisions from #64 in the decision log.
