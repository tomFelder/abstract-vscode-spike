# Plan 46-a - tree rail tabs + filter + ＋: validate round 2

Fresh-eyes adversarial validation of PR #228 (`v2/tree-a` @ `253a9d08f2d`) against plan 46 pins P4.1-P4.5, spec 43 §3.6 tolerances (colours exact to hex; lengths/radii ±1px; shadow strings exact; type per the ramp). Live app driven headless via `playwright-core` against `TMPDIR=/tmp ./scripts/code-web.sh ./living-docs-sample --port 8082` (bare URL); every px/hex read with `getBoundingClientRect` / `getComputedStyle`. Round 1 FAILED on P4.5 (SOURCES label) and P4.2 (body-content reach); this round re-checks both, re-confirms the three round-1 ticks, and audits the rebase.

## Verdict: PASS (all 5 criteria met) - with a required pre-merge re-sync finding (branch is one merge stale)

## Re-run checks (Node 24)

| Check | Result |
|---|---|
| `npm run typecheck-client` | clean (exit 0) |
| `npm run valid-layers-check` | clean (full tsgo layer chain, no errors) |
| `./scripts/check-seams.sh` | OK - all shell seams intact |
| `./scripts/test.sh --grep "treeRail"` | **19 passing** (incl. the new "keeps a document matched only by body text (P4.2 content reach)" test = the claimed +1) |
| `./scripts/test.sh --grep "livingDocs"` | **306 passing** (NOT 309 - see the rebase-staleness finding) |

### livingDocs count discrepancy (306, not the PR-claimed 309)

The PR text and both prior round comments claim `livingDocs` = 309. On this branch state it is **306**. Root cause: 45-a (#227) added `livingDocAddress.test.ts` (89 lines) plus additions to `livingDocRender.test.ts` / `livingDocPmDecorations.test.ts`, landing three-plus new tests under the `livingDocs` grep. Those tests are on `main` but NOT on this branch, because the branch was rebased onto `78de441580e` (48-a Home, #229) BEFORE #227 merged. `livingDocAddress.test.ts` does not exist on this branch. The fix commit (`253a9d08f2d`) touches only `treeRailView.ts`, `treeRail.ts`, and `treeRail.test.ts` - none under the `livingDocs` grep - so it cannot have regressed the count. 306 is the honest branch baseline; the "309" claim is a stale carry-over from the pre-rebase measurement.

## Live numeric measurements (1440×900, `getComputedStyle`)

| Predicate | Spec | Measured | Verdict |
|---|---|---|---|
| Tab strip (`.rail-tabs`) height | 38px ±1 | 38px css (rect 39 = 38 + 1px border) | PASS |
| Tabs | Files·Context·Outline, no Search | 3 tabs: Files, Context, Outline (`button.rail-tab`) | PASS |
| Strip gap / padding / border | - | gap 2px · padding 0 10px · border-bottom `#EEF0F3` 1px | PASS |
| Active chip height / radius | 26px / 8 | 26px / 8px | PASS |
| Active chip bg | white | `rgb(255,255,255)` = `#FFFFFF` | PASS |
| Active chip shadow (e1) | `0 1px 2px rgba(20,22,28,.05)` | `rgba(20,22,28,0.05) 0px 1px 2px 0px` | PASS |
| Active chip type | 12/600 `#1A1C20` | 600 / 12px / `rgb(26,28,32)` | PASS |
| Idle tab type | 12/500 `#868B95` | 500 / 12px / `rgb(134,139,149)` | PASS |
| Idle tab hover | `#52575F` | `rgb(82,87,95)` | PASS |
| ＋ (`.rail-new-doc`) size / radius | 24px / 7 | 24×24 / 7px, aria "New Document", sits right of tabs | PASS |
| ＋ hover bg | `#EEF0F3` | `rgb(238,240,243)` | PASS |
| **SOURCES label** (`.rail-files-tree .rail-tree-folder-label`) | mono 10/600/.12em `#A3A8B2` uppercase | `"JetBrains Mono"` / 10px / 600 / letter-spacing 1.2px / `rgb(163,168,178)` / uppercase | **PASS (round-1 defect fixed)** |
| Rail scrolls as one | one scroller across Reports/brief/SOURCES | one `.monaco-list` in `.rail-panel-files`, 0 extra scrollables | PASS |

The SOURCES-label restyle lands on the correct selector this round: round 1 measured system-ui 11px / `#1A1C20` / mixed-case; round 2 measures mono 10/600/.12em `#A3A8B2` uppercase (the round-1-identified `.rail-files-tree .rail-tree-folder-label`). The rendered text is `text-transform:uppercase` over the on-disk-cased folder name ("Sources" -> "SOURCES") - the correct display-time treatment, as round 1 itself noted. Evidence: `sources-label-1440.png`.

## Behaviour attacks (P4.2)

Filter input is `input.rail-filter-input` (placeholder "Filter documents…"), folded into the Files tab.

- **Body-only phrase "primary colour"** (appears only in document bodies - Executive Summary, Project Brief, Appendix - never in a title/filename): narrows to **REPORTS ▸ BRIEF ▸ Appendix — Design Tokens** (count 3 incl. ancestor folders). Round 1's identical query returned "No documents match". **The P4.2 body-reach defect is fixed.** Evidence: `body-primary-colour-1440.png`.
- **Case-insensitivity (body):** "PRIMARY COLOUR" surfaces the same 3 rows.
- **Nonsense phrase** "zzxqwv-nonsense-phrase" → honest empty state, "No documents match 'zzxqwv-nonsense-phrase'.", input stays live. Evidence: `nonsense-empty-1440.png`.
- **Label filter narrows + clears:** "Weekly" → 2 rows `[Reports, Weekly Operating Summary]`; clearing restores all 12. "board" (lower) → 2 rows `[Reports, Board Note]` (case-insensitive label). Evidence: `label-weekly-1440.png`.
- **No snippet affordance:** the surfaced body match is a plain tree row (no `[class*="snippet"]`/excerpt element) - consistent with the fix's stated scope.
- **Focus discipline:** filter = "Board"; blur the input, click into the editor, type `SHOULD_NOT_LAND_IN_FILTER` → filter value unchanged ("Board"). Editor keystrokes physically cannot reach the rail input (the doc renders in a separate cross-origin webview iframe; the input reacts only to its own `input` events). Evidence: `focus-discipline-1440.png`.

### Snippets adjudication (the P4.2 scope decision)

P4.2 as written: "Type-to-filter lives inside Files ... narrows rows live; **prior Search behaviours are reachable this way**." The old Search's behaviours were: find-by-title, find-by-body, show-a-snippet, open-on-click. This round restores find-by-body (through `searchTreeRail`, the single home of title-OR-body matching - no duplicated matching code) and open-on-click already held; find-by-title held. The only unrestored piece is the **snippet**, which the tree widget has no row slot for.

**Judgement: P4.2 is satisfied as written.** The load-bearing clause is "behaviours are **reachable**" - i.e. can you get to the document. A body-only phrase now surfaces the document and clicking it opens it, so the reachability behaviour is fully restored. A snippet is a *preview of where the match sits*, i.e. presentation of the match, not the reachability itself. Findability is the behaviour; the snippet was the presentation. The fix ships findability without snippets, states this openly, and the criterion does not enumerate snippets. P4.2 ticks.

## Regression of round-1 ticks (re-confirmed live, post-rebase + new CSS)

- Active chip still 26px / radius 8 / white / e1 / 12-600; idle 500/12 `#868B95`, hover `#52575F` - all re-measured, unchanged by the new folder-label CSS.
- ＋ still 24px / radius 7 / hover `#EEF0F3`, right of the tabs, name-first per plan 42 (round-1 evidence stands; size/hover re-confirmed live).
- 3 tabs, no Search tab; 38px strip.
- Context tab renders its add-source composer; Outline renders the active doc's headings; Files renders the grouped tree. No leaked filter state across tab switches.

## Rebase / stale-branch finding (duty 4 spot-check)

The prompt's spot-check requires the bundle commits to sit "on top of f2d7dd71f35 or later" and, on opening a living doc, the 70px numbered gutter from 45-a to show. **Both are false on this branch:**

- `origin/main` HEAD is `f2d7dd71f35` (45-a numbered gutter + address model, #227). It is **NOT** an ancestor of `HEAD` (253a9d08f2d). The merge-base is `78de441580e` (48-a Home, #229). The bundle sits on top of #229 but one merge behind #227.
- **48-a Home (#229) IS present:** `screenRenderHome.ts` on-branch; the Home nav icon renders; Home was the rebase target, so it is intact. PASS.
- **45-a numbered gutter (#227) is ABSENT:** `livingDocAddress.test.ts` does not exist on-branch; `livingDocRender.ts` still describes the old 30px dot gutter (`.pm-gutter::before` = 9px blue dot). Live: opening `Board Note` renders ProseMirror with `.prose` `padding-left: 30px` (the old 30px reserved lane) and **no** numbered gutter / block-number element. This is the pre-45-a editor surface. Evidence: `editor-old-gutter-1440.png` (no numbered gutter visible in the reading column).

**Adjudication - not a merge-time regression, but a required pre-merge re-sync.** The bundle touches only `treeRailView.ts` / `treeRail.ts` / `treeRail.test.ts` - none of the 45-a files. A real (non-fast-forward) merge of `v2/tree-a` into `main` therefore keeps #227 intact (`git merge-tree` confirms no conflict on the gutter files; the branch modifies none of them). So merging would NOT revert the 45-a gutter. The "old 30px gutter live" is purely an artefact of running this one-merge-stale branch in isolation. None of the five P4.* criteria touch the gutter, so this staleness does not fail any checklist box.

It is, however, a real hygiene defect that must be cleared before merge: (1) the branch should be re-rebased onto current `main` (`f2d7dd71f35`) so the live app and future validation see the 45-a gutter, and (2) the PR's "309 passing" claim is wrong for this branch (306) and must be corrected once re-synced (it should return to 309+ with #227's tests back in the tree). Recorded here so the tick of the five criteria is not read as a claim that the branch is current with main - it is not.

## Frames

`tabstrip-1440.png` · `sources-label-1440.png` · `body-primary-colour-1440.png` · `nonsense-empty-1440.png` · `label-weekly-1440.png` · `focus-discipline-1440.png` · `editor-old-gutter-1440.png`.
