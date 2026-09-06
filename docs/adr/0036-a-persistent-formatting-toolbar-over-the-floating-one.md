---
number: 36
status: "**Done (v4 iter 3, PR #17).** 0 core patches (own `livingDocRender.ts`: CSS `.etoolbar` + `docToolbar`, sticky under the 48px header; removed `.seltoolbar`/`placeSelToolbar`; the generic `[data-fmt]` handler now passes `data-fmt-arg` so Heading/Quote work). TDD: header test re-spec'd (7 passing). Verified live + all six gates green; coexists with the source drawer. Editor 82→96."
provenance: "v4"
source: docs/07-decision-log.md
---

# A persistent formatting toolbar over the floating one

**The editor carries a persistent calm formatting toolbar — reverses the v3 floating-selection-toolbar choice**

v3 (decision-era note in `06-design-notes`) replaced the old comp's heavy toolbar with a floating selection toolbar, reasoning "the comp has no persistent toolbar". The revised "Workbench v2" comp **does** carry a persistent toolbar, pared to essentials (borderless `Heading 2 ▾` + B/I/U + list/ordered/quote + a quiet "● Saved · v14"; no Link-to-source / Run-skill / History). The premise of the floating-toolbar decision no longer holds, and the comp is authoritative for "indistinguishable" — so the persistent calm toolbar is correct now
