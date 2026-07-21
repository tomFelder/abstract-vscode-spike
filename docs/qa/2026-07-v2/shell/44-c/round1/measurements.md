# 44-c round 1 - nav on chrome, raw measurements

Live drive: `TMPDIR=/tmp ./scripts/code-web.sh ./living-docs-sample`, session `shell-44c`, Playwright/Chromium, deviceScaleFactor 2-3. Numbers via `getBoundingClientRect` / `getComputedStyle`. Full JSON in `measurements.json`.

## Nav container (P3.1)

| Property | Measured | Expected |
|---|---|---|
| width | 76px | 76px |
| background-color | `rgba(0, 0, 0, 0)` (transparent - chrome `#EDEFF3` shows through) | no panel bg |
| border-right | `0px none` | none |

## Nav items (P3.2 active / P3.3 idle)

Active = Editor (after clicking the Editor nav item). Idle = Home/Templates/Knowledge/Agents. Chip width 60px on every item.

| Item | State | bg | color | radius | box-shadow | label weight | glyph | label size |
|---|---|---|---|---|---|---|---|---|
| Editor | active | `rgb(255,255,255)` #FFFFFF | `rgb(70,80,184)` #4650B8 | 10px | `rgba(20,22,28,0.05) 0 1px 2px` (e1) | 600 | 18px | 10px |
| Home | idle | transparent | `rgb(134,139,149)` #868B95 | 10px | none | 500 | 18px | 10px |
| Templates | idle | transparent | #868B95 | 10px | none | 500 | 18px | 10px |
| Knowledge | idle | transparent | #868B95 | 10px | none | 500 | 18px | 10px |
| Agents | idle | transparent | #868B95 | 10px | none | 500 | 18px | 10px |

- Chip height 45px; padding 8px top / 6px bottom; gap 3px (matches mock icon-nav).
- Home hover colour (real hover driven): `rgb(82,87,95)` = `#52575F` (slate). P3.3 hover.

## Settings pinned bottom (P3.3)

The settings item is VS Code's global-activity "Manage" gear (`codicon-settings-view-bar-icon`), pinned to the bottom of the activity bar at `top: 849px` (below the five nav items at top 50-230px), rendered quiet/faint per the plan-25 shipped treatment. "Accounts" sits just above it at top 816px. Both are well below the nav group, so Settings reads as bottom-pinned. (The mock labels the gear "Settings"; the shipped item is the stock "Manage" gear with the settings glyph - the criterion is "Settings pinned to the bottom", which holds.)

## Navigation (P3.4)

All five nav items (Home, Editor, Templates, Knowledge, Agents) clicked cleanly and switched the active surface (each screenshot shows the right surface + the matching active chip + matching header breadcrumb). No dead nav items after the top-bar removal.

## Sweep (PR.1)

Ten screenshots at 1440x900 and 1760x1000 (`<surface>-<viewport>.png`). Inspected each for clipped panels, scrollbar collisions, white-on-white seams and double headers: none found. Nav sits on chrome, cards float with 12px gaps, one 48px header per surface.
