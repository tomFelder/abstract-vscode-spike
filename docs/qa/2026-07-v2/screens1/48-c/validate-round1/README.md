# 48-c Template flows - VALIDATION ROUND 1 (#226)

Adversarial validation of bundle 48-c (PR #233) after the mechanical rebase onto `origin/main` (45-a/b/c, 46-b/c merged). Criteria: T2.4, T2.5, T2.6, H2.3u, TC.1, TR.1. Verdict: **PASS**.

## Method

Web harness driven with Playwright (headless Chromium) against `TMPDIR=/tmp ./scripts/code-web.sh ./living-docs-sample --port 8083`, bare URL. Unlike the implementer's round-1 note, the File-System-Access mount registered in this session, so the folder's real documents and templates loaded live - the render-level and full-loop criteria are verified end-to-end in the running workbench.

On-disk service-layer claims were re-derived independently (not trusting the implementer's unit tests): three Node harnesses import the actual transpiled production code (`livingDocMarkdown.js`, `livingDocAddress.js`, `editorWebviewProtocol.js`) and exercise it against real files on a real filesystem. This is the sanctioned service-layer fallback, reproduced by the validator.

## Screenshots

- `01-light-path-coldstart-1440.png` - cold start lands in the numbered-gutter editor; light path intact (do-not-break).
- `02-templates-new-template-header-1440.png` - Templates surface; header reads exactly `＋ New template` (TC.1); 3 cards, each with a single `Use`; dashed tile = "Save current doc as template" (F18 wizard NOT on the populated grid); STARTERS row present.
- `03-home-in-sync-1440.png` - Home (48-a) intact; truthful "Everything is in sync." triage; header `＋ Open Folder` (H1.4).
- `04-use-bind-sources-nudge-1440.png` - T2.4 full loop LIVE: `Use` on the "Client update" card duplicated the template into the folder, opened the new doc (template STRUCTURE, plain prose, no fabricated content / no resolved figures), and the new doc's tree row carries the accent "Bind sources" nudge (46-c renderer reading `needsSourceBinding`). Living docs (Board Note, Weekly Operating Summary) show the LWD badge, not the nudge - the truthful contrast.

## Per-criterion result

| Criterion | Result | Evidence |
|---|---|---|
| T2.4 Use duplicates, empties binds, opens, needs-binding + tree nudge | PASS | screenshot 04 (full loop live) + svc-proof 6/6 |
| T2.5 Save-as-template to `.abstract/templates/`, binds emptied, appears in grid, honest no-op | PASS | svc-proof 4/4 (write + template:true + name: + path) |
| T2.6 both stores discovered, no same-name duplicates, `.abstract` wins | PASS | dedupe-proof 3/3 (incl. case/whitespace variant attack) |
| H2.3u Home Review deep link opens doc + Review tab, scrolls to block; deleted block degrades | PASS | h23u-proof 7/7 incl. the closed-path race |
| TC.1 header reads exactly `＋ New template` | PASS | screenshot 02 + live titlebar read |
| TR.1 typecheck-client / valid-layers-check / check-seams.sh / suite all clean | PASS | 339 passing 0/0; three checks clean |

## H2.3u closed-path attack (the round-1 46-c defect)

The round-1 46-c defect was a race: a Review deep link fired before the target surface mounted lost the scroll. Attacked directly with a deep-link where nothing is open:

- `reviewBlock` awaits `openEditor` (which runs `setInput`, registering the `onDidRequestRevealBlock` listener AND `loadDocument`) BEFORE firing the reveal event - so the listener is live when the event fires.
- The block-scroll is additionally routed onto the 46-c panel replay seam: `focusPanel('review', { blockId })` records the deep-link payload so a Review rail mounting after the call still consumes the block address on subscribe.
- The webview reducer holds `pendingRevealBlockIndex` until `ready`, then flushes it on `applyReady` - a reveal that arrives before the ProseMirror surface is laid out is HELD, not lost.

h23u-proof reproduces all three: reveal-before-ready HELD, FLUSHED on ready; reveal-after-ready posted immediately; a deleted/unknown block id resolves to index `-1` (webview no-ops the scroll, doc opens without scroll, no error).

## Regressions

- F18: the from-examples wizard moved to the empty state only (mounted once at `screenRenderTemplates.ts:154`); the populated grid leads with Save-current-doc-as-template and mounts no duplicate/dead wizard DOM.
- Templates gallery (48-b) renders; Home (48-a) intact; light path lands in the editor.

## Rebase note

Post-rebase livingDoc suite: 339 passing (origin/main 333 + 7 new grep-matched tests - 1 relocated F18 wizard test). Three markdown-suite tests (`emptyBindsToSlots`, `buildDocumentFromTemplate`, `buildTemplateFromDocument`) live under the `LivingDoc bind-link format` suite, which the case-sensitive `--grep "livingDoc"` does not match; they run under the full suite. Known collisions (`needsSourceBinding`, `focusPanel`/`consumePendingPanel`, adjacent additions) resolved to one definition each, preferring main's mechanism where the merge forced a choice.
