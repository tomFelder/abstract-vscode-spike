# Plan 40 - File interop door + buildable gate residual (paste this into a fresh chat)

> **For agentic workers:** run this with `superpowers:dispatching-parallel-agents` - one focused
> sub-agent per independent domain, dispatched concurrently, each on its own branch/worktree, with
> small live-verified stacked PRs off `main`. This is a **build loop**, not an assessment.
> Spec of record: [22-file-interop-and-project-layout.md](../22-file-interop-and-project-layout.md)
> (the ratified interop stance, decision 155) and its §6 acceptance criteria; the gate context is
> [18-beta-plan.md](../18-beta-plan.md) §2-3; the T1 verdict that unblocks this work is on issue
> #128 (**FIX-FIRST**, its fix order now executed - export cleared, import fidelity floor defined);
> binding principles in [16-principles.md](../16-principles.md) (P3 review-routing, P6 files-on-disk,
> plan 33 L8 "never fabricate what it cannot do").

**Goal:** make the beta gate's own sentence - *"a stranger can bring a real folder"* - literally true
in **both directions**. A user points Abstract at a folder of Word documents and spreadsheets, works
in it through the review grammar, and sends the result back out to a Word-speaking organisation. When
this loop closes, doc 22 §6 (import / export / spreadsheets / layout) holds on real files, and the
one buildable beta-gate residual (X1 survivability, #121) is confirmed gone.

**Why now:** the 13-14 Jul wave closed most of the beta gate - plan 37 journey robustness (F1-F19),
plan 38 onboarding, the plan 39 T1 paste/table/image fixes, and the plan 36 *local* analytics sink
all landed (PRs #143-#158). What remains splits cleanly: a **buildable feature wave** (the P1
file-interop door, doc 22, decision 155 - no external dependency) and a **you-dependent residue**
(#120 needs a live OpenAI subscription to debug against; #134's cloud half needs the PostHog project
+ real `phc_` key). This loop builds the former and hands you a tight checklist for the latter.

## Two tracks

- **Track A - the interop door (the feature wave).** Doc 22 §2-4. Three domains: import (#129),
  export (#130), spreadsheet + PDF sources (#131).
- **Track B - the buildable gate residual.** X1 survivability (#121): approved work survives a
  reload and History rehydrates from the on-disk lock. Much landed in #149; this track owns
  confirming the contract end to end and closing the residual, not rebuilding it.

Everything else that gates the beta is **parked for you** (see the closing checklist) because no
sub-agent can complete it: it needs your accounts, not code.

## Hard rule: build to the spec, don't re-scope

Each domain is validated against its **doc 22 §6 acceptance-criteria checkbox**, not a fresh
interpretation. Markdown is canonical; every other format converts at the boundary and the original
file is never destroyed (doc 22 §1). Foreign formats are imported (docx -> a real `.md`), read-only
sources (PDF, xlsx feed context/bindings, never the editing surface), or export targets (docx, PDF).
We do not become a Word editor, a PDF editor, or a spreadsheet. Where doc 22 marks something deferred
(gdoc/gsheet/xlsx export, cell-level xlsx binding, any db layer), it stays an honest "SOON" row - not
a dead affordance (plan 33 L8).

## Dispatch shape (dispatching-parallel-agents)

You are the **orchestrator**. You decompose, dispatch, adjudicate, manage branches/PRs/merges, and
write the summary - you do not write feature code or verify surfaces yourself. Every implementer and
validator sub-agent runs on **Opus 4.8** (`model: "opus"`); each gets a self-contained prompt (its
one domain, the doc 22 section + §6 checkboxes it owns, the repo rules pointer `.claude/CLAUDE.md`,
its branch/base, its port pair) and inherits none of your context. Pair each implementer with an
independent validator that tries to **refute** its claims against the §6 checkboxes before you merge
(the paired-convergence protocol from the P0/P1 and P2 runs; verdict **APPROVE** / **REDO** + numbered
findings). Two REDO cycles then park with an honest "known gaps" comment.

**Independence map (why these can go parallel):**

- **A1 import** and **A2 export** share the docx conversion seam and the `assets/` convention but run
  in *opposite directions* (import = docx->HTML->md via **mammoth**; export = md->docx via a separate
  writer). Land **A1 first**, then A2 rebases onto the shared assets/pipeline helpers - do not run
  them in the same wave.
- **A3 spreadsheet/PDF sources** touches the SOURCES/binding + lock-staleness layer, disjoint from
  the editor pipeline - safe to run parallel with A1.
- **B1 X1** touches the persistence (PM history + lock + audit) layer - disjoint from all of Track A.

**Waves:**

- **Wave 1 (parallel):** A1 (import) · A3 (sources) · B1 (X1). Three implementers, three worktrees,
  three port pairs, dispatched in one turn.
- **Wave 2 (after A1 merges):** A2 (export), rebased on A1's assets/pipeline helpers.

## The domains

### A1 - Import: docx -> Markdown (#129) · doc 22 §2

Turn the F10 "not yet imported" marker into a door. `.docx` in the tree/SOURCES offers **Import as
document**; conversion (pure-JS **mammoth** docx->semantic-HTML then HTML->Markdown, run in the
proxy/node layer where file access lives, never the renderer) writes `Same Name.md` **beside the
untouched original**, records `importedFrom` + `sourceHash` in the new doc's lock (provenance from
birth), extracts embedded images to `assets/<doc-name>/` with relative refs, opens the doc, and shows
a plain-words **kept/dropped summary card** ("Headings, lists, tables, 3 images kept · comments and
tracked changes not imported"). Fidelity floor and the named-and-dropped list are doc 22 §2; `.doc`,
password-protected and unparseable files stay in the F10 "not yet imported - {reason}" state (never a
mangle). Imported tables stay display-only until the #140 editing path (already merged) - import
fidelity is bounded by editor fidelity, say so in the card.

### A2 - Export: docx + PDF join HTML/Markdown (#130) · doc 22 §3 · Wave 2

Unstub the Present & export modal's honest `docx` "SOON" row and add **PDF**. docx: clean export of
the rendered doc (headings/lists/tables/images, bound values inlined as plain text like the Markdown
flatten), styles mapped to **Word's built-in styles** so the receiving org can restyle, **no Abstract
chrome/dots/diff UI**. PDF: render the existing self-contained HTML export through the desktop build's
print-to-PDF (cheapest correct path, no new render engine; desktop is the beta vehicle). The
**before-export reconcile gate applies unchanged** (plan 32): unreconciled figures surface the reason
and swap the CTA for "Export anyway" (audited) / "Fix first" - the wedge at the exit door. gdoc/gsheet/
xlsx stay honest "SOON" rows.

### A3 - Spreadsheets as CSV sources + PDF as read-only context (#131) · doc 22 §4

`.xlsx` in the folder offers **Use as source**; accepting extracts each sheet to
`data/<workbook-name>/<sheet-name>.csv`, leaves the workbook on disk **watched** (correlated watcher
per `.claude/CLAUDE.md`), and re-extracts on `sourceHash` change so the normal staleness machinery
flags dependent docs. Bindings point at the extracted CSVs (`bind:` shape unchanged); the provenance
drawer shows figure -> CSV row -> `Budget.xlsx · Sheet "FY26"` -> synced-at. **Parsing floor** (doc 21
§6.5): delimiter sniffing (`,` vs `;`), BOM/Windows-1252 tolerance, currency/thousands/parenthesised-
negative numbers, dates normalised on extraction; merged headers and pivots are *named* limitations,
never silent misreads. **PDF as a source (read-only):** text extracted at import as a `context` edge
(framing, not value bindings), listed in SOURCES with freshness; an image-only PDF names itself
unreadable rather than yielding empty context. Cell-level xlsx binding, formulae, Google Sheets and
any db layer stay deferred (P3) per doc 22 §4.

### B1 - X1 survivability residual (#121) · doc 18 §2.3 R4

Confirm and close the X1 contract: an approved change survives a reload, and History rehydrates from
the on-disk lock on a cold reopen (F1 + F19). The web build's storage is ephemeral - surface that
**honestly** rather than pretending otherwise (the #149 stance); the durable contract is the desktop
build's on-disk write (re-scoped Electron-only, decision 162). This track is *confirm end to end +
close the residual*, not a rebuild: if the live E2E (approve -> reload -> edit + History + chip all
survive; on-disk file reflects the approve) passes in desktop and the web build states its ephemerality
truthfully, close #121 with the evidence; if it does not, fix the gap on our surfaces (PM history +
lock + audit), portable to the cloud rebuild.

## Global constraints (enforce via validators)

- **Real data only.** Truthful kept/dropped cards, truthful "SOON" rows, honest empty/error states;
  never fabricate a conversion result or a hosted export (plan 33 L8).
- **Everything routes through the review grammar (P3).** Import lands a reviewable new doc; Tidy-style
  moves (out of scope here, #132) are not smuggled in; export's reconcile gate is the plan-32 gate,
  not a new one.
- **Files-on-disk stay portable (P6).** Originals never destroyed; a converted folder reads as an
  obviously-sensible folder in Finder/Explorer to someone who never opens Abstract; conversion runs in
  the proxy/node layer, never the renderer.
- **Instrument as you build.** New surfaces emit their [15-metrics-and-instrumentation.md](../15-metrics-and-instrumentation.md)
  §3.1 events from day one; events not yet in the dictionary are type-registered for the analytics wiring.
- **Ledger discipline.** Our-surface only expected; any core patch is minimal, fail-soft, and logged
  in [03-merge-tax-ledger.md](03-merge-tax-ledger.md). Prefer a bundled pure-JS lib (mammoth for
  import) over a bundled pandoc/native binary for beta.
- Tabs not spaces; nls-externalised UI strings; disposables registered (correlated file watchers per
  the repo rule); Australian English; no em dashes; title-style caps on labels. `npm run typecheck-client`
  + `npm run valid-layers-check` clean per PR. Settle each open decision to the doc 22 recommendation
  and append it to [07-decision-log.md](../07-decision-log.md).

## Environment (the gotchas every prior run hit)

- **Node 24:** shells default to node 22 - `export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"`
  (per `.nvmrc`) before any build.
- **Build loop:** use the watch task / `npm run watch`; never `npm run compile`. Check `out/` mtime vs
  the latest merge before trusting a build (stale `out/` invalidated an earlier walk).
- **Web build entry** is bare `http://localhost:8080/` (the `?folder=` URL breaks); **desktop launcher
  needs `TMPDIR=/tmp`** (Unix-socket path length). Import/export/Tidy need **real folders + OS dialogs**,
  so verify the file-touching paths on the **desktop build** (the launch/run skills), web for webview UI.
- **Commits:** the husky pre-commit hook is broken and silently stages on failure - commit with
  `--no-verify` and never trust the index after a failed commit. No co-author lines.
- **gh** defaults to the `microsoft/vscode` upstream - always pass `--repo tomFelder/abstract-vscode-spike`.
- Per-worktree isolation: own `npm i`, own port pair (web 8080/8082/8084, proxy 8090/8092/8094 - set
  `livingDocs.modelProxyUrl` when non-default), model backend OpenRouter (`LWD_BACKEND=openrouter`).

## Acceptance criteria (doc 22 §6)

**Import (docx):**
- [ ] A `.docx` offers Import; conversion writes `Name.md` beside the untouched original with
  `importedFrom` + `sourceHash` provenance in the lock.
- [ ] Images land in `assets/<doc>/` with relative references.
- [ ] A kept/dropped summary card shows; tracked changes import final text and say so.
- [ ] `.doc`, password-protected, unparseable files stay in the F10 "not yet imported - {reason}"
  state; nothing mangles silently.

**Export:**
- [ ] docx export produces a Word file with headings/lists/tables/images mapped to built-in styles,
  bound values inlined, no Abstract chrome.
- [ ] PDF export ships via desktop print-to-PDF of the HTML export.
- [ ] The before-export reconcile gate applies to both; "Export anyway" is audited.
- [ ] gdoc/gsheet/xlsx remain honest "SOON" rows.

**Spreadsheets / PDF sources:**
- [ ] An `.xlsx` offers "Use as source"; sheets extract to `data/<workbook>/<sheet>.csv`; the workbook
  is watched and re-extracts on hash change, flagging dependents.
- [ ] The provenance drawer shows figure -> CSV row -> workbook chain.
- [ ] The delimiter/encoding/number-format parsing floor holds against the doc 21 §6.5 realities;
  merged-header sheets warn rather than misalign.
- [ ] PDF sources contribute extracted text as context edges, appear in SOURCES with freshness, and
  name themselves unreadable when image-only.

**X1 residual:**
- [ ] Approve -> reload: the edit, History and Saved · vN chip all survive; the on-disk file reflects
  the approve (desktop). The web build states its ephemerality truthfully. #121 closed with evidence,
  or the residual gap fixed on our surfaces and then closed.

## Verify approach

Live E2E per domain, on the **desktop build** for anything touching real files (import/export/xlsx
watching use OS dialogs + on-disk writes), web for webview-only UI - screenshots to
`docs/plans/40-verify/`. Fixtures: a real `.docx` with headings/lists/nested-lists/tables/images/
tracked-changes, a `.doc` and a password-protected file (refusal path), an `.xlsx` with `;`-delimited
+ BOM + currency + merged-header sheets, and a text PDF + an image-only PDF. Every §6 checkbox is
proven by a probe with a saved artefact; the closing act is a re-run of the doc 18 §2.3 gate check
with the updated verdict, so the beta-gate status stays evidence, not opinion.

## Conclude with

A single summary: every PR (number, title, domain, merged/open/parked), every REDO and why, every
parked gap, every core patch (logged in the ledger), decision-log rows added, and the doc 22 §6 +
doc 18 §2.3 status after the run. All PRs carry their screenshots - reviewable from the PR record alone.

---

## Parked for you (not agent-buildable - needs your accounts, not code)

These are the remaining beta-gate items a sub-agent cannot finish. They are the last things between
this loop closing and "first stranger":

1. **#120 - ChatGPT-subscription model backend fails after sign-in.** The sign-in succeeds but the
   model call fails; debugging it needs a **live OpenAI ChatGPT Plus/Pro subscription** to probe the
   Codex-token path against. Until then the capped OpenRouter fallback carries every user (doc 18 §2.1),
   so the gate is not *blocked* - but BYO-subscription is the path P0 wants working. Decide whether to
   hand an agent a recorded failing trace + your test account, or take this one yourself.
2. **#134 (cloud half) - PostHog wiring.** The local consent-gated sink landed (#156). The cloud half
   - create the PostHog project, replace `phc_REPLACE_ME` in `product.json`, stand up the four
   dashboards, confirm masked session replay - needs **your PostHog project + real `phc_` key** (steps
   in `docs/plans/36-verify/README.md`). Once the key exists, the dashboard/replay build can be its own
   short loop.

Both are P0 for the gate; neither is in this loop's scope because neither can be completed without you.
