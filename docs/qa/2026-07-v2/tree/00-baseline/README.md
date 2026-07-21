# Plan 46 - Tree rail: iteration 0 (baseline / before state)

Baseline evidence for [plan 46](../../../../plans/46-tree-rail-loop.md) (lane B, Abstract Editor v2 wave). Captured on the `v2/tree-00-baseline` worktree, branched from `origin/main` at `3ec16a6333e` (post plan-44 shell, PR #216/#220 already merged - the icon-nav-on-chrome v2 shell is in).

## Blocker: live capture could not run (disk full)

**The runtime screenshots and `getBoundingClientRect`/`getComputedStyle` measurements (capture steps 4-5) could NOT be produced.** `npm install` failed twice with `ENOSPC: no space left on device` during the extensions postinstall - the disk sits at 93-100% used throughout (see below), and a full VS Code install (~1.5G `node_modules`) plus the `npm run compile` `out/` tree (multi-GB) does not fit.

- The volume is over-subscribed by the parallel v2 lanes (each `abstract-v2-*` worktree carries ~1.5G `node_modules`) plus ~39G of **stale `.claude/worktrees/agent-*` worktrees** from concluded runs (plans 30-36, all long merged).
- Reclaiming the stale-worktree `node_modules` would free ~5.8G and unblock the build, but that action was **denied by the safety classifier** as out-of-scope for this agent (touching other lanes' worktrees). Within-scope reclaim (own npm cache, the half-written `extensions/copilot/node_modules`) freed only ~1.4G - not enough.

**Escalation for the orchestrator:** free disk before the 46-a implementer runs. Cleanest fix is `git worktree remove` (or at minimum `rm -rf .../node_modules`) on the concluded `.claude/worktrees/agent-*` set - these are from runs that finished weeks ago. Once ~5G is free, `npm install && npm run compile` will complete and the live launch (`TMPDIR=/tmp ./scripts/code-web.sh ./living-docs-sample --port 8082`) can proceed. All the grep pointers and target numbers below are done and do not need re-doing; only the live screenshots + measured px/hex remain.

## What WAS captured: the source-of-truth "before" numbers

The current rail styling is injected as a `<style>` block in `treeRailView.ts` (`_injectStyles`, `treeRailView.ts:742-815`). These are the exact pre-v2 values (read from source; they are what the browser would compute, since the rail hard-codes them rather than reading theme tokens for most dimensions):

### Tab strip (today: FOUR tabs, Search IS a tab)

- Tabs today: **Files · Context · Outline · Search** - four tabs (`TABS` const, `treeRailView.ts:39-44`). Search is a tab, not folded into Files. Plan 46-a folds it in (P4.1/P4.2).
- Tab strip: no fixed height - `padding:0 2px`, `border-bottom:1px solid var(--vscode-widget-border,#eef0f3)`; height driven by the tab button's own padding (`treeRailView.ts:747`).
- Tab button: `padding:8px 8px`, `font:500 11.5px/1 system-ui`, `gap:5px`, glyph `font-size:12px`; idle colour `--vscode-descriptionForeground`, hover `--vscode-foreground` (`treeRailView.ts:748-751`). **Effective height ~ 8+8 + ~12 line + 2px active underline ≈ 30px** (measure live to confirm).
- Active tab today = **bottom-border underline** (`border-bottom-color:oklch(0.55 0.13 255)`, i.e. accent), NOT a white chip. Target (P4.3) is a white chip 26px radius 8 + e1, 12/600.
- No `+` new-document button exists today (target P4.4).
- No SOURCES mono group label styling on the tab strip (the SOURCES/folder label is `.rail-folder`, `font:600 10px/1 'JetBrains Mono' … letter-spacing:.08em … uppercase`, `treeRailView.ts:768` - close to target 10/600/.12em but letter-spacing is .08em not .12em, and colour is `--vscode-descriptionForeground` not `#A3A8B2`).

### Rows (Files tree)

The Files tab uses a real `WorkbenchObjectTree` (`treeRailView.ts:257-286`); row heights come from `TreeRailDelegate.getHeight` (`treeRailFilesTree.ts:35`), which returns a **single uniform `TREE_RAIL_ROW_HEIGHT = 26` (`treeRailFilesTree.ts:21`) for BOTH folder and doc rows today** - there is no folder-vs-doc height split. Target P5.1/P5.2 introduce distinct heights (folder **28px**, doc **30px**). CSS-visible facts:

- Folder label: `font:600 11px/1 system-ui` (`treeRailView.ts:756`). Target P5.1 name is 12.5/600.
- Leaf (doc) row: `gap:7px`, `font:400 13px/1.3 system-ui`, ellipsis on overflow (`treeRailView.ts:757`). Target P5.2 name 13px - matches; row radius 8 + 30px height is the target (confirm delegate height live).
- Status dot: container `width:9px;height:9px`, dot `width:7px;height:7px;border-radius:50%` (`treeRailView.ts:759-760`). **7px dot already matches target P5.2.**
- Dot colours today (oklch, `treeRailView.ts:762-765`): grey `--vscode-descriptionForeground` opacity .45 · green `oklch(0.6 0.14 150)` · yellow `oklch(0.7 0.15 85)` · red `oklch(0.55 0.2 25)`. Target restates them as `ok`/`attention`/`#D5D8DE` semantic tokens (46-b restyles to hex).
- Grey dash (plain no-lock leading indicator): `width:8px;height:2px` (`treeRailView.ts:761`).
- **No LWD chip and no amber pending pill in the tree today** (target P5.3). The old trailing amber pending dot was already removed in PR #212 (comment, `treeRailView.ts:458-460`); pending now shows only as the leading yellow status dot.
- **No selected-row treatment** in the injected CSS (relies on the tree widget's default selection background via `overrideStyles: { listBackground: 'sideBar.background' }`, `treeRailView.ts:276`). Target P5.4 is bg `#F4F5FD` / border `#E0E5FB` / text `#2A2F60`.
- Indent: the tree widget's default (not the 14px target P5.5); hover uses `--vscode-list-hoverBackground` (target `#F1F2F6`).

### Context / Outline tabs (regression baseline)

- Context tab: groups rendered as `.rail-folder` uppercase mono labels + `.rail-item` rows (`_renderContext`, `treeRailView.ts:529-570`), plus "＋ Add source" / "＋ Add context" composers. `.rail-item`: `padding:6px 8px 6px 18px`, `border-radius:6px`, `font:400 13px/1.3` (`treeRailView.ts:769`).
- Outline tab: `.rail-outline` rows, click scrolls the editor via `revealHeading` (`_renderOutline`, `treeRailView.ts:685-709`); lvl-1 `font-weight:600`, lvl-2/3 indented + muted (`treeRailView.ts:791-795`).

## Grep pointers (file:line)

### Tab list / TABS const
- `src/vs/workbench/contrib/livingDocs/browser/treeRailView.ts:37` - `type TreeRailTab = 'files' | 'context' | 'outline' | 'search'`.
- `treeRailView.ts:39-44` - the `TABS` const (four entries incl. `search`). This is what 46-a edits to drop `search`.
- `treeRailView.ts:176-184` - the tab-strip render loop.
- `treeRailView.ts:711-740` - `_renderSearch` (the current Search tab body: input + results). 46-a folds this behaviour into Files as type-to-filter (note: the Files tree already has `findWidgetEnabled: true` + a keyboard-nav label provider, `treeRailView.ts:281-284`, so type-ahead exists on the tree today).

### Minimal-v1 context menu (the current right-click)
- `treeRailView.ts:308-315` - `tree.onContextMenu` registration on the Files tree.
- `treeRailView.ts:467-475` - `_showFileMenu`: today only **Rename… / Delete… / (sep) / Add to chat**. Target pin 6 replaces this with the four-group 208px popover (Open/Open to the right · Rename/Duplicate/Move to… · Bind sources…/View history/Present · Delete). Uses `this.contextMenuService.showContextMenu(...)` - the native ContextMenuService, so 46-c restyles it (P6.7), not forks it.
- `treeRailView.ts:503-527` - `_renameFile` (currently a **quickInput prompt modal**, NOT inline tree edit) and `_deleteFile` (confirm dialog with dependents list). Target P6.3 makes rename inline in the tree.

### Rename / move / delete / duplicate service seams (`common/livingDocs.ts` interface + `browser/livingDocsService.ts` impl)
| Op | Interface | Impl | Status for 46-c |
|---|---|---|---|
| `renameFile(resource, newBaseName)` | `livingDocs.ts:828` | `livingDocsService.ts:1279` | **EXISTS**. Moves file + lock sidecar via `_moveFileWithSidecar`. Reused as-is for inline rename. |
| `deleteFile(resource)` | `livingDocs.ts:835` | `livingDocsService.ts:1373` | **EXISTS**. Snapshots file+sidecar for Undo; removes sidecar with the doc (`livingDocsService.ts:1375,1405`). Reused for P6.6. |
| `getFileDependents(resource)` | `livingDocs.ts:820` | `livingDocsService.ts:1273` | **EXISTS**. Backs the delete warn-and-list (P6.6) and move re-point. |
| `_moveFileWithSidecar(from, to)` | (private) | `livingDocsService.ts:1312` | **EXISTS but PRIVATE**. The atomic doc+`.lock.json` move-or-rollback machinery. 46-c "Move to…" (P6.4) needs a **new additive public method** (e.g. `moveFile(resource, targetFolder)`) that wraps this + re-points dependents. **ADDITIVE GAP.** |
| `applyTidyMoves(items)` | `livingDocs.ts:858` | `livingDocsService.ts:1552` | **EXISTS**. Batch-moves through `_moveFileWithSidecar` (`livingDocsService.ts:1566`) with rollback (`:1599`) and carries `dependents` (`:1522`) - the re-point pattern to follow for a single-file Move. |
| `buildTidyPlan()` | `livingDocs.ts:849` | `livingDocsService.ts:1482` | EXISTS (the agent-proposed move plan; not the manual single-file move). |
| Duplicate (doc + sidecar) | - | - | **MISSING - ADDITIVE GAP.** No `duplicateFile`/`copyDoc` on the interface or impl (only `duplicateAgent`, `livingDocs.ts:776`, unrelated). 46-c (P6.4) must add a new additive `duplicateFile(resource)` that copies the doc + its `.lock.json` sidecar with a distinct name. |
| `attachToChat(resource)` | `livingDocs.ts:838` | `livingDocsService.ts:1470` | EXISTS (current menu's "Add to chat"; not in the pin-6 group list - decide whether to keep). |
| `revealHeading(resource, i)` | `livingDocs.ts:571` | - | EXISTS (Outline click target; regression PT.1). |

**Summary of the 46-c additive-only gap list:** two new public methods needed - **`moveFile`/move-to** (wrapping the existing private `_moveFileWithSidecar` + `getFileDependents` re-point) and **`duplicateFile`** (copy doc + sidecar, distinct name). Rename, delete, dependents, and the sidecar-atomic move engine all already exist. Bind sources / View history / Present (P6.5) route to existing flows (bind = `addSource`/`getSourceCandidates`, `treeRailView.ts:574-602`; history + present are existing editor flows). Keep `livingDocsService.ts` additive-only (spec §3.7 / do-not-break).

### Status-dot precedence ladder (PR #212)
- The ladder lives in **`common/railStatus.ts`**, function **`docRailDot`** (`railStatus.ts:65`), imported by the tree at `common/treeRail.ts:10` and applied at `treeRail.ts:150` and `:327`.
- Precedence (top wins), verbatim from `railStatus.ts:65-90`:
  1. **RED** - needs input: `relinkCount > 0` (loudest) → then `fanoutFailed` → then `stale`.
  2. **YELLOW** - `pendingCount > 0` (changes waiting for approval).
  3. **GREEN** - `unseenAgentEdits > 0` (agent-applied since the user last looked).
  4. **GREY** - nothing to report (plain no-lock doc always lands here).
- Inputs plumbed through `ILivingDocSummary` → `buildTreeRailNodes` (`treeRail.ts:150-157, 327`): `pendingCount, unseenAgentEdits, relinkCount, stale, fanoutFailed`, each defaulting to 0/false → grey. Documented on `ITreeRailItem` at `treeRailFilesTree.ts` / `treeRail.ts:56-65`.
- **Do-not-break (spec 46 §5):** 46-b must preserve red > yellow > green > grey. The pin-5 wording ("ok/attention/plain") is a **restyle of the same ladder**, not a re-ordering; the amber pending PILL (P5.3) is a new right-meta treatment, distinct from the leading dot, and "pending wins over LWD chip" is a display rule at the chip layer, not a change to `docRailDot`.

## Target numbers (from the mock, for the implementer's before/after)

Source: `docs/design/abstract-editor-v2/Abstract Editor v2.dc.html` pins 4-6 (lines 366-384) and plan 43 §2.

- Rail: 264px floating card, radius 14. Tab strip **38px**. Active tab = white chip **26px radius 8 + e1, 12/600**; idle 12/500 `#868B95`, hover `#52575F`. Quiet ＋ 24px radius 7, hover bg `#EEF0F3`. SOURCES label mono **10/600/.12em `#A3A8B2`**.
- Folder rows **28px**: chevron 9px rotate 90° ~150ms, name **12.5/600**, right mono doc-count `#A3A8B2`.
- Doc rows **30px radius 8**: 7px dot, name 13px, ellipsis. LWD chip mono **9.5/600 `#5B6DC4` on white, border `#E0E5FB`, radius 5**; pending pill mono **10/600 `#8A6D1A` on `#FDFAF2`, border `#E4DCCB`, radius 999** (pending wins, never both). Selected: bg `#F4F5FD`, border `#E0E5FB`, text `#2A2F60`. Children indent **14px**, hover bg `#F1F2F6`.
- Context menu: **208px popover, radius 12, 30px rows, 6px padding, hairline dividers, popover shadow**. Delete `#B5514B`, hover bg `#FBEEEE`.

## Screenshots

**Not captured** - see the disk blocker above. The five required frames (Files w/ folder expanded + living doc selected + pending doc; Context; Outline; the current right-click menu; the tab-strip close-up at 1440x900, plus Files at 1760x1000) remain outstanding for the 46-a round-1 implementer once the build is unblocked.
