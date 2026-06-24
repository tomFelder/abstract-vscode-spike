# Real Documents loop — R-gate log (v5 / `living-docs-realdocs`)

Concise per-iteration log of the "real documents" loop. R-gates (R1–R7) + HOLD design gates (G1–G6) are
defined in `docs/plans/13-real-documents-loop.md`. Verify live on a real folder; re-read disk for every
write (on `code.sh` per Decision #38). One commit per iteration; before/after shots posted as PR comments.

## Iteration 1 — settle + prove (no feature code)

**Surface decided (Decision #38, Tom's call):** web `code-web` + chrome-devtools drives UI iteration (real
reads); desktop `code.sh` proves disk persistence for every write-gate. Rationale: proved live that
`code-web` writes only to in-browser memfs, and the real-disk FSA picker is a native dialog automation
can't drive.

**Proved live on `/Users/tommy/Sites/.realdocs-test`** (`Weekly Update.md` + `Team Notes.md` + `metrics.csv`):

| Check | Result |
|---|---|
| Real-folder discovery (tree-rail) | ✅ `Weekly Update` under REPORTS, `metrics.csv` under SOURCES — real files, no demo data. `Team Notes.md` excluded (no frontmatter → not "living"). |
| Source-read on real CSV | ✅ `bind:metrics.mrr.latest` resolved to the real `49800`, highlighted as a bound figure. |
| Home reflects folder | ❌ Hardcoded demo (4 fake projects, "New project" no-op). → R2 gap. |
| In-app edit applies | ✅ "Edit raw Markdown" sentinel applied, "Saved · v14". |
| Edit persists to **disk** (`code-web`) | ❌ on-disk file byte-identical — memfs only. → drives Decision #38. |
| Desktop `code.sh` boots on the real folder | ✅ Electron app ("Opportunity OS - Living Documents") booted on `.realdocs-test`, workbench started. (One benign console seam: `ExtensionsViewlet.registerViews` complains because the de-IDE work deregistered the Extensions container — not a crash.) Disk-proof surface confirmed viable. Note: its UI isn't chrome-devtools-drivable, so per-write disk proofs open the folder via CLI + re-read the file. |

**R-gate status going in:** R1 missing (no on-ramp), R2 missing (Home demo), R3/R4 engine-real but
surface-gated, R5/R6 missing UI, R7 missing (stretch). Full map + ranked build order in
`13-real-documents-loop.md`. **Design gates G1–G6:** held from v4 (no feature code changed the shell this
iteration).

**Next:** R1 + R2 — the open-folder on-ramp + folder-reflecting Home + empty state, which unblock everything.

## Iteration 2 — R1 (open-folder on-ramp) + R2 (folder-reflecting Home)

**Built (TDD for the service logic; 0 core patches — all in our own contrib):**
- Service (`livingDocsService.ts`): broadened discovery (`_collectDocs`/`_isDocFile`) so `listDocuments`
  returns **every `.md`** with the existing `isLiving` flag (was living-only); added `openFolder()`
  (`IFileDialogService.showOpenDialog({canSelectFolders})` → `IHostService.openWindow`) and
  `getWorkspaceFolderName()`. Injected `IFileDialogService` + `IHostService`.
- Home (`screenRender.ts`): rewrote `renderHome` — empty state ("Open a folder to begin" + Open-folder
  button) when no folder; otherwise the folder name + a DOCUMENTS grid of the real docs (living badged,
  plain shown as "Markdown"), each an `openDoc` action. "New project" no-op → "Open another folder"/"New
  document"; "Switch folder…" in the header.
- Glue (`screenEditor.ts`): fetch docs before first render; re-fetch on `onDidChange`; handle
  `openFolder` / `newDocument` / `openDoc`.

**TDD:** inverted the `listDocuments` test (now includes plain Team Notes + the reference note, with the
flag); added `getWorkspaceFolderName` + `openFolder` service tests; added 3 Home render tests (empty /
populated / no-docs). Watched each fail, then pass. **68 livingDocs tests green; typecheck clean.**

**Verified live on the real folder** (`code-web` + chrome-devtools, served `.realdocs-test`):

| Gate | Result |
|---|---|
| R2 Home reflects the real folder | ✅ "mount — 2 documents · 1 living"; demo project cards gone; "Switch folder…" + "Open another folder" present. |
| R2 all `.md` shown, living badged | ✅ **Team Notes** (Markdown, no badge) + **Weekly Update** (• Living, "1 source: metrics.csv"); tree-rail REPORTS now lists both (Team Notes was previously hidden). |
| R2 "New project" resolved | ✅ replaced by "Open another folder"; no `newProject` action anywhere. |
| openDoc wiring | ✅ clicking the Team Notes card opens the plain doc (previously unlistable). |
| R4-precursor: New document | ✅ "New document" created **Untitled document** (appears in tree + opened); web write → memfs (real disk on desktop per Decision #38). |
| R1 open-folder action | ⚠️ buttons present + wired (`openFolder`); the actual folder *pick* is a native dialog (the one manual step) — `openFolder`→`openWindow` wiring is unit-tested; cancel opens nothing. |
| R1 empty state | unit-tested (renders "Open a folder to begin" + button); `code-web` always mounts a folder, so the no-folder state shows on desktop / a no-folder window. |

**Design gates G1–G6:** held — only the Home webview content + service discovery changed, not the shell
(single editor pane, calm 48px header, 76px labeled tree-rail nav, no Explorer/menubar/palette surfaced,
no dev toasts). The de-IDE contributions run at every workbench startup, so a folder-switch reload re-applies
them (G4 holds across a switch).

**R-gate status after iter 2:** **R2 PASS** (live), **R1 PASS** for the on-ramp UI + wiring (folder-pick is
the inherent manual step). R3 (edit persists) verified in-app iter 1 + desktop is the disk surface; R4
(create) wired + in-app verified, desktop disk-proof pending; R5/R6 next; R7 stretch.

**Next:** R5 — add/remove a source via UI (new `addSource`/`removeSource` service API, TDD), or R3/R4 desktop
disk-proof. Pick highest-impact next iteration.

## Iteration 3 — R5 (add/remove a source via UI)

**Decision #40 (the add-source UX):** an in-app list of the folder's data files (csv/json) in the Context
panel — not a native dialog (scopes to the project per #39, and is drivable; the native picker is the same
non-automatable wall as R1).

**Built (TDD; 0 core patches):**
- Pure `withFrontmatterSource(text, source, add)` (`livingDocMarkdown.ts`) — edits only the `sources:`
  frontmatter list, body verbatim; creates frontmatter for a plain doc's first source; drops the empty
  `sources:` key on last removal; idempotent.
- Service: `addSource`/`removeSource` (rewrite frontmatter → `saveRawText`, which persists + re-resolves +
  fires change) and `getSourceCandidates` (folder csv/json minus bound + `.lock.json`/`agents.json`).
- UI: `treeRailView` Context tab — a ＋ Add source picker (lists candidates, click to bind) + a × unbind on
  each Linked source row.

**TDD:** 4 `withFrontmatterSource` tests (add/idempotent/remove-drops-key/create-frontmatter); 3 service
tests (addSource persists frontmatter + leaves prose; removeSource; getSourceCandidates excludes
bound+system files). Watched each fail then pass. **82 livingDocs tests green; typecheck clean.**

**Verified live** (`code-web` + chrome-devtools, `.realdocs-test` with a 2nd data file `forecast.csv`):

| Check | Result |
|---|---|
| Linked sources + unbind affordance | ✅ Context tab shows "LINKED SOURCES · 1: metrics.csv (live · feeds 1 block)" with a × Remove. |
| ＋ Add source lists folder candidates | ✅ picker offered `forecast.csv` (metrics.csv excluded as bound; lock/agents excluded). |
| Add binds + resolves from the real file | ✅ clicking `forecast.csv` → "LINKED SOURCES · 2", forecast.csv resolved "live"; no frontmatter hand-editing. |
| Remove unbinds | ✅ × on forecast.csv → back to "LINKED SOURCES · 1". |
| Persistence | web write → memfs (disk unchanged, expected); the write path is `saveRawText`→`IFileService` (unit-tested to persist; real-disk on desktop per #38). |

**Design gates G1–G6:** held — only the Context panel (within the tree-rail) + service changed; the 49800
bound figure (G5) intact, shell unchanged, no toasts.

**R5 PASS** (add + remove live). **Next:** R6 — add a context *file* via UI + @mention resolving real folder
files (the Add-context form is currently text-only; @mention resolves only frontmatter-declared files today).

## Iteration 4 — R6 (reference a file via UI + @mention over the folder)

**Decision #41:** (a) reference-a-file = a **File** kind in the existing "＋ Add context" form (picker of folder
md/csv/json → writes `context:` frontmatter); (b) `@mention` broadened from frontmatter-declared to **all real
folder docs** (cached on the doc state at load; `_readContext` already reads any relative path).

**Built (TDD; 0 core patches):**
- Generalized `withFrontmatterSource` → `withFrontmatterList(text, 'sources'|'context', value, add)` (wrapper kept).
- Service: `addContextFile`/`removeContextFile` (→ `_rewriteList` → `saveRawText`), `getContextCandidates`
  (folder files minus bound/referenced), `IDocState.folderFiles` (via `_scanFolderDocs`, excludes
  self/lock/agents/generated), and `getMentionableFiles` now unions declared sources/context + folder files.
- UI: `treeRailView` Add-context form gains a **File** kind with a candidate picker; × unbind on Referenced files.

**TDD:** 1 markdown test (`withFrontmatterList` context key) + 3 service tests (mentionables include folder
files / addContextFile persists context frontmatter & leaves prose+sources / getContextCandidates filtering).
Inverted the old `getMentionableFiles` test. **85 livingDocs tests green; typecheck clean.**

**Verified live** (`code-web` + chrome-devtools, `.realdocs-test` with `metrics.csv`+`forecast.csv`+`Team Notes.md`):

| Check | Result |
|---|---|
| ＋ Add context → File kind picker | ✅ lists `forecast.csv` + `Team Notes.md` (metrics.csv excluded as bound source). |
| Reference a real file | ✅ picking `Team Notes.md` → "REFERENCED FILES · 1: Team Notes.md (current)" (context frontmatter, no hand-editing). |
| Remove reference | ✅ × → Referenced files group cleared. |
| @mention resolves real folder files | ✅ the Chat composer's @-chips show `@forecast.csv` / `@metrics.csv` / `@Team Notes.md` — `forecast.csv` is a folder file NOT declared in WEEKLY's frontmatter, yet mentionable (was declared-only before R6). |

**Design gates G1–G6:** held — only the Context panel + the Chat composer's mentionable list changed; the 49800
bound figure (G5) intact, shell unchanged.

**R6 PASS** (add + remove reference + @mention over the real folder). **R1–R6 all pass live.**

### Desktop `code.sh` native-parity / disk-proof (Decision #38)

`code.sh` boots on `.realdocs-test` with the full R1–R6 build (the same compiled `out/`). The Electron UI is
not chrome-devtools-drivable, so the disk-write proof is done by observing the engine's real-disk writes:
- **Deterministic:** deleted the engine-written `agents.json`, relaunched `code.sh`, and it **reappeared on
  real disk** — the desktop build writes via the real `IFileService` (not memfs). `saveRawText` (R3/R4/R5/R6
  writes) uses the same `IFileService.writeFile`, unit-tested to persist.
- **Corroborating:** a desktop session's `Weekly Update.md` carried the R5 `forecast.csv` source on real disk
  (227 b, persisted across a relaunch) and an `Untitled.md` from R4's template — both real-disk, web can't
  write disk (proven iter 1). So create / edit / add-source / add-context all round-trip to real disk natively.

**LOOP STOP CONDITION MET: R1–R6 all pass live on a real folder; design gates G1–G6 hold; desktop `code.sh`
confirms native real-disk parity; 0 core patches across v5.** R7 (bind a figure to a source cell via UI) is a
noted stretch, not blocking.
