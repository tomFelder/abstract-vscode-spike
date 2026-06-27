# Plan 15 — iteration 5 prompt: bring the calm chrome into PM, flip the default, retire `renderDoc` (U1)

Handoff prompt for the next `/loop` iteration of [15-unify-editor-f7-loop.md](15-unify-editor-f7-loop.md).
Iters 1-4 are done (PRs #25/#26/#27 merged). Paste the block below into a fresh session.

---

Run iteration 5 of the editor-unification /loop (docs/plans/15-unify-editor-f7-loop.md).
Iters 1-4 are MERGED to main; branch off a current main. State of play: living docs render+edit in ProseMirror behind an opt-in 'pm' mode, and ALL the
former renderDoc-only features now work in PM as decorations - the inline proposal diff (F4), accept/reject
through the service with a body reset (F6), the provenance gutter dot (G5), and the source-peek bottom
drawer from a figure click (G1). Decisions 46-52 are settled - don't re-litigate. The ONE reason iter 4
did not flip the default: the calm CHROME is still renderDoc-only - the persistent formatting toolbar
(`.etoolbar`, wired through `execCommand`/`data-fmt`, which ProseMirror does not honour) and the Present
button are gated `isLiving && isRendered`. So 'pm' has decoration parity but not chrome parity.

ITERATION 5 - bring the chrome into PM, then FLIP the default and RETIRE the renderDoc body (decision 49,
criterion U1, net delete > add). In order:
  1. Toolbar in PM. Wire `.etoolbar` to the bundle's `LWDPM.cmd(view, name)` instead of `execCommand`:
     the heading dropdown -> `h1`/`h2`/`h3`/`paragraph`, B -> `bold`, I -> `italic`, the list buttons ->
     `bullet_list`/`ordered_list`, quote -> `blockquote` (all already in the bundle's COMMANDS). Add a
     `pmCmd` message (toolbar button -> RUNTIME -> `LWDPM.cmd(pmView, name)`); show the toolbar in 'pm'
     mode. DROP the Underline button (Tom's call): Markdown and the commonmark schema have no underline
     mark - calm by subtraction. Remove the `U` from `.etoolbar`, don't fake it.
  2. Present in PM. Show the Present button (and run the Present/export modal) in 'pm' mode, not just
     `isRendered` - it already works off the doc model, only the render gate excludes pm.
  3. FLIP THE DEFAULT. Make 'pm' the initial/default render path for living docs (a living doc opens in
     PM, not renderDoc). Keep 'raw' reachable. The "Edit"/"Done editing" toggle becomes a "rendered
     preview" toggle or is dropped - decide and keep it calm.
  4. RETIRE the renderDoc HTML body. Delete `renderDoc`, `renderBoundParagraph`, `renderBlockMarkdown`'s
     renderDoc-only callers, `gutterCell`, `renderInsertProposal`, and the renderDoc branch in
     `renderLivingDocContent`. KEEP the calm chrome (topbar, `.etoolbar`, syncBar, source drawer) and the
     export path (`renderExportHtml`/`renderExportMarkdown`). Net intent: delete more than is added; remove
     the now-dead inline-diff/insert HTML paths that only renderDoc used (the PM widgets replace them).

This closes U1 (one editor). U3 (chat proposal in-surface) already works in PM; re-verify it on the flipped
default (a chat edit on a living doc -> inline diff -> accept). F7 + chat-on-every-doc are EXPLICITLY OUT
OF SCOPE this iteration (Tom's call) - this iteration is FLIP-ONLY (U1). Do NOT touch the `isLiving` chat
gate in `sendChatMessage`/`_chatRespond` here; dropping it (chat on any doc, decision 48) + the
fresh-project F7 end-to-end + the desktop disk smoke are iter 6. Keeping iter 5 to the flip keeps the
HOLD-sensitive commit small and reviewable.

HOLD is the hard constraint: F1-F6 + F8 must pass LIVE on existing living docs (now via the PM surface,
since renderDoc is gone), plus v5 R1-R6 and the design gates (G1/G2/G5/G6, G4-as-revised). Because the
default flips, you MUST re-verify each F-gate LIVE on the PM default before claiming HOLD: open an existing
living doc (now opens in PM), drive a source-change refresh + a chat edit, confirm the figure/gutter/diff/
accept/source-drawer all work, and that the calm toolbar + Present are present and functional. The renderDoc
unit tests (`renderLivingDocHtml` suite) will need rewriting to assert the PM default - update them, don't
delete the coverage.

Method: TDD any new pure logic. Rebuild the vendored bundle offline ONLY if the schema/commands change
(docs/lwd-pm-bundle-build.md: /Users/tommy/Sites/.lwd-pm-build -> `node build.mjs --emit`; ASCII; re-run
hygiene; round-trip test must pass) - the toolbar wiring needs no bundle change (COMMANDS already exist).
Verify LIVE on the real folder via code-web + chrome-devtools with the OpenRouter proxy; RE-READ disk for
every write; **a desktop `code.sh` disk smoke is REQUIRED this iteration** (the default-path persistence
must be proven on real disk, not just memfs - decision 38). Branch off main (continue the PR line). Log any
core patch in the merge-tax ledger inside docs/06-design-notes.md (target 0). Update 07-decision-log +
06-design-notes + plan 15 iter-5 log + the living-docs-v6-chatdoc memory. Commit ONE change; post
before/after screenshots as a PR comment.

Settled going in (don't re-ask): DROP Underline (no Markdown/schema mark); iter 5 is FLIP-ONLY - F7 +
chat-on-every-doc are iter 6.

Settle first (STOP and ask before building):
  - The rendered "preview": once PM is the default, is there still a read-only "rendered" view at all
    (e.g. for Present/print), or does PM + the export path cover it? Default recommendation (proceed unless
    Tom objects): drop the 'rendered' mode for living docs entirely - PM is the one surface; export covers
    print. Confirm with Tom only if removing it turns out to entangle the Present/export flow.

STOP and ask before building only if a genuinely new product/architecture decision appears (46-52 are
settled). Stop when U1 passes live on the flipped PM default + U3 re-verified on a living doc + every HOLD
gate green (re-verified on the new default) + a desktop disk smoke confirms persistence on the default
path - or after the loop's 20 iterations. (chat-on-every-doc + F7 = iter 6.)
