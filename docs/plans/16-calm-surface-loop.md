# 16 — Calm Surface: make it a document tool, not VS Code in a costume (overnight multi-PR /loop)

Plan 15 gave Living Documents a coherent **spine**: one ProseMirror surface for every `.md`, chat on
every doc, inline diff → accept → real-disk persistence, figures traced to sources. The architecture is
solid. The **experience is not** — the product still opens as Visual Studio Code wearing a thin costume,
and the IDE keeps reasserting its defaults. This loop's single job is **feel**: strip the surface down to
a calm document tool, fix the on-ramp, and stop leaking internals (chrome, error toasts, sidecar files,
injected frontmatter, hung chat) so a person can *just start writing*.

This is the first iteration whose target is the user's first impression rather than a capability gate.
It runs **overnight, autonomously, across multiple PRs**, off `main`. No human is awake to review between
iterations — so the rules below are different from plan 15: **default-and-log instead of stop-and-ask**,
and **core patches are expected and permitted** (you cannot suppress the workbench shell contrib-only).

---

## Goal

Opening Living Documents — cold, on a fresh folder — feels like opening a calm writing tool: a document
on a quiet surface, no status-bar footer, no IDE activity bar, no error toasts, no restricted-mode banner,
no sign-in, no sidecar files in view, and a chat that streams instead of hanging. The spine from plan 15
keeps working unchanged underneath.

### The critique this loop is answering (Tom, 2026-06-27, verbatim intent)
> "It's still an IDE in a trench coat and the seams show… too much IDE still e.g. the footer… not seamless
> to jump in and start working."

Concretely, things a *writer* should never see that are visible today (all observed live in iter 6):
- The **status-bar footer**: "remote Test Files", "No Problems", "JSON", "LF", "UTF-8", "Spaces: 2",
  "Ln 1, Col 1", "Copilot status", "Editor Language Status".
- The **activity bar** IDE icons, the **breadcrumb** ("/ [Test Files]"), **editor tabs**, split-editor buttons.
- Desktop cold-launch: a **Restricted Mode** banner, a **Sign In** button, and **"Activating extension
  'vscode.X' failed: Not Found"** error toasts.
- **`.lock.json`** sidecars and **`agents.json`** sitting next to the user's documents in the Explorer.
- Chat **hangs** for seconds then dumps a blob (no streaming), and a transient model error / non-JSON reply
  surfaces as a flat "the agent model errored" with no retry.
- The **on-ramp is filesystem-first**: "create a folder → create a file → it opens" is IDE muscle memory.

---

## How this loop runs (READ THIS — different from plan 15)

### Autonomous: default-and-log, never block
Tom is asleep and will review in the morning. **Do NOT use AskUserQuestion. Do NOT stop to ask.** Where a
product/architecture choice arises, pick the most defensible default, **record it in
`docs/07-decision-log.md` with a one-line rationale**, and proceed. The only acceptable hard stops are
genuinely irreversible/destructive actions (force-pushing `main`, deleting a user's data) — none of which
this work requires. If an iteration gets truly stuck (won't compile after reasonable effort), commit the
WIP to its branch, write the blocker in the iteration log, and **move on to the next independent iteration**
rather than halting the whole loop.

### Multi-PR: stacked branches off `main`, left open for morning review
No reviewer is available overnight, so iterations **stack** and are **never merged** by the loop:
- Iteration 1 branches `calm-surface-1` off `main`; its PR targets **`main`**.
- Iteration N (N>1) branches `calm-surface-N` off `calm-surface-(N-1)`; its PR targets **`calm-surface-(N-1)`**
  (a stacked PR — the diff stays scoped to that iteration).
- Each PR is a self-contained, reviewable unit. Leave them all open. In the morning Tom merges bottom-up
  (GitHub auto-retargets the next PR to `main` as each lands).
- Post each iteration's **before/after screenshots as a PR comment** (raw URLs from committed shots under
  `docs/plans/16-verify/`, the plan-15 pattern), plus a one-paragraph readiness note.

### Core patches are EXPECTED here (the key relaxation)
Plan 15 targeted **0 core patches**. This loop **cannot** — suppressing the status bar, activity bar,
banner, tabs, restricted mode, and startup notifications is inherently workbench-shell work. Core patches
are **permitted and expected** (decision 22 already allows them). For each one: keep it minimal and
fail-soft, prefer a **setting default** or a **registered contribution** over editing a shared part where
possible, and **log every core patch in the merge-tax ledger in `docs/06-design-notes.md`** with file:line
and why a contrib-only route didn't exist. The discipline is "minimal and logged", not "zero".

---

## HOLD — the plan-15 spine must keep working (re-verify live every iteration)

The whole point is that *feel* improves while *capability* is untouched. Every iteration must re-verify, live:
- **F1–F8** (chat reads sources → inline diff → accept/reject → persist; OpenRouter backend; figures
  auto-apply; multi-turn) and **F7** (the fresh-project loop, plan 15 iter 6).
- **U1–U3** (one PM editor for every doc; bound figures as non-editable nodes; chat proposal as in-PM diff).
- **R1–R6** (open/create folder, folder-reflecting Home, edit→disk, sources/context/@mention).
- **Design gates G1–G6** (one quiet writing surface; calm header; detached gutter + inline figures; palette
  keybindings + sash lock; source-peek bottom drawer; nav never blanks / no dev toasts).
- **Decisions 38–53** stay honored. In particular **38** ("web drives, desktop proves disk"): web is memfs
  and resets on reload — the **desktop `code.sh` smoke is the real-disk proof** and is REQUIRED on any
  iteration that changes a write path or the on-ramp.

A regression in any HOLD gate is a stop-and-fix within that iteration before its PR is opened.

---

## The iterations (each = one PR in the stack)

Ranked by impact on the first impression. Pick the highest unmet one each cycle. Each is self-contained.

### Iteration 1 — Strip the workbench shell to a document surface ("the footer etc")
**The headline.** Hide the IDE shell parts so the window is a document surface, not an editor.
- **Files:** `src/vs/workbench/contrib/livingDocs/browser/livingDocs.contribution.ts` (extend the existing
  `HideIdeContainersContribution`, `:157`, which already deregisters IDE view containers `:48`); reach the
  shell via `IWorkbenchLayoutService.setPartHidden(hidden, part)`
  (`src/vs/workbench/services/layout/browser/layoutService.ts:259`) with the `Parts` enum (`:22-30`:
  `STATUSBAR_PART`, `ACTIVITYBAR_PART`, `BANNER_PART`, `TITLEBAR_PART`, `EDITOR_PART`).
- **Hide:** the **status bar** (`STATUSBAR_PART` — the footer), the **activity bar** IDE icons
  (`ACTIVITYBAR_PART` — the calm icon-nav for Home/Templates/Knowledge/Agents already lives in the
  side bar per `:222-225`, so the activity bar is redundant), **editor tabs**
  (`workbench.editor.showTabs: "none"` default), **breadcrumbs** (`breadcrumbs.enabled: false` default),
  and the split-editor action. Prefer **setting defaults** registered for the product where they exist;
  use `setPartHidden` (a startup contribution) for what settings can't reach. Keep the desktop **title bar**
  (window controls) — that's OS chrome, not IDE chrome.
- **Decide & log:** exactly which parts stay (recommendation: title bar on desktop only; everything else
  off; the calm topbar + tree-rail inside the surface are the chrome). Record as a decision.
- **Accept:** opening a doc (web + desktop) shows no status bar, no activity bar, no tab strip, no
  breadcrumb — just the calm document + the rail. HOLD live. Core patches logged.

### Iteration 2 — Kill the cold-launch noise and trust leaks
- **Restricted Mode banner →** trust the product's workspace by default. Set
  `security.workspace.trust.enabled: false` (or trust-on-open) as a product default; remove the `BANNER_PART`
  surface for it. Verify the banner is gone on a fresh desktop launch.
- **"Extension 'vscode.X' failed: Not Found" toasts →** these are built-in extensions the target build
  doesn't ship. Either stop activating them for this product or suppress the activation-failure
  notification. Decide the least-hacky route and log it.
- **Sign In / Copilot status →** this is a document tool, not Copilot. Remove the Sign-In affordance and the
  Copilot status entries from the chrome that remains.
- **"/ [Test Files]" workspace/remote label →** replace with the product/document identity (or nothing).
- **Accept:** a cold launch on a fresh folder (web + desktop, `TMPDIR=/tmp`) shows **zero** error toasts, no
  restricted-mode banner, no sign-in, no Copilot chrome. HOLD live.

### Iteration 3 — Document-first on-ramp
- **Files:** `screenLauncherView.ts` / `screenRender.ts` (Home), `livingDocsService.ts` (open/create),
  `livingDocEditorInput.ts`.
- **Open to a document, not a dead-end.** On open with a folder: restore the last document, or present a
  friendly blank writing surface — never the bare Explorer.
- **"New document" creates AND opens in one action** (no Explorer folder→file ceremony): create the `.md`,
  open it in PM, focus the title/first line; name-on-first-save or an inline title. Keep folder creation
  available but secondary.
- **Recents on Home;** the tree-rail stays the primary nav (the native Explorer is secondary, per decision 42).
- **Accept:** from a fresh folder, one click → a writable document open in PM, cursor ready. HOLD live +
  **desktop disk smoke** (a newly-created doc persists to real disk).

### Iteration 4 — Hide internal artifacts; stop polluting the user's files
- **`.lock.json` + `agents.json` out of view.** They're internal plumbing
  (`livingDocLockStore.ts:21` `lockUriFor`, `agentStore.ts:23`). Filter them from the native Explorer
  (`files.exclude` product default) **and** the tree-rail (`common/treeRail.ts` build filter). The files
  still exist on disk; the user just never sees them in their document list.
- **Stop injecting frontmatter into plain docs.** `serializeLivingDoc` (`common/livingDocMarkdown.ts:210`)
  always emits a `---\ntitle: …\n---` block — so accepting a chat change on a plain doc wrote
  `title: Untitled` into a clean file (observed in the iter-6 disk smoke). Fix: a plain doc (no
  sources/context/binds) must round-trip to **plain Markdown** — emit no frontmatter, or only the
  frontmatter the doc actually had. Mirror the `pmEdit` raw-save path (`livingDocEditor.ts:125`) in
  `_persist` for non-living docs, or make `serializeLivingDoc` omit a derived/empty title.
- **TDD (pure logic):** plain doc in → accept a chat insert → serialize → assert the on-disk text is
  byte-clean plain Markdown (no injected `title:`), `isLiving` still false. Watch it fail first.
- **Accept:** the iter-6 desktop smoke, repeated, shows `Notes.md` containing **only** the list (no
  `title: Untitled`); `.lock.json`/`agents.json` absent from the Explorer + tree-rail. HOLD live + desktop smoke.

### Iteration 5 — Chat feel: streaming, retry, robust parse, honest progress
- **Files:** `livingDocsService.ts` (`_callModel:1305`, `sendChatMessage:~1413`, `_chatRespond:~1448`),
  `reviewRailView.ts` (the chat render), `scripts/lwd-anthropic-proxy.js` (stream passthrough if needed).
- **Stream the reply** instead of a multi-second hang then a blob: request the model with streaming and
  render the assistant text progressively in the rail (proposals still queue at the end).
- **Auto-retry once** on a transient model error before the honest fallback (the flakiness hit in iter 6:
  OpenRouter intermittently errored/hung on larger follow-ups). Keep the fallback honest if the retry also fails.
- **Harden the JSON parse.** `_chatRespond` does `JSON.parse(raw.slice(indexOf('{')…))` — a non-JSON or
  partial reply throws and surfaces as "the agent model errored". Tolerate it: treat a non-JSON reply as a
  plain chat answer (no proposals), never a crash.
- **A real "working…" indicator** while in-flight (the busy state exists via `isChatBusy`; make it visibly
  progressive).
- **Accept:** chat shows progressive output; a forced transient error self-recovers on retry; a non-JSON
  reply degrades to a plain answer (no false error). HOLD live (F1–F6 still produce/accept proposals).

### Iteration 6 — Calm polish pass (design audit against the document vision)
- Run a **DesignSync / rams-style audit** of the stripped surface against the calm-document vision; close the
  top gaps (typography, spacing, the review rail's IDE-panel shape, empty states, the source drawer, the
  Home screen). This is the "does it read as one calm product" sweep.
- **Accept:** a scored audit ≥ ~90% on the calm-document rubric; the end-to-end first-run (fresh folder →
  open → write → chat → accept) reads as a writing tool, not an IDE. HOLD live + a final desktop smoke.

> If the six land with budget left, add a 7th: a **first-run "30-second" walkthrough** capture (screen-record
> the cold-launch-to-first-paragraph path) as the morning artifact, and a short `docs/` write-up of what the
> surface now is vs. the stock workbench.

---

## Method (every iteration)
- **TDD** all pure/serialization logic (iter 4's plain-doc round-trip; any new pure helpers). Watch red → green.
- **Build:** `nvm use 24.15.0` → `npm run watch` (background) → fix all `typecheck-client` +
  `valid-layers-check` errors before testing. Run living-docs unit suites via
  `./scripts/test.sh --grep "<living-docs suite titles>"` (see plan 15 — keep them green; update, don't delete).
- **Verify live on a REAL folder:** `./scripts/lwd-anthropic-proxy.sh` (OpenRouter, default
  `http://localhost:8090`) → `./scripts/code-web.sh <real-folder>` (http://localhost:8080) → drive with
  chrome-devtools (a11y-click reaches webview surfaces; re-snapshot before each click). RE-READ disk for
  every write (web is memfs).
- **Desktop real-disk proof (decision 38):** the `launch` skill (`.claude/skills/launch`) →
  `code.sh` via `@playwright/cli` over CDP; **`export TMPDIR=/tmp`** (the macOS `/var/folders` socket-path
  bug). The rail's 3-tab Chat/Review surface is **inside `.living-docs-panel`** (click the panel's own "Chat"
  button, not the workbench view tab); the chat input is a plain `<textarea>` (focus + pbcopy + `Meta+v` +
  `Enter`). Required on any iteration touching a write path or the on-ramp (1, 3, 4, 6).
- **Screenshots** to `/Users/tommy/Sites/.lwd-shots/iter16-N-*`; copy into `docs/plans/16-verify/` for the PR;
  post before/after as a **PR comment** with commentary (raw.githubusercontent URLs on the iteration branch).
- **Update** `docs/07-decision-log.md` (+ every default-and-log decision), the merge-tax ledger in
  `docs/06-design-notes.md` (every core patch), this plan's iteration log, and the
  `living-docs-v6-chatdoc` memory (or a new `living-docs-calm-surface` memory if it grows large).
- **Gotchas:** model flakiness (retry small prompts; iter 5 fixes it properly); web memfs resets on page
  reload (don't reload mid-flow expecting created files to survive — desktop is the disk proof); base64 PM
  bundle rebuild only if the schema changes (`docs/lwd-pm-bundle-build.md`); ASCII-only source (hygiene gate).

---

## The /loop

> `/loop` Run the **Calm Surface** overnight loop (`docs/plans/16-calm-surface-loop.md`) AUTONOMOUSLY — Tom
> is asleep and reviews in the morning, so **never stop to ask**: where a product/architecture choice
> arises, pick the best default, record it in `docs/07-decision-log.md`, and proceed. Pick the highest
> unmet iteration from the plan (suggested order: 1 strip the workbench shell / footer → 2 kill cold-launch
> noise + trust leaks → 3 document-first on-ramp → 4 hide internal artifacts + stop injecting frontmatter →
> 5 chat streaming/retry/robust-parse → 6 calm design-audit pass). **Stacked PRs, never merged:** iteration 1
> branches `calm-surface-1` off `main` (PR → `main`); iteration N branches `calm-surface-N` off
> `calm-surface-(N-1)` (PR → `calm-surface-(N-1)`); leave every PR open for morning review. **Core patches
> are expected and permitted here** (you can't suppress the workbench shell contrib-only) — keep each minimal
> + fail-soft, prefer a setting default or a registered contribution, and log every one in the merge-tax
> ledger in `docs/06-design-notes.md`. TDD pure logic; verify each iteration LIVE on a real folder via
> code-web + chrome-devtools with the OpenRouter proxy, RE-READ disk for every write, and run the desktop
> `code.sh` smoke (`TMPDIR=/tmp`, via the `launch` skill) on any iteration that changes a write path or the
> on-ramp (1/3/4/6). **HOLD (re-verify live every iteration):** F1–F8 + F7, U1–U3, R1–R6, design gates
> G1–G6, decisions 38–53 — the plan-15 spine must keep working; a HOLD regression is fixed before the PR is
> opened. Each iteration: commit ONE focused change on its branch, push, open the stacked PR, post
> before/after screenshots as a PR comment with commentary, and update the decision log + merge-tax ledger +
> this plan's iteration log + the memory. Keep going through the iteration list without checkpointing; if one
> iteration gets truly stuck, commit the WIP, log the blocker, and move to the next independent iteration.
> **Stop when all six iterations have a PR open and HOLD is green across the stack, or after 12 iterations;**
> then post a final readiness summary (what changed, the PR stack in merge order, before/after of the
> cold-launch-to-first-paragraph path, and any default-and-log decisions Tom should sanity-check).

---

## Build / run (per the build memory)
- `nvm use 24.15.0` → `npm run watch` (background) → `./scripts/lwd-anthropic-proxy.sh` (OpenRouter default)
  → `./scripts/code-web.sh <real-folder>` (http://localhost:8080).
- Desktop real-disk proof: the `launch` skill → `code.sh` via `@playwright/cli` over CDP; `export TMPDIR=/tmp`.
- chrome-devtools a11y-click reaches webview-internal surfaces; re-snapshot before each click (uids change).
- Screenshot `filePath` must be inside a workspace root (e.g. `/Users/tommy/Sites/.lwd-shots/`).

## Key file anchors (grounding for the executor)
- IDE-chrome hiding: `livingDocs.contribution.ts:48` (`IDE_VIEW_CONTAINER_IDS`), `:157`
  (`HideIdeContainersContribution`), `:222-225` (the calm screen view containers).
- Shell parts: `services/layout/browser/layoutService.ts:22-30` (`Parts`), `:259` (`setPartHidden`).
- Lock sidecar: `livingDocLockStore.ts:21` (`lockUriFor`), `:52` (`write`). agents.json: `agentStore.ts:23/37`.
- Plain-doc frontmatter injection: `common/livingDocMarkdown.ts:210` (`serializeLivingDoc`); raw-save path
  `livingDocEditor.ts:125` (`pmEdit`); persist `livingDocsService.ts:1776` (`_persist`).
- Chat: `livingDocsService.ts:1305` (`_callModel`), `:~1413` (`sendChatMessage`), `:~1448` (`_chatRespond`,
  the `JSON.parse` to harden); rail render `reviewRailView.ts`.
- Tree-rail filter: `common/treeRail.ts` (`buildFileTree`).

## Carry-over context
- The whole loop sits on top of plan 15 (PR #29 merged): PM is the one editor for every `.md`, chat works on
  every doc (decision 48), `renderDoc` is retired. See `living-docs-v6-chatdoc` memory + decision log 38–53.
- "Web drives, desktop proves disk" (decision 38). "Folder IS the project, all `.md` badged" (decision 39).
  Native Explorer + tree-rail coexist, rail default (decision 42). OpenRouter backend (decision 44).

---

## Iteration log

### Iteration 1 — Strip the workbench shell to a document surface (branch `calm-surface-1`, PR → `main`)
**What changed (one focused commit):** registered four product config-default overrides in
`livingDocs.contribution.ts` (a single `registerDefaultConfigurations` call beside the existing
`registerConfiguration`) so the IDE shell parts are OFF by default — `workbench.statusBar.visible:false`
(the footer), `workbench.activityBar.location:'hidden'` (the icon column), `workbench.editor.showTabs:'none'`
(the tab strip), `breadcrumbs.enabled:false` (the breadcrumb). The desktop title bar (OS window controls) is
left alone.

**Core patches:** none. Tier **additive-contribution** — these are real, user-overridable settings set via the
same registry API a built-in uses, so the merge-tax ledger is unchanged (logged in `06-design-notes.md` D8).

**Default-and-log decision:** #54 (decision log) — config-defaults over `setPartHidden`; and the consequence
that hiding the activity bar retires the v3 labelled icon-nav (Home + command palette carry the screens; the
tree-rail / Explorer is the single sidebar). Flagged for Tom's morning sanity-check.

**HOLD re-verified live (web, code-web + OpenRouter, real folder `.realdocs-test`):** the living doc opens in
ProseMirror (U1) with the calm formatting toolbar (G2), the bound figure `49800` as a non-editable node + a
provenance gutter dot (U2/G5), the "All sources synced" chip + Present; a chat turn read `metrics.csv` +
`forecast.csv` and rendered an "Outlook" insertion as a green inline diff in the PM doc with Approve/Reject +
a synced rail card "1 change waiting on you · Approve all" (F1/F3/F4/F5/U3). No status bar, activity bar, tabs
or breadcrumb anywhere.

**Desktop smoke (`code.sh`, `TMPDIR=/tmp`, via the launch skill):** the same shell-strip holds on desktop —
the Home dashboard renders on a surface with no status bar / activity bar / tabs / breadcrumb. (The
cold-launch Restricted-Mode banner + Sign-In button + first-run welcome walkthroughs are still present — those
are iteration 2's scope.)

**Screenshots:** `docs/plans/16-verify/iter1-*` — before/after web shell, the HOLD doc + chat spine, and the
desktop shell.

**Carry-over:** iteration 2 (off `calm-surface-1`) kills the cold-launch noise (trust banner, ext
activation-failure toasts, Sign-In / Copilot chrome, the workspace label).

### Iteration 2 — Kill the cold-launch noise + trust leaks (branch `calm-surface-2`, PR → `calm-surface-1`)
**What changed (one focused commit):** extended the config-default block in `livingDocs.contribution.ts` with
five more overrides — `security.workspace.trust.enabled:false` (Restricted-Mode banner),
`workbench.welcomePage.experimentalOnboarding:false` (the "Welcome / Sign in to use Copilot" modal + the "Make
It Yours" walkthrough), `workbench.startupEditor:'none'` (welcome page), `chat.disableAIFeatures:true` (the
built-in Copilot Sign-In/status chrome), `window.title:'${activeEditorShort}'` (drop the `[remote]` label) —
plus one minimal core patch in `mainThreadExtensionService.ts` to log (not toast) dev-only built-in
`vscode.*` activation-failure errors.

**Core patches:** 1 — `mainThreadExtensionService.$onExtensionActivationError` (guard the dev toast with
`!extensionId.value.startsWith('vscode.')`). Fail-soft; no contribution seam exists on this `$`-RPC handler.
Logged in `06-design-notes.md` D8 with the file:line + why contrib-only wasn't possible.

**Default-and-log decision:** #55.

**HOLD re-verified live (desktop cold launch, `code.sh`, `TMPDIR=/tmp`, fresh folder `.realdocs-test`):** the
living doc opens in PM with the calm toolbar + bound figure `49800` (U1/U2/G2/G5); a chat turn (the product's
own Review-rail chat, **with `disableAIFeatures` on**) read `metrics.csv` + `forecast.csv` and rendered an
"Outlook" insertion as a green inline diff with Approve/Reject + a synced rail card (F1/F3/F4/F5/U3). Web
reload: no regression; the title is now just the document name.

**Acceptance met:** the desktop cold launch shows **zero** error toasts, no Restricted-Mode banner, no Sign-In,
no onboarding modal, no Copilot chrome — it opens straight to the calm Home dashboard.

**Screenshots:** `docs/plans/16-verify/iter2-*` — desktop before (iter-1 shell, banner + Sign-In) / after
(clean cold launch), the desktop HOLD chat spine, and the calm web home.

**Carry-over:** iteration 3 (off `calm-surface-2`) is the document-first on-ramp.

### Iteration 3 — Document-first on-ramp (branch `calm-surface-3`, PR → `calm-surface-2`)
**What changed (one focused commit):** (1) `NEW_DOCUMENT_TEMPLATE` in `livingDocsService.ts` becomes a single
newline — a new doc opens as a **blank writing surface**, no injected `title:` frontmatter, no "## Overview /
Write your document here" boilerplate. (2) `focusPm()` in the `livingDocRender` runtime calls `pmView.focus()`
on mount so the caret lands in the doc (once per mount — decision-50 mount-once means re-renders never steal
focus). (3) A `LivingDocEditor.focus()` override forwards pane focus into the webview iframe so the in-iframe
focus actually takes effect. Home stays the friendly landing (recents + New document + empty-state) — not the
bare Explorer.

**Core patches:** none. Tier **our-surface**.

**Default-and-log decision:** #56.

**Acceptance met + desktop disk smoke (decision 38, `TMPDIR=/tmp`, fresh `/tmp/calm-iter3`):** the empty-state
"New document" created `Untitled.md` on **real disk** containing only a newline (no `title:`, no boilerplate);
typing persisted it as **clean plain Markdown** (`Q3 Planning Notes for the launch`), re-read from disk. On
web, New document → a blank PM surface, writable; the PM editor reports `focused`.

**HOLD re-verified live:** the living doc still opens in PM with the calm toolbar + bound figure `49800`
(U1/U2/G2/G5). _Observed (pre-existing, flagged for iter 6): the formatting toolbar is absent on a blank plain
doc but present on living docs._

**Screenshots:** `docs/plans/16-verify/iter3-*` — before/after New document (boilerplate → blank), the typed
blank doc, the desktop empty-state on-ramp, and the HOLD living doc.

**Carry-over:** iteration 4 (off `calm-surface-3`) hides internal artifacts (`.lock.json`/`agents.json`) +
stops injecting frontmatter on the serialize-on-accept path (the create path is already clean as of iter 3).

### Iteration 4 — Hide internal artifacts + stop injecting frontmatter (branch `calm-surface-4`, PR → `calm-surface-3`)
**What changed (one focused commit):** (a) `.lock.json` + `agents.json` added to a `files.exclude` product
default (object-valued defaults merge, so the built-in `.git`/`.DS_Store` excludes survive) — hidden from the
native Explorer; the custom tree-rail already lists only `.md`. (b) Stopped `serializeLivingDoc` injecting a
derived `title:`: `parseLivingDoc` now records the authored `frontmatterTitle` (`''` if none), serialize emits
`title:` only from that and drops the entire `---` block when there is no authored frontmatter — so a plain doc
round-trips byte-clean Markdown, while living docs (and plain docs with an authored title) are unchanged.

**Core patches:** none. Tier **our-surface + additive-contribution**.

**TDD (pure logic, red→green):** 3 tests in `livingDocMarkdown.test.ts` — plain doc round-trips byte-clean; a
plain doc + an inserted block stays plain (no injected `title:`, `isLiving` false); a plain doc with an
authored title keeps it. Watched the first two fail, then pass. All 87 LivingDoc tests green.

**Default-and-log decision:** #57.

**Desktop disk smoke (decision 38, `TMPDIR=/tmp`, fresh `/tmp/calm-iter4`):** created a plain `Untitled.md`
("Launch Plan"), chat-inserted an intro paragraph, **Approved** → re-read from **real disk**: clean plain
Markdown (`grep -c 'title:'` = 0, `grep -c '^---'` = 0), the insertion present; `agents.json` +
`Untitled.lock.json` both on disk but **absent from the Explorer**.

**HOLD re-verified live:** chat → inline diff → Approve → persist all work; the crumb stays "Markdown" (plain,
`isLiving` false) through the accept.

**Screenshots:** `docs/plans/16-verify/iter4-*` — web Explorer (no agents.json), the desktop chat insert, and
the desktop after-accept (clean doc + Explorer hides both sidecars).

**Carry-over:** iteration 5 (off `calm-surface-4`) is chat feel — streaming, retry, robust parse.

### Iteration 5 — Chat feel: robust parse + retry + alive indicator (branch `calm-surface-5`, PR → `calm-surface-4`)
**What changed (one focused commit):** (a) a pure, TDD'd `parseChatResponse(raw)` replaces the bare throwing
`JSON.parse` in `_chatRespond` — extracts the JSON object when present, otherwise degrades to a plain-text
answer; the bubble never shows the raw JSON envelope (a parsed-but-empty `reply` falls back to a neutral
line). (b) `_callModel` retries once on a transient failure (not on a refusal). (c) the "Working…" indicator
becomes a pulsing agent avatar + an animated "Thinking…" ellipsis (pure CSS in `reviewRailView`).

**Streaming — DEFERRED + logged (decision 58):** the model is asked for "ONLY a JSON object" and the proxy is
a buffered round-trip, so token-streaming would surface raw JSON. Real streaming needs a response-format
redesign (prose stream + structured tail) + proxy SSE + a progressive webview render — a larger, riskier
change than fits an unattended iteration. The robustness trio removes the felt pain (false errors, dead hang).

**Core patches:** none. Tier **our-surface**.

**TDD (pure logic):** 4 `parseChatResponse` tests — clean JSON, prose-wrapped JSON, plain-text degrade,
truncated-JSON degrade. 91 LivingDoc tests pass.

**Default-and-log decision:** #58.

**HOLD re-verified live (code-web + OpenRouter):** a chat question returned a real prose answer ("…MRR growth
to $49,800… Churn… now standing at 2.4%…") with the source-read step — no raw JSON, no false error; figure
`49800` + calm toolbar intact (F1/F-spine, U1/U2/G2). A live edge-case (gpt-4o-mini returning an empty
`reply`) was caught and fixed (neutral fallback instead of a raw-JSON bubble).

**Screenshots:** `docs/plans/16-verify/iter5-*` — the prose chat answer (no JSON leak).

**Carry-over:** iteration 6 (off `calm-surface-5`) is the calm design-audit polish pass — incl. the
plain-doc formatting-toolbar gap flagged in iter 3.
