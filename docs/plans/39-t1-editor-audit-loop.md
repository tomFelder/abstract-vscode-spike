# Plan 39 — The T1 editor audit loop (the beta disqualifier check)

**Paste this whole file into a fresh Claude Code session.** It is self-contained.

## Goal (one sentence)

Run the T1 editor-fundamentals audit — can a Word/Docs person paste, edit tables, handle images,
and trust undo in Abstract's editor? — grade every area PASS / DEGRADED / FAIL with evidence,
triage findings into **gating** (paste-fidelity class, blocks beta per principle P10) vs
**polish**, file a GitHub issue per gating finding, and end with a single verdict:
**PROCEED / FIX-FIRST (list) / DISQUALIFIED**.

## Why this runs now

Doc 18 §3 + doc 16 P10: editor weakness is a *beta disqualifier*, and this is the last pending
unknown that can invalidate the plan rather than delay it (docs/21 §4 item 8, **issue #128** —
update it as you go; it is the single operational tracker for this loop). The audit result also
sequences the P1 interop work (issues #129/#130): there is no point importing docx into an editor
that mangles pasted content.

## Context you need (read these first, ~20 minutes)

- `docs/26-glossary-and-id-index.md` — the ID systems used below.
- `docs/16-principles.md` — P10 (the disqualifier rule), P5 (plain words), P8 (undo everywhere).
- `docs/plans/34-verify/environment.md` and `docs/plans/34-verify/x1-desktop-check.md` — how the
  previous loop built and drove the app (web via `@vscode/test-web` + chrome-devtools MCP;
  desktop Electron launch steps). **The beta target is the Electron desktop build only**
  (decision 162); audit on desktop where feasible, fall back to the web build only for
  input-simulation ergonomics and say so per finding.
- The editor is a vendored-ProseMirror webview (`docs/06-design-notes.md` D7;
  `docs/lwd-pm-bundle-build.md`); source under `src/vs/workbench/contrib/livingDocs/`.
- Repo conventions: work on branch `39-t1-editor-audit`; commit per iteration; **audit only — no
  product fixes in this loop** except trivial test-harness seams; 0 core patches.

## The audit areas (one iteration each; grade every row)

| # | Area | What a Word person does | Minimum probes |
|---|---|---|---|
| 1 | **Paste from Word** (THE gating area) | Ctrl+V from a Word doc | Paste `text/html` clipboard payloads in Word's real format (mso- styles, `<o:p>`, smart quotes, nested lists, a 4×6 table with merged header, an inline image, bold/italic/links, tracked-changes residue). Verify: structure survives, no raw HTML/mso junk, no silent content loss. Also plain-text paste, paste-over-selection, paste into a list |
| 2 | **Tables** | Edit a cell, add a row | Render fidelity (GFM), cell editing, tab between cells, row/column add/delete if present — absence is a finding, not a crash |
| 3 | **Images** | Paste/drag an image | Lands, renders, persists to disk + survives reload, relative path sane |
| 4 | **Lists & structure** | Bullets, numbering, nesting, headings | Enter/Tab behaviour, mixed nesting, heading conversion, the decision-68 sibling data-loss class (regression probe) |
| 5 | **Undo/redo** | Ctrl+Z fixes anything | Across paste, across list ops, across an approve (known gap F6 — confirm, don't refix), redo symmetry |
| 6 | **Find & replace** | Ctrl+F muscle memory | Exists? Scoped to doc? Replace honoured in bound spans? (Bound values must NOT be silently editable — P8/provenance invariant) |
| 7 | **Selection & cursor** | Click, drag, shift-arrows, select-all | Cursor stability across re-renders, selection across block boundaries, no caret jumps while a proposal streams |
| 8 | **Long-doc ergonomics** | A 30-page board pack | 10k-word fixture: typing latency, scroll stability, no whole-doc re-render jank |

Word-clipboard payloads: synthesise realistic Word `text/html` clipboard content (mso-
classes/styles) as fixtures under `docs/plans/39-verify/fixtures/` — real-Word capture is not
available in the loop environment; say so in the findings preamble. Drive input via the same
harness prior loops used (chrome-devtools MCP / Playwright with `executablePath`).

## Loop mechanics

- **Iteration 0:** build, launch, create the fixture set (Word-HTML payloads + the 10k-word doc),
  smoke-check the harness. Commit.
- **Iterations 1-8:** one area each. For every probe: evidence (screenshot or DOM/disk assertion),
  grade, one-line user-impact in plain words ("pasting your weekly report loses the table" not
  "TableView drops rowspan"). Commit per iteration into `docs/plans/39-verify/t1-findings.md`.
- **Iteration 9 — triage & verdict:** classify every DEGRADED/FAIL as **gating** (paste-fidelity
  class: silent content loss, mangled paste, broken undo, data loss) or **polish** (missing
  nicety with a workaround). File one GitHub issue per gating finding (labels `P0`,`beta-v1`,
  title prefix `[T1]`), link them in the findings doc, comment the verdict on **#128**, and
  update `docs/21-beta-v1-prioritization.md` §4 item 8 with a one-line status pointing at #128.
- **Stop condition:** all 8 areas graded + verdict posted, or 12 iterations, whichever first.
  If the harness cannot drive an area at all, grade it UNTESTABLE with the reason — never skip
  silently (the F14 lesson applies to audits too).

## The verdict (the deliverable)

End `t1-findings.md` with:

1. The grade table (8 areas × grade × gating/polish).
2. **The verdict: PROCEED / FIX-FIRST / DISQUALIFIED** — FIX-FIRST lists the gating issues in
   fix order with effort guesses; DISQUALIFIED (any silent-content-loss class unfixable inside
   the fork's editor) escalates to the founder with the evidence, because it reopens the
   editor-substrate question (docs/05 Q2).
3. What this means for #129/#130 (import/export sequencing).

Honesty rules: real probes only, no fabricated grades, absence-of-feature is a finding not a
crash, every claim carries evidence. This audit exists to be able to fail.
