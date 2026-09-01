---
number: 171
status: "**Decided.** Plan 45 bundle-b + plan 46's menu item; contract fixed in plan 43 §3.2 so lanes never negotiate mid-flight."
provenance: "plan 43 pin 7"
source: docs/07-decision-log.md
---

# Abstract's own product tab strip

**Product tabs are Abstract's own 40px tab row inside the editor card, rendered in the editor pane host DOM (never inside the webview); VS Code tabs stay `showTabs:'none'`; sources open as tabs on the same strip; "Open to the right" is the ONE sanctioned split (a second group with its own tab row; closing the last tab closes the group); no drag-to-split, no reorder-into-groups; ~8 visible tabs then overflow**

The working set needs visible parallel surfaces (docs + sources) without re-admitting IDE tab semantics the calm shell removed. Pane-host DOM avoids webview re-render flicker and the "replace the group header" core seam the mock flagged as possible; the drawer stays the quick provenance peek while a tab is for working in the source.
