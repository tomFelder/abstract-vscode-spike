# Validation round 1 - bundle 49-a Knowledge (PR #240, issue #239)

Adversarial validator, fresh eyes. Worktree `abstract-v2-screens1`, branch `v2/screens2-a` at `5079b4d0b81`. Web build via `TMPDIR=/tmp ./scripts/code-web.sh ./living-docs-sample --port 8083`, driven headless with Playwright/Chromium (the Claude-in-Chrome extension was not connected; the in-app FS picker and memfs mount behave identically). Measurements taken with `getComputedStyle`/`getBoundingClientRect` inside the screen webview iframe.

## Verdict: PASS with one defect (D1, K2.2 glyph)

## Checks (broker on :8090 killed first for hermetic stubs)

- `npm run transpile-client` - clean
- `npm run typecheck-client` - clean (exit 0, no diagnostics)
- `npm run valid-layers-check` - clean (exit 0)
- `./scripts/check-seams.sh` - OK, all shell seams intact, zero core seams
- `./scripts/test.sh --grep "livingDoc"` - **350 passing, 0 failing** (baseline ~348; net +2: new `sourceFreshness` suite +4, screenRender Knowledge tests reworked, one old-drawer test removed) - accounted, matches the claim

## Diff audit

- Service `livingDocsService.ts` is additive only: new `resyncSource` + `setSourceExpected` (public), `_expectedSourceIds`/`_sourceResource`/`_documentsForSource` (private), one modified push line adding `resource` + `markedExpected` fields. No existing method logic destructively altered. Re-sync routes through the existing `refreshFromSources` machinery.
- No `Date.now()` in any render path: `knNow` is captured once at state-build time (`screenEditor.ts:273,357`) and read from state by the render module (`screenRenderKnowledge.ts:54`); `sourceFreshness.ts` takes an injectable `now`. The only `Date.now()` calls in the diff are the two state-build sites plus test files.
- Closed-loop F12 files (`livingDocRender.ts`, `treeRailFilesTree.ts`, `treeRailView.ts`, `contextGroups.ts`, `treeRail.ts`) touched surgically: label/vocabulary wording, two functions exported (`keyNamespace`/`sourceNamespace`), and additive optional `freshness`/`sourceFreshness` params defaulted for backward compatibility. Nothing structural.
- No em-dash character added anywhere in the diff (grepping the added lines for it returns empty); the old Knowledge subtitle em-dash was removed with the `.scr-head` rebuild.

## Live numeric per criterion (fresh + stale state, real folder data)

Folder sources enumerated independently: **metrics.csv** (bound by Board Note + Weekly Summary, 18 value keys) + **market-research.md** (context-only, referenced by both) = the exactly-two rows shown. Nothing fabricated.

| Criterion | Measured | Result |
|---|---|---|
| K1.1 shell | column max-width `1180px`, filter field `240px`, white card on chrome | PASS |
| K1.2 add-source | sheet lists 8 real target docs + 1 real folder file (metrics.csv) + API field; `addSource` write path (`_sourceResource` joins folder root -> `sources/` on first use). In-app FS picker (decision 40), not a native OS dialog - not headless-blocked | PASS |
| K1.3 summary | "2 sources in this folder · 18 bound figures depend on them." - matches independent count | PASS |
| K2.1 table geometry | radius `13px`; header bg `rgb(251,252,253)`=#FBFCFD; grid `336.28/168.16/168.14/235.42/90px` = 2:1:1:1.4:90px; header font `600 9.5px JetBrains Mono`, letter-spacing `1.14px` (=.12em); color `rgb(163,168,178)`=#A3A8B2; labels SOURCE·KIND·SYNC·FEEDS·BINDS | PASS |
| K2.2 glyph + kind word | KIND words correct (Table/Reference); **glyph keyed on transport kind (file/api/mcp) not semantic kind - a Reference .md shows the ⊞ table glyph instead of ◇** | **FAIL (D1)** |
| K2.3 SYNC | fresh: green dot `rgb(44,129,89)`=#2C8159 + "24d ago"; stale: dot `rgb(201,154,46)`=#C99A2E + text `rgb(138,109,26)`=#8A6D1A + "stale · 24d" + **row bg `rgb(253,250,242)`=#FDFAF2 cream**; context-only: grey dot `rgb(213,216,222)`=#D5D8DE + "context only"; dot 7px | PASS |
| K2.4 FEEDS chips | accent-tint chips; clicking one opened `Board Note.md` (data-stop prevented the row source-tab) | PASS |
| K2.5 BINDS | "18" in `rgb(70,80,184)`=#4650B8/600 when >0; faint em-dash glyph `rgb(163,168,178)`=#A3A8B2 when none | PASS |
| K2.6 row click | metrics.csv row -> `openSource` -> opened `vscode-test-web://mount/metrics.csv` as a product tab titled "metrics.csv" showing the CSV grid | PASS |
| K2.7 real rows | exactly 2 rows, 1:1 with the folder's actual sources; nothing fabricated. xlsx lineage N/A (no xlsx-derived CSV in the sample) | PASS (lineage untestable) |
| K3.1 attention card | exactly ONE card (precise selector), names the stalest (metrics.csv). Re-sync: "stale · 24d" -> "just now", row white, card gone (routes through `refreshFromSources`). Mark-as-expected: -> "context only" grey, row white, card gone, Undo appears; persists across hard reload | PASS |
| K3.2 explainer | one static HOW BINDING WORKS card, no charts | PASS |
| K3.3 all-fresh | fresh state renders 0 attention cards, explainer alone | PASS |

## F12 sweep (stale source staged) - the ONE vocabulary

I aged `metrics.csv`'s last row (48600 -> 52000) so the bound hash (`hashString(last line)`) drifts from the lock's `8833a9c`, then re-scanned each surface:

| Surface | Reads | Vocabulary |
|---|---|---|
| Knowledge table | "stale · 24d", #8A6D1A text, #FDFAF2 cream row | correct |
| Figure hover-peek | "Stale · source changed since last sync" (leads with Stale) | correct |
| Context tab (Linked sources) | "stale · feeds 1 block" | correct |
| Context tab (Referenced files) | "current" (market-research fresh) | correct |
| Tree SOURCES meta | "stale" in #8A6D1A **after the bound docs are opened** (see watcher adjudication) | correct |
| Home stamps | "in sync" per-doc | out of F12 scope (doc-history axis, inventory note #13) |

### Watcher adjudication

The implementer flagged that the headless memfs watcher does not observe native-disk writes, so a just-loaded doc's `getFreshness` stays fresh and the tree meta reads "synced" live. I reproduced this: on first load the tree meta reads "synced" (#5D8A66) while the Knowledge table (re-reads on visit) correctly reads "stale". **I went further and disproved it as a code defect**: after opening the two docs that bind metrics.csv (which forces `getFreshness` to re-read the aged source), the tree meta **flips live to "stale" in #8A6D1A** - the exact F12 amber token. So the tree-meta vocabulary mapping is proven live, not merely correct-by-construction. The initial "synced" is purely the harness watcher not having fired - not a defect. The Context tab's mapping is additionally unit-asserted (`livingDocsService.test.ts:668` `detail: 'stale · feeds 1 block', changed: true`).

The editor header pill ("All sources synced") and the editor banner ("A linked source changed since the last sync") are the deliberately-excluded aggregate roll-ups (F12 inventory rows 11-12); they are not per-source freshness tokens.

### Re-sync audit trail (harness caveat)

Re-sync flips the row to "just now" live. The on-disk lock is NOT updated (still hash `8833a9c`, empty `audit`) because the memfs mount does not flush writes back to real disk - `refreshFromSources` -> `_deriveDocument` writes the new hash/values and pushes an `'auto-applied'` audit entry (`livingDocsService.ts:3259`) to the in-memory lock only. The audit-write is correct-by-construction (code path exercised, since the figure values changed) but is not independently observable on real disk in this harness.

## Regression

Home (v2 greeting + doc grid), Templates, and the Editor screen all render; tree rail shows Reports/Sources groups; figure binding + hover-peek work. Intact.

## Defect

**D1 (K2.2) - the SOURCE-cell kind glyph does not distinguish the semantic kind.** Spec K2 requires "kind glyph (⊞ table / ◍ transcript / ◇ reference)". The implementation keys the glyph on the source *transport* kind (`s.kind` -> file/api/mcp) via `KIND_GLYPH = { file:'⊞', api:'◍', mcp:'◇' }` (`screenRenderKnowledge.ts:23`), so every `file` source - a CSV *table* and an `.md` *reference* alike - renders the same ⊞ glyph. Live: market-research.md's KIND word correctly reads "Reference" but its glyph is ⊞ (should be ◇). The glyph should follow the same semantic table/transcript/reference axis the KIND word already computes (`kindWord`), not the transport axis.

Fixtures restored (`metrics.csv`, `Board Note.lock.json`); working tree clean.
