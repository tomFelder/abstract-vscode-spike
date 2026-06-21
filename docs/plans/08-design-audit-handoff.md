# Living Documents - design-audit loop (clean session)

You are auditing the **Opportunity OS / Living Documents** spike against the **Claude Design** (the
locked hi-fi comp) and closing the gap, iteratively. The engine, the de-IDE'd Studio shell, the
clean-file + lock **format/graph** (PR #5), and the **orchestration** layer - triggers, graph
event-bus, per-edge policy, verify gate, lifecycle hooks, live Agents view (PR #6) - are all built and
merged into `living-docs-design-match`. The app works, but it is still a long way from the design.

**This session has ONE job: run ~10 audit iterations comparing the Claude Design to the running app,
and each iteration close the single highest-impact gap** - implement a missing feature/component, or
(if present) test its functionality + information architecture against the design and fix what's
wrong. Commit each iteration on a running audit PR with before/after screenshots and a logged score.
**Stop when the overall match is >= 90% with core flows functional, or after 10 iterations.**

## The goal + success criteria

> **Goal:** reach **>= 90% visual + functional match** between the current app and the Claude Design,
> surface by surface, with the core flows actually working.

Score each surface 0-100 across five dimensions, then average across surfaces for the overall number:
1. **Layout / structure** - regions, grid, ordering match the design.
2. **Visual styling** - color, type ramp, spacing, radius, iconography match.
3. **Component completeness** - every component the design shows is present (not a placeholder).
4. **Information architecture** - navigation, labels, grouping, and flow match the design's intent.
5. **Functional behaviour** - the surface does what the design implies (not just looks right).

"90%" means: near-pixel layout + all key components present + IA correct + core flows functional, with
only minor polish gaps remaining. Record the per-surface and overall score every iteration so progress
is measurable.

## Surfaces to audit (the comp's set)

Home dashboard - Documents home (sidebar) - the **document editor** (rendered view: provenance gutter
dots, bound values, KPI table, inline diff/review) - **Context panel** (freshness) - **Agents view +
workflow canvas** - **Review / Chat / History / Skills** right panel - **Knowledge** - **Templates** -
**Present / export modal**. Survey all in iteration 1; then attack lowest-scoring first.

## Setup

- Repo: `/Users/tommy/Sites/abstract-vscode-spike`. **Work on branch `living-docs-design-audit`** (already
  cut off `living-docs-design-match`); push commits there and open ONE audit PR (base
  `living-docs-design-match`). Add commits to that PR each iteration; if an iteration lands a discrete,
  reviewable feature, a separate stacked PR is fine too.
- Node 24 REQUIRED: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.15.0`.
- `npm run watch` (own long-lived background process; never with a trailing `&` inside another bg job).
  `npm run typecheck-client` to type-check `src/`. Tests: `./scripts/test.sh --grep "LivingDoc|AgentOrchestrator"`
  (runs against `out/` - wait for the watch to recompile the changed `.js` first).
- **Pull the reference design via the `DesignSync` tool** (the Claude Design connector - see the
  `abstract-vscode-spike-build` memory). Pull the frame(s) for the surface you're auditing this
  iteration. If the exact Claude Design file/URL or a frame name is unclear, ASK Tom before guessing.
  The companion HTML in `docs/` (`option-10-living-docs-format.html`, `orchestration-automations.html`)
  are secondary references, not the source of truth.
- **Run + screenshot the app:** `./scripts/code-web.sh ./living-docs-sample` -> http://localhost:8080.
  Drive + screenshot with the **chrome-devtools MCP** (open the base URL; `?folder=` does NOT work).
  `take_screenshot` `filePath` must be inside a workspace root (e.g. `/Users/tommy/Sites/.lwd-shots/...`),
  NOT `/tmp`. Capture the design and the app at the **same viewport** for a fair diff.

## The audit loop (per iteration)

1. **Read the audit log** (`docs/design-audit/log.md`) for the current per-surface scores; pick the
   single highest-impact gap (lowest score x most user-visible). Iteration 1: survey every surface and
   seed the log with baseline scores + screenshots first.
2. **Pull the design** for that surface via `DesignSync`; **screenshot the current app** surface.
3. **Diff** them: list discrepancies under (a) layout, (b) styling, (c) missing components, (d) IA,
   (e) behaviour. Be specific (what, where, design-value vs app-value).
4. **Close the gap:**
   - If a feature/component is **missing or visually off** -> implement it. Use TDD for any real logic
     (`superpowers:test-driven-development`); match the surrounding code; keep it inside the
     `livingDocs` contrib (**0 added core patches** - update `docs/plans/03-merge-tax-ledger.md` if you
     must add one, and justify it).
   - If it is **present** -> exercise its functionality + IA against the design (click through the real
     flow in the web build) and fix bugs / wrong labels / wrong grouping.
5. **Log it:** append to `docs/design-audit/log.md` - iteration #, surface, before/after screenshots
   (commit the PNGs under `docs/design-audit/shots/`), the discrepancy list, what changed, and the
   **before -> after score** for that surface + the new overall.
6. **Verify + commit:** `typecheck-client` clean and tests green, then one commit per iteration on the
   audit branch; push. Husky precommit must pass.
7. **Re-score.** If overall >= 90% with core flows functional, **stop early** and summarize. Otherwise
   continue to the next iteration (cap at 10).

## Scoring honesty

Do not inflate scores. A surface that "looks close" but whose buttons do nothing is not >= 90% - the
functional dimension drags it down. Prefer fixing real behaviour over cosmetic polish when both are
open. Note explicitly when a gap is **a design feature not yet built** vs **a bug in built behaviour**.

## Conventions (husky precommit blocks commits)

**tabs only** (even inside template literals); **no non-ASCII in source** (HTML entities in webview
HTML, `\uXXXX` escapes in TS strings - `textContent` does not decode entities); **no `in` operator**
(`Object.prototype.hasOwnProperty.call`); **no `querySelector`/`querySelectorAll` in workbench code**
(walk `parentElement` + `hasAttribute`, or dom `h()`) - webview `<script>` strings are exempt;
**double-quoted strings reserved for nls-externalized strings** (single quotes/backticks otherwise);
**no raw `setInterval`/`setTimeout`** (use `mainWindow.setInterval` / a DOM window); DI ctor non-service
args BEFORE `@IService` args; declare service deps in the constructor. End commit messages with:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. **PRs must embed screenshots**
(commit them under `docs/design-audit/shots/` and reference by raw GitHub URL on the audit branch).

## Gotchas (learned this build)

- **chrome-devtools MCP:** do NOT `pkill` all of its Chrome processes - that disconnects the MCP server
  for the rest of the session. If a stale Chrome blocks a new page, close the page via the MCP, or
  start a fresh session. **Fallback if the MCP is unavailable:** the repo has Playwright
  (`node_modules` + `browser-chromium`); you can render the real `renderScreenHtml` / `renderLivingDocHtml`
  output to PNG with a short Playwright script (see PR #6's Item 7 for the pattern) - faithful to
  production render code, just not driven through the running workbench.
- Web build caches the builtin-extension scan + theme in **IndexedDB** (clear after editing a builtin
  extension manifest) and `product.json` at server startup (restart on rebrand).
- The Context panel reads the **active editor**; clicking inside a webview does not refocus its editor
  group, so open the doc from the Documents list (or close side editors) before reading the panel.
- `@vscode/test-web` serves the workspace over a layered FS: disk edits to sources are read fresh, but
  the OS file-watcher / staleness flag may not auto-flip. Drive freshness via the in-app actions, or
  rely on the unit tests for the dirty-bit logic.

## How to run this (paste into the fresh session)

```
/goal Reach >=90% visual + functional match between the current Living Documents app and the Claude Design, surface by surface, with core flows working - tracked in docs/design-audit/log.md.

/loop Run one design-audit iteration following docs/plans/08-design-audit-handoff.md: pull the relevant surface from the Claude Design via DesignSync, screenshot the current app, diff them, close the single highest-impact gap (implement a missing feature with TDD, or test+fix a built one), update docs/design-audit/log.md with before/after screenshots and scores, verify (typecheck + tests), and commit on the living-docs-design-audit PR. Stop when the overall match is >=90% with core flows functional, or after 10 iterations.
```

`/loop` with no interval self-paces (one iteration per turn). Keep going until the success criteria or
the 10-iteration cap; then post a final summary comment on the PR with the score trajectory.

## After the loop
Summarize the score trajectory (baseline -> final, per surface); list any design features still
deferred; ensure the audit PR's body has the latest before/after screenshots; update the
`abstract-vscode-spike` / `living-docs-*` memories with where the design now stands.
