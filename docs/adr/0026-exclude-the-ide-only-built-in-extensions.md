---
number: 26
status: "**Done (v2 iter 6, PR #15). FIRST v2 core patch** (tier: **core-patch**) — a 3-id denylist filter in `builtinExtensionsScannerService.ts`. Product-correct (not just a dev fix) and surgical/reversible. Verified live: the three toasts are gone, the launch + click-through is clean (G6 PASS). Evidence toward greenfield (Q3): the calm shell needed exactly one tiny core seam across six iterations."
provenance: "v2"
source: docs/07-decision-log.md
---

# Exclude the IDE-only built-in extensions

**Exclude the IDE-only first-party builtins (emmet / git-base / merge-conflict) from the product**

A word processor doesn't want emmet abbreviations, git plumbing, or merge-conflict decorations; these are also the builtins whose web bundle 404s in the `@vscode/test-web` dev run, firing "Activating extension '...' failed: Not Found" toasts on every launch (gate G6). The builtin set is injected (dev: DOM, prod: build) and read by the web `BuiltinExtensionsScannerService` — the one place to exclude them is that scanner
