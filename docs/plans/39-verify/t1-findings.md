# Plan 39 — T1 editor-fundamentals audit: findings

Audit of the eight editor areas from `docs/plans/39-t1-editor-audit-loop.md`.
Grades: **PASS / DEGRADED / FAIL / UNTESTABLE** (+ gating vs polish triage in the
verdict section). Audit only — no product fixes were made in this loop.

## Environment preamble (read before the grades)

- Date: 2026-07-12. Linux container (remote Claude Code session), branch
  `39-t1-editor-audit` from `main` @ `93b875ba`.
- **The Electron desktop build is not buildable in this environment**: the
  session's network policy returns 403 for `electronjs.org` (Electron headers
  and binary downloads), so `npm ci` cannot produce a desktop build. The beta
  target is desktop (decision 162); this audit therefore runs against the
  **web build** (`@vscode/test-web` serving the same compiled workbench
  sources), which shares the whole editor surface — the vendored-ProseMirror
  webview (`docs/06-design-notes.md` D7), `livingDocRender.ts`, and
  `livingDocsService.ts` are identical code in both builds. Where a probe's
  result could differ on desktop (file-system persistence, native clipboard,
  native find), that caveat is stated inline on the finding, per the plan's
  fallback rule.
- Known web-build environment limits inherited from plan 34
  (`docs/plans/34-verify/environment.md`, `x1-desktop-check.md`): disk writes
  go through an in-memory File System Access provider, so "survives reload"
  probes are graded on the desktop-verified persist path plus in-session
  evidence, and say so.
- **Word clipboard payloads are synthesised** (real Word capture is impossible
  in a Linux container without Office): `docs/plans/39-verify/fixtures/`
  carries `text/html` payloads in Word's real clipboard shape (mso styles,
  `<o:p>`, `MsoListParagraphCxSp*` conditional-comment lists, `MsoTableGrid`,
  smart-quote entities, `msoIns`/`msoDel` tracked-change residue). See
  `fixtures/README.md`.
- Native modules were built against node (not Electron) headers — irrelevant
  to the audited surface (the editor webview is pure browser code).
- Driver: Playwright over the pre-installed Chromium
  (`/opt/pw-browsers/chromium`), dispatching real `ClipboardEvent('paste')` /
  keyboard events inside the editor webview frame.

## Grade table (filled as iterations complete)

| # | Area | Grade | Gating / polish | One-line user impact |
|---|---|---|---|---|
| 1 | Paste from Word | **FAIL** | **gating** (T1-A, T1-B, T1-C) | Pasting your Word report keeps the words but destroys every table and bullet list, and can splice deleted tracked-changes text back into your sentences |
| 2 | Tables | **FAIL** | **gating** (T1-D) | Your table displays beautifully but you cannot edit a cell or add a row — and clicking a cell then typing deletes the whole table |
| 3 | Images | **FAIL** | **gating** (T1-E) | Pasting or dragging a screenshot into your doc does nothing at all — no image, no error |
| 4 | Lists & structure | **PASS** | — | Bullets, numbering, nesting and heading conversion all behave the way a Word person expects |
| 5 | Undo/redo | **DEGRADED** | **gating** (T1-F, confirms known F6) | Ctrl+Z is reliable while you edit — but the moment you approve a change, undo goes dead: even your own earlier typing can no longer be undone |
| 6 | Find & replace | — | — | — |
| 7 | Selection & cursor | — | — | — |
| 8 | Long-doc ergonomics | — | — | — |

---

## Iteration 0 — build, launch, fixtures, harness

- **Build**: `npm ci` fails as shipped in this environment (Electron headers
  403 — see preamble). Recovered with: deps installed `--ignore-scripts`
  against node headers, system ripgrep copied into `@vscode/ripgrep/bin`,
  per-extension installs, then `npm run gulp compile` → clean compile in
  1.22 min. No product source was changed.
- **Launch**: `./scripts/code-web.sh <scratch-workspace>` → HTTP 200 on
  :8080 in 9 s. Scratch workspace = copy of `living-docs-sample` +
  `Probe.md` + `Longdoc.md` (the 10k-word fixture).
- **First-run shell observation** (context, not a grade): with no model
  connected the app opens directly on Settings → "Model access"
  (`shots/00-workbench.png`); the Workspace tree rail lists all docs and
  opens them fine without a model (`shots/00-tree-rail.png`). The audit
  needs no model — every probe is editor-local.
- **Fixtures**: `fixtures/` — synthesised Word `text/html` clipboard
  payloads (see fixtures/README.md for the honesty note), plain-text
  payload, 10k-word doc (10,271 words / 43 sections).
- **Harness smoke-check (PASS)**: Playwright (headless Chromium) →
  workbench → open "Probe" from the tree rail → located the ProseMirror
  webview frame → dispatched `ClipboardEvent('paste')` with
  `<p>smoke <b>bold</b> paste</p>` → read back through the bundle's own
  serializer (`LWDPM.toMarkdown(pmView)`):
  `# smoke **bold** pasteProbe` — paste path live, bold preserved as
  `**bold**`. (The heading-merge artefact is because the caret sat at
  offset 0 of the H1; probes from iteration 1 place the caret deliberately.)

---

## Iteration 1 — Area 1: Paste from Word — **FAIL (gating)**

All probes dispatched the synthesised Word `text/html` clipboard payloads
(fixtures/) as real `ClipboardEvent('paste')` into the live ProseMirror
surface, and read the document back through the editor's own serializer
(`LWDPM.toMarkdown`). Evidence: `shots/01-paste-word-report.png`,
`shots/01-paste-word-report-fresh.png`, `shots/01-paste-into-list.png`,
plus the serialized-markdown transcripts below.

### What survives (the good half)

| Probe | Result |
|---|---|
| Heading (`<h1>` pasted at a fresh block) | PASS — becomes `# Q3 Weekly Report` |
| Bold / italic / hyperlink | PASS — `**$49,800**`, `*12 per cent*`, `[dashboard](https://example.com/dashboard)` |
| Smart quotes / em-dash / nbsp entities | PASS — kept as the typographic characters (`“momentum is steady.”`, `—`) |
| mso- junk / `<o:p>` / conditional comments | PASS — none leak into the document text |
| Inline image (data URI) | PASS — becomes a markdown image, renders |
| Plain-text-only paste | PASS — both lines land as paragraphs |
| Paste over a selection | PASS — selection replaced cleanly, formatting of pasted content kept |
| Paste into a list item | PASS-ish — text lands inside the item, sibling items intact (a leading space is collapsed — HTML whitespace, minor) |

### What breaks (the gating half)

**T1-A — Word bullet/numbered lists flatten to junk-glyph paragraphs.**
Word's clipboard HTML does not use `<ul>/<li>` — list items are
`<p class=MsoListParagraphCxSp*>` with the bullet glyph inside a
`mso-list:Ignore` span. The editor has no Word-list normaliser, so a 2-level
bullet list pastes as four flat paragraphs with literal glyph characters:

```
·       Pipeline grew in EMEA

o       Two new enterprise logos
```

Not a list (no `-`/`*` markdown, no nesting, glyph + nbsp runs kept as text).
User impact: *pasting your weekly report turns every bullet list into junk
lines you must retype.* Silent-structure-loss / mangled-paste class → gating.

**T1-B — Word tables are silently destroyed.** The editor schema
(commonmark + `bound_figure`; `docs/lwd-pm-bundle-build.md`) has **no table
nodes**, so ProseMirror's paste parser hoists every `<td>`'s content out as
a separate paragraph. The fixture's 6-row `MsoTableGrid` with a merged
header pasted as a vertical run of 20 one-line paragraphs
(`**Region & Segment**` / `**Revenue**` / … / `AMER` / `Enterprise` /
`$21,300` / …). No cells, no rows, no grid — and nothing tells the user the
table was dropped. User impact: *pasting your report loses the table; the
numbers survive as a meaningless vertical list.* Silent-content/structure
loss → gating, and it also caps Area 2 (tables) below.

**T1-C — Tracked-changes residue pastes BOTH deleted and inserted text.**
The fixture carries Word's `msoDel`/`msoIns` spans
(`revised down` struck-through + `held flat` underlined). The strike/underline
styling is dropped and both runs are concatenated into the sentence:

```
The forecast was revised downheld flat after the review; final wording pending.
```

User impact: *if your Word doc still has tracked changes, pasting splices the
deleted wording back into the sentence with no visual warning.* Silent content
corruption → gating (narrower than T1-A/T1-B but the same trust class).

**Minor (polish):** Word's empty spacer paragraphs (`<o:p>&nbsp;</o:p>`)
paste as stray blank paragraphs containing a non-breaking space.

### Grade: FAIL — gating

Inline fidelity is genuinely good (better than feared: no mso junk, real
marks, smart quotes intact), but the two structures a Word person pastes
most — bullet lists and tables — are both destroyed silently, and
tracked-changes residue corrupts sentences. Per P10 this is exactly the
paste-fidelity class that gates the beta.

Desktop caveat: none — the paste path (ProseMirror clipboard parser +
commonmark schema) is identical webview code in web and Electron builds;
these results are build-independent.

---

## Iteration 2 — Area 2: Tables — **FAIL (gating)**

Probed with a 3×3 GFM table set as the document body, driven in the live
editor. Evidence: `shots/02-gfm-table-render.png`,
`shots/02-table-selected.png`, `shots/02-table-wiped-by-typing.png`,
`shots/02-table-undo-restored.png`.

### Render fidelity — PASS (genuinely good)

A GFM pipe table renders as a real styled table (header row, borders,
`:---:` alignment honoured, inline markdown inside cells). Since the
plan-15 bundle doc was written, the vendored bundle gained a `table_block`
node: markdown-it's `table` rule is enabled, the raw pipe text is held in a
`markdown` attr, `toDOM` renders a static `<table class="lwd-table"
data-md="…" contenteditable="false">`, and the serializer writes the attr
back verbatim — so tables round-trip to disk losslessly.

### Editing — absent, and destructively surprising (T1-D)

The node is `atom:true, isolating:true, contenteditable=false`:

- **Cell editing: absent.** Clicking a cell does not place a caret — it
  node-selects the whole table (verified:
  `selection.node.type = table_block` after clicking the `$21,300` cell).
- **Tab between cells: absent.** Tab moves focus out of the editor.
- **Add/delete row/column: absent.** The toolbar has no table commands
  (`bold/italic/bullet_list/ordered_list/blockquote` + heading select only);
  no context menu, no cell affordances. Absence is the finding, not a crash.
- **The trap: click a cell, then type — the whole table is replaced by the
  typed character.** Click selects the atom; typing over a node-selection
  replaces it (standard ProseMirror), so the doc went from a 3×3 table to
  the literal text `X`. Single-step undo does restore the table
  (`02-table-undo-restored.png`). For the Word persona — "edit a cell, add
  a row" is THE table journey — this is a one-keystroke silent table wipe.
- Editing a table therefore requires editing the `.md` file outside the
  product (or asking the model via chat). No in-editor path exists.

### Grade: FAIL — gating (T1-D: no table editing + one-keystroke table wipe)

User impact: *your board pack's table shows up perfectly, but the moment
you try to fix one number in it you either can't (no caret) or you destroy
the table (typing replaces it).* With T1-B (pasted Word tables never become
tables at all), table support is display-only end to end.

Desktop caveat: none — identical webview code in both builds.

---

## Iteration 3 — Area 3: Images — **FAIL (gating)**

Probes dispatched real `ClipboardEvent('paste')` / `DragEvent('drop')` with
an actual PNG `File` in the `DataTransfer`, plus HTML-embedded and
relative-path image probes. Evidence: `shots/03-image-datauri.png`,
`shots/03-image-relative.png` + transcripts.

| Probe | Result |
|---|---|
| **Paste an image file** (the "Ctrl+V a screenshot" case) | **FAIL — silent no-op.** File present in the clipboard (`files.length = 1`), document unchanged, no image, no message. There is no `handlePaste`/file handler in the editor bundle and no asset-write path in the service (images exist only as chat-context attachments). |
| **Drag-drop an image file** | **FAIL — silent no-op.** Same: `drop` with a PNG file changes nothing. |
| Image arriving inside pasted HTML as a data URI (Word's inline-image shape) | PASS-ish — inserts a commonmark `image` node, renders, serializes as `![chart](data:image/png;base64,…)`. But the whole image is base64 inside the `.md` body — no asset file on disk, no relative path; a large screenshot would balloon the document. |
| Relative-path image already in the doc (`![logo](logo.png)`, file exists in the workspace) | **FAIL (web build) — does not render.** The webview resolves it against its own `/static/sources/` base and the load fails (`naturalWidth = 0`, broken-image placeholder). *Desktop caveat: resolution could differ in the Electron webview — untested here (environment: no desktop build); on the web build it is broken.* |
| Persistence of the data-URI image | The image markdown is in the body that `pmEdit` saves (300 ms debounce observed, chip → "Saving…"); body persistence itself is the X1-verified desktop path. No separate asset file exists to persist. |

### Grade: FAIL — gating (T1-E: no image paste/drop at all)

P10 names images as one of the three "Word-grade" fundamentals. The two
actions a Word/Docs person actually does — paste a screenshot, drag a
picture in — are both silent no-ops, and there is no insert-image
affordance anywhere in the editor UI as a workaround (the only way an image
can enter a doc is embedded in pasted HTML, or by hand-editing the file
outside the product). Silent no-op on user content → gating.


---

## Iteration 4 — Area 4: Lists & structure — **PASS**

Live keyboard probes in the editor (evidence: `shots/04-lists-final.png` +
serialized transcripts inline):

| Probe | Result |
|---|---|
| Enter mid-list-item | PASS — splits into a new sibling item (`alpha / inserted / beta`) |
| Tab on an item | PASS — nests under the previous item (`  * inserted`) |
| Shift-Tab | PASS — lifts back to top level |
| Enter twice on an empty item | PASS — exits the list into a paragraph (the Word reflex) |
| Mixed nesting (ordered inside bullet) | PASS — round-trips exactly; Enter inside the nested ordered list inserts `2.` and renumbers `two` → `3.` |
| Heading conversion (toolbar select) | PASS — paragraph → `## h2` and back, no text loss |
| Toolbar "Bulleted list" on a paragraph | PASS — wraps as a list item |
| Edit ONE item of a 4-item list, siblings intact (PM surface) | PASS — `edit-me EDITED`, all three `keep-*` siblings byte-identical |
| **Decision-68 regression (the list-sibling data-loss class, fixed in plan 31)** | PASS — ran the shipped unit suite in the real browser runner: `node test/unit/browser/index.js --browser chromium --grep "LivingDoc bind-link format"` → **62 passing**, including "applyBlockEdit splices ONE item and leaves siblings byte-identical (the data-loss repro)" and the fail-soft guard test |

### Grade: PASS

List editing is genuinely Word-grade: the enter/tab muscle memory works,
nesting round-trips, and the decision-68 data-loss class stays fixed at
both the unit and the live-surface level. (The list *paste* failure from
Word lives in Area 1 / T1-A, not here.)

---

## Iteration 5 — Area 5: Undo/redo — **DEGRADED (gating; confirms known gap F6, with a sharper mechanism)**

Basics probed live with keyboard events; the approve-boundary probe used a
**canned local model proxy** (a scratchpad-only test seam speaking the
proxy's Anthropic-shaped SSE protocol on :8090 — no product code touched)
so a real chat proposal → real approve could run in this model-less
environment. Evidence: `shots/05-heuristic-proposal.png`,
`shots/05-approved.png`, `shots/05-undo-after-approve.png`,
`shots/05-history-wiped-after-approve.png`.

### The good half — everyday undo is solid

| Probe | Result |
|---|---|
| Undo typing | PASS |
| Redo via Ctrl+Y **and** Ctrl+Shift+Z | PASS (both bound) |
| Undo a full Word-report paste in ONE step | PASS — single Ctrl+Z removes the whole paste cleanly |
| Undo a list restructure (Tab nest) | PASS — restores the flat list |
| Undo typing-over-a-node-selection (table wipe from Area 2) | PASS — single undo restores the table |

### The gating half — approve kills the undo stack (T1-F)

Sequence run live: user types ` USERTYPED` (verified undoable + redoable)
→ chat proposes an edit → **Approve** → the edit applies. Then:

- **Ctrl+Z does not undo the approve** (the F6 statement, confirmed — the
  doc is byte-identical after Ctrl+Z).
- **Worse: Ctrl+Z no longer undoes ANYTHING** — the user's own
  pre-approve typing, which was undoable seconds earlier, is now
  permanently baked in. The undo stack is empty.

Mechanism (code-confirmed in the vendored bundle): a model-driven body
change re-renders through `LWDPM.setDoc`, which builds a **fresh
`EditorState` with fresh plugins** — including a brand-new, empty
`history()` plugin state. Every approve/reject/refresh that resets the PM
body erases the whole session's undo history.

Mitigation that exists: the History tab / snapshots (plan 26) can restore
named versions, so approved-over work is not unrecoverable — but that is
not the Ctrl+Z muscle-memory P8 promises ("undo works everywhere,
including across approves"), and it does nothing for the wiped typing
history.

### Grade: DEGRADED — gating

Everyday undo is dependable (better than the FRAGILE the journey map
feared), but the P8 promise breaks exactly at the product's signature
moment (the approve), and it breaks *wider* than F6's known statement: the
approve wipes undo for everything, not just itself. Broken-undo class →
gating. This confirms and sharpens F6 — logged as a finding, not refixed.

Desktop caveat: none — identical webview/bundle code both builds.
