# 06 — Design notes (intent vs reality)

The visual target is the **"Agentic Workbench" Direction 01 — Workbench hi-fi** (Claude Design
project `d198ca07-9eef-4d05-96e1-b383e6c19c03`). The spike's shell does not yet match it. This doc
records the known UI/UX gaps and Tom's specific design intent so the next pass can act on them. All
of these are wired into [plans/02-studio-de-ide-handoff.md](plans/02-studio-de-ide-handoff.md).

---

## D1 — Provenance gutter redesign (detach the dots from the prose)

### Problem (today)
The colored provenance dots render **inline with the sentence**, which pushes the text in and reads
as document indentation. They look like part of the body, not metadata about it.

### Intent (Tom's spec)
The dots/markers belong in a **true left gutter**, well left of the document column, visually
**detached** from the body — so the prose column is never shifted by them.

Add a **line-numbered gutter**, with these rules:
- Each **document line** gets a number in the gutter.
- A line that **wraps** across 2-3 visual rows does **NOT** increment the number — the wrapped
  continuation rows show a **blank gap**; the number only advances on a real new line.
- A **dot** appears in the gutter beside a **bound / edited** line.
- If an edit spans a **multi-line paragraph**, the marker **blends into a vertical bar** spanning
  those gutter rows (indicating the change touches several lines) — rather than a single dot.
- **Hover** a gutter marker still **pulls up** the provenance (reveal source / detail), as today.

### Sketch
```
 gutter        document column
 ┌────┐
 │ 1 ●│  Revenue grew 18% week-on-week to $48.6k MRR, on 427     <- bound line: dot in gutter
 │    │  new signups. Churn eased to 2.4%.                        <- wrapped: blank gutter, no number
 │ 2  │  Growth remained steady this week.                        <- plain line: number only
 │ 3 ┃│  A multi-line commentary paragraph whose edit            <- multi-line edit: bar, not dot
 │   ┃│  spans several wrapped rows, so the marker becomes
 │   ┃│  a vertical bar across the affected gutter rows.
 └────┘
```

### Notes
This is **our own webview surface** (low risk, no core patch). The detached gutter also moves us
closer to the "document, not code" feel — but note the line-number gutter is itself a slightly
code-editor metaphor; check against the hi-fi whether numbers or a subtler marker rail is wanted.

---

## D2 — Header / document-title area looks "funky"

Tom reports "something super funky going on with the header and how we're displaying the
documents." The current `livingDocRender` top bar (brand row + crumb + status pill + toggle /
export / refresh buttons) and the document title block were assembled pragmatically, not to spec.

**Action:** review the header, the document title block, and how the document is seated in the
editor area **against the Workbench hi-fi** and correct the discrepancies. Wired into ITEM C of the
next plan.

---

## D3 — The calm shell: "calm by subtraction" vs "calm by construction"

The Studio skin (item 5) hides IDE chrome via settings — **calm by subtraction**. It gets ~80% of
the way and is reversible, but it leaves the IDE's *interaction grammar* underneath (panes, groups,
view containers, palette, drag-to-split). The design intent is **calm by construction**: a shell
that was built to be a word processor.

Tom's explicit guidance for how to approach the shell:
- **Far less flexibility, less UI information, less customization** than VS Code exposes.
- **No** draggable panes/panels, **no** split editors, **no** "reopen editor with," **no** command
  palette surfaced to the user.
- The reference points are **Microsoft Word, Google Docs, Notion** — light-touch, gentle, opinionated.
- "Currently this editor feels far too customizable, like the VS Code product, than what I'd like."

The next pass should therefore **remove optionality**, not just hide chrome — and where removing it
requires fighting core, log that as evidence toward greenfield (see [05](05-open-questions.md) Q3).

---

## D4 — The document surface is the part that already works

Worth stating positively: because the document is rendered in our own webview, the **document
itself** already reads like a word processor. The gap is entirely the surrounding shell (left rail =
file tree, view-pane chrome, header, group/close affordances). The next pass should bring the
*surrounding* shell up to the document's level — and pixel-align the document + review rail to the
hi-fi (ITEM D of the next plan).

---

## D5 — Post-v1 status: functionality is done; the shell still diverges (the v2 design loop)

The v1 functionality loop (plan 09, PR #13) made every surface *work* — Chat agent, Apply-fix,
source-peek + "Sync across", Context kinds, dynamic subtitle — all live-verified. Tom's review:
**functionally good; the UX/UI/IA has drifted from the intended design.** The named abrasions:

- **Split panes / blank panes (the #1 abrasion).** v1's source-peek + "Sync across" open the source
  in a VS Code `SIDE_GROUP` *editor group*, so opening a source spawns a second pane — frequently
  leaving one pane **entirely blank**. This is exactly the "no split editors" violation of D3.
  **v2 fix:** redesign source-peek + Sync-across as an **in-surface panel/overlay** in the document
  surface; remove every `SIDE_GROUP` open; never show an empty editor group. (Decision log 19 -> 20.)
- **The header is heavy and messy** — too many controls, not the comp's calm single 48px bar.
- **The left rail has nowhere near the design's IA.** The comp is a single tree-rail
  (Files / Context / Outline / Search + a folder tree); today it's split across activity-bar
  containers. **v2 fix:** build the design's tree-rail (Decision log 21).
- Still standing from D1–D4: detach the provenance gutter; remove VS Code optionality (no drag/split/
  reopen-with/palette/group-close); pixel-align each surface.

**The v2 loop** ([plans/11-design-alignment-loop.md](plans/11-design-alignment-loop.md)) is a
UX/UI/IA/visual pass to **>= 95% alignment** with explicit "hard UX gates" for each abrasion above,
and — newly — **core patches are permitted where the design needs them** (logged in the merge-tax
ledger; decision log 22), since "calm by construction" (D3) can't always be reached contrib-only.
The per-surface **Exists-today vs Design-intends** inventory the loop builds lives in
`design-audit/v2-inventory.md`.

---

## D6 — Comp-confirmed clarifications (from the v2 iter-1 live audit, 2026-06-22)

The iteration-1 audit (read the comp `.dc.html` pixel-by-pixel + drove the live app) resolved three
open questions and pinned the header clutter. Recorded here so later iterations build to the comp, not
to a guess:

- **The provenance gutter is a subtle marker rail, NOT line-numbered (resolves D1's open question).**
  D1 floated line numbers but flagged "check the hi-fi whether numbers or a subtler marker rail is
  wanted." The comp answers it: a **30px `flex:none` gutter column** to the left of the 720px doc
  column, holding a centered **9px dot** beside a bound line (a **vertical bar** for a multi-line
  edit) — **no line numbers at all**. Build the detached dot/bar rail; drop the line-number idea.
- **The right rail is Chat / Review / History — three tabs (new gap).** The comp's 392px right panel
  has exactly three tabs. The running app has a fourth, **Skills**. v2 must reconcile: either drop
  Skills or justify it as a deliberate departure (decide in the decision log when touched).
- **The header clutter is specific (sharpens D2/G2).** The doc editor's heavy header is a **second
  toolbar row** the comp does not have: `Heading / B / I / U / list / quote / ✦ Ask AI / ⇆ Source /
  </>`, plus **↓ Download** and **↻ Refresh from sources** buttons in row 1. The comp's bar is row 1
  minus those: brand/crumb + synced pill + ↗ Present + avatar only. Calming G2 = stripping/relocating
  that whole second row and the Download/Refresh buttons, not just restyling.
- **The squeeze is a symptom of the editor-group model.** Every surface (Home/Templates/Knowledge/
  Agents) is a webview *editor*; with a leftover/blank group open they render in a narrow column. So
  G1 (kill split/blank groups) and G3 (replace activity-bar-of-editors with a real shell) are the same
  root cause — fixing the hosting model un-squeezes the secondary surfaces for free.
- **(iter 3) G3 splits cleanly into two slices.** The **tree-rail** (Files/Context/Outline/Search +
  folder tree) is a single DOM-rendered `ViewPane` and was buildable contrib-only (done, decision 23).
  The remaining slice — the comp's **76px labeled icon-nav** (vs VS Code's ~48px unlabeled activity
  bar) and making Home/Templates/Knowledge/Agents *pure nav actions* that keep the tree-rail visible
  rather than activity-bar containers that swap the sidebar — fights VS Code's one-icon-per-container
  model and likely needs a `styleOverrides`-CSS pass and/or a small core seam. Treat it as its own
  iteration, not part of the tree-rail build.
- **(v3 iter 2) "Calm by construction" means no optionality, not just no chrome (closes G4).** A
  document app has **no command palette** and **no user-resizable panes** - those are IDE affordances
  that say "this is a tool you configure," the opposite of the comp's opinionated single surface. v2
  removed the *visible* chrome; v3 removes the last two *reachable* affordances at the source: the
  palette/Quick-Open keybindings (so `Cmd+Shift+P` / `F1` / `Cmd+P` and the `>` command mode do
  nothing) and a global lock that makes every layout sash non-draggable. Design intent going forward:
  **the shell layout is set, not negotiated** - widths/positions are product decisions (decision 27),
  and the user resizes nothing. This is the design rule, not a one-off fix.
- **(v4 iter 1) The "Workbench v2" comp re-states the calm rule for the editor + source surfaces.** The
  revised comp keeps the same shell and changes only four things, all reinforcing "calm document app over
  IDE/tool": (1) **source no longer splits the editor** — it slides up as a **bottom in-surface drawer**
  (52% height, drag-handle, one filled "Sync to report" action) instead of a left pane with a floating
  sync circle; the doc stays full-width centered. (2) the **formatting toolbar is pared to essentials** —
  the heading dropdown goes borderless, and "Link to source" / "Run skill" / "History" are dropped, leaving
  just a quiet "● Saved · v14". (3) the **right rail loses the Document-Agents panel** — document agents are
  de-emphasised out of the always-on rail. (4) the **Home greeting** aligns to the baseline. Read together:
  the editor should feel like one quiet writing surface — source and agents are *traced to on demand*, not
  parked open beside the prose. That is the bar for v4 (>=97% vs this comp).
- **(v4 iter 2) The source drawer is `position:fixed` to the webview viewport, not an in-flow pane.** The
  v3 layout flexed a left pane and the document side-by-side (`.peekwrap`), so opening source visibly
  squeezed the prose. The v2 comp wants the document to stay put and the source to *overlay* the bottom. The
  clean implementation is a fixed-position drawer (`left:0;right:0;bottom:0;height:52%;z-index:25`) pinned
  to the bottom of the webview viewport — the document renders full-width exactly as it does with no source
  open, and the drawer floats above it. The sync affordance lives in the drawer header (one filled primary
  button), not as a floating circle on a divider that no longer exists. Same data, calmer hosting.
- **(v4 iter 3) "Calm" no longer means "no toolbar" — it means a *pared* toolbar.** v3 read the old comp as
  having no persistent toolbar and used a floating selection popover. The revised comp settles the question:
  there IS a persistent word-processor toolbar, just a quiet one (borderless heading dropdown, B/I/U,
  list/ordered/quote, and a muted "● Saved · v14" status) with the heavy controls — Link-to-source, Run
  skill, History — removed. The lesson: calm is achieved by *dropping the noisy affordances*, not by hiding
  the whole toolbar until selection. The persistent toolbar reads as a familiar document app; the floating
  one read as a novelty. Wiring stayed `execCommand` via the generic `[data-fmt]` handler (now honouring
  `data-fmt-arg`).
- **(v5 iter 1) The engine was already "real"; the missing piece is the *on-ramp*, not the plumbing.** Live
  on a real folder, the tree-rail listed the real docs/sources and a bound figure resolved to the real CSV
  value — discovery, source-read, create and save all run through `IFileService` already. What's absent is a
  way *into* a folder from the calm shell: the de-IDE work (G4) stripped the menubar/Explorer/palette that
  normally carry "Open Folder", so there is no on-ramp at all. The Home screen meanwhile still shows
  hardcoded demo projects. So v5 is mostly **surfacing existing real capability** (an Open-folder action, a
  Home that reflects the folder, add-source/add-context affordances) rather than building a data layer — the
  inverse of the usual "UI exists, wire it up" shape. The one true plumbing gap is verification: `code-web`
  writes to memfs, so disk-persistence is proven on the desktop `code.sh` build (Decision #38).
- **(v5 iter 2) The Home dashboard is the on-ramp, not a demo.** The comp's Home showed a multi-project
  dashboard with hardcoded cards ("Opportunity OS", "Acme Co", a "New project" tile). With real folders
  (decision #39 — the folder IS the project), Home is reframed: when no folder is open it is a single calm
  invitation ("Open a folder to begin" + one button); when a folder is open it shows that folder's name and
  a grid of its real documents (living ones carry a small "Living" badge, plain `.md` read "Markdown"), each
  card opening the doc. The greeting stays, but the four fictional project cards and the no-op "New project"
  button are gone — "New project" becomes "Open another folder" / "New document". The lesson: the comp's
  dashboard was a *mock of a populated state*; the real product needs the empty/on-ramp state first, and the
  populated state must read from the open folder, not from fixtures.

## D7 — (v6) The editor substrate becomes real ProseMirror; the calm shell now also has the native Explorer

The v6 chat-on-document loop (plan 14) makes two design-relevant substrate changes, both deliberate
reversals of earlier calls now that the *core authoring loop* (not just the visual shell) is the bar:

- **The writing surface is a real ProseMirror `EditorView`, not `contenteditable` + `execCommand`.** D4
  said "the document surface is the part that already works" — visually true, but the editing *mechanics*
  were not: blocks were `contenteditable` persisted on blur, and **Enter just blurred the block** rather
  than making a paragraph. That is the "can't reliably edit" pain. v6 reverses decision 4's "reuse VS Code
  primitives, no 3rd-party rich-text" (for the fork path) and mounts a vendored ProseMirror bundle, so Enter
  = a real paragraph, lists/headings/bold work, and the doc serialises back to Markdown. Iter 1 wires it for
  **plain (non-living) `.md`**; bringing it to the living-doc surface (bound figures as a non-editable inline
  node, provenance gutter preserved) is the next slice. Design rule going forward: the document is edited in
  a genuine rich-text engine — the calm look (the `.prose` type ramp) is layered *on top of* PM, not faked.
- **The native File Explorer is back — and that is OK, because calm ≠ feature-poor.** D6/G4 framed "calm by
  construction" as removing IDE optionality. v6 (decision 42) re-admits the native Explorer as a *second*
  activity-bar container so the loop can create folders/files on disk. This is not a regression of the calm
  intent: the tree-rail stays the **default** surface, and the Explorer is an opt-in power tool, not the
  primary nav. The refined rule: strip the optionality that makes the app read as "a tool you configure"
  (palette, resizable panes, IDE chrome — still gone), but keep the *functional* affordances a real document
  app needs (a file tree you can create in). G4 is consciously relaxed for power, not abandoned.
- **One editor surface — ProseMirror carries living documents too (plan 15 keystone).** v6 mounted PM for
  *plain* `.md` only, leaving *living* docs on the bespoke `renderDoc` HTML body — two surfaces, and the
  seam is exactly what blocked F7 (a freshly-created doc is plain, so it could be PM-edited but not chatted
  on). Plan 15 settles four calls (decisions 46-49): a bound figure becomes a first-class **`bound_figure`
  atom inline node** in the vendored bundle (non-editable, renders the resolved value, round-trips to
  `[label](bind:key)`); proposals become **PM decorations/widgets**; **chat is available on every doc**
  ("living" is just a data-binding badge); and `renderDoc`'s HTML body is **retired** in favour of one PM
  render path (net delete > add). Iter 1 lands the foundation: the rebuilt bundle carries the node (proven
  by a unit test against the real artifact, and live — a living doc temporarily routed through PM showed
  `49800` as a blue non-editable figure that survived a prose edit back to `[49800](bind:metrics.mrr.latest)`),
  while the committed surface still routes living docs to `renderDoc` so the v6 HOLD gates stay green. The
  bound-figure styling rule holds either way: the resolved value carries the comp's faint-blue underline; in
  PM it is an atom node rather than a `.bound` span, but the look is identical.
- **A fresh webview per document open (the reopen-blank fix).** The doc editor reused one `IWebviewElement`
  across opens; reusing it across a hide/show cycle (close a doc, reopen it in the pooled pane) left the
  reused iframe **blank** when re-fed the ~370 KB inline ProseMirror bundle via `setHtml`. Fix: build a fresh
  webview for each input (owned by `_inputDisposables`), so it reliably loads its content — verified live
  (close → reopen now renders the editor, not a blank). The deeper optimization (stop re-inlining the bundle
  per render by serving it as a webview resource / mount-once-then-message) is the next slice; this iteration
  fixes the correctness bug with minimal, no-merge-tax code.
- **The document webview is now a persistent surface (mount-once-then-message; plan 15 iter 2).** Previously
  every re-render called `setHtml` with the whole document HTML, re-inlining the ~370 KB ProseMirror bundle
  and tearing down the live editor each time. That is invisible for the renderDoc living docs (plain HTML)
  but would make living-docs-in-PM impossible: every figure/proposal change would remount the editor and
  drop the cursor. The fix sets the shell (chrome + bundle + a delegated runtime) ONCE, then pushes only the
  dynamic body as `lwdRender` messages; the runtime preserves the live ProseMirror node across updates by
  detaching and reattaching it. This is the quiet foundation for iter 3 (render living docs in PM with live
  inline diffs) — the editor can now stay alive while its surroundings change. Design rule: the writing
  surface is mounted once and *updated*, never rebuilt; chrome is re-rendered around it, not over it.
- **Living documents can now be edited in the ProseMirror surface (plan 15 iter 3), behind an opt-in toggle.**
  On the persistent surface, a living doc gains an "Edit" toggle that switches it into the unified PM editor:
  bound figures render as the non-editable blue atom node, and source-bound blocks get a quiet left
  provenance accent. renderDoc stays the default so the HOLD gates (F4 inline diff, F6 accept/reject, G5
  gutter) keep passing while those features are ported into PM iteration by iteration. The one subtlety:
  ProseMirror only round-trips the body, so a living-doc edit re-attaches the original frontmatter
  (`withReplacedBody`) — editing prose in PM must never silently strip what makes the document *living*.
  Design rule: the unified editor rolls out incrementally and is the *default only when it is at least at
  parity* with the surface it replaces; until then it's a labelled, opt-in preview, never a silent regression.
- **Proposals + the provenance gutter are now real PM decorations, and accept/reject works in PM (plan 15
  iter 4).** The last renderDoc-only features moved onto the unified surface: a pending chat edit renders as
  an inline word-diff *in the document* (the original block hidden, the diff + Approve/Reject widget in its
  place — the same green/red markup as renderDoc, now a ProseMirror widget decoration); a generative insert is
  an all-additions widget at its anchor; every source-bound block carries a detached provenance **dot** in the
  left margin (G5 — replacing iter-3's CSS accent); and clicking a bound figure opens the source-peek **bottom
  drawer** over the full-width doc (G1, never a split). Accept routes through the existing service so there is
  one mutation/persist path (no second copy in the bundle), and the live PM body resets to disk truth after the
  change. Design rule reaffirmed: **parity before the flip.** Decoration parity is done, but the calm *chrome*
  (the persistent formatting toolbar, still wired through `execCommand`, and the Present button) is renderDoc-
  only, so the default stays renderDoc this iteration; the flip + renderDoc retirement waits until the toolbar
  (via `LWDPM.cmd`) and Present live in PM too — a half-flip that drops the toolbar would be a calm-shell
  regression, not progress.
- **The flip: ProseMirror is now THE editor, and `renderDoc` is gone (plan 15 iter 5 — U1).** The last two
  blockers were chrome, not features: the calm formatting toolbar was wired through `document.execCommand`
  (which PM ignores) and the Present button was gated to the rendered mode. Iter 5 rewired the `.etoolbar` to
  the bundle's `LWDPM.cmd(view, name)` (heading `<select>` → `paragraph`/`h1`/`h2`/`h3`, B/I, list/ordered/
  quote — all pre-existing COMMANDS, **no bundle rebuild needed**), showed the toolbar + Present in PM, then
  **flipped the default to `pm` for every document and deleted the `renderDoc` HTML body** (and
  `renderBoundParagraph`, `gutterCell`, `renderInsertProposal`, `inlineDiff`, `renderBlockMarkdown`,
  `renderSourcePeekLayout`, plus the dead grid/gutter CSS). The `'rendered'` view mode is retired entirely —
  PM is the one surface; `raw` (a Markdown textarea, reached from the "Edit raw Markdown" hint) is the only
  alternative, and the export path (`renderExportHtml`/`renderExportMarkdown`, which never went through
  `renderDoc`) is untouched. Net: **−176 lines** in `livingDocRender.ts` (+59/−235) — delete > add, as U1
  requires. **Underline was dropped** (Tom's call): Markdown / the commonmark schema has no underline mark, so
  a `U` button would be faking a format that can't round-trip — calm by subtraction. Tier: **our-surface, 0
  core patches** (merge-tax ledger unchanged — target met). Design rule realised: there is now exactly one
  writing surface for every `.md`, plain or living; the calm chrome (topbar, formatting toolbar, sync bar,
  source drawer, Present) is layered *around* the live ProseMirror node, never a second renderer. Verified
  live end-to-end on the flipped default — web (code-web + OpenRouter): a living doc opens straight into PM
  with the calm toolbar + Present; the toolbar formats the live doc (paragraph⇄H2 via `cmd`); the bound figure
  is a non-editable node that opens the source-peek drawer (U2/G1/G5); a chat edit renders the inline diff in
  the doc → Approve persists + clears (U3/F4/F5/F6); raw round-trips (frontmatter + `[…](bind:…)` intact); and
  desktop (`code.sh`, **real disk**, decision 38): the same doc opens in PM and a typed edit persisted to the
  real `Weekly Summary.md` on disk (re-read confirmed). The 6 design gates hold; no living-docs console errors.
- **Chat on every document — F7 closed (plan 15 iter 6, decision 48).** The last F-gate (the whole chat
  loop from a *freshly created* doc) was blocked only by an `isLiving` guard on chat, left over from when a
  bespoke renderer (not PM) drove living docs. With PM now the one surface (iter 5), that guard is the only
  thing standing between a plain `.md` and the agent. Iter 6 drops it in exactly two places — `sendChatMessage`
  (the `!state.doc.isLiving` clause becomes just `!state`, so any *open* doc can chat) and the rail's
  `_activeDoc()` (which decided whether the Chat/Review surface attaches). "Living" is now purely a
  data-binding **badge** (decision 39/48), never a chat gate. Crucially, the **data affordances stay tied to
  real bindings**: `getSkillReport`/`applySkillFix` (the Financial/Formatting/Strategy agents),
  `_recomputeFreshness`/the sync bar, the bound-figure highlight + source-peek, and the `@mention` source
  chips all remain `isLiving`-gated — a plain doc gets the chat loop and nothing it has no data for. The chat
  proposal → in-PM inline diff → accept/persist path was already doc-agnostic (`getPendingForDoc`,
  `renderPmDeco`, `approve`/`_persist` never checked `isLiving`), so no other code moved — the change is a
  pure gate removal. Tier: **our-surface, 0 core patches** (merge-tax ledger unchanged — target still met).
  Verified live end-to-end: web (code-web + OpenRouter) — a brand-new folder + doc created via the native
  Explorer opens in PM as "Markdown"; the Chat composer is live on it; "generate a top-10 list" → inline
  all-additions diff in the PM doc + a synced rail card → accept renders the list + clears the card; a
  follow-up "rewrite … to focus on enterprise sales" → word-level diff → accept; the doc **stays plain**
  (crumb "Markdown", isLiving false) through both accepts. HOLD re-verified on the same gate: an existing
  living doc still opens in PM with figures + calm toolbar + `@mention` chips, and a chat edit there still
  reads its sources, renders the diff, and persists on accept (F1–F6). Desktop (`code.sh`, **real disk**,
  decision 38, `TMPDIR=/tmp`): a freshly-created `Notes.md` + an accepted chat insert were **re-read from real
  disk** carrying the generated list (with a `Notes.lock.json` sidecar; `serializeLivingDoc` adds a minimal
  `title:` frontmatter on first persist but no `sources:`/`context:`, so the doc stays plain). All 6 design
  gates hold; no living-docs console errors.

---

## D8 — (plan 16) The Calm Surface loop: make it a document tool, not VS Code in a costume

Plan 16 ([plans/16-calm-surface-loop.md](plans/16-calm-surface-loop.md)) is the first loop whose target is
the user's **first impression** rather than a capability gate. It runs overnight, autonomously, across a stack
of PRs off `main`, and — unlike plan 15's "0 core patches" target — **core patches are permitted** (you can't
suppress the workbench shell contrib-only). The discipline shifts to "minimal and logged", not "zero". This is
the **merge-tax ledger** for the loop: one entry per iteration, recording the tier (additive-contribution /
our-surface / core-patch) and, for any core patch, the file + why a contrib-only route didn't exist.

- **Iter 1 — strip the workbench shell. Tier: additive-contribution, 0 core patches (ledger unchanged).**
  The four IDE tells Tom called out — the **status-bar footer**, the **activity-bar icon column**, the
  **editor tab strip**, and the **breadcrumb** — are each governed by a real, user-overridable setting, so
  they are turned off as **product defaults** via one `registerDefaultConfigurations` call in
  `livingDocs.contribution.ts` (`workbench.statusBar.visible:false`, `workbench.activityBar.location:'hidden'`,
  `workbench.editor.showTabs:'none'`, `breadcrumbs.enabled:false`). No shared workbench part was patched —
  this is the same registry API a built-in uses (cf. `remoteExplorer.ts:317`), so it is an additive
  contribution and the merge-tax target survives the very first iteration despite core patches being allowed.
  Trade-off logged in decision 54: hiding the activity bar also retires the v3 labelled icon-nav; Home (the
  startup screen) + the command palette carry Templates/Knowledge/Agents, and the Workspace tree-rail / native
  Explorer is the single sidebar. Desktop **title bar** (OS window controls) intentionally kept. Verified live
  web + desktop (no status bar / activity bar / tabs / breadcrumb); HOLD re-verified (PM editor, bound figure,
  chat → inline diff → rail card). _The desktop cold-launch still shows the Restricted-Mode banner + Sign-In +
  welcome walkthroughs — those are iteration 2._

- **Iter 2 — kill the cold-launch noise + trust leaks. Tier: additive-contribution + 1 core patch.**
  Four of the five fixes are real settings, registered as product defaults in the same
  `registerDefaultConfigurations` block (still additive, 0 core patches): `security.workspace.trust.enabled:false`
  (Restricted-Mode banner), `workbench.welcomePage.experimentalOnboarding:false` (the "Welcome / Sign in to use
  Copilot" modal + the "Make It Yours" walkthrough — both onboarding steps gated by this flag),
  `workbench.startupEditor:'none'` (welcome page), `chat.disableAIFeatures:true` (the built-in **Copilot** chrome
  — Sign-In button + Copilot status; the product's own Review-rail chat is a separate contribution and is
  unaffected), and `window.title:'${activeEditorShort}'` (drop the `${rootName} [remote]` label).
  **The one core patch** (this loop's first ledger entry):
  `src/vs/workbench/api/browser/mainThreadExtensionService.ts` `$onExtensionActivationError` (~`:102`) — the
  "Activating extension 'vscode.X' failed: Not Found" toasts are **dev-build-only** (the `isDev` branch; a built
  product just `console.error`s) and come from built-in `vscode.*` extensions this slim build doesn't ship.
  Guarded the toast with `&& !extensionId.value.startsWith('vscode.')` so built-in activation failures log
  instead of toasting; user/third-party errors still toast in dev. **Why no contrib-only route:** this is a
  hard-coded `notificationService.error` call inside a `$`-RPC handler on `MainThreadExtensionService` — no
  contribution seam, event, or setting exists on this path. Minimal (one boolean + a comment) and fail-soft (a
  missed case just shows a toast, never breaks activation). Re-pin on rebase if the handler is refactored.
  Verified live on a desktop cold launch: zero toasts / banner / sign-in / onboarding / Copilot chrome; HOLD
  green (PM doc + bound figure + the product chat -> inline diff -> rail card, with `disableAIFeatures` on).

- **Iter 3 — document-first on-ramp. Tier: our-surface, 0 core patches.** Three our-surface changes, no core
  patch: (1) `NEW_DOCUMENT_TEMPLATE` (`livingDocsService.ts`) goes from a `title:`-frontmatter + "## Overview"
  boilerplate to a single newline, so a new doc opens as a **blank writing surface**; (2) `focusPm` in the
  `livingDocRender` runtime calls `pmView.focus()` on mount (once — decision 50 mount-once); (3) a
  `LivingDocEditor.focus()` override forwards pane focus into the webview iframe so the in-iframe focus lands.
  Verified on a **desktop real-disk smoke**: the create path writes clean blank Markdown to disk (no `title:`),
  and typed content persists as clean plain Markdown. HOLD green (living doc still opens in PM with toolbar +
  figure). _Flagged for iter 6: the formatting toolbar is absent on blank plain docs (pre-existing)._
