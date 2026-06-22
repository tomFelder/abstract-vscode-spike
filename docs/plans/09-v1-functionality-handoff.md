# Living Documents - v1 functionality & UX loop (clean session)

You are taking the **Opportunity OS / Living Documents** spike from "looks like the comp" to
"**works like a v1**". The visual match is already strong (~86% vs the Claude Design after a 10-iteration
design-audit, PR #9). Your job now is **functionality and UX**: make every surface the comp implies
actually *do* what it promises, make the agentic loop *real*, and make the whole thing *feel* like a
product you'd ship - not a prototype with static panels.

> **Status update (read this — the model is already wired).** Plan 10 (`living-docs-model`, PR #11,
> merged) made the agentic features **model-backed via a localhost Anthropic OAuth proxy** — NOT via
> `ILanguageModelsService` (that dependency was removed). So criterion 1 (Review-impact model rewrite)
> and the model half of criterion 3 (Strategy grader) are **done**. **Do not re-do the "wire a model"
> step below** — instead start at the **Chat agent (criterion 2)**, reusing the proxy. See
> [`../10-model-integration.md`](../10-model-integration.md) for how the model transport works
> (`livingDocsService._callModel` → proxy `/v1/messages`, `livingDocs.modelProxyUrl`,
> `stop_reason:"refusal"` → graceful fallback). Run the proxy before any model-dependent work:
> `./scripts/lwd-anthropic-proxy.sh` (Anthropic OAuth; needs Console credits), or the dev test backend
> `LWD_BACKEND=openrouter OPENROUTER_API_KEY_FILE=~/.config/lwd-openrouter.key ./scripts/lwd-anthropic-proxy.sh`.

Read this whole doc before starting. It is seeded with hard-won lessons so you do not repeat dead ends.

## The goal + acceptance criteria (v1)

> **Goal:** a v1 where every core surface is **functional and polished** - the agentic loop is real
> (model-backed), no control is a dead placeholder, navigation never blanks, and the experience feels
> calm and trustworthy. Hold the visual match at **>= 85%** (don't regress the design work) while
> lifting **functional behaviour** to the bar below.

**v1 is reached when ALL of these are true** (score each 0-100; v1 = every line >= 85 and nothing
visibly broken):
1. **Agentic loop is real.** ✅ **DONE (plan 10, PR #11).** A context change -> Context panel ->
   Review impact now yields a genuine model rewrite (verified live: a tone-aware meaning change at 90%
   confidence, not the heuristic note) -> lands in the Review rail -> approve applies / reject reverts.
   Nothing more needed here unless you want to also surface model rewrites on the *agent-run* path
   (today only the Context "Review impact" button triggers meaning rewrites).
2. **Chat is a working agent.** The composer is a real input; @mention files; the agent replies using
   the document + sources; tool-call steps render; "Approve all / Review each" still work.
3. **Skills run for real.** Financial (deterministic, done) + Formatting (deterministic, done) +
   **Strategy** (model-backed: claims vs the Knowledge decision stack — ✅ **DONE plan 10**: NO MODEL ->
   READY -> real PASS/FLAG, verified live) + Run/Re-run (done). **Remaining gap:** **Apply fix** must
   actually edit the document (e.g. Formatting's heading-case fixes; a Strategy/Formatting suggested
   edit applied to the prose). That's the open part of this criterion.
4. **Editor is a real editor.** Formatting toolbar (bold/italic/heading/list/quote) edits prose;
   provenance gutter dots are clickable and reveal the source cells; the comp's **source-peek + "Sync
   across" side pane** works (open a CSV beside the doc, edit, sync the figures with a diff); raw-
   Markdown round-trips (done).
5. **Context is complete.** Linked sources + Referenced files render from real data (done); add the
   comp's **Pasted text / Images / Company knowledge** groups + **Add context** - this needs a small
   `context`-kind data-model extension (today `doc.context` is just file-path strings).
6. **No dead ends, no rough edges.** Every button does something or is honestly disabled; navigating
   between any surfaces never blanks (nav bug fixed iter 6 - keep it fixed); the dev-build extension-
   activation error toasts are gone; the doc subtitle tracks the resolved week; empty states read well.
7. **Core flows pass functional tests** (TDD) and a **live click-through** in the web build.

Record per-criterion scores + a short "what works / what's rough" note every iteration in
`docs/design-audit/log.md` (continue the same log). **Stop when all 7 criteria are >= 85 and the live
click-through is clean, or after 12 iterations.**

## The model is already wired (plan 10) — start at the Chat agent

The language model is no longer the blocker — plan 10 wired it via a **localhost Anthropic OAuth proxy**
(`scripts/lwd-anthropic-proxy.js`), reachable from the renderer through `livingDocsService._callModel`
(model `claude-opus-4-8`, adaptive thinking; `stop_reason:"refusal"`/errors fall back to the heuristic).
`_hasModel()` probes the proxy `/healthz`; `_modelImpact` and `_gradeStrategy` POST it. **There is no
`ILanguageModelsService` anymore.** Full detail: [`../10-model-integration.md`](../10-model-integration.md).

So the highest remaining lever is the **Chat agent (criterion 2)** — build it on `_callModel` (same
transport), not a new provider. Before any model-dependent iteration, start the proxy (see the Status
note up top); confirm it with `curl -s localhost:8090/healthz`. If the Anthropic Console org still has
no credits, run the proxy's **OpenRouter test backend** so the live click-throughs work; either way the
service code is unchanged. Keep the no-model fallback intact (honest, tested).

## Setup (unchanged from the audit)

- Repo `/Users/tommy/Sites/abstract-vscode-spike`. **Branch `living-docs-v1` off `main`** — after PR #11
  merges, `main` carries the design-audit gains *and* the model-proxy wiring this plan depends on
  (verify with `git cat-file -e main:scripts/lwd-anthropic-proxy.js`). Open ONE `living-docs-v1` PR;
  commit each iteration; PRs embed before/after screenshots.
- **Start the model proxy** before model-dependent iterations: `./scripts/lwd-anthropic-proxy.sh`
  (Anthropic OAuth — needs Console credits), or `LWD_BACKEND=openrouter OPENROUTER_API_KEY_FILE=~/.config/lwd-openrouter.key ./scripts/lwd-anthropic-proxy.sh`
  for a cheap dev model. `curl -s localhost:8090/healthz` should return `{"ok":true}`.
- Node 24: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.15.0`.
- `npm run watch` (own long-lived bg process). `npm run typecheck-client` to type-check `src/`.
  Tests: `./scripts/test.sh --grep "LivingDoc|AgentOrchestrator|screenRender|Present modal"` (runs
  against `out/` - wait for watch to recompile the changed `.js` first; grep for "OUT updated").
- Run + drive the app: `./scripts/code-web.sh ./living-docs-sample` -> http://localhost:8080, driven
  with the **chrome-devtools MCP** (open the base URL; `?folder=` does NOT work). Screenshots must be
  saved inside a workspace root (e.g. `/Users/tommy/Sites/abstract-vscode-spike/docs/design-audit/shots/`).
- **Design reference (DesignSync):** project **"Agentic Workbench"** `d198ca07-9eef-4d05-96e1-b383e6c19c03`,
  file **`Living Documents - Workbench.dc.html`** (the comp; inline styles = the spec; its `screenshots/`
  are rendered-state references). The comp is a *static prototype* - it does not define backend
  behaviour, so for the *functional* bar use product judgement + this doc, not just the comp.

## The loop (per iteration)

1. Read `docs/design-audit/log.md` (full history + the v1 criteria scores). Pick the single
   highest-impact unmet criterion (lowest score x most central to the product).
2. If it is a real feature/behaviour: **brainstorm briefly if non-trivial**, then build it with
   **TDD** (`superpowers:test-driven-development`) for any real logic. Keep everything inside the
   `livingDocs` contrib - **0 added core patches** (update `docs/plans/03-merge-tax-ledger.md` + justify
   if you genuinely must add one).
3. **Verify live in the web build** (not just unit tests) - click the real flow through with the
   chrome-devtools MCP and confirm it works and *feels* right.
4. Log it: criterion, before/after screenshots (commit PNGs under `docs/design-audit/shots/`), what
   changed, new per-criterion scores.
5. `typecheck-client` clean + tests green, then one commit per iteration; push.
6. Re-score. Stop at the v1 bar (all 7 >= 85, clean click-through) or after 12 iterations; then post a
   final functional-readiness summary on the PR.

## Hard-won lessons (do not relearn these)

- **The app is MORE complete than a visual survey suggests.** Many surfaces were scored low at baseline
  only because they were *unverified*, not missing (Knowledge OKRs, canvas, editor diff/approve all
  turned out built). **Verify before assuming missing** - open the surface, click it, read the code.
- **chrome-devtools MCP can drop mid-session** (the page falls to `about:blank` and the server dies -
  it happened once, NOT from a pkill). Do **not** `pkill` its Chrome. If it dies, the fallback is a
  short **Playwright render-to-PNG** script: the `screenRender.ts` / `livingDocRender.ts` outputs are
  pure HTML strings, so you can render them faithfully headless (import the compiled `out/...js`; stub
  `globalThis.window` only if you import `livingDocRender` which pulls `vs/base/browser`). But for v1's
  functional click-throughs you really want the live MCP - a session restart restores it.
- **Reaching the populated Review rail** (the approve/reject flow): change a context source
  (`market-research.md`), open the doc, **Context panel -> "Review impact"**. `reviewImpact` treats
  each non-bound paragraph as an influence target and queues changes. Figures *auto-resolve* on every
  render, so the *agent* run path queues nothing - the Context "Review impact" button is the entry
  point. (Pre-model: heuristic suggestions; post-model: real rewrites.)
- **The nav blank-out bug** (fixed iter 6): low-level webviews (`createWebviewElement`+`mountTo`) reload
  blank when their editor pane is hidden then re-shown (DOM re-parent) and don't re-apply HTML. Fix was
  to recreate the webview on `setEditorVisible(true)` in `ScreenEditor`. If you add more webview editors,
  use the same pattern (or the `overlayWebview` claim/layout pattern).
- **Web build caches** the builtin-extension scan + theme in **IndexedDB** and `product.json` at server
  start - clear/restart after editing a builtin manifest or rebrand.
- **Key files** (`src/vs/workbench/contrib/livingDocs/`): `livingDocsService.ts` (the engine: bindings,
  freshness, reviewImpact, verify-gate graders, agents); `common/livingDocsModel.ts` (clean-file + lock
  data model); `common/livingDocs.ts` (service interface); `browser/livingDocRender.ts` (doc editor HTML
  + Present modal); `browser/screenRender.ts` (Home/Templates/Knowledge/Agents screens + canvas);
  `browser/reviewRailView.ts` (Chat/Review/History/Skills rail); `browser/contextPanelView.ts` +
  `common/contextGroups.ts` (Context panel); `screenEditor.ts` / `livingDocEditor.ts` (the webview panes).
  **Model transport:** `livingDocsService._callModel` POSTs the proxy at `livingDocs.modelProxyUrl`
  (default `http://localhost:8090`); the proxy is `scripts/lwd-anthropic-proxy.js` — see
  [`../10-model-integration.md`](../10-model-integration.md). The Chat agent should reuse `_callModel`.
- **Hygiene (husky precommit blocks):** tabs only; **no non-ASCII in source** (use HTML entities in
  webview HTML, `\uXXXX` in TS strings); no `in` operator; no `querySelector` in workbench code; double
  quotes reserved for nls strings; no raw `setInterval`/`setTimeout`; DI ctor non-service args before
  `@IService` args. End commits with
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Scoring honesty (weighted to behaviour for v1):** a surface that looks right but whose buttons do
  nothing is NOT v1. Note explicitly "real / honest-stub / model-gated". Don't fake capability (a chat
  that can't actually respond is worse than honest); make it real or honestly disabled.

## v1 backlog (priority order, from the audit's deferred list)

0. ~~**Wire a language model**~~ ✅ **DONE (plan 10, PR #11)** — localhost OAuth proxy + `_callModel`;
   Review-impact rewrites and the Strategy grader are model-backed. Start at item 1.
1. **Chat composer -> real agent** (input, @mentions, tool-call render, model reply) — build on
   `_callModel` / the proxy. **The first iteration.**
2. **Apply-fix** (Formatting/Strategy suggested edits actually edit the doc) — the open half of
   criterion 3; the Strategy/Financial graders themselves are done.
4. **Editor source-peek + "Sync across" pane** (the comp's signature editing interaction).
5. **Context kinds** (Pasted text / Images / Company knowledge + Add context; needs a context-kind
   model extension - `doc.context` is currently `string[]`).
6. **Provenance dots clickable** -> reveal source cells (the `revealSource` service method exists).
7. **Polish:** suppress dev-build extension toasts; dynamic doc subtitle (track resolved week);
   tighten empty states; KPI-table styling vs the comp.

## How to run this (paste into the fresh session)

```
/goal Take Living Documents to v1 functionality + UX (per docs/plans/09-v1-functionality-handoff.md): every core surface works and feels polished, the agentic loop is model-backed and real, no dead controls, navigation never blanks. Hold visual match >=85%. Tracked in docs/design-audit/log.md.

/loop Run one v1 iteration following docs/plans/09-v1-functionality-handoff.md: pick the highest-impact unmet v1 criterion, brainstorm if non-trivial, build it with TDD inside the livingDocs contrib (0 core patches), verify it live in the web build via chrome-devtools MCP, log before/after screenshots + per-criterion scores, typecheck + tests green, commit on the living-docs-v1 PR. Stop when all 7 v1 criteria are >=85 with a clean live click-through, or after 12 iterations.
```

`/loop` with no interval self-paces (one iteration per turn). The model is already wired (plan 10), so
the very first iteration should be the **Chat agent (criterion 2)** built on `livingDocsService._callModel`
— start the proxy first (Status note up top). Criteria 1 and the Strategy half of 3 are already done;
re-score them from the current state rather than rebuilding.

## After the loop
Summarize functional readiness per criterion (before -> after); list anything still deferred; ensure the
v1 PR body has the latest before/after screenshots and a clear "what's real vs stubbed" table; update
the `living-docs-*` memories with where v1 stands.
