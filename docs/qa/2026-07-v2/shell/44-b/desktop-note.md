# Bundle 44-b desktop note (PH.6): the macOS traffic-light inset

The web harness is the validated path for this bundle. The one thing web cannot exercise is the **macOS desktop window's native traffic-light buttons** (close / minimise / zoom), which the OS draws in the top-left ~78px of the window when running the packaged Electron build. This note tells the founder exactly what to look at in the 2-minute desktop smoke.

## What the header does on desktop

The 48px Abstract header repurposes the custom title bar part (decision 170). On macOS desktop:

- The custom title bar's stock content (`.titlebar-left`, `.titlebar-center`, `.titlebar-right`, drag region) is hidden by studio.css; our `.abstract-header` overlay (`position:absolute; inset:0; padding: 0 16px`) paints on top. The header's **left rail toggle** therefore starts at **x ≈ 16px** from the window's left edge.
- macOS native draws the traffic lights over the top-left of the window (~0-78px). VS Code's stock title bar reserves that space via `.titlebar-left` platform padding (see `titlebarpart.css` `.monaco-workbench.mac .part.titlebar { flex-direction: row-reverse }` + the mac window-controls handling). Because our overlay bypasses `.titlebar-left`, it does **not** inherit that reservation.

## What to check (2-minute desktop smoke)

Run the packaged desktop build on macOS and open the sample folder. Look at the **top-left corner of the header**:

1. **Do the macOS traffic lights overlap the left rail toggle (the panel glyph)?** They should NOT. The toggle should sit clear to the right of the three coloured buttons, fully clickable.
2. **Is the "A" logo tile + "Living Docs Sample" workspace name pushed far enough right that nothing collides with the traffic lights?**

## If they collide (the likely fix)

If the desktop build shows the traffic lights sitting on top of the left toggle, the fix is a **macOS-only left padding** on `.abstract-header` to clear the ~78px inset - a one-line addition to studio.css scoped to `.monaco-workbench.mac`, e.g.:

```css
.style-override.mac .abstract-header { padding-left: 78px; }
```

This is CSS-only (no core change, no new seam) and would be a fast follow-up. It was **not** added pre-emptively because:

- The web harness (the validated path) has no traffic lights, so a blind 78px left pad would push the whole header cluster 78px to the right **on web**, breaking the web layout that this bundle's criteria are measured against.
- The correct scoping is `.monaco-workbench.mac` (desktop only), which cannot be verified on web. The founder's desktop smoke is the right place to confirm whether it's needed and that the scoped rule lands cleanly.

## Everything else is web-validated

Header height (48px), the hairline border (`#E2E4EA`), the breadcrumb, per-surface right clusters, both rail toggles (28px), ⌘\ / ⌘⇧\, collapse persistence across reload, and the badge-dot render were all measured live on the web build at 1440×900 and 1760×1000 (see `round1/`). Only the traffic-light clearance is desktop-specific and left for the founder smoke.
