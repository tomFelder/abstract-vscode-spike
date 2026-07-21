# Plan 44 baseline - five surfaces on pre-shell main

Baseline evidence captured before the Abstract Editor v2 shell work begins. These
screenshots record the current state of all five product surfaces on `main`,
including the per-webview top bar that plan 44 removes (the "double-header" state:
one bar drawn by each livingDocs webview, sitting above the workbench chrome).

- **Commit captured:** `ed3fea9e4da3c785552b0b2c2d8a94999d54c60f` (main, #214)
- **Date:** 2026-07-21
- **Launch command:** `TMPDIR=/tmp ./scripts/code-web.sh ./living-docs-sample`
  (served on `http://localhost:8080/`; the bare URL auto-opens the mounted
  `living-docs-sample` workspace so the surfaces render populated)
- **Driver:** headless Chromium via `@playwright/cli`; each surface reached by
  clicking its item in the 76px labelled left nav (the VS Code activity bar, whose
  `action-label` anchors carry `aria-label` Home/Editor/Templates/Knowledge/Agents)
- **Workbench root background** (`getComputedStyle` on `.monaco-workbench`):
  `rgb(243, 243, 243)` on every surface - the light theme window colour
- **Viewports:** 1440x900 and 1760x1000 (ten PNGs; dimensions confirmed exact)

## Per-surface top bars visible in this baseline

Every livingDocs surface renders inside a single out-of-process webview iframe
(OOPIF) that draws its own top bar. This is the header plan 44 folds into the
workbench shell.

- **Editor** - a living document is open (`brief/Appendix.md`, "Appendix - Design
  Tokens"). Webview top bar shows the `mount / Appendix - Design Tokens /
  Appendix.md` breadcrumb with a `Present` button and account avatar, and a
  SECOND toolbar row below it (`Paragraph`, B, I, ..., "Changes live only in this
  tab"). This is the clearest example of the double-header.
- **Home** - webview top bar shows `Abstract / Home` breadcrumb, an `All sources
  synced` status pill, `Present` button and avatar. Body: "Good morning, Tom",
  the Ask-this-project box, "Tidy this project", sync status, and the "Living Docs
  Sample - 7 docs, 1 source" project card.
- **Templates** - webview top bar shows `Abstract / Templates` breadcrumb with
  `Present` and avatar. Body: three template cards (Client update, Meeting notes
  to SOP, Weekly report).
- **Knowledge** - webview top bar shows `Abstract / Knowledge` breadcrumb, `All
  sources synced` pill, `Present` and avatar. Body: two-source table
  (market-research.md, metrics.csv).
- **Agents** - webview top bar shows `Abstract / Agents` breadcrumb with `Present`
  and avatar. Body: five-agent table (Weekly refresh, Source-change watcher,
  Freshness sweep, Before-export gate, On-publish snapshot).

## Files

| Surface | 1440x900 | 1760x1000 |
| --- | --- | --- |
| Editor | `editor-1440x900.png` | `editor-1760x1000.png` |
| Home | `home-1440x900.png` | `home-1760x1000.png` |
| Templates | `templates-1440x900.png` | `templates-1760x1000.png` |
| Knowledge | `knowledge-1440x900.png` | `knowledge-1760x1000.png` |
| Agents | `agents-1440x900.png` | `agents-1760x1000.png` |
