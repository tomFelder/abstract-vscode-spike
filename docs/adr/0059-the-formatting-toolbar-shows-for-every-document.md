---
number: 59
status: "**Done (plan 16 iter 6, branch `calm-surface-6`, PR → `calm-surface-5`).** Tier: **our-surface, 0 core patches** (`livingDocRender.ts` gate). TDD: a render test asserts a plain doc gets the toolbar but not the sync bar / figure hint (9 render tests pass). Verified live web **and** desktop: a new blank doc shows the Paragraph/B/I/list/quote toolbar. **Final capstone desktop smoke (decision 38, fresh `/tmp/calm-iter6`):** cold launch is calm (no shell / banner / sign-in / toasts; `agents.json` hidden), New document → blank surface **with toolbar**, typing persists clean plain Markdown to real disk (0 `title:`, 0 `---`). **Calm-document rubric ~met (≥~90%):** G1 one quiet PM surface ✓, G2 calm header + universal toolbar ✓, G3 detached gutter + inline figures ✓, G4 reduced IDE optionality (activity bar now hidden) ✓, G5 source-peek bottom drawer ✓, G6 no dev toasts / nav never blanks ✓; plus every \"IDE in a trench coat\" tell from Tom's critique (footer, activity bar, tabs, breadcrumb, trust banner, sign-in, sidecars, injected frontmatter, false chat errors) is closed. _Honest residuals (minor, logged): chat streaming deferred (iter 5); \"Saved · v14\" is a mock version; the \"Edit raw Markdown\" affordance is living-only; the title bar keeps a minimal command-center + layout toggles by design._"
provenance: "plan 16"
source: docs/07-decision-log.md
---

# The formatting toolbar shows for every document

**Calm polish pass: the formatting toolbar shows for every PM document (plain or living); the stripped surface meets the calm-document rubric**

Iter 6 is the polish/audit sweep. The one concrete defect found across the loop: the calm formatting toolbar was gated `(isLiving && isPm)` in `renderLivingDocContent`, so a plain doc (incl. a freshly-created blank note from iter 3) opened with **no way to format** — wrong now that PM is the single editing surface (decision 53). Changed the gate to `(!!doc && isPm)`: B/I/headings/lists/quote are universal; the living-only chrome (the sync bar, the bound-figure hint) stays `isLiving`-gated. The broader calm-document audit (gate-by-gate, below) confirms the first-run path now reads as a writing tool, not an IDE.
