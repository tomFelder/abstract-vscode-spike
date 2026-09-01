---
number: 53
status: "**Done (plan 15 iter 5).** Wired `.etoolbar` → `LWDPM.cmd` (heading `<select>`→paragraph/h1/h2/h3, B/I, bullet/ordered/blockquote — no bundle change; **Underline dropped**, no Markdown mark); Present + toolbar show in `pm`; default `_mode='pm'`; deleted `renderDoc`/`renderBoundParagraph`/`gutterCell`/`renderInsertProposal`/`inlineDiff`/`renderBlockMarkdown`/`renderSourcePeekLayout` + dead grid/gutter CSS; `LivingDocViewMode = 'raw' \\| 'pm'`. Tier: **our-surface, 0 core patches**; net **−176 lines** in `livingDocRender.ts` (delete > add, U1). Render unit suite rewritten to assert the PM default (8 tests; 99 living-docs tests pass; typecheck + layer-check clean). Verified live on the flipped default — web (code-web + OpenRouter): PM opens by default with calm toolbar + Present, the toolbar formats the live doc, bound figure → source drawer (U2/G1/G5), chat edit → inline diff → Approve persists/clears (U3/F4/F5/F6), raw round-trips with frontmatter + bind links intact; **desktop `code.sh` disk smoke (decision 38):** a PM edit persisted to the real `Weekly Summary.md` on disk (re-read confirmed). All 6 design gates hold. _F7 + chat-on-every-doc (decision 48) remain iter 6 — this iteration was flip-only._"
provenance: "plan 15"
source: docs/07-decision-log.md
---

# Flip the default to ProseMirror and retire renderDoc

**Flip the default to ProseMirror, retire `renderDoc`, and drop the read-only `rendered` mode entirely (U1)**

Iter 4 reached decoration parity in 'pm' but left two chrome blockers (toolbar wired via `execCommand`; Present gated to rendered), so the default stayed `renderDoc`. Iter 5's one "settle first" question: once PM is the default, is there still a read-only "rendered" view, or does PM + the export path cover it? Resolved **by investigation** (per the plan's rule — confirm with Tom only if removing it entangles Present/export): `renderExportHtml`/`renderExportMarkdown` take `(doc, resolved)` and are called from the service, never through `renderDoc`, and the Present modal renders off `present.open` state — so dropping `rendered` does **not** entangle Present/export. Decision: **drop the `rendered` mode entirely** — PM is the one editing surface, `raw` stays reachable (the "Edit raw Markdown" hint), export covers print; the old pm↔rendered "Done editing" toggle is removed (nothing to toggle to).
