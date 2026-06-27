# Plan 15 — iteration 4 prompt: collapse to one surface (F4/F6/G5 in PM, flip the default)

Handoff prompt for the next `/loop` iteration of [15-unify-editor-f7-loop.md](15-unify-editor-f7-loop.md).
Iters 1–3 are merged (PRs #25/#26). Paste the block below into a fresh session.

---

Run iteration 4 of the editor-unification /loop (docs/plans/15-unify-editor-f7-loop.md).
Iters 1–3 are MERGED to main. State of play: the bound-figure atom node round-trips
(decision 46); the doc webview is a persistent mount-once-then-message surface (decision 50);
and LIVING docs already render+edit in ProseMirror behind an opt-in 'pm' mode, with frontmatter
preserved on save via withReplacedBody (decision 51). renderDoc is still the DEFAULT for living
docs (so F1–F6/G5 stay green), and the provenance "gutter" in PM is only a CSS accent so far.
Decisions 46–51 are settled — don't re-litigate.

ITERATION 4 — collapse to ONE surface: bring the remaining renderDoc features into PM, then
flip the default and retire the renderDoc HTML body (decision 49, criteria U1/U2/U3).
Build these on the persistent surface, driving them from the lwdRender message payload:
  1. Inline proposal diff IN PM (F4, decision 47): a pending IProposedChange renders as
     ProseMirror decorations — word-level green/red (add/del) over the target block, and a
     generative `insert` as an all-additions block widget at its anchor. TDD the pure mapping
     (proposal[] + doc -> DecorationSet spec).
  2. Accept / reject IN PM (F6): the inline controls (and the rail card, F5) apply to the PM
     doc — accept = a real PM transaction (replace oldText->newText / splice the insert) ->
     toMarkdown -> withReplacedBody -> saveRawText; reject clears the decoration. Keep the
     chat-rail review card (reviewRailView) in sync.
  3. Provenance gutter + applied-flash (G5) as real PM gutter decorations (dot / spanning bar
     beside bound/changed lines), replacing the iter-3 CSS accent.
  4. Source-peek bottom drawer (G5, decision 35) still opens from a figure/Source action over
     the full-width PM doc (reuse the existing reveal->drawer message; never a split editor — G1).
  5. FLIP THE DEFAULT: make 'pm' the default render path for living docs and RETIRE the renderDoc
     HTML body (keep the calm topbar/toolbar/drawer chrome). Net intent: delete more than is added.

This almost certainly needs the vendored bundle to expose a DECORATIONS API: extend
lwdpm-entry.js with a ProseMirror plugin holding a DecorationSet that the host sets/updates via a
new mount option + an exported `setDecorations(view, spec)` (proposals + gutter), and wire the
gutter as widget/line decorations. Rebuild offline per docs/lwd-pm-bundle-build.md
(/Users/tommy/Sites/.lwd-pm-build -> `node build.mjs --emit`; keep ASCII; re-run hygiene); the
bundle round-trip test must still pass.

HOLD is the hard constraint: F1–F6 + F8 must pass LIVE on existing living docs, plus v5 R1–R6 and
the design gates (G1/G2/G5/G6, G4-as-revised). Because this iteration FLIPS the default, you must
reach figure+gutter+diff+accept parity in PM BEFORE flipping — verify each (F4 diff shows, F6
accept persists + clears, G5 gutter + source drawer present) live in 'pm' mode first, then flip in
the same commit. If parity is too big for one clean commit, land the decorations behind the toggle
(default stays renderDoc) and DO NOT flip yet — say so and leave the flip for iter 5. Do not
half-flip.

Method: TDD the pure/decoration logic (proposal->DecorationSet; gutter placement; PM<->Markdown
incl. bound figures + frontmatter). Verify LIVE on the real folder via code-web + chrome-devtools
with the OpenRouter proxy running; RE-READ disk for every write; desktop code.sh disk smoke if a
write-gate is touched. Re-check the HOLD gates live (open an existing living doc, drive a
source-change + a chat edit, confirm F4/F5/F6 still work end-to-end). Branch off main (PR #26 is
merged — new branch, continue the PR line). Log any core patch in docs/plans/03-merge-tax-ledger.md
(target 0). Update 07-decision-log + 06-design-notes + plan 15 iter-4 log + the
living-docs-v6-chatdoc memory. Commit ONE change; post before/after screenshots as a PR comment.

STOP and ask before building only if a genuinely new product/architecture decision appears
(46–51 are settled). Stop when U1–U3 + F7 pass live + every HOLD gate green + a desktop disk smoke
confirms persistence, or after the loop's 20 iterations.
