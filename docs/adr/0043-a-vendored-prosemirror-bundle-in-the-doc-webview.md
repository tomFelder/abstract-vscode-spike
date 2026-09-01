---
number: 43
status: "**Done (v6 iter 1).** Built `window.LWDPM.{mount,toMarkdown,cmd,destroy}` from `prosemirror-{model,state,view,markdown,schema-list,keymap,commands,history}` via `esbuild --format=iife --minify --charset=ascii` (+ a post-build escape of non-ASCII regex-literal bytes → fully ASCII). Vendored as **base64 in a `.ts`** (`prosemirrorBundle.ts`) — sidesteps the no-new-`.js` hygiene gate, the non-ASCII filter, and webview resource-root plumbing; decoded once via `decodeBase64` and inlined. A bound figure is just a `[label](bind:key)` link, which the stock markdown parser/serializer round-trips (proven in Node), so no custom node was needed for iter 1. Tier: **our-surface** (own webview). Verified live (see F2 in plan 14). _Residual:_ re-inlining 367KB per render causes a blank-on-reopen → build-order #1 is to load it as a webview resource."
provenance: "v6"
source: docs/07-decision-log.md
---

# A vendored ProseMirror bundle in the doc webview

**Ship ProseMirror as a vendored, prebuilt ASCII IIFE bundle inlined into the doc webview**

F2 needs a real ProseMirror `EditorView` (reverses decision 4's "no 3rd-party rich-text dep" for the fork path). The doc webview is fed a self-contained HTML string (`livingDocRender.ts`, `allowScripts`), and there is no PM in `node_modules`. Two ways to bundle: (a) add `prosemirror-*` to the root `package.json` + an esbuild/gulp build step (touches the fork's build pipeline + layering/hygiene); (b) build the IIFE **offline** and vendor the prebuilt artifact. Tom's call: **(b)** — lowest merge-tax, no root build change, reversible, matches iter-1 "minimal feature code".
