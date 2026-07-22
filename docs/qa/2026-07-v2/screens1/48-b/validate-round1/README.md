# Plan 48-b - VALIDATION ROUND 1 (adversarial)

Bundle 48-b "Template cards + skeletons" (PR #230, plan 48, loop `(#226)`). Fresh-eyes validator; criteria = PR #230 body checklist (T1.1-T1.2, T2.1-T2.3, T3.1-T3.2), tolerances spec 43 §3.6, mock `Abstract Editor v2.dc.html` (spec wins).

Harness: `code-web.sh ./living-docs-sample --port 8083`, driven with `@playwright/cli` bundled Chromium (the Chrome MCP extension was not connected). Node 24, transpile-client, TMPDIR=/tmp. The screen body is a cross-origin OOPIF webview, so top-frame JS cannot read into it; per-check measurement method stated below (screenshot pixel-sampling via PIL / rendered-literal + override audit / in-page probe where reachable).

## Verdict: PASS (with 1 evidence-integrity defect + minor notes)

The code meets every 48-b criterion. The one defect is in the **implementer's PR evidence claim**, not the code: the PR comment and `48-b/round1` screenshot assert "Weekly report used 1x (1 provenance doc seeded)", but the live sample folder contains **no** `template: <name>` provenance document, so the honest, real-data count is **used 0x** for every template - which is exactly what the live surface renders. The criterion (honest usage from real lineage) is MET; the implementer's stated measurement is not reproducible.

## Checks (re-run)

| Check | Result | Method |
|---|---|---|
| `typecheck-client` | clean | re-ran |
| `valid-layers-check` | clean | re-ran |
| `check-seams.sh` | OK - all shell seams intact | re-ran |
| `test.sh --grep "livingDocs"` | **310 passing, 0 failing, 0 pending** | re-ran after transpile |

### Test accounting

310 passing matches the implementer's claim. `.only`/`.skip`/`xit` audit across the livingDocs test tree: **none** (the one `grep` hit is the string "mcp_error", not a modifier). Every removed/weakened test maps to a removed surface:
- `screenRender.test.ts`: the plan-28 templates block is replaced by v2 tests asserting the real bind-slot count, honest usage, skeleton bars (`#E0E5FB`/`#D5D8DE`/`#F6F7F9`), the four starters and their `newStarter` ids; `editTemplate` assertions dropped because the v2 card drops the Edit action (mapped). Away-feed / project-answer / failure-line tests removed because plan-48 Home retired those pre-v2 surfaces (48-a).
- `livingDocRender.test.ts`: per-webview top-bar/breadcrumb/avatar tests replaced by "draws no per-webview top bar" - the plan-44 global header now owns them (mapped removed surface).
- New coverage is additive and real-data: `countBindSlots`, `templateSkeletonRows` (deterministic), `listTemplateGallery` seeds two `template: Weekly report` + one other-template doc and asserts usage=2 (case-folded) and an honest 0 - this unit test independently proves the lineage mechanism.

Nothing weakened or deleted without a mapped removed surface.

## T1 - surface + filter

| Predicate | Expected | Measured | Method |
|---|---|---|---|
| Filter field size | 240 x 32 | 240 x 32 | pixel-sampling (span of `#FBFCFD`/`#E9EAEE` on the field) |
| Filter field bg | `#FBFCFD` | `#FBFCFD` | pixel-sampling (interior x1160) |
| Filter field border | `#E9EAEE` | `#E9EAEE` | pixel-sampling (left edge x1060) |
| Filter field radius | 9 | 9 (literal `.tpl-filter` shell CSS, no override) | rendered-literal + override audit |
| Header action | "+ New template" | "+ New **Template**" (title-case) | screenshot - see Defect 2 |
| Sub-line (T1.2) | exact | "Start a living document from a pattern. Sources bind after creation." | screenshot + rendered literal |
| Live filter | narrows cards, clear restores | 4 cards -> type "meeting" -> **1** (Meeting notes to SOP) -> clear -> **4** | in-page drive (real keystrokes) + screenshots `filter-meeting.png` / `filter-cleared.png` |
| Column max | 1180px | literal `max-width:1180px`, no override | rendered-literal audit |

Live filter fully exercised: STARTERS row correctly unaffected (filter targets `[data-filter]` cards only).

## T2 - template cards

| Predicate | Expected | Measured | Method |
|---|---|---|---|
| Grid | 3-col, gap 14 | 3 card boxes of 352px (350 thumb + 2x1 border), **14px** gap between boxes | pixel-sampling (thumbnail runs on y=280) |
| Card radius / e1 | 13 / `0 1px 2px rgba(20,22,28,.05)` | literals, no override; corner rounds ~2px near edge | rendered-literal + pixel corner check |
| Hover border/shadow | `#9AA2E0` + lifted shadow | **not reproducible via synthetic mouse into OOPIF**; literal `.tpl-card:hover{border-color:#9AA2E0;box-shadow:0 8px 24px -12px rgba(20,22,28,.2)}` present, no external overridable stylesheet | rendered-literal + override audit (live hover could not be driven - OOPIF limit; recorded honestly) |
| Thumbnail | 110px, bg `#F6F7F9`, border-bottom `#EEF0F3` | **110px**, `#F6F7F9`, `#EEF0F3` | pixel-sampling (canvas y-span 232->341; bottom border at y=341) |
| Skeleton bars | title `#D5D8DE` / prose `#E9EAEE` / slot `#E0E5FB` | `#D5D8DE` / `#E9EAEE` / `#E0E5FB` all confirmed | pixel column scan through Weekly thumbnail |

### Independent skeleton-vs-source proof (NON-featured template: "Meeting notes to SOP")

The implementer proved "Weekly report". I proved a template they did NOT feature. Source blocks of `Meeting notes to SOP.template.md`:
1. `# {{slot:process name}} - Standard operating procedure` -> H1 title bar; carries 1 `{{slot}}` -> one accent chip
2. `## Purpose` -> title bar (no binds)
3. prose line -> prose bar
4. `## Steps` -> title bar
5. prose line -> prose bar
6. `## Responsibilities` -> title bar (maxRows=6 cap reached)

Predicted skeleton kinds (cap 6): `[title, slots, title, prose, title, prose]`, with exactly ONE accent chip (the sole bind slot, the H1). Pure-function output confirmed identical; the live card shows "1 bind slot". The single accent bar sits right after the title bar - exactly where the one live-data position is. Honest.

Cross-checked Weekly report by pixel column scan: `#D5D8DE`(title) / `#E0E5FB`(slot) / `#E9EAEE`(prose) / `#E0E5FB`(slot) / `#D5D8DE`(title) / `#E9EAEE`(prose) = `[title, slots, prose, slots, title, prose]`, matching `templateSkeletonRows`.

### Authored throwaway template (validator-created)

Created `Zzz validator probe.template.md` (`template: true`, binds at row 2 and row 5, `sources: probe.csv`). Predicted: bindSlots = 1 slot + 2 binds = **3**; skeleton `[title, slots, prose, slots, title, prose]`. Live render (`templates-1440x900.png`): card "Zzz validator probe - 3 bind slots - used 0x", skeleton exactly as predicted. Template deleted after; file confirmed absent from disk. (Grid still showed the card after a cache-busted code-web reload - a code-web static/worker-cache artifact, not a 48-b criterion; live-delete reflection is T2.6 / bundle 48-c scope.)

### T2.3 usage lineage - the honesty check

`listTemplateGallery` tallies `fromTemplate` provenance across `_collectDocs` (which excludes `.template.md`). Exhaustive grep of `living-docs-sample`: the only `template:` frontmatter lines are the three `template: true` template files; **zero** documents carry `template: <name>` provenance. Therefore the honest count for every template is **0x**, which is exactly what the live surface renders (Client update / Meeting notes to SOP / Weekly report / probe all "used 0x"). The service unit test independently proves the count-2 / count-0 mechanism with seeded lineage. Real data, honest 0 - criterion MET.

## T3 - starters

STARTERS row: 4 cards - Blank living doc / Project brief / Meeting notes / Metrics digest, each with its one-line purpose, `#FBFCFD` bg (pixel-sampled), radius 13, no thumbnail. Visually subordinate (13/600 name, 12 muted purpose; shorter, thumbnail-less vs the 110px-thumb YOUR TEMPLATES cards). Live round-trip (`starter-projectbrief.png`): clicking "Project brief" created a doc named "Project brief" via `createDocument` (the existing review-safe path), opened it empty (no fabricated prose, decision 17), tree row present with an honest grey/new dot. It is an untitled-until-first-save editor (decision 56) - nothing written to disk, so nothing to clean up; ephemeral by design.

## Regression

- Cold start lands in the **Editor**, not Home (light path, plan 42) - `00-workbench-load.png`.
- Home (48-a) renders; v2 icon-nav on chrome intact.
- **Use button** still opens the `generateFromTemplate` sheet ("New document from a template", name + note, Generate Draft) - today's behaviour, unchanged; 48-c will upgrade it (`use-sheet.png`).

## Defects

1. **(evidence integrity, low)** PR #230 comment + `48-b/round1/*` screenshots claim "Weekly report used 1x (1 provenance doc seeded)". No such provenance doc exists in `living-docs-sample`; the live, real-data count is **0x**. The code is correct and honest; the implementer's stated measurement is not reproducible. Repro: `grep -rn "^template: " living-docs-sample --include='*.md' | grep -v 'template: true'` -> empty; open Templates -> every card "used 0x".
2. **(copy, low)** Header action renders "+ New **Template**" (title-case) but criterion T1.1 + mock say "+ New template" (lowercase t). House style (title-case for buttons) is defensible, but the literal criterion text is lowercase. Cosmetic; button present and functional.

Neither defect blocks the bundle; both recorded for the author.

## Files
Screenshots in this folder; measurements in this README (PIL pixel-sampling done inline, no artifacts left).
