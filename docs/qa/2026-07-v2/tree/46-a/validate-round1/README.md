# Plan 46-a - tree rail tabs + filter + ＋: validate round 1

Adversarial validation of PR #228 (`v2/tree-a` @ `ed6903b`) against plan 46 §2 pins P4.1-P4.5, spec 43 §3 tolerances (colours exact to hex; lengths/radii ±1px; shadow strings exact; type per the ramp, `system-ui` face never a failure). Live app driven headless via Playwright against `TMPDIR=/tmp ./scripts/code-web.sh ./living-docs-sample --port 8082`; every px/hex read with `getBoundingClientRect` / `getComputedStyle`. Before-reference is the merged-main source-truth in `../../00-baseline/README.md` (live baseline frames were never captured - prior ENOSPC blocker); after-frames captured here.

## Verdict: FAIL (2 defects)

## Re-run checks (Node 24)

| Check | Result |
|---|---|
| `npm run typecheck-client` | clean |
| `npm run valid-layers-check` | clean |
| `./scripts/check-seams.sh` | OK - all shell seams intact |
| `./scripts/test.sh --grep "livingDocs"` | 309 passing |
| `./scripts/test.sh --grep "treeRail"` | 18 passing (incl. new `filterTreeRailNodes`) |

Grep accounting verified: the `livingDocs` grep (309) does NOT include the `treeRail.test.ts` suite (its describe block is titled `treeRail`, not `livingDocs`), so the two greps are disjoint; the new filter test lands under the `treeRail` grep only. Implementer's accounting stands.

## Live numeric measurements (1440×900)

| Predicate | Spec | Measured | Verdict |
|---|---|---|---|
| Tab strip height | 38px ±1 | 38px (rect 39 = 38 + 1px border) | PASS |
| Tabs | Files·Context·Outline, no Search | 3 tabs: Files, Context, Outline | PASS |
| Strip gap / padding / border | - | gap 2px · padding 0 10px · border-bottom `#EEF0F3` 1px | PASS |
| Active chip height | 26px | 26px | PASS |
| Active chip radius | 8 | 8px | PASS |
| Active chip bg | white | `#FFFFFF` (rgb 255,255,255) | PASS |
| Active chip shadow (e1) | `0 1px 2px rgba(20,22,28,.05)` | `rgba(20,22,28,0.05) 0px 1px 2px 0px` | PASS |
| Active chip type | 12/600 | 600 / 12px / `#1A1C20` | PASS |
| Idle tab type | 12/500 `#868B95` | 500 / 12px / rgb(134,139,149)=`#868B95` | PASS |
| Idle tab hover | `#52575F` | rgb(82,87,95)=`#52575F` | PASS |
| ＋ size / radius | 24px / 7 | 24×24 / 7px | PASS |
| ＋ hover bg | `#EEF0F3` | rgb(238,240,243)=`#EEF0F3` | PASS |
| Rail scrolls as one | one scroll region | Reports + brief + Sources are one `.monaco-list` virtual scroller; tab strip + filter fixed above | PASS |
| SOURCES label | mono 10/600/.12em `#A3A8B2` | **system-ui 11px / 600 / letter-spacing normal / `#1A1C20` / not uppercase** (`.rail-tree-folder-label`) | **FAIL** |

## Behaviour attacks

- **(a) type-to-filter narrows live:** rows 12 → 2 → 12. Typing "Weekly" leaves `["Reports","Weekly Operating Summary"]` (ancestor folder kept); clearing restores all. PASS. (My row count is 12 vs the implementer's 15 - the `brief` subfolder is collapsed here so its 3 children are not rendered rows; narrowing behaviour identical.)
- **(b) case-insensitive + partial:** "board"==="BOARD" → Board Note; partial "Weekl" → Weekly Operating Summary. PASS.
- **(b2) content/body search - GAP:** "primary colour" (a phrase in the Appendix *body*, in no title) → **0 rows, "No documents match"**. The old Search matched title OR body content with a snippet; the new `filterTreeRailNodes` matches the row *label* only. See audit below. **Prior Search body-content behaviour is NOT reachable.**
- **(d) focus discipline:** filter = "Board", click into editor, type `SHOULDNOTLAND` → filter still "Board" (unchanged). PASS. The rail's input only re-focuses itself when a filter is already active; the editor is a separate surface.
- **(e) Context + Outline render:** Context renders its add-source composer; Outline renders 3 heading rows for the active doc. PASS.
- **(f) switch tabs with active filter:** filter persists across Files→Context→Files (stays "Board", 2 rows); Context shows no leaked filter input; clearing then restores 12 rows. No stuck state. PASS.
- **(＋ name-first, P4.4):** clicking ＋ opens the name prompt; "Sprint 46 Validate" + Enter → row "Sprint 46 Validate" in Reports + a new Recent group (name kept, not "Untitled"). A path-hostile name "Q3 Review: Draft" → row "Q3 Review Draft" (`_safeStem` strips `:` for a safe filename stem; the typed name is kept). PASS.
  - *On-disk note:* `@vscode/test-web --browserType none` mounts the folder through an in-browser filesystem; writes do not round-trip to real disk, so literal on-disk verification is impossible in this harness (an infra constraint, not a defect). The write is verified at the file-service/tree-model level (the new doc appears in the tree with its `.md` name).

## Old-Search-behaviour reachability audit

The deleted `_renderSearch` (main history) drove `searchTreeRail(docs, query)` (still exported, now dead code - only its own test references it). Behaviour comparison:

| Old Search behaviour (`searchTreeRail`) | New filter (`filterTreeRailNodes`) | Reachable? |
|---|---|---|
| Match by **document title** (case-insensitive substring) | Matches row **label** (case-insensitive substring) | YES |
| Match by **document body / content** (case-insensitive `body.indexOf(q)`) | Label-only; no body read | **NO - gap** |
| **Snippet** around the first body match (`...±24/±36 chars...`) | No snippet (rows are just narrowed) | **NO - gap** |
| Blank query returns nothing | Blank query returns the whole tree unchanged | Behaviour changed (acceptable: filter idiom) |
| Click a hit opens the doc | Click a filtered row opens the doc (unchanged tree wiring) | YES |
| (new) Filter also narrows **folders / sources** by label | n/a | New, additive |

Net: title/filename search and open-on-click are reachable; **body-content search + snippets are not**. P4.2's clause "prior Search behaviours are reachable this way" is only partially met.

## Defects

1. **P4.5 SOURCES-label styling** - the Files-tab group labels (Reports/Sources) render via `TreeRailFolderRenderer` → `.rail-tree-folder-label` (`treeRailView.ts:788`): `font:600 11px/1 system-ui; color:var(--vscode-foreground)`. Expected mono 10/600/.12em `#A3A8B2` uppercase. The `.rail-folder` rule the PR restyled to the spec values (`treeRailView.ts:800`) is used only by the **Context** tab's group header (`treeRailView.ts:603`), not the Files tree where SOURCES actually lives. Measured: system-ui 11px, weight 600, letter-spacing `normal`, colour `#1A1C20`, text-transform `none` (label reads "Sources", mixed-case). Evidence: `sources-label-1440.png`, `rail-1440.png`.

2. **P4.2 content-search reachability** - the folded-in filter (`filterTreeRailNodes`) matches row labels only; the old Search's title-OR-**body** matching with snippets is not reachable. Repro: type a phrase present only in a document body (e.g. "primary colour", in the Appendix) → "No documents match". Evidence: `content-gap-1440.png`. (`searchTreeRail` remains exported but is now dead code.)

## Frames

`tabstrip-1440.png` · `rail-1440.png` / `rail-1760.png` · `files-1440.png` / `files-1760.png` · `filter-active-1440.png` · `content-gap-1440.png` · `context-1440.png` · `outline-1440.png` · `plus-prompt-1440.png` · `plus-created-1440.png` · `sources-label-1440.png`.
