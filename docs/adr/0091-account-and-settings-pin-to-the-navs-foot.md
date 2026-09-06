---
number: 91
status: "**Done (plan 25 iter 2).** 0 core patches; branch `redesign-25-2-nav-chip`."
provenance: "plan 25, iter 2, C1"
source: docs/07-decision-log.md
---

# Account and settings pin to the nav's foot

**Account + settings pinned to the bottom of the 76px bar — style-only, functionality untouched**

The comp pins a quiet account (person) + settings (gear) pair at the bottom of the nav (19px glyph, `faint` #A3A8B2, no label). 25.1's `studio.css` had *hidden* both (they were "IDE tells"); 25.2 reverses that: the core `GlobalCompositeBar` already renders them as the last child of the activity bar's `.content` div, which the core `.composite-bar { margin-bottom: auto }` rule already floats to the bottom — so no repositioning was needed, only styling (`> .content > div:not(.menubar):not(.composite-bar)`: 44px items, faint glyph, `::after{content:none}` to drop the label row). Clicking still opens the accounts / manage menus (verified visible + functional). **Tier: our-surface CSS, 0 core patches.**
