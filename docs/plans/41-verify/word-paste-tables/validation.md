# Plan 41 — #138/#139 validation: live paste probes (Word/HTML tables)

Independent adversarial verification of implementation commit `3931baac`
("fix(livingDocs): paste Word/HTML tables into table_block (#138)") on branch
`claude/multi-agent-orchestration-t4s27d-word-paste`, layered on the already
merged #137/#139 paste normaliser. Verdict: **READY** — all 11 success criteria PASS.

## Environment preamble (read before the grades)

- Date 2026-07-15. Linux container (remote Claude Code session), git worktree
  `/home/user/wt-paste`, branch above @ `3931baac`, one commit ahead of
  `origin/main`. Diff scope confirmed: 3 files (2 source + 1 test), 525 +/- lines,
  no other product source touched.
- **Web build, not desktop** — same rationale as plan 39
  (`docs/plans/39-verify/t1-findings.md`): the Electron desktop build is not
  buildable in this environment (electronjs.org 403), so probes run against the
  **web build** (`@vscode/test-web` serving the same compiled workbench sources).
  The vendored-ProseMirror webview, `livingDocRender.ts` and
  `livingDocWordPaste.ts` are byte-identical code in both builds; the paste
  pipeline is pure browser code, so a web-build result transfers to desktop. The
  only desktop-only caveat (native OS clipboard) does not apply — probes inject a
  real `ClipboardEvent('paste')` carrying a `text/html` payload, exactly what the
  listener reads (`cd.getData('text/html')`), so the code path exercised is
  identical to a real Ctrl+V of Word/browser HTML.
- **Word clipboard payloads are synthesised** (real Office capture is impossible
  in a Linux container). Probe A replays the plan-39 fixture
  `docs/plans/39-verify/fixtures/word-clipboard-report.html` verbatim (real Word
  clipboard shape: `MsoTableGrid`, `<o:p>`, `MsoListParagraph` conditional-comment
  lists, smart-quote entities, `msoIns`/`msoDel` tracked-change residue). Probes
  B/C/G use hand-built payloads targeting the specific rule under test.
- Driver: Playwright over the pre-installed Chromium
  (`/opt/pw-browsers/chromium-1194`), headless. Each probe opens the `Probe` doc
  from the Workspace tree rail, locates the innermost webview frame exposing
  `window.LWDPM` + `pmView`, clears the body to an empty paragraph, dispatches the
  paste, and reads the document back through the editor's **own serializer**
  (`window.LWDPM.toMarkdown(pmView)`) — plus reads the rendered `<table>` DOM and
  captures a full-window screenshot. Transcripts: `probe-transcripts.json`.
- No product source was modified during validation. No new test files were needed
  (the implementer's 28-case suite already covers the unit surface).

## Grade table

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Word fixture table pastes as a real rendered table, not paragraphs (#138 headline) | **PASS** | `shots/01-word-report-paste.png` shows a 6-row visual grid; live DOM = 1 `<table>`, 6 rows, 24 cells; serializer emits a GFM pipe table (transcript `A.md`/`A.tables`). |
| 2 | Any plain-HTML (non-Word) table also converts | **PASS** | `shots/02-plain-html-table.png`; `B.md` = 4-row GFM table from a hand-built `<thead>/<tbody>` payload with no mso markers. |
| 3 | Merged cells degrade by the stated repeat rule; columns never misalign | **PASS** | `shots/03-merged-cells.png`: `colspan=2` "Merged Head" repeated across 2 cols, `rowspan=2` "Down" repeated down 2 rows, rectangular 3×3 (`C.md`). Fixture header `colspan=2` also repeats: `Region & Segment \| Region & Segment` (`A.md`). |
| 4 | Pipe / inline-markup / empty-cell handling; lossless GFM round-trip | **PASS** | `B.md`: header cell "Role \| Team" and body "a\|b" — pipes escaped `\|` in GFM, rendered as literal `|` in cells (screenshot 02); `<b>Lead</b>` kept as `**Lead**`. Unit suite includes real-bundle parse→serialize round-trip cases (28 passing). |
| 5 | #137 lists + inline fidelity unregressed in the same payload | **PASS** | `A.md`: Word list paragraphs rebuilt to a nested bullet list (Pipeline → Two new logos / Renewal 96% → Hiring); `**$49,800**`, `*12 per cent*`, `[dashboard](…)`, smart quotes all preserved. Screenshot 01. |
| 6 | #139 as-accepted semantics verified live (deleted dropped, inserted kept plain) | **PASS** | Ground truth from fixture line 211: `msoDel`="revised down", `msoIns`="held flat". `A.md` sentence = "The forecast was **held flat** after the review; final wording pending." — deletion dropped, insertion kept. Probe G (`shots/06`): "Status: approved today." — "rejected" (msoDel) gone, "approved" (msoIns) present as **plain** text, `hasUnderline=false`. |
| 7 | One-step undo restores pre-paste state | **PASS** | Rigorous run: paste fixture into original doc → table present → single Ctrl+Z → doc `=== ` original `"# Probe\n\nParagraph one."` byte-for-byte (`shots/04-undo-after-paste.png`). |
| 8 | Pasted tables editable via the existing #140 table-editing UI | **PASS** | Probe E: mousedown on the pasted "Lead" cell opens `input.lwd-cell-editor`; typing "Director" + Enter commits → `Ada \| Director` in the serialized GFM (`shots/05-pasted-table-editing.png`). |
| 9 | Non-Word, non-table pastes fall through untouched | **PASS** | Probe F: `<p>hello <b>bold</b></p>` → `F.md` = "hello **bold**"; listener guard `!isWordHtml && !/<table[\s>]/i` returns without intercept, native PM paste handles it. |
| 10 | typecheck-client, valid-layers-check, all three suites green (my own runs) | **PASS** | `gulp compile` 0 errors; `typecheck-client` clean; `valid-layers-check` clean; `LivingDoc Word paste` **28 passing**, `LivingDoc bind-link format` **70 passing**, `--grep "table"` **200 passing**. |
| 11 | Implementer's ASCII/hygiene claim about the pre-existing `§` | **PASS** | `livingDocRender.ts:48` carries `§` (bytes `0xC2 0xA7`) identically on `origin/main` and HEAD; the diff's added lines contain **no** non-ASCII bytes. The `--no-verify` commit is justified — the husky hook trips on pre-existing content, not new code. |

## Static / correctness review notes

- Injected-function self-containment holds: no optional chaining (`?.`), nullish
  coalescing (`??`), module refs, or TS-only runtime helpers in the added
  `rebuildPastedTables` step. The implementer's own suite asserts this
  (`String(normalizeWordPasteHtml)` contains `rebuildPastedTables`, no
  `import`/`require`). The lone `=>` in the diff is a TypeScript type annotation
  on the `transforms` array, erased at compile.
- Transform order is correct: `rebuildPastedTables` runs **last**, after office
  spacers / Word lists / tracked-changes residue are cleaned inside cell HTML, so
  a Word table with tracked changes in a cell serialises the accepted text.
- Interception regex `/<table[\s>]/i` does not false-positive on "tablet" (needs
  `<table` followed by whitespace or `>`).
- Entity decode resolves `&amp;` last (fixture `Region &amp; Segment` → `Region &
  Segment`, not `Region &`), verified live in `A.md`.

## Risks / not probed

- Real Microsoft Office clipboard bytes could differ subtly from the synthesised
  fixture (only mitigated, not eliminated — same limitation as plan 39). The
  fixture is a faithful Word export shape and the parser is markup-driven, so the
  risk is low.
- Nested tables (a `<table>` inside a cell) are a stated limitation, not tested
  live (the greedy-safe regex degrades to the inner `</table>`); Word's export
  path here does not nest tables.
- Alignment is intentionally always `---` (matches the docx importer); not a
  defect, not separately graded.
