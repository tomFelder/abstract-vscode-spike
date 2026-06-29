# Plan 17 — "Off the Golden Path" UX loop

**Mandate (Tom, 2026-06-29 night):** Stop polishing the one thin, narrow golden path.
Actually *use* the product like a slightly-unpredictable human, clicking around, and find
where the experience falls down. The software currently works on the rehearsed happy path but
feels undesirable to move through. Fix that. Many small PRs, stacked off `main`, left open for
morning review. Up to ~50 iterations; quality over count.

Follows [[16-calm-surface-loop]]. Build/verify mechanics unchanged from the build memory:
`npm run watch` + `./scripts/code-web.sh ./living-docs-sample` (http://localhost:8080) driven by
the chrome-devtools MCP; OpenRouter proxy on :8090 for chat. Every PR gets before/after shots.

## Method

For each iteration: pick the highest-value friction from the backlog → reproduce it live →
make the surgical fix (prefer additive config / our-surface, log any core patch) →
`npm run typecheck-client` + `valid-layers-check` → re-verify live with before/after screenshots →
commit on a `plan17-N-*` branch off `main` → open a PR with the shots. Re-verify the calm-surface
HOLD gates are not regressed.

## Baseline exploration (2026-06-29, cold boot, storage cleared)

Toured every main surface off the rehearsed path: cold boot, the Workspace rail, the native
Explorer, Home, Templates, Knowledge, Agents, a living-doc editor (Board Note), bound-figure
source-peek. Findings, prioritised:

### P0 — first impression / content fidelity
1. **Cold boot lands on the native VS Code Explorer**, not the calm "Workspace" rail. The user's
   first sidebar is `.vscode`, a raw file list, plus Outline + Timeline accessory panes — the exact
   "IDE in a trench coat" the calm-surface loop set out to kill. The calm Workspace rail
   (Files/Context/Outline/Search tabs, Reports + Sources groupings) is one click away but is not the
   default. *Fix: force the Workspace sidebar view active on startup; keep Explorer reachable
   (decision 42 / F1 disk ops).*
2. **Markdown tables render as raw pipe-text.** The flagship sample "Board Note" leads with a
   metrics table; the vendored ProseMirror bundle has no table support, so the whole table renders
   as one literal paragraph: `| Metric | Previous | ... | $41.2k | $48.6k | +18% | ...`. Any document
   with a table looks broken. *Fix: add GFM table support to the PM bundle (markdown-it rule +
   schema nodes + serializer); bound figures must still render inside cells.*

### P1 — naming / state honesty
3. **Editor breadcrumb shows the editor *type* ("Living Document"), not the document name.** Opening
   "Board Note" shows `Abstract / Living Document`. *Fix: title from the resource/doc name.*
4. **Review-rail empty copy is stale & context-blind.** "No changes waiting. Open a Living Document
   and click 'Refresh from sources'." shows verbatim on the Home/Templates/Knowledge/Agents screens
   *and* when a living document is already open. *Fix: context-aware empty states.*
5. **Activity-nav clutter.** The calm nav (Workspace / Home / Templates / Knowledge / Agents) is
   joined by the native "Explorer", "Accounts", and "Manage" (gear) — IDE tells. *Fix: hide
   Accounts/Manage; resolve Explorer vs the rail's own file ops.*
6. **Home greeting leaks the memfs mount name.** "mount — 4 documents · 2 living." The folder reads
   as `mount` (the web `/static/mount` mount point). *Fix: friendlier folder label; verify desktop.*

### P2 — polish / verify
7. Window/tab title is the old brand "Opportunity OS" when no editor is active.
8. Source-peek highlights the *latest* CSV row even when a *previous*-bound figure is clicked.
9. Verify Templates/Knowledge/Agents action buttons (Generate draft, Edit, +New agent, Run now,
   +add sources) are wired or degrade honestly — no dead-ends.
10. New-document on-ramp, plain-doc, and empty-folder states (needs more exploration).

## Iteration log

- **Iter 1 — PR #39 `plan17-1-workspace-default`** (fixes backlog #1). Cold boot now lands on the calm
  Workspace rail, not the native Explorer. `StudioStartupContribution` opens the Workspace view on
  startup (re-asserted once on the next tick). 0 core patches.
- **Iter 2 — PR #40 `plan17-2-doc-name-crumb`** (fixes #3, stacked on #39). Topbar crumb now names the
  open document (`Abstract / Board Note`) instead of the editor type (`Living Document`). 0 core patches.
- **Iter 3 — PR #41 `plan17-3-review-empty-states`** (fixes #4, stacked on #40). Review rail empty copy
  is context-aware: names the open doc, or invites opening one — no more stale "Open a Living Document
  and click 'Refresh from sources'." on every screen. 0 core patches.
- **Iter 4 — PR #42 `plan17-4-drop-fake-version`** (new find, stacked on #41). The editor toolbar showed
  a fabricated `Saved · v14` on every document — identical on all of them, including brand-new blank
  ones. Tom is anti-fake-data; dropped the made-up version, leaving an honest "Saved" (the editor
  autosaves; staleness is the sync pill's job). 0 core patches.

- **Iter 5 — PR #43 `plan17-5-render-tables`** (fixes backlog #2, stacked on #42). GFM tables now render
  as real read-only tables instead of raw pipe-text. Added a `table_block` atom node to the vendored PM
  bundle: it captures the table's Markdown at parse time, renders it as an HTML table (cells reuse
  markdown-it inline rendering; `bind:` links become clickable `.bound` spans so source-peek still works),
  and serializes the captured Markdown back verbatim → byte-for-byte round-trip (build gate + a new repo
  test). Read-only matches the "figures are bound, not hand-edited" stance; the raw-Markdown toggle is the
  edit path. Calm board-report table CSS. 0 core patches.

- **Iter 6 — PR #44 `plan17-6-generate-draft-cta`** (fixes part of #12, stacked on #43). The Templates
  screen's primary CTA "Generate draft" was wired to nothing (no `data-msg`, while its siblings
  "Review diff" / "Export" were wired) — the most prominent button on the screen did nothing on click.
  Wired it to open the previewed draft document (Weekly Operating Summary), the honest outcome for the
  mock. Full template-driven generation from prompt + sources is logged as future work. 0 core patches.

- **Iter 7 — PR #45 `plan17-7-honest-unbuilt-buttons`** (finishes #12, stacked on #44). Audited every
  screen button: only three were dead-ends (no `data-msg`) — Templates "Voice", Agents "+New agent",
  Knowledge "Edit" (the rest are wired). These are genuinely unbuilt features, so rather than silently
  doing nothing they now wear a quiet "Soon" tag and read as inactive (honest > broken). Tom to decide
  later whether to build or remove each. 0 core patches.

- **Iter 8 — PR #46 `plan17-8-calm-hint`** (calm polish, stacked on #45). The living-doc hint bar was a
  permanent two-sentence tutorial re-explaining the whole bound-figure + review model on every open.
  Trimmed to one calm line ("Figures stay bound to their sources. Click one to trace it back to the
  data.") keeping the "Edit raw Markdown" escape hatch. 0 core patches.

### New findings from this pass
- **#11 fake version number** — fixed in iter 4.
- **#12 dead CTAs on the screens** — RESOLVED. Static audit of every screen button: Templates
  "Generate draft" was the one wired-to-nothing primary CTA (fixed iter 6); "Voice" / "+New agent" /
  "Edit" are unbuilt features now flagged "Soon" (iter 7). All other buttons (Agents rows/open/run,
  filters, Review diff, Export, Home cards, folder/new-doc) are wired. Remaining honesty nits (lower
  priority): the Templates `crm` / `api` source chips reference sources not in the folder; `+add source`
  is decorative.
- **#13 blank new-doc has no placeholder** — "New document" opens a stark white canvas; a faint "Start
  writing…" affordance would warm the empty state. (P2.)

## Readiness summary (morning of 2026-06-30)

Eight stacked PRs off `main`, **#39 → #46**, each verified live (code-web + OpenRouter) with before/after
shots in the PR and in `docs/plans/17-verify/`. **0 core patches across the whole loop.** Merge
bottom-up (#39 first); GitHub auto-retargets each base as the one below it merges.

| PR | Branch | What it fixes |
|---|---|---|
| #39 | `plan17-1-workspace-default` | Cold boot lands on the calm Workspace rail, not the IDE Explorer |
| #40 | `plan17-2-doc-name-crumb` | Topbar crumb names the open document, not the editor type |
| #41 | `plan17-3-review-empty-states` | Review rail empty copy is context-aware (no stale "open a Living Document…") |
| #42 | `plan17-4-drop-fake-version` | Drop the fabricated "· v14" from the toolbar |
| #43 | `plan17-5-render-tables` | **GFM tables render as real tables** (was raw pipe-text) — flagship fix |
| #44 | `plan17-6-generate-draft-cta` | Templates "Generate draft" CTA now opens the draft (was a dead click) |
| #45 | `plan17-7-honest-unbuilt-buttons` | Voice / +New agent / Edit flagged "Soon" instead of dead clicks |
| #46 | `plan17-8-calm-hint` | Living-doc hint trimmed from a 2-sentence tutorial to one calm line |

**Verified healthy off the golden path (no change needed):** the chat → proposal → inline diff → rail
card → approve loop (real model); bound-figure source-peek (incl. from inside tables now); the Home
on-ramp (New document / New doc from template / Open + Switch folder all wired); the Agents screen
(rows/open/run/filters wired); empty-folder + new-doc flows.

**Deferred for Tom's judgment (documented, not changed):**
- **Activity-bar IDE tells** — the nav still carries the native "Explorer" (kept by decision 42 for disk
  file ops), plus "Accounts" and the "Manage" gear. Hiding the latter two would calm the nav but removes
  the only UI path to Settings/Keyboard Shortcuts — a product call.
- **Unbuilt features behind the "Soon" tags** (Voice, New agent, Knowledge Edit) — build or remove.
- **Templates mock honesty** — the `crm` / `api` source chips reference sources not in the folder;
  `+ add source` is decorative.
- **Web-only artifacts** (correct on desktop): Home greeting shows the memfs mount name "mount" as the
  folder; the browser tab title reads the old "Opportunity OS" (product.json + desktop window are
  "Abstract"; no source references the old name).
- **Nice-to-haves:** a faint "Start writing…" placeholder on a blank new doc; source-peek highlights the
  latest CSV row even when a *previous*-bound figure is clicked.
