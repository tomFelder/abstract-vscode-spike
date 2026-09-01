---
number: 50
status: "**Done (plan 15 iter 2).** `renderLivingDocHtml` now returns the shell (set once); `renderLivingDocContent` returns the `{ html, pmMd }` payload pushed as messages. The webview RUNTIME delegates all events on a persistent `#lwd-root` and, on each update, detaches the live PM node, swaps the body, and reattaches it (PM survives reparenting). A `lwdReady` handshake flushes any update that raced the load. Tier: **our-surface** (own renderer + editor). 0 core patches. Verified live: opening the Present modal / source-peek drawer updates the surface without remounting PM (same node + webview id); plain-doc edits persist; reopen no longer blanks; living docs keep rendering via `renderDoc` (F1-F6 green, 66 tests pass)."
provenance: "plan 15"
source: docs/07-decision-log.md
---

# Mount once, then message the doc webview

**The doc webview is a persistent surface: set the shell once, update via postMessage (mount-once-then-message)**

Rendering the doc previously called `setHtml` with the full HTML (incl. the ~370 KB inline ProseMirror bundle) on *every* change, which re-inlines the bundle and tears down + remounts the live PM editor each render. That is fine for the current renderDoc living docs (plain HTML) but is fatal to the goal of living docs *in* PM (every proposal/figure change would remount the editor and lose cursor/selection/scroll). Options to fix: (a) serve the bundle as a webview resource (`asWebviewUri`) so `setHtml` is cheap but still remounts PM; (b) **mount-once-then-message** — set the shell (chrome + bundle + a delegated runtime) once, then push only the dynamic body as `lwdRender` messages, preserving the live PM node across updates by detaching/reattaching it. Chose **(b)**: it is the only one that keeps the editor *alive* across re-renders (the real prerequisite for in-PM proposals/figures), and it needs no resource-root/file-write plumbing (so it stays our-surface, respecting decision 43). `IWebviewElement` has no `asWebviewUri` and the bundle is base64-in-TS (not a servable file), so (a) would have been more merge-tax for less benefit.
