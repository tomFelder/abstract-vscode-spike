# Living Documents — format implementation handoff (clean session)

You are continuing the **Opportunity OS / Living Documents** spike. The engine is proven (PR #1, merged),
the shell reads as a calm document app (Studio de-IDE, PR #2, merged), and a **design-match + build-out
round** on `living-docs-design-match` implemented the rest of the locked comp's surfaces (Home, Templates,
Knowledge, Agents+canvas, Present modal, Chat/History/Skills tabs, clean icon nav). **This phase has ONE job:
replace the document format with the approved "clean file + lock file" model and build the dependency graph
that keeps a document current when its sources change.** This is the foundational layer everything else
(provenance, trust, the influence-dependency moat) sits on — do it before building more on top.

## Read first (the decision is already made — do not re-litigate it)
- **`docs/08-living-documents-format-spec.md`** — the approved spec. This is your contract. It settles the
  format (Option 10: clean `<doc>.md` + generated `<doc>.lock.json`), the bind-link syntax, the lock schema,
  the two dependency kinds (value bindings vs influence dependencies), the two-phase architecture (cheap
  always-on staleness → expensive on-demand "Review impact"), the trust guardrails, the multiplayer posture,
  and the full decision log. **§6 is your scope; §7 is your acceptance test.** Build exactly that.
- **`docs/option-10-living-docs-format.html`** — the companion visual (the clean-file + lock-file anatomy on
  the Weekly Operating Summary). Open it in a browser for the target rendering of bind links + the gutter dot.
- `docs/05-open-questions.md` — Q1 (format) is now **resolved by spec 08**. Q2 (editor depth) and Q3
  (fork-vs-greenfield) are still open; the format in spec 08 is deliberately chosen to survive both — keep it
  that way (identity-keyed, never text-position-keyed).
- `docs/plans/03-merge-tax-ledger.md` — the discipline: **0 added core patches**. Everything here is our own
  contribution + service code, so this phase should add zero. Keep it that way and update the ledger if not.
- Memories: `abstract-vscode-spike-build` (Node 24 gotcha, web-build verify, DesignSync = the design connector),
  `opportunity-os-living-docs`, `living-docs-fullapp-decisions`.

## Repo / branch / build
- Repo: `/Users/tommy/Sites/abstract-vscode-spike`. **Branch `living-docs-format` off `main`** once the
  build-out PR has merged; otherwise branch off `living-docs-design-match`.
- Node 24 REQUIRED: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.15.0`
- `npm run watch` (background; keeps `out/` compiled) — DO NOT background it with a trailing `&` inside another
  background job; run it as its own long-lived process. `npm run typecheck-client` to type-check `src/`.
- Tests: `./scripts/test.sh --grep "LivingDocsService"` — **runs against `out/`, so wait for the watch to
  recompile** the changed `.js` before running.
- Visual verify: `./scripts/code-web.sh ./living-docs-sample` serves http://localhost:8080; drive + screenshot
  with the chrome-devtools MCP (open the base URL; `?folder=` does NOT work). chrome-devtools `take_screenshot`
  `filePath` must be inside a workspace root (e.g. `/Users/tommy/Sites/.lwd-shots/…`), NOT `/tmp`. GOTCHAs:
  server caches `product.json` at startup (restart on rebrand); the web build caches the builtin-extension scan
  + theme in **IndexedDB** (clear it after editing a builtin extension manifest).
- Conventions (husky precommit blocks commits): **tabs only** (even inside template literals — single
  left-aligned strings); **no non-ASCII** in source (HTML entities/ASCII); **no `in` operator**
  (`Object.prototype.hasOwnProperty.call`); **no `querySelector`/`querySelectorAll`** (walk `parentElement` +
  `hasAttribute`, or use dom `h()`); **double-quoted strings are reserved for nls-externalized strings** (use
  single quotes or backticks otherwise); DI ctor non-service args BEFORE `@IService` args; declare service deps
  in the constructor (not via `IInstantiationService` elsewhere). One commit per item; keep type-check + tests
  green each time. End commit messages with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- PRs **must include screenshots** (drive the web build, capture before/after, embed in the PR body).

## What you are replacing (current format code)
- `common/livingDocMarkdown.ts` — the current `.living.md` parse/serialize. Today bindings are
  `<!-- bind id=… cells=… -->` HTML comments and api blocks store `{cell}` templates on disk. **This is what
  the bind-link format replaces.**
- `common/livingDocsModel.ts` — the doc/block/binding model types. Gains the lock-file types.
- `browser/livingDocsService.ts` — the brain (the agent loop, figure-auto-apply / meaning-change-approve,
  source reads, audit). Gains lock read/write, bind-link resolution, hash-based staleness + dirty-bit, and the
  "Review impact" pass. The audit currently lives in memory / a `.audit.json` notion — fold it into the lock.
- `browser/livingDocRender.ts` — the doc webview. Renders bind links as plain text + a blue gutter dot.
- The review rail (`browser/reviewRailView.ts`) and its `getAllPending`/`approve`/`reject`/audit flow already
  exist — **route all impact results through it. Do not invent new review UX.**

## Work items — in order, one commit each, verify against spec 08.

**ITEM 1 — Bind-link format: parser + serializer (replace the HTML-comment scheme).**
Parse/serialize the clean `.md` with inline `[value](bind:source.field)` links (spec §3.2). The bind link IS
the anchor (no line numbers, no slugged ids that drift). Frontmatter declares `sources:` and `context:` lists
(spec §3.3). Keep generic Markdown rendering working for non-living `.md`.
Acceptance: a `.md` with bind links round-trips through parse→serialize unchanged; the visible link text is the
resolved value so the file reads correctly standalone.

**ITEM 2 — `.lock.json` schema + read/write + rendered-cache reconciliation.**
Implement the lock schema in spec §3.3 (`version`, `bindings`, `context`, `claims`, `pins`). The lock is the
**source of truth for resolved values + freshness**; on render/save, reconcile the `.md`'s visible link-text
cache to the lock's `resolved` value (**lock wins**). Spike persists the lock as a sidecar `<doc>.lock.json`
(production will platform-store it — keep the read/write behind a small seam so that swap is trivial).
Acceptance: editing a source value and re-syncing updates `bindings[].resolved` + `sourceHash` + `syncedAt`;
the rendered doc shows the new value; the `.md` link-text cache is reconciled.

**ITEM 3 — Staleness detection (cheap, always-on) — the dirty bit.**
A correlated file watcher (`fileService.createWatcher`) / source poll hashes each source; on change, flip a
**dirty bit** for affected bindings/context and surface a *"may be affected"* flag. **Never touches prose.**
Value bindings (`bindings`) use exact hash compare; influence sources (`context`) just flag staleness.
Acceptance: changing `metrics.csv` marks the bound doc dirty (hash mismatch); changing a `context:` source
flips its freshness to ⚠ — both with zero model calls.

**ITEM 4 — The Context panel (left) with freshness status.**
A left panel listing the document's `context:` sources (whole-document granularity, spec §3.5) each with
✓ current / ⚠ changed-since-review. This is an additive view (mirror `documentsView.ts`/`screenLauncherView.ts`
patterns). Reverse provenance ("why is this here?" → which context informs a paragraph) is a stretch within
this item; the panel + freshness is the must.
Acceptance: the Context panel lists sources with correct ✓/⚠ status driven by the dirty bits from Item 3.

**ITEM 5 — "Review impact" (expensive, on-demand) → the existing review rail.**
A **"Review impact"** trigger runs a model pass (via `ILanguageModelsService` / Agent Host, with the existing
heuristic fallback when no model — and per spec §3.6 guardrail 3, **no eager rewrites**; per the trust memo,
"no model available" should be a visible state, not a silent degrade). It reads the *diff* of a changed source
against the doc and returns **candidate edits with provenance + confidence**. Figure-class auto-applies;
meaning/influence changes queue as red/green inline diffs with Approve/Reject + an audit entry **in the lock**.
Acceptance: change a `context:` source → ⚠ → "Review impact" → candidates appear in the review rail → approve →
flag clears, lock `claims`/`context` updated, audit entry written.

**ITEM 6 — Migrate the sample `.living.md` documents to the new format.**
Convert `living-docs-sample/*.living.md` (spec §4): HTML-comment binds → inline `[value](bind:…)`; `{cell}` api
templates → resolved bind links; `.audit.json` → merged into `.lock.json`. **Add a `context:` source** (e.g.
`market-research.md`) to at least one doc so the influence path is exercised end-to-end. Treat this as a
learning exercise — expect it to surface format issues; fold fixes back into Items 1–5.
Acceptance: the migrated docs open, render with blue dots, and drive both paths (value auto-apply + influence
flag → Review impact).

**ITEM 7 — Tests + verification (spec §7).**
Extend `test/browser/livingDocsService.test.ts`: bind-link round-trip; lock read/write; staleness dirty-bit;
impact-pass heuristic path; migration of a `.living.md` fixture. Keep assertions snapshot-style where possible.
Then the web-build pass in spec §7 with chrome-devtools screenshots for the PR.

## Trust guardrails to honor throughout (spec §3.6 — these are the product, not polish)
No silent value breakage (bind links self-anchor); prose claims fail **loudly** (low-confidence re-link prompt,
never silent re-attach); no eager rewrites (flag, don't auto-edit); confidence-gated routing (figures may
auto-stage, sentiment always waits); pinning/snapshots schema field reserved; reverse provenance available.

## Deferred — named, NOT built this phase (spec §6)
Section/claim-level influence edges; scheduled freshness agent; CRDT text layer; salient-fact semantic gating;
entity index for "mentioned everywhere"; pinning UI (reserve the schema field); cloud/platform persistence
(stay on sidecar files, behind the read/write seam from Item 2).

## After all items
Summarize; run the full verify (type-check + tests + a chrome-devtools screenshot pass per spec §7); update the
merge-tax ledger (expect **0 added core patches**); update the memories; open a PR **with screenshots**. Then
the next phase opens up: connect-a-source UI + one real connector, persistence hardening, and the agentic
ecosystem — all of which now have a real format + dependency graph to build on (see the backlog in
`docs/plans/05-next-phase-handoff.md`).
