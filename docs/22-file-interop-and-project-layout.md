# 22 - File interop and project layout: import, export, spreadsheets, folder conventions

The spec for the P1/P2 "real-folder reality" work prioritised in
[21-beta-v1-prioritization.md](21-beta-v1-prioritization.md) §4-5. Governing principles: the folder
is the project (decision #39), Markdown + lock is the canonical format (Option 10,
[08-living-documents-format-spec.md](08-living-documents-format-spec.md)), files on disk the user
owns (P6, [16-principles.md](16-principles.md)), everything lands through the review grammar (P3),
and Abstract never fabricates what it cannot do (plan 33 L8 - the discipline that kept docx export
an honest "SOON" instead of a broken button).

## 1. The stance in one paragraph

**Markdown is canonical; every other format converts at the boundary.** Foreign formats are either
**imported** (docx → a real `.md` the agent can work on), treated as **read-only sources** (PDF,
xlsx - they feed context and bindings but are never the editing surface), or **exported to** (docx,
PDF, HTML, Markdown). We do not become a Word editor, a PDF editor, or a spreadsheet. The original
file is never destroyed by any conversion.

## 2. Import: docx → Markdown

Builds on F10 (plan 37): docx files already must appear in the tree marked "not yet imported" with
a reason. This spec turns that marker into a door.

### The flow

1. In the tree/SOURCES list, a `.docx` file shows **Import as document**. (Also offered in bulk from
   the first-run orientation: "I found 4 Word documents - import them?" - the 2b moment.)
2. Conversion produces `Same Name.md` **beside the original**; the original stays on disk untouched
   and is listed as the import's source in the new doc's lock (`importedFrom`, with `sourceHash`) -
   provenance from birth.
3. Embedded images are extracted to `assets/<doc-name>/` and referenced relatively.
4. The imported doc opens in the editor; a plain-words summary card states what was kept and what
   was dropped ("Headings, lists, tables, 3 images kept · comments and tracked changes not
   imported"). Honesty over silent lossiness.
5. Once imported, the original is a candidate for `archive/originals/` via the Tidy verb (§5) -
   proposed, never automatic.

### Fidelity floor (beta)

- **Kept:** headings, paragraphs, bold/italic, lists (nested), hyperlinks, tables (GFM pipe tables),
  images, block quotes.
- **Named and dropped:** comments, tracked changes (import the *final* text; say so), footnotes
  (inline them or drop with a note), text boxes, headers/footers, embedded objects.
- **Refused with a reason (F10 state, never a mangle):** legacy `.doc`, password-protected files,
  files that fail to parse. "Not yet imported - {reason}" stays the fallback.

### Implementation note

Prefer a pure-JS pipeline in the proxy/node layer (e.g. **mammoth** for docx → semantic HTML, then
HTML → Markdown), avoiding a bundled pandoc binary for beta. Conversion runs where file access
lives, never in the renderer. If pandoc is later justified (better tables/footnotes), it slots
behind the same flow unchanged.

## 3. Export: docx and PDF join HTML and Markdown

The Present & export modal already has honest `docx`/`xlsx`/`gdoc`/`gsheet` "SOON" rows. Beta
unstubs **docx** and adds **PDF**; Google formats and xlsx export stay "SOON" (P3).

- **docx:** clean export of the rendered document - headings, lists, tables, images, bound values
  inlined as plain text (like the Markdown export flattens `bind:` links). Styles map to Word's
  built-in styles so the receiving organisation can restyle. No Abstract chrome, dots, or diff UI.
- **PDF:** render the existing self-contained HTML export through the desktop build's print-to-PDF
  (the desktop is the beta vehicle, [14](14-product-strategy.md) §6). Cheapest correct path; no new
  render engine.
- **The before-export gate applies unchanged** (plan 32): unreconciled figures surface the reason
  and swap the CTA for "Export anyway" (audited) / "Fix first". This is the wedge showing up at the
  exit door - the exported artifact is the trust story ([14](14-product-strategy.md) §1).
- Exports write beside the document, like today. No fabricated hosting.

## 4. Spreadsheets: the numbers answer

**Question asked:** manage numbers from an Excel file - CSV, a database, or other?

**Answer: CSV, not a database.** Decided 12 Jul 2026:

- The whole binding/provenance engine already speaks CSV (`file` sources with `sourceHash` +
  `syncedAt`; the 1p drawer opens on the exact row). A database adds an alien mental model to the
  exact audience we promised none (P5), breaks files-on-disk portability (P6), and is invisible to
  the user's own tools.
- CSV is plain text: diffable, hashable, emailable, and exactly what the lock's staleness machinery
  (hash compare → dirty flag) was built on ([08](08-living-documents-format-spec.md) §3.4).

**xlsx at the boundary:** users will point at workbooks, not CSVs. The flow:

1. An `.xlsx` in the folder appears in SOURCES (F9) with **Use as source**.
2. Accepting extracts each sheet to `data/<workbook-name>/<sheet-name>.csv`. The workbook stays on
   disk, **watched**: when its `sourceHash` changes, sheets re-extract and the normal staleness
   machinery flags dependent docs - the workbook behaves like any live source.
3. Bindings point at the extracted CSVs (`bind:` keys unchanged in shape). The provenance drawer
   shows the chain: figure → CSV row → extracted from `Budget.xlsx · Sheet "FY26"` → synced-at.
4. **Parsing floor** (the Excel realities from doc 21 §6.5): delimiter sniffing (`,` vs `;`),
   BOM/Windows-1252 tolerance, currency/thousands-separator/parenthesised-negative number parsing,
   dates normalised on extraction. Merged headers and pivots are *named* limitations ("this sheet
   has merged headers - values may misalign"), not silent misreads.

**Deferred (P3):** direct cell-level xlsx binding (`bind:workbook.sheet.B7`), formula awareness,
Google Sheets (arrives with the gsheet connector, not before), and any SQLite/db layer - revisit
only if a real dataset outgrows CSV, which no beta user's weekly pack will.

**PDF as a source (P1, read-only):** text extracted at import for context/knowledge (a `context`
edge in the lock, not value bindings - PDFs feed *framing*, tables in PDFs are chapter-2). Listed
in SOURCES with freshness like any file. Never converted to an editable doc in beta; a
scanned/image-only PDF names itself unreadable rather than yielding empty context.

## 5. Folder conventions and the Tidy verb

**Question asked:** meaningful subfolders (`data/`, `archive/`, `working-files/`) to keep the main
project clean as things outdate.

**The convention (soft, never enforced):**

```
my-project/
  Weekly Summary.md            ← documents live at the root (or wherever the user puts them)
  Weekly Summary.lock.json     ← beside its doc (Option 10); hidden in our tree, shown on ask
  templates/                   ← *.template.md (the plan-28 convention, already real)
  data/                        ← sources: CSVs, extracted workbook sheets, the watched .xlsx
  assets/                      ← images extracted on import, referenced relatively
  working-files/               ← drafts, scratch, thinking docs
  archive/                     ← superseded docs; archive/originals/ for imported docx
  .abstract/                   ← hidden app home (decision 156) - see below
```

**The `.abstract/` folder (decision 156):** the hidden, in-project home for everything the app
needs to store that is not a user document or a user data file:

```
.abstract/
  config.json                  ← project settings (autonomy defaults, model prefs)
  skills/                      ← the default thinking-skills pack + wizard-grown skills (skill.md)
  knowledge/                   ← Knowledge-library metadata & source caches (the data itself stays in data/)
  runs/                        ← agent run log (feeds WHILE YOU WERE AWAY, 1w)
  index/                       ← discovery/search indexes and derived caches (always rebuildable)
```

Boundaries that hold the portability principle (P6):
- Everything inside is a **plain, portable file** - a skill.md found in `.abstract/skills/` is
  readable and editable by a human or another tool; nothing binary, nothing proprietary.
- **Locks stay beside their documents** (Option 10 spec of record) - lock-follows-file rename/move
  semantics and provenance-visible-to-external-tools both depend on it. Relocating locks into
  `.abstract/` is a greenfield revisit, not a beta change.
- `templates/` stays visible: users author templates directly (plan 28); hiding them breaks that.
- **Secrets never live here** (they are proxy-side in `~/.abstract/`, D29-C) - the project folder
  must always be safe to zip and send.
- Caches/indexes are rebuildable; deleting `.abstract/` must degrade gracefully (skills pack
  re-seeded, knowledge re-derived from locks, runs history lost with a plain-words note).

New projects are born with the empty conventional folders absent (no ceremony) - except
`.abstract/`, which is created on first agentic use (skills pack seeding); the **Tidy verb**
creates the visible conventions as it needs them.

**The Tidy verb (P2, requires F16):** "Tidy this project" in the project chat / Home. The agent
*proposes* a move plan through the review grammar - "move 6 outdated drafts to `archive/`, 3 CSVs
to `data/`" - each move a reviewable item, applied only on approve. Hard requirements:

- **Moves are atomic on the lock** (file + sidecar together or neither - the 1d/F16 semantics),
  with Undo.
- **Bindings survive:** every lock whose `source` path points at a moved file is updated in the
  same atomic operation; the dependency graph (reverse edges) is the work list. A move that would
  orphan bindings is warned exactly like a D6 delete (warn, list dependents, proceed = graceful,
  never block).
- **Outdated is proposed, not assumed:** staleness signals (superseded-by-newer-version name
  patterns, no edits in N weeks, no inbound references) justify a *suggestion* with a stated
  reason; the human decides. No file ever moves silently.
- External tools remain first-class citizens of the folder (P6): the conventions must read as an
  obviously-sensible folder to someone who never opens Abstract.

## 6. Acceptance criteria

Import (docx):
- [ ] A `.docx` in the tree offers Import; conversion writes `Name.md` beside the untouched original with `importedFrom` provenance in the lock.
- [ ] Images land in `assets/<doc>/` with relative references.
- [ ] A kept/dropped summary card is shown; tracked changes import final text and say so.
- [ ] `.doc`, password-protected, and unparseable files stay in the F10 "not yet imported - {reason}" state; nothing mangles silently.

Export:
- [ ] docx export produces a Word file with headings/lists/tables/images mapped to built-in styles, bound values inlined, no Abstract chrome.
- [ ] PDF export ships via desktop print-to-PDF of the HTML export.
- [ ] The before-export reconcile gate applies to both; "Export anyway" is audited.
- [ ] gdoc/gsheet/xlsx remain honest "SOON" rows.

Spreadsheets:
- [ ] An `.xlsx` offers "Use as source"; sheets extract to `data/<workbook>/<sheet>.csv`; the workbook is watched and re-extracts on hash change, flagging dependents.
- [ ] The provenance drawer shows figure → CSV row → workbook chain.
- [ ] Delimiter/encoding/number-format parsing floor holds against the doc 21 §6.5 realities; merged-header sheets warn rather than misalign.
- [ ] PDF sources contribute extracted text as context edges, appear in SOURCES with freshness, and name themselves unreadable when image-only.

Layout & Tidy:
- [ ] Lock files are hidden in the Abstract tree.
- [ ] `.abstract/` exists (hidden in the tree), holds skills/knowledge-metadata/runs/config/index as plain files, is created on first agentic use, and deleting it degrades gracefully (rebuildable caches, re-seeded skills pack, plain-words note for lost run history).
- [ ] Tidy proposes moves through the review grammar; nothing moves without approve.
- [ ] Moves are atomic (doc + lock), update all dependent locks' source paths, warn on would-orphan, and offer Undo.
- [ ] A tidied project remains legible in Finder/Explorer to a non-Abstract user.
