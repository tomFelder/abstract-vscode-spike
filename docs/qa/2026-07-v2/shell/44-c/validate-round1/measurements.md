# Bundle 44-c - VALIDATION ROUND 1 (adversarial re-measurement)

Validator: fresh eyes, refute-not-confirm. All numbers below are live `getComputedStyle` / `getBoundingClientRect` / real-mouse-hover readings on the REAL elements at `http://localhost:8080/` (session shell-44c-validate), branch `v2/shell-c` @ b3e401b, viewport 1440x900 unless noted. Raw JSON in `measurements.json`. Cites (#216).

## Automated checks (re-run, not trusted from the PR)

| Check | Result |
|---|---|
| `npm run typecheck-client` | clean (exit 0, no TS errors) |
| `npm run valid-layers-check` | clean (exit 0) |
| `./scripts/check-seams.sh` | OK - all shell seams intact (exit 0) |
| `./scripts/test.sh --grep "livingDocs"` | 309 passing, 0 failing (matches implementer's 309/0) |

## Pin 3 live measurements

### P3.1 - nav on chrome
- Nav container: width `76px`, background-color `rgba(0,0,0,0)` (transparent), border-right `0px none`.
- Workbench chrome behind it: `rgb(237,239,243)` = `#EDEFF3`. PASS.

### P3.2 - active chip (Editor)
- bg `rgb(255,255,255)` = `#FFFFFF`; colour `rgb(70,80,184)` = `#4650B8`; radius `10px`; border `0px`; width `60px`.
- box-shadow `rgba(20,22,28,0.05) 0px 1px 2px 0px`.
- active label (`::after`): weight `600`, size `10px`.
- active glyph (`::before`): `18px`. PASS.

### e1 shadow adjudication
Plan 20 Part B (`docs/plans/20-abstract-ui-redesign-handoff.md:95`) defines: **e1 card `0 1px 2px rgba(20,22,28,.05)`**. The rendered chip shadow is `rgba(20,22,28,0.05) 0px 1px 2px 0px` - the identical value, in the browser's canonical serialisation (colour first, explicit `0px` spread). This **IS e1 per the plan**, not an unverified guess. CONFIRMED.

### P3.3 - idle / hover / labels / glyphs / Settings
- Idle item (Home): colour `rgb(134,139,149)` = `#868B95`; bg transparent; label weight `500`, size `10px`; glyph `18px`.
- Hover (real mouse move onto Home): colour `rgb(82,87,95)` = `#52575F` (slate). PASS.
- Bottom of the bar: `Accounts` at top 816, then `Manage` gear (`codicon-settings-view-bar-icon`) at top 849 - both pinned below the five nav items (top 50-230). Gap 816-230 = 586px of chrome confirms bottom-pinning.

### Settings adjudication
The criterion text (plan 44 P3.3, spec 43 §2 pin 3) reads "Settings pinned bottom". The realised bottom item is the **stock VS Code Manage gear** (`codicon-settings-view-bar-icon`, aria-label "Manage") given the quiet plan-25 treatment, NOT a bespoke item literally labelled "Settings". Judging against the spec text (§2 wins over the mock per 43 §3.6): the spec's intent is "the settings entry point is present and pinned to the bottom of the nav" - the Manage gear IS VS Code's settings entry point (opens the global settings/manage menu), and it is measurably pinned to the bottom. Reusing the stock gear rather than inventing a parallel item is the correct engineering choice (no duplicate settings surface). The criterion is met in substance. PASS.

### P3.4 - navigation (5 items x 2 round trips)
All five items clicked twice; `.lwd-nav-active` tracked the click every time (Home->Editor->Templates->Knowledge->Agents, x2). Header content updated for Templates ("+ New Template"), Knowledge ("+ Add Source"), Agents ("5 agents active"). No dead items. **Zero new console errors** attributable to any of the 10 nav clicks (`newErrors: []` on every click).

Note (not a 44-c defect): clicking Editor with no document open keeps the breadcrumb on "Home". This is by design - the Editor nav opens the active/last Living Document and falls back to the document surface (`livingDocs.contribution.ts:534-551`); breadcrumb text is a 44-b (PH.2) concern, already merged, not 44-c scope. The active chip DID switch to Editor, satisfying P3.4.

### Console-error baseline
4 distinct errors load before any nav interaction and are stock VS Code web extension-host failures (`viewsExtensionPoint` extensionId, `viewDescriptorService` id, and `ERR_CONNECTION_REFUSED`/404 for the absent extension host). They are unrelated to the nav CSS and unchanged by navigation.

## PR.1 - five-surface sweep, both viewports
10 screenshots captured by the validator (home/editor/templates/knowledge/agents at 1440x900 and 1760x1000) plus two nav close-ups. Each inspected: single 48px header on every surface (no double headers), nav renders bare on `#EDEFF3` chrome, floating content cards with correct gaps, no clipped panels, no scrollbar collisions, no white-on-white seams. PASS.

## Diff audit
`git diff origin/main...v2/shell-c --stat` touches only `src/vs/workbench/contrib/styleOverrides/browser/media/studio.css` (+27/-15) plus docs/screenshots. No `src/vs/` file outside `styleOverrides`. Seam budget untouched (still 2/2). PASS.

## Out-of-scope routing flag (NOT a 44-c defect)
`screenRenderKnowledge.ts:127` renders the Knowledge subtitle with `&mdash;` ("Every source your documents depend on — where it comes from"). This em dash violates the no-em-dash / Australian-English house rule, is visible on the Knowledge surface, but PRE-EXISTS on origin/main and is owned by plan 49's screen render - untouched by 44-c (which is studio.css only). Flagging for routing to the plan-49 lane; does not fail PR.1 (pins 1-3 shell scope).
