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
| 2 | Tables | — | — | — |
| 3 | Images | — | — | — |
| 4 | Lists & structure | — | — | — |
| 5 | Undo/redo | — | — | — |
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
