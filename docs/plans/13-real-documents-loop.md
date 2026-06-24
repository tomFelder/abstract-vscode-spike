# 13 — Real Documents loop (v5 / `living-docs-realdocs`)

Take Living Documents from its v4 design-aligned shell (PR #17, merged to `main` 2026-06-24) to a state
where a user can **open a real local folder from the calm shell and actually work** — edit existing docs,
create new ones, bind sources, reference other files — all persisting to **real disk**. This is the
FUNCTION phase, not pixel-alignment. Branch: `living-docs-realdocs` off `main`.

The R-gates (acceptance) and HOLD gates (the six v4 design gates G1–G6, re-checked every iteration with a
real folder open) are specified in the loop goal. This doc is the **function-gap map** + **ranked build
order**, grounded in a live iteration-1 proof.

---

## Iteration 1 — settle + prove (no feature code)

### What was proven live (real throwaway folder `/Users/tommy/Sites/.realdocs-test`)

Created a real folder: `Weekly Update.md` (frontmatter `sources: [metrics.csv]` + a `[49800](bind:metrics.mrr.latest)`
bind link), `Team Notes.md` (plain), `metrics.csv` (4 weekly rows). Served it via `./scripts/code-web.sh
/Users/tommy/Sites/.realdocs-test`, drove it with the chrome-devtools MCP. Findings:

1. **Real-folder discovery already works.** The left tree-rail listed `Weekly Update` under REPORTS and
   `metrics.csv` under SOURCES — both my real files, no demo data. `Team Notes.md` was **not** listed
   (it has no frontmatter/bind, so `listDocuments`'s "is this living?" filter excludes it).
2. **Source-read already works on real data.** Opening `Weekly Update` resolved `bind:metrics.mrr.latest`
   to **`49800`** — the latest value from my real CSV — and highlighted it as a bound figure.
3. **The Home main area is hardcoded demo data.** "Across 4 projects…", the four project cards
   (Opportunity OS / Acme Co / Fund III / Job Search 2026), "New project" (no-op). None of it reflects
   the open folder. (R2 gap, confirmed live.)
4. **⛔ `code-web` does NOT persist writes to real disk.** I edited the doc in-app (added a sentinel line
   via "Edit raw Markdown" → "Done editing source"); the edit **applied in-app** ("Saved · v14", the new
   line rendered) but the on-disk file was **byte-identical** — the sentinel never reached disk.
   `@vscode/test-web` serves the mounted folder over HTTP read-only and overlays writes in an in-browser
   memfs (`code-web.js` mounts at `/static/mount`; writes do not round-trip). **This contradicts the
   loop goal's premise that the web build round-trips to disk.**

### The build + verification surface — the decision this iteration exists to settle

Three surfaces, and the naive "web + File System Access API + fully-unattended chrome-devtools" path has an
internal contradiction:

| Surface | Real-disk READ | Real-disk WRITE | Drivable by chrome-devtools MCP |
|---|:--:|:--:|:--:|
| **Desktop** `code.sh` (Electron) | ✅ | ✅ | ✗ (Electron; native dialogs) — but folder opens via CLI |
| **Web** `code-web` (test-web mount) | ✅ | ✗ (memfs only) | ✅ (full a11y-click into webview) |
| **Web + File System Access API** | ✅ | ✅ | ⚠️ UI yes, but `showDirectoryPicker()` is a **native OS dialog** CDP cannot drive |

VS Code's web build **does** have a real-disk FSA path (`services/dialogs/browser/fileDialogService.ts:206`
calls `showDirectoryPicker()`, backed by `platform/files/browser/htmlFileSystemProvider.ts`) — `window.showDirectoryPicker`
is present and the context is secure. So opening a folder via FSA gives real read **and** write in the
browser. The only wall is that the **native picker / permission prompt cannot be automated** by
chrome-devtools (CDP file-chooser interception covers `<input type=file>`, not the FSA directory picker).

**Implication:** we cannot prove "re-read the file from disk after every write" *fully unattended on the web
build*. **Decision (Decision #38, Tom's call): "web drives, desktop proves disk."** Primary UI-iteration
surface = `code-web` + chrome-devtools (real reads; memfs writes are fine for interaction + in-app
round-trip checks). Disk-persistence proof for every write-gate = desktop `code.sh` (real disk, folder
opened via CLI, re-read the file). Iteration 1 confirmed `code.sh` boots on `.realdocs-test`, so the
disk-proof surface is viable. The R1 **product** on-ramp is built on the real FSA path regardless (so the
shipped app is real-disk on web and desktop); the choice only governs the *verification* loop.

---

## Function-gap map — current real-data engine vs each R-gate

Engine is in `src/vs/workbench/contrib/livingDocs/browser/`. Verdicts verified live (iter 1) or by code read.

| R-gate | What it needs | Status | Evidence / where |
|---|---|---|---|
| **R1** Open a real folder from the shell (+ switch folders), no CLI | An in-app "Open folder…" action (Home button) → FSA open path; survives the de-IDE removals | **DONE (iter 2)** — on-ramp UI + wiring | `livingDocsService.openFolder()` (`showOpenDialog`→`openWindow`); Home empty-state button + "Switch folder…" + "Open another folder" (all `data-msg="openFolder"`). 0 core patches. Wiring unit-tested; the native folder *pick* is the one manual step (dialog not automatable). |
| **R2** Empty state when no folder; populated state reflects the REAL folder; resolve "New project" no-op | Home reads real folder (docs/sources counts), an empty state, "New project" wired or removed | **DONE (iter 2)** — verified live | `renderHome` rewritten: empty state, or folder name + DOCUMENTS grid of every `.md` (living badged). "New project" → "Open another folder". `listDocuments` broadened to all `.md` (`_collectDocs`/`_isDocFile`). Verified live on `.realdocs-test`. |
| **R3** Open a real `.md`, edit, persists to disk (re-read to prove) | Real-disk write | **ENGINE REAL, surface-gated** | `livingDocsService` `loadDocument` reads via `IFileService`; `saveRawText` writes via `IFileService.writeFile`. In-app round-trip proven live; **disk persistence blocked on `code-web` memfs** — needs desktop/FSA surface. |
| **R4** Create a new doc in the folder (real `.md`, appears in tree, editable) | Real-disk write to a workspace path | **ENGINE REAL, surface-gated** | `createDocument` → `_uniqueDocUri` → `IFileService.writeFile` with `NEW_DOCUMENT_TEMPLATE`. Same disk-persistence caveat as R3. The "New project"/"Blank document" Home buttons should call it. |
| **R5** Add a SOURCE via UI (pick a real file, e.g. CSV); binding resolves; remove works | A "＋ Add source" affordance that writes the `sources:` frontmatter; a remove affordance | **DONE (iter 3)** — verified live | Context panel "Linked sources": ＋ Add source picks from an in-app list of folder csv/json (`getSourceCandidates`), writes frontmatter (`addSource`→`withFrontmatterSource`→`saveRawText`, re-resolves); × per source unbinds (`removeSource`). TDD; 0 core patches. Verified live: added/removed `forecast.csv` on `.realdocs-test` (resolved "live"). Decision #40. |
| **R6** Reference another file via UI — Context "＋ Add context" picks a REAL file; @mention resolves real folder files | A file-picker in the Context add form; @mention resolution over the real folder | **PARTIAL / MISSING** | `addContext` exists but the form (`treeRailView.ts` `_renderAddContext`) is text-only (Pasted text / Image / Company knowledge), no file picker; stored in the lock, not a real file ref. No `@mention` folder resolution found. **New service API needed (TDD).** |
| **R7** (stretch) Bind a figure to a source cell via UI (select text → choose source key) | Inline bind-creation UI writing a `[text](bind:key)` link | **MISSING** | Bind links are hand-authored Markdown; parser/resolver are real (`extractBindLinks`). No bind-creation affordance. Stretch — note, don't block. |

### Architecture notes (for builders)
- Main-area screens (Home/Templates/Knowledge/Agents) are reached via **activity-bar icon-nav containers**;
  the activity bar IS shown (it's the comp's left nav). The built-in Explorer/Search/SCM/Debug/Extensions
  containers are deregistered (`HideIdeContainersContribution`). G4 forbids re-introducing them.
- Left sidebar = one `TreeRailView` (Files/Context/Outline/Search). Right = one `ReviewRailView`
  (Chat/Review/History + on-demand Document-Agents disclosure).
- Workspace folder comes from `IWorkspaceContextService.getWorkspace().folders` (real).

---

## Ranked build order (later iterations — one R-gate per commit)

1. **R1 + R2 together (the on-ramp)** — highest impact, unblocks everything. In-app "Open folder…" on Home
   (FSA path), folder-switch, empty state, Home reflects the real folder, resolve "New project". Likely
   needs a small core seam (a folder-open command reachable without the de-IDE'd menu) — log in
   `03-merge-tax-ledger.md`.
2. **R4 — Create document** — wire the existing real `createDocument` to the Home/tree "Blank document"/
   "New doc" buttons; verify it lands in the tree and on disk.
3. **R3 — Edit persists** — mostly proving on the chosen disk surface; ensure no silent loss.
4. **R5 — Add/remove source via UI** — new `addSource`/`removeSource` service API (TDD), a picker, frontmatter write.
5. **R6 — Add context file + @mention** — file picker in the Context form (TDD); @mention resolves real folder files.
6. **R7 (stretch) — Bind figure via UI** — select-text → source-key picker; note only.

Each later iteration: build → verify live on a real folder (chrome-devtools; **re-read disk for every
write**) → re-check G1–G6 → update `07-decision-log` + `06-design-notes` + this doc + `docs/design-audit/r5-log.md`
→ commit ONE change → post before/after screenshots as a PR comment.

## R1 build notes (de-risked iter 1)

**Product semantics (Decision #39):** the open folder *is* the project — Home reflects this one folder
(no multi-project dashboard); "New project" becomes **"Open folder…"**; the tree/Home show **all `.md`**
with living docs **badged**.

**The open-folder seam (likely 0 core patches).** The de-IDE work removed the palette/menu surfaces but not
the commands. In the **web** build the plain `pickFolderAndOpen` (behind "Open Folder…") *throws* unless a
simplified provider is mounted — so don't use it. Instead, from our own contrib (inject `IFileDialogService`
+ `IHostService`):
```
const uris = await fileDialogService.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false });
if (uris && uris[0]) { await hostService.openWindow([{ folderUri: uris[0] }], { forceReuseWindow: true }); }
```
`showOpenDialog` (browser) calls `showDirectoryPicker()` → `htmlFileSystemProvider.registerDirectoryHandle`
→ a real-disk-backed URI; `openWindow` reloads the workbench with it as the workspace. Same code path works
on desktop (native dialog + native folder open). Surface it as a Home button + an empty-state button +
rename the "New project" quick-start tile; folder-switch = the same action again.

**Verification wrinkle:** the open action triggers a **native picker** automation cannot complete on either
surface. So R1 verifies in two parts: (a) the **empty state** + the button existing/triggering the picker is
fully drivable via chrome-devtools; (b) the actual folder *selection* + reload is the one **manual** step
(click the picker), after which discovery/edit are drivable again. R2's folder-reflecting Home is fully
drivable once a folder is open.

**R2 service change (TDD):** broaden `listDocuments` to return **all `.md`** with a `isLiving` flag (today it
filters to living-only) so the tree/Home can show plain docs badged. Unit-test the flag like the existing loop.

## Build / run (per [abstract-vscode-spike-build] memory)
- `nvm use 24.15.0` → `npm run watch` (background) → `./scripts/code-web.sh <folder>` (http://localhost:8080).
- Desktop parity / disk-proof: `./scripts/code.sh <folder>`.
- chrome-devtools a11y-click reaches webview-internal surfaces; re-snapshot before each click (uids change).
- Screenshot `filePath` must be inside a workspace root (e.g. `/Users/tommy/Sites/.lwd-shots/`), not `/tmp`.
