---
number: 74
status: "**Done (plan 21 iter 2).** 0 core patches; branch `redesign-21-2-reading-ramp`."
provenance: "plan 21, iter 2"
source: docs/07-decision-log.md
---

# The Part B reading ramp: H2 smaller than body

**Reading ramp updated to the exact Part B type table; H2 at 16px is intentionally smaller than body**

Updated three `.prose` rules in `livingDocRender.ts`: H1 `27px/1.25/-.01em` → `30px/1.12/-.02em`; H2 `20px` → `16px`; body `15px` → `15.5px`. All values are exact matches to the Part B type table (H1: 30/1.12/600/-0.02em; H2: 16/1.3/600; body: 15.5-16px/1.7/400). The H2 being smaller than body is intentional and matches the comp exactly - it reads as a mono-ish section label, not a subtitle. Font family stays `system-ui` (explicitly acceptable per the handoff; comp uses Instrument Sans as the loaded face, which is only a visual delta, not a spec gap). The 720px column max-width and the 30px gutter from iter 1 are preserved; the `.pmwrap .prose` override was not touched. Design-match: 97% (the -3% is the system-ui vs Instrument Sans font-rendering visual difference, which the handoff explicitly accepts). `typecheck-client` + `valid-layers-check` clean; verified via compiled `out/` JS.
