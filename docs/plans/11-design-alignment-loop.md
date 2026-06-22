# Living Documents - design alignment & UX/UI loop (v2 shell, clean session)

You are taking the **Opportunity OS / Living Documents** spike from "**works like a v1**" to "**feels
like the product we designed**". Functionality is done (plan 09, PR #13, merged): every core surface
is functional, the agentic loop is model-backed, no product control is a dead placeholder. **Your job
now is the SHELL - information architecture, UX, UI, and visual fidelity** - aligning the running app
to the **"Agentic Workbench" hi-fi comp** at **>= 95%**, surface by surface, while making the whole
thing feel **calm, opinionated, and single-surface** (Word / Google Docs / Notion - **not** a
customizable VS Code IDE).

> **The document surface already reads like a word processor** (it's our own webview). The gap is
> almost entirely the *surrounding shell*: the left rail, the header, and - most abrasively - VS
> Code's editor-group **split panes** (a v1 regression: opening a source spawns a second editor group,
> often leaving one pane blank). See [`../06-design-notes.md`](../06-design-notes.md) for Tom's
> standing design intent (D1-D4 + "remove optionality, not just hide chrome").

Read this whole doc before starting. It is seeded with hard-won lessons and three architectural calls
Tom has already made (below) so you do not re-litigate them or repeat dead ends.

## Architectural calls already made (do NOT re-decide these)

1. **Source-peek / Sync-across become in-surface panels, NOT editor splits.** The v1 implementation
   opened the CSV and the source view in a VS Code `SIDE_GROUP` editor group. That is the abrasive
   split-pane / blank-pane behaviour. **Replace it** with an in-document side panel / overlay inside
   the one calm surface (the comp's "Sync across" pane). No second editor group, ever.
2. **Build the design's left tree-rail.** Implement the comp's single ~264px rail with tabs
   **Files / Context / Outline / Search** and a folder tree (Reports / Clients / Sources / Templates),
   departing from the current activity-bar-per-view split. (This reverses the spike-era "activity bar
   as nav" choice for the v2 shell - see decision log [`../07-decision-log.md`](../07-decision-log.md).)
3. **Core patches are now ALLOWED where the design genuinely needs them** - each logged in
   [`03-merge-tax-ledger.md`](03-merge-tax-ledger.md) with its tier + justification. The prior loops
   held 0 core patches; faithful layout / single-surface / bespoke-rail work may need a core seam.
   Prefer the cheapest tier that works (settings -> theme -> styleOverrides-CSS -> additive-contribution
   -> core-patch); when you must patch core, that is also **evidence toward greenfield** (Q3) - note it.

## The goal + acceptance criteria (v2)

> **Goal:** the running app aligns to the Agentic Workbench comp at **>= 95%** overall (UX / UI / IA /
> visual), and **feels like one calm, opinionated surface** - no abrasive edges, no VS Code optionality
> leaking through. Hold functionality at the v1 bar (don't regress plan 09's behaviour).

**v2 is reached when ALL of these are true:**

- **Overall alignment >= 95%** - mean across surfaces, each scored 0-100 on **Layout, Styling,
  Components, IA, Interaction/UX** (behaviour is already at the v1 bar; weight the *experience*).
- **Every "hard UX gate" below passes** (these encode the specific abrasions Tom called out):
  1. **No split editor groups, no blank panes.** Opening a source / syncing shows an **in-surface
     panel**, never a second editor group. There is never an empty editor group on screen.
  2. **The header is calm and light** - matches the comp's single 48px bar; not heavy or cluttered.
  3. **The left rail matches the comp** - one tree-rail (Files / Context / Outline / Search + folder
     tree), not separate activity-bar containers.
  4. **No VS Code optionality leaks** - no draggable panes/panels, no split editors, no "reopen editor
     with", no command palette surfaced to the user, no editor-group close/tab affordances. Remove the
     optionality, don't just hide it (Tom: "feels far too customizable, like the VS Code product").
  5. **Provenance gutter is detached** from the prose (design-notes D1) and the document + review rail
     are pixel-aligned to the hi-fi (D4).
  6. **Navigation never blanks** (keep the iter-6 fix) and **the dev-build extension-activation toast
     is gone** (now in scope - core patches allowed).
- **A clean live click-through** in the web build with none of the above regressing.

Score each surface + the hard gates every iteration in the design-audit log (continue
`docs/design-audit/log.md`, the v2 section). **Stop when overall >= 95% AND every hard gate passes AND
the click-through is clean, or after 10 iterations.**

## The loop (per iteration)

1. **Iteration 1 is the AUDIT (no code).** Produce/maintain **`docs/design-audit/v2-inventory.md`**:
   for every surface in the comp, two columns - **"Exists today"** (what the running app actually does,
   verified live) vs **"Design intends"** (from the comp) - plus a per-surface alignment score and a
   ranked gap list. This is the map the rest of the loop closes. Verify before assuming missing (the
   app is more complete than a survey suggests - see lessons).
2. **Each later iteration:** pick the single highest-impact unmet gap (most abrasive x most central;
   the split-pane abrasion is #1). **Brainstorm briefly if non-trivial**, then build it. Use **TDD**
   (`superpowers:test-driven-development`) for real logic; for pure layout/visual work, add a
   structural/snapshot assertion where it's meaningful and lean on the live click-through otherwise.
3. **Verify live in the web build** via the chrome-devtools MCP - and **explicitly re-check every hard
   UX gate for regressions** (especially: did anything reintroduce a split/blank pane?).
4. **Document as part of the iteration** (Tom's explicit requirement - the loop is not done until the
   docs reflect reality):
   - architecture decisions -> append to [`../07-decision-log.md`](../07-decision-log.md) (ADR row +
     rationale + status);
   - design-intent changes / new gaps found -> [`../06-design-notes.md`](../06-design-notes.md);
   - any core patch -> [`03-merge-tax-ledger.md`](03-merge-tax-ledger.md) (tier + justification);
   - the per-surface inventory + scores -> `v2-inventory.md` and the design-audit log; commit
     before/after PNGs under `docs/design-audit/shots/`.
5. **`typecheck-client` clean + tests green**, then **one commit per iteration; push**.
6. **Re-score.** Stop at the v2 bar (>= 95% + all hard gates + clean click-through) or after 10
   iterations; then post a final design-readiness summary on the PR.

## Setup

- Repo `/Users/tommy/Sites/abstract-vscode-spike`. **Branch `living-docs-design-v2` off `main`** (after
  PR #13 merges, `main` carries the v1 functionality this builds on). Open ONE `living-docs-design-v2`
  PR; commit each iteration; PRs embed before/after screenshots.
- **Start the model proxy** before model-dependent click-throughs: `./scripts/lwd-anthropic-proxy.sh`
  (Anthropic OAuth - needs Console credits), or
  `LWD_BACKEND=openrouter OPENROUTER_API_KEY_FILE=~/.config/lwd-openrouter.key ./scripts/lwd-anthropic-proxy.sh`
  for the cheap dev backend. `curl -s localhost:8090/healthz` should return `{"ok":true}`.
- Node 24: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.15.0`.
- `npm run watch` (own long-lived bg process). `npm run typecheck-client` to type-check `src/`. Tests:
  `./scripts/test.sh --grep "LivingDoc|AgentOrchestrator|screenRender|Present modal|livingDocs"` (runs
  against `out/` - wait for watch to recompile; grep the watch log for "Finished compilation").
- Run + drive: `./scripts/code-web.sh ./living-docs-sample` -> http://localhost:8080, driven with the
  **chrome-devtools MCP** (open the base URL; `?folder=` does NOT work). Screenshots must be saved
  inside a workspace root (e.g. `docs/design-audit/shots/`).
- **Design reference (DesignSync):** project **"Agentic Workbench"** `d198ca07-9eef-4d05-96e1-b383e6c19c03`,
  file **`Living Documents - Workbench.dc.html`** (the comp; inline styles = the pixel spec; its
  `screenshots/` are rendered-state references). For the *experience* bar, use this comp + Tom's intent
  in [`../06-design-notes.md`](../06-design-notes.md), not just literal pixels.

## Hard-won lessons (do not relearn these)

- **The document webview is the good part; the SHELL is the gap.** Don't redesign the document body
  (it reads like Word already); spend the budget on the left rail, header, panes, and removing IDE
  optionality.
- **The split-pane regression is the #1 abrasion.** v1's `revealSource` / `openSourceBeside` /
  `syncFromSources` open editors in `SIDE_GROUP` (`livingDocsService.ts`, `livingDocEditor.ts`). Rip
  that out in favour of an in-surface panel. Grep `SIDE_GROUP` in the contrib to find every site.
- **`@vscode/test-web` serves CACHED file reads** - an *external* edit to a source isn't re-read on
  Refresh. To see a sync/figure change live, edit the source **in-app** (and save). This bit the v1
  loop repeatedly.
- **chrome-devtools MCP can drop mid-session** (page falls to `about:blank`, server dies). Do **not**
  `pkill` its Chrome - close pages via the MCP. If it dies, restart the session; a Playwright
  render-to-PNG of the compiled `screenRender`/`livingDocRender` HTML is the headless fallback.
- **The nav blank-out bug** (fixed iter 6): low-level webviews reload blank when their pane is hidden
  then re-shown; recreate the webview on `setEditorVisible(true)`. Keep this fixed; reuse the pattern.
- **Web build caches** the builtin-extension scan + theme in IndexedDB + `product.json` at server
  start - clear/restart after editing a builtin manifest, theme, or rebrand.
- **Hygiene (husky precommit blocks):** tabs only; **no non-ASCII in source** (HTML entities in webview
  HTML, `\uXXXX` in TS strings - the harness sometimes normalizes literals, but don't rely on it); no
  `in` operator; no `querySelector` in workbench code (webview `<script>` strings are exempt); double
  quotes reserved for nls; no raw `setInterval`/`setTimeout`; DI ctor non-service args before
  `@IService` args. End commits with
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Key files** (`src/vs/workbench/contrib/livingDocs/`): `livingDocsService.ts` (engine + `SIDE_GROUP`
  callers); `browser/livingDocEditor.ts` + `screenEditor.ts` (webview editor panes); `browser/
  livingDocRender.ts` (doc editor HTML + toolbar + the v1 "Sync across" banner); `browser/
  reviewRailView.ts` (Chat/Review/History/Skills rail); `browser/contextPanelView.ts` +
  `common/contextGroups.ts` (Context panel); `browser/documentsView.ts` + `screenLauncherView.ts` (the
  left-nav views to consolidate into the tree-rail); `livingDocs.contribution.ts` (containers, views,
  startup, hide-explorer). The Studio chrome lives in `styleOverrides/browser/media/studio.css`.

## v2 backlog (priority order)

1. **Kill the split-pane abrasion (THE FIRST code iteration).** Redesign source-peek + "Sync across"
   as an **in-surface panel/overlay** in the document surface; remove every `SIDE_GROUP` open; ensure
   there is never a blank/empty editor group. Disable user-facing split/optionality (gate 4).
2. **The left tree-rail** - one rail with Files / Context / Outline / Search tabs + a folder tree
   (Reports / Clients / Sources / Templates), replacing the activity-bar-per-view split.
3. **Calm the header** - align to the comp's single 48px bar; cut the heaviness/clutter.
4. **Provenance gutter detach** (design-notes D1) + pixel-align the document + review rail (D4).
5. **Remove VS Code optionality** - no drag, no split, no "reopen editor with", no command palette, no
   editor-group close/tab affordances (gate 4). Remove, don't just hide.
6. **Dev-build extension-activation toast gone** (emmet/git-base/merge-conflict 404 in `@vscode/test-web`)
   - now in scope; the cheapest fix is excluding those unused first-party builtins from the dev run.
7. **Per-surface pixel alignment** to the comp (Home / Templates / Knowledge / Agents / Present modal /
   Context / the rail) for the last points to 95%.

## How to run this (paste into the fresh session)

```
/goal Take Living Documents to >=95% design alignment with the "Agentic Workbench" comp (per docs/plans/11-design-alignment-loop.md): a calm, single-surface, opinionated shell (Word/Docs/Notion, not a customizable IDE). Kill the split-pane/blank-pane abrasion (in-surface panels, no editor splits), build the design's left tree-rail, calm the header, detach the provenance gutter, remove VS Code optionality, and pixel-align each surface. Hold v1 functionality. Core patches allowed where the design needs them, logged in the merge-tax ledger. Tracked in docs/design-audit/.

/loop Run one v2 design-alignment iteration per docs/plans/11-design-alignment-loop.md. Iteration 1: audit only - build docs/design-audit/v2-inventory.md (Exists-today vs Design-intends + scores + ranked gaps), no code. Later iterations: pick the highest-impact unmet gap (split-pane abrasion first), brainstorm if non-trivial, build it (TDD for logic; core patches allowed, logged in plans/03-merge-tax-ledger.md), verify live via chrome-devtools MCP AND re-check every hard UX gate for regressions, update the decision log (07) + design notes (06) + v2-inventory + design-audit log with before/after screenshots, typecheck + tests green, one commit on the living-docs-design-v2 PR. Stop when overall >=95% AND every hard UX gate passes AND the live click-through is clean, or after 10 iterations.
```

`/loop` with no interval self-paces (one iteration per turn). **Iteration 1 is the audit** (no code);
the **first code iteration is the split-pane redesign**. Documentation (decision log + design notes +
inventory) is part of every iteration's definition of done - the loop is not complete until the docs
reflect the shipped state.

## After the loop
Summarize design readiness per surface (before -> after) + each hard UX gate (pass/fail -> pass); list
anything still deferred; ensure the v2 PR body has the latest before/after screenshots and a clear
"what aligned vs what's still off" table; confirm the decision log, design notes, and merge-tax ledger
are current; update the `living-docs-*` memories with where the v2 shell stands.
