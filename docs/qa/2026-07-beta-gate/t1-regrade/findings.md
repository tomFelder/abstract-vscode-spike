# T1 re-grade - live re-probe of the six formerly-gating findings (#128)

Beta-gate file-reality wave (#245), 23 Jul 2026. Adversarial validator (Opus 4.8), instruction to refute. Driven LIVE against `origin/main` @ `accc01ed569` in worktree `abstract-v2-editor` (branch `beta-gate/t1-regrade`, zero product edits). Web build via `code-web.sh ./living-docs-sample --port 9081`. Every value is a read-back from the editor's own serializer (`LWDPM.toMarkdown`) or a live ProseMirror doc-node walk, not eyeballed. Screenshots in `shots/` beside this file; `word-paste-webview.png` is the key artefact (lists + table + tracked-changes sentence in one frame).

## Grade table

| finding | probe | expected | measured | verdict |
|---|---|---|---|---|
| #139 | paste Word fixture, read forecast sentence + DOM residue | deleted "revised down" dropped; "held flat" kept plain; no strike/underline | sentence = "The forecast was held flat after the review; final wording pending."; `has_reviseddown=false`, `has_heldflat=true`; DOM del/s/strike=0, ins/u=0, line-through=0 | **PASS** |
| #137 | same paste, walk PM for list nodes + junk glyphs | Word lists become real nested list nodes, no junk-glyph paragraphs | `bullet_list`=2, `list_item`=4, nested depth 1; `junkGlyph=false` | **PASS** |
| #138 | same paste, count `table_block` + DOM table | Word table becomes ONE real table block, not a paragraph run | `table_block`=1; DOM table=1, rows=6, cells=24; `attrs.markdown` = full 4-col GFM | **PASS** |
| #140 | mousedown cell, type+Enter; toolbar ops; node-select table then printable key | cell edit hits that cell only; row/col ops present; type-over no wipe | "one" -> "EDITEDCELL", siblings byte-identical; toolbar `[row+,col+,row-,col-]`; node-selected table + printable keydown leaves doc UNCHANGED | **PASS** |
| #141 | paste image/png File, then drag-drop; walk PM for image nodes | not a silent no-op: lands, renders, persists to assets/ | paste node `src=assets/Board Note/shot.png` rendered; drop node `src=assets/Board Note/dropped.png` rendered; `saveImageAsset` write path fired | **PASS** |
| #142 | type marker (own undo group), approve via the `pmReplaceBody` seam, step Cmd+Z | approve is one undoable step; pre-approve typing survives | undo1 reverts the approve, marker survives; undo2 removes the marker; undo stack survives the approve | **PASS** |

## Suite counts (broker on :8090 killed first)

- `livingDoc`: 360 passing / 0 failing (baseline held)
- `LivingDocs`: 8 passing / 0 failing (baseline held)
- Supporting: `LivingDoc Word paste` 28/0; `table` 249/0 (2 pending); `LivingDoc bind-link format` 82 passing / 1 failing

The 1 failing test (`templateSkeletonRows yields plain prose bars...`, `livingDocMarkdown.test.ts:161`) fails on a clean `origin/main` checkout with zero edits - a pre-existing baseline failure, not a T1 area and not a regression from these fixes. The decision-68 data-loss guard in the same suite is green. Tracked for a hygiene fix in this wave.

## Verdict recommended for #128: PROCEED

All six formerly-gating findings are fixed and live-verified; no new gating defect found.

## Method honesty notes

- #142 was probed via the same body-reset seam the accept path uses (`pmReplaceBody`, called by `applyUpdate` on `pmReset` at `livingDocRender.ts:663`) because no broker/model was available. prosemirror-history's 500ms `newGroupDelay` coalesces a synthetic type-then-approve into one undo group; with a realistic >600ms pause the two are separate groups and the P8 promise holds.
- #141 exercised the web build's in-memory FS provider; the `saveImageAsset -> assets/<doc>/` path is build-independent, but a desktop run writing a real PNG remains the honest final confirmation (same web-vs-desktop caveat as every prior T1 probe; not a blocker).

## Environment gotchas for the next runner

- Open the workbench on `http://localhost:9081/?folder=vscode-test-web://mount/`. The auto-suggested `?folder=/static/mount` binds to `HTMLFileSystemProvider` with no directory handle: every read/write throws `No file system handle registered (/static)` and the tree shows "0 documents".
- `pmView` is a closure-local `let`, not a global - capture the live `EditorView` by wrapping `LWDPM.mount` in a Playwright init-script.
