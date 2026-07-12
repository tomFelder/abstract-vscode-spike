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
| 1 | Paste from Word | — | — | — |
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
