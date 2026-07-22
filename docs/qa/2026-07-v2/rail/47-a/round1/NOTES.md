# Bundle 47-a round 1 - evidence notes

Live web build (`./scripts/code-web.sh --port 8082 ./living-docs-sample`), headless Chrome via Playwright, deviceScaleFactor 2. The rail opens on the editor surface once a living document is active.

## Screenshots
- `00-workbench-context.png` - the v2 shell with a living document open (48px header, tree rail, editor).
- `01-review-tab-white-chip.png` - Review tab active as the white chip; tab strip Chat . Review . History; collapse chevron; empty Review state.
- `02-chat-tab-composer.png` - Chat tab active (white chip); full C6 composer anatomy: Edit-across working set, @mention Attach chips, + Skill / @ Mention buttons, accent send, honest "Model unavailable" health line.
- `03-history-tab.png` - History tab active (white chip); "VERSION HISTORY . <doc>" + Save version + empty state (PV.2 rehydration).

## Live numeric metrics (getComputedStyle, from the running rail)
Tab strip: height 45px (44px content box + 1px hairline), labels exactly `["Chat","Review","History"]` (Skills gone).
Active chip: height 28px, font `600 12.5px system-ui`, colour `rgb(26,28,32)` = #1A1C20, bg #fff, box-shadow `0 1px 2px rgba(20,22,28,.05)` (e1), radius 8px. [P13.3]
Idle tab: font `500 12.5px system-ui`, colour `rgb(134,139,149)` = #868B95. [P13.3]
Review badge: HIDDEN on a doc with zero pending (hide-at-zero confirmed live). [P13.4]

## Before/after (git-verified, HEAD~1 vs this branch)
Active tab: OLD = colour + 2px accent underline (::after); NEW = white chip 28px + e1, underline removed.
Badge: OLD = 9px, oklch(0.66 0.16 45), no min-width; NEW = 10/600, #C99A2E, min-width 16, centered, radius 999.
Address: OLD = <span> (inert); NEW = <button> cursor:pointer + hover underline, click -> revealBlockAddress.
