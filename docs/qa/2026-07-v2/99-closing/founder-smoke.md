# Editor v2 wave - the standing founder desktop smoke (DoD item 7)

The web harness is the validated path for the whole Editor v2 wave (plans 44-49): every surface criterion was measured live on the web build at 1440x900 and 1760x1000. This note is the short list of things web **cannot** exercise, left for a 2-minute manual smoke of the packaged macOS desktop build (matching the decision 71 precedent). Nothing below blocks the wave - each is either desktop-only chrome or a harness artefact with a known, benign cause.

## The 2-minute checklist

Run the packaged desktop build on macOS, open the sample folder (`living-docs-sample`), and confirm:

### 1. macOS traffic-light inset on the 48px header (plan 44-b criterion)

This is the one desktop-specific header check. The 48px Abstract header repurposes the custom title bar part (decision 170); its `.abstract-header` overlay paints from x ~= 16px and bypasses the stock `.titlebar-left` reservation, so it does not inherit the macOS traffic-light padding.

Look at the **top-left corner of the header**:

- Do the macOS traffic lights (close / minimise / zoom) overlap the **left rail toggle** (the panel glyph)? They should NOT - the toggle must sit clear to the right of the three coloured buttons, fully clickable.
- Is the "A" logo tile + "Living Docs Sample" workspace name pushed far enough right that nothing collides with the traffic lights?

**If they collide**, the fix is a macOS-only left pad, CSS-only, no core change, no new seam:

```css
.style-override.mac .abstract-header { padding-left: 78px; }
```

It was deliberately **not** added pre-emptively: web has no traffic lights, so a blind 78px pad would shove the whole header cluster right on web (the measured path) and the correct `.monaco-workbench.mac` scoping cannot be verified on web. Full rationale: [`../shell/44-b/desktop-note.md`](../shell/44-b/desktop-note.md).

### 2. The rest of the header (spot-check on desktop, already web-validated)

Height 48px; hairline border-bottom `#E2E4EA`; breadcrumb updates on doc/surface change; per-surface right clusters; both rail toggles (28px); the pending-review amber badge dot. All measured live on web (plan 44-b `round1/`); desktop just confirms the native title-bar repurposing reads the same.

### 3. Rail toggles + the one sanctioned split (desktop chords)

`Cmd+\` toggles the tree rail, `Cmd+Shift+\` toggles the right rail, `Cmd+B` keeps its dual role; the stock split-editor is neutralised so editor groups stay at 1 except via the sanctioned "Open to the right" (pin 6). Web-validated; desktop confirms the native keybinding layer agrees.

## Known harness-only caveat (memfs watcher freshness, plan 49-a)

Not a desktop check per se, but the standing caveat the wave leaves behind: the **headless memfs watcher does not observe native-disk writes**, so on first load a just-loaded doc's `getFreshness` can read "synced" while a re-reading surface (the Knowledge table) correctly reads "stale". Loop 49-a's validator **disproved this as a code defect**: opening the two docs that bind `metrics.csv` forces `getFreshness` to re-read the aged source and the tree meta flips live to "stale" in the exact F12 amber token (`#8A6D1A`). The initial "synced" is purely the harness watcher not having fired. Two consequences on real disk that web cannot show:

- On a **real desktop disk** (native file watcher, not memfs), the freshness dot should update without needing the bound docs opened first - worth an eyeball on desktop, but the mapping itself is proven and unit-asserted (`livingDocsService.test.ts`).
- The re-sync **audit trail** writes to the in-memory lock only in the web harness (the memfs mount does not flush back to real disk); on desktop the `.lock.json` audit entry should persist to disk. Correct-by-construction in code; independently observable only on real disk.

Full adjudication: [`../screens2/49-a/validate-round1/README.md`](../screens2/49-a/validate-round1/README.md) ("Watcher adjudication" + "Re-sync audit trail").

## Verdict

Web is the validated path and is green (see this folder's `README.md`). The desktop smoke exists to confirm the two things web structurally cannot: the macOS traffic-light clearance on the repurposed title bar, and native-disk freshness/audit persistence. Both have known, CSS-only-or-benign remedies if the smoke turns anything up.
