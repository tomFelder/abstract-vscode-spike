# Abstract Editor v2 - pixel spec of record

This folder holds the design source for the Editor v2 wave (plans 43-49).

- `Abstract Editor v2.dc.html` — the mock: the Editor surface (pins 1-14), Home (H1-H3), Templates (T1-T3), Knowledge (K1-K3) and Agents (A1-A3), each followed by its engineering handoff ledger. Open it in any browser (it loads `support.js` from this folder). Toggle the tweak props (annotations, context menu, properties panel) via the `data-dc-script` block at the bottom of the file.
- `Abstract Shell Views.dc.html` — placeholder companion file from the same design session (empty canvas).
- `obsidian-ref-*.png` — the three Obsidian screenshots that informed the shell direction (shell + relevant-notes rail, file context menu, properties panel). Reference only; Abstract's execution follows the mock and the plan docs, not Obsidian.

Rule of precedence, verbatim from the plan-20 convention: **when this mock and the written spec disagree, the written spec wins.** The written spec is `docs/plans/43-editor-v2-spec.md`, which transcribes every pin with its px/hex values. Validators screenshot-diff the running app against this mock, but tick criteria against plan 43.
