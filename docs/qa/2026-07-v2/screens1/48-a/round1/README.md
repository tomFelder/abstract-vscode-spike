# Plan 48-a "Home" - round 1 evidence

Live captures of the v2 Home on `./living-docs-sample` (`code-web`, port 8083, Chrome for Testing, deviceScaleFactor 2), plus the numeric verification. Before-images: `../../00-baseline/`.

## Screenshots

- `home-allclear-1440x900.png` / `home-allclear-1760x1000.png` - the v2 Home dashboard on the sample folder. The sample ships **zero pending documents**, so this is the all-clear variant: greeting "Good morning." + real mono date "Wed 22 Jul", summary "Everything is in sync.", and the 4-col ALL DOCUMENTS grid (avatar + status chip + source count per card, dashed New-document tile last). No rails; the calm white card floats on chrome; header shows "＋ Open Folder".
- `home-empty-1440x900.png` / `home-empty-1760x1000.png` - the empty-project front door (a folder is open but has no documents). Unchanged content from baseline by design; 48-a only reshapes the dashboard + the true no-folder state.
- `coldstart-lands-in-editor-1440x900.png` - **do-not-break proof**: a cold start (no nav click) lands in the **Editor** with a document open, NOT on Home. Plan-42 light path unchanged.

## Why no live NEEDS-YOU / no-folder frame this round

- **NEEDS YOU (H2)**: the sample folder has no pending proposals, and producing one live needs an agent run against a model (unavailable in the web sandbox / light path). H2 is verified below by the rendered literals + the unit tests (`screenRender.test.ts`: the NEEDS-YOU card, the amber pill, the real reason with a line address, the freshness stamp, the "+N more" overflow, and the zero-pending absence).
- **True no-folder state (H1.5, #211 items 1-2)**: `code-web` always mounts a workspace folder, so the `hasFolder:false` state is not reachable live (the empty-dir instance lands on the empty-*project* front door instead). H1.5 is verified by the unit test that asserts the new plain-words copy AND a product-vocabulary word count of 0 over the visible copy.

## Numeric verification (rendered literals = computed values; these elements are inline-styled, no external CSS overrides them)

Measured from the transpiled `renderHome` output (`out/.../screenRender.js`) - the exact HTML the webview receives:

| Criterion | Expected | Measured |
|---|---|---|
| H1.1 column | max 1080, padding 64/48/80 | `max-width:1080px;margin:0 auto;padding:64px 48px 80px` ✓ |
| H1.2 greeting | 30/600/-0.02em nowrap | `font:600 30px/1.12 system-ui;color:#14161A;letter-spacing:-.02em`, `white-space:nowrap` ✓ |
| H1.2 date | mono 13 `#A3A8B2`, real date | `font-size:13px;color:#A3A8B2` -> "Wed 22 Jul" (real wall-clock date) ✓ |
| H1.3 summary | 14 `#868B95`, truthful count | `font:400 14px/1.5 system-ui;color:#868B95`; "1 document needs you · everything else is in sync." / "Everything is in sync." ✓ |
| H2.2 card | 3px accent top, radius 13 | `border-top:3px solid #5B6DC4;border-radius:13px` ✓ |
| H2.2 pulse dot | 8px, 2.4s | `width:8px;height:8px;border-radius:999px;background:#C99A2E;animation:lwdPulse 2.4s ease-in-out infinite` ✓ |
| H2.2 name | 14.5/600 | `font:600 14.5px/1.2 system-ui` ✓ |
| H2.2 pill | mono amber "N TO APPROVE", radius 999 | `color:#8A6D1A;background:#FDFAF2;border:1px solid #E4DCCB;border-radius:999px` -> "3 TO APPROVE" ✓ |
| H2.2 reason | plain-language, real line address | "…waiting on your call at line 6." (only when the change carries a real sourceLine) ✓ |
| H2.4 freshness | real relative time | "refreshed 2m ago" (from the doc's latest snapshot) ✓ |
| H3.1 grid | 4-col, gap 12 | `grid-template-columns:repeat(4,1fr);gap:12px` ✓ |
| H3.1 avatar | 26px | `width:26px;height:26px;border-radius:8px` ✓ |
| H3.1 chip | 20px pills | `height:20px;padding:0 8px;border-radius:999px` ✓ |
| H3.3 tile | dashed New document | `class="doc-newtile" … border:1px dashed #C6CAD2` + "New document" ✓ |

## H3.4 one-truth (chip == tree dot), verified against the shared `docRailDot` helper

| Doc | tree dot (docRailDot) | Home chip | Agree |
|---|---|---|---|
| Pending (pendingCount 3) | yellow | needs you | ✓ |
| Calm (living, 0 pending) | grey | in sync | ✓ |
| Plain (non-living) | grey | markdown | ✓ |

## Note on the greeting name

Live in the web sandbox the greeting reads "Good morning." with **no name**: `IPathService.userHome()` resolves to a path with no usable basename there, so the greeting honestly drops the name rather than showing a fabricated one (H1.2 "name from an existing honest source"; the unit test exercises the with-name path). On desktop this resolves to the real OS account name.

## Checks

- `npm run typecheck-client` - clean (exit 0, 0 TS errors)
- `npm run valid-layers-check` - clean (exit 0)
- `./scripts/check-seams.sh` - OK, all shell seams intact
- `./scripts/test.sh --grep "livingDocs"` - 306 passing, 0 failing (baseline 309; net -3 = pre-v2 dashboard surface assertions removed, replaced by honest v2 coverage; every delta accounted for)
