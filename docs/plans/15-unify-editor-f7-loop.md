# 15 — Unify the editor surface & close F7 (v6 completion / `living-docs-chatdoc`)

The v6 chat-on-document loop ([[14-chatdoc-loop.md]]) reached **7 of 8 F-gates live** (F1–F6, F8): on a
*living* document you can chat (OpenRouter) → generate/revise → inline green/red diff in the doc + a
Copilot/Cursor review card in the rail → accept/reject → rendered + persisted. The one open gate is **F7
— the whole loop from a *freshly created* doc** — and iter 3 pinpointed why it is blocked: there are
**two editor surfaces**. A *plain* `.md` opens in the real ProseMirror editor (no chat); a *living* `.md`
opens in the bespoke `renderDoc` HTML renderer (bound figures, provenance gutter, inline diff, source
drawer, chat proposals). A brand-new doc is plain, so it can be PM-edited but not chatted on.

This phase closes that seam: **make ProseMirror the single editing surface for every document** (plain
and living), bringing the living-doc features *into* PM. That single move closes build-order #1
(load-as-resource), #2 (PM drives living docs) and **F7** together, and makes "reliable editor +
chat-on-document" one coherent surface rather than two. Off `main` on `living-docs-chatdoc` (continues
the v6 PR line). Model backend stays **OpenRouter** via the localhost proxy.

---

## Goal

One surface: a real ProseMirror `EditorView` is the editor for **all** `.md`, and the living-doc
capabilities render *inside* it. When this lands, F7 is a straight verification pass and the v6 stop
condition (all F1–F8 live on a freshly created folder + a desktop disk smoke) is reachable.

Decided already (carry forward): OpenRouter is the backend (decision 44); native Explorer + tree-rail
coexist, rail default (decision 42); the PM bundle is vendored (decision 43); generative chat content is
an `insert` proposal reusing the review/approve machinery (decision 45).

### The keystone — ProseMirror drives living documents

Bring each living-doc feature that currently lives in `renderDoc` (`livingDocRender.ts`) into the PM
surface, preserving the design gates (G1/G2/G5/G6) and the v1 behaviour:

1. **Bound figures as a non-editable inline node.** `[label](bind:key)` renders in PM as an **atom
   NodeView** showing the resolved live value with the comp's blue dotted-underline highlight; not
   directly editable (driven by its source); clicking it opens the source-peek. Must serialize back to
   `[label](bind:key)` and survive a Markdown round-trip (extend the vendored bundle — decision 43 — with
   the figure node + its md token).
2. **Inline proposal diff *in PM* (F4 in-surface).** A pending `IProposedChange` renders as PM
   decorations/widgets: a meaning edit as word-level green/red over the target block; a generative
   `insert` as an all-additions widget at its anchor. Accept/reject (F6) applies to the PM doc and
   persists; reject restores. (Today these are HTML in `renderDoc`; move them onto PM.)
3. **Provenance gutter + applied-flash (G5).** Keep the detached gutter markers (dot / spanning bar) and
   the post-apply flash beside bound/changed lines — as PM gutter decorations or a parallel column.
4. **Source-peek bottom drawer (G5, decision 35).** The in-surface bottom drawer still opens from a
   figure/Source action; the document stays full-width (never a split editor — G1).
5. **Load the PM bundle as a webview resource** (`asWebviewUri` + `localResourceRoots`; the `marked.js`
   vendoring pattern) instead of re-inlining 367 KB per render — fixes the close-then-reopen blank and the
   per-render cost (build-order #1).
6. **One render path.** Retire the `renderDoc` HTML body in favour of PM for living docs (keep the calm
   topbar/toolbar/drawer chrome). Net intent: **delete more than is added** — the bespoke block renderer
   collapses into the PM schema + NodeViews.

### Acceptance criteria — the "F-gates" (re-verified live each iteration)

- **U1 — One editor.** Every `.md` (plain and living, new and existing) opens in a ProseMirror
  `EditorView`. The bespoke living-doc HTML body renderer is gone (or only chrome remains).
- **U2 — Bound figures.** A living doc's `[x](bind:key)` shows the resolved value as a non-editable
  highlighted inline node; clicking it peeks the source; it round-trips to `[x](bind:key)` on disk
  (re-read to prove). Editing prose around it is reliable (Enter = paragraph, lists, bold).
- **U3 — Chat proposal in-surface.** A chat edit and a chat `insert` both render as an inline diff
  **inside the PM doc** (green/red), with accept/reject that applies to the PM doc + persists and clears
  the diff. The chat-rail review card (F5) stays in sync.
- **F7 — Fresh-project end-to-end.** From a *newly created* folder (native Explorer): create folder +
  doc → edit in ProseMirror → chat "generate me a top-10 list" → inline diff + chat card → accept →
  continue the thread → "change a couple of them" → accept. No CLI, no hand-edited Markdown.
- **Disk smoke.** A desktop `code.sh` run re-reads a file after an edit + an accepted chat change to
  prove real-disk persistence (web is memfs, decision 38).

### HOLD (regression gates — re-check every iteration)

- **F1–F6 + F8 keep passing live** (the iter-1/2 loop, on existing living docs).
- **v5 R1–R6** still work (open/create folder, folder-reflecting Home, edit→disk, sources/context/@mention).
- **Design gates:** G1 one quiet writing surface (PM in-surface diff + bottom drawer, never a split
  editor); G2 calm header; G5 detached gutter + inline figures preserved *through PM*; G6 nav never
  blanks, no dev toasts. G4 stays as revised (decision 42 — Explorer allowed).
- **Merge-tax:** prefer our-surface / additive; log any core patch in `03-merge-tax-ledger.md`. The PM
  bundle stays vendored (decision 43); resource-loading it is still our surface.

### Method

TDD all new pure/service logic (the figure NodeView's md serialize/parse round-trip; proposal→decoration
mapping; PM↔Markdown for living docs incl. bound figures). Rebuild the vendored bundle offline (decision
43) when the schema/figure node changes; keep it ASCII (`--charset=ascii` + the regex-escape post-step)
and re-verify hygiene. Verify live on a REAL folder via `code-web` + chrome-devtools **with the OpenRouter
proxy running** (a11y-click reaches webview surfaces; re-snapshot before each click); RE-READ disk for
every write; final desktop `code.sh` smoke (decision 38). Post before/after screenshots as PR comments
(Tom reviews in the conversation). **If a step needs a product/architecture decision — STOP and ask**
(listed below).

### Settle first (STOP and ask before building)

- **Bound-figure NodeView treatment in PM** — atom inline node vs. widget decoration; how
  edit-protection + provenance-peek attach; how it serializes. (The central design call.)
- **How the inline proposal diff is expressed in PM** — ProseMirror decorations (inline add/del marks +
  a block widget for inserts) vs. a rendered overlay. Affects accept/reject application.
- **Whether a freshly-created doc is "living" by default** (so chat is available immediately) or stays
  plain until a source/bind is added (so F7 starts by adding one). Drives the F7 script.
- **Replace vs. wrap `renderDoc`** — confirm we retire the bespoke HTML body (one surface) rather than
  keep both.

---

## The /loop

> `/loop` Run one "unify the editor / close F7" iteration on `living-docs-chatdoc`. **FIRST ITERATION
> (settle + prove the keystone, minimal feature code):** brainstorm + settle the four "settle first"
> decisions with Tom; then prove (a) the vendored PM bundle can carry a **bound-figure inline NodeView**
> that renders the resolved value, is non-editable, and round-trips `[x](bind:key)` to disk (re-read to
> prove), and (b) the PM bundle loads as a **webview resource** (`asWebviewUri`), fixing the
> close-then-reopen blank. **LATER ITERATIONS:** pick the single highest-impact unmet criterion (suggested
> order: bundle-as-resource → bound-figure NodeView → render living docs in PM (retire `renderDoc` body) →
> provenance gutter + source drawer in PM → chat proposal as in-PM inline diff with accept/reject (U3) →
> F7 fresh-project end-to-end → desktop disk smoke); brainstorm if non-trivial; build it (TDD for
> serialization/NodeView/decoration logic; core patches logged in `03-merge-tax-ledger.md`); verify live on
> a REAL folder via `code-web` + chrome-devtools with the OpenRouter proxy running and RE-READ disk for
> every write; AND re-check the HOLD gates (F1–F6, F8, R1–R6, the design gates); update `07-decision-log` +
> `06-design-notes` + this plan + the `living-docs-v6-chatdoc` memory; commit ONE change on the PR; AND
> post that iteration's before/after screenshots embedded in a PR comment with commentary. If a step needs
> a product/architecture decision (the "settle first" list), STOP and ask before building it. **Stop when
> U1–U3 + F7 all pass live on a freshly created folder with the OpenRouter-backed chat AND every HOLD gate
> still passes AND a desktop `code.sh` smoke confirms real-disk persistence, or after 20 iterations; then
> post a final readiness summary as a PR comment with the final shots.**

---

## Build / run (per the build memory)
- `nvm use 24.15.0` → `npm run watch` (background) → `./scripts/lwd-anthropic-proxy.sh` (OpenRouter
  default, decision 44) → `./scripts/code-web.sh <real-folder>` (http://localhost:8080).
- Rebuild the vendored PM bundle offline when the schema/figure node changes; ASCII-only; re-run hygiene.
- Desktop parity / disk-proof: `./scripts/code.sh <folder>` (decision 38, "web drives, desktop proves disk").
- chrome-devtools a11y-click reaches webview-internal surfaces; re-snapshot before each click (uids change).
- Screenshot `filePath` must be inside a workspace root (e.g. `/Users/tommy/Sites/.lwd-shots/`).

## Carry-over context (from plan 14, verified)
- Chat loop lives in `livingDocsService.ts` (`sendChatMessage`/`_chatRespond`/`_queueChatEdit`/
  `_queueChatInsert`/`approve`/`approveAll`) + `reviewRailView.ts` (rail card) + `livingDocRender.ts`
  (`renderInsertProposal`, `inlineDiff`). `IProposedChange` has `insert`/`afterBlockId`; `IChatMessage`
  has `proposedIds`.
- PM today: `prosemirrorBundle.ts` (base64 IIFE, `window.LWDPM.{mount,toMarkdown,cmd,destroy}`) inlined by
  `livingDocRender.ts` for the plain (`!isLiving`) branch; `pmEdit`→`saveRawText({silent})` persists.
- A bound figure is just a Markdown link with an href `bind:…`, which the stock PM markdown
  parser/serializer already round-trips — the NodeView adds the resolved-value rendering + edit-protection
  on top, it does not need a new link syntax.
