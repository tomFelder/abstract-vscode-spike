# Plan 46 - Tree rail (Editor v2, lane B first)

Spec of record: [43-editor-v2-spec.md](43-editor-v2-spec.md) (pins 4, 5, 6). **Starts after plan 44 merges.** Branch prefix `v2/tree-*`; worktree `/Users/tommy/Sites/abstract-v2-tree`.

## 1. Why

The tree rail is the file manager for people who do not want a file manager: status at a glance (dots, LWD chips, pending pills), three calm tabs instead of four, and a real right-click menu so documents behave like documents (rename, duplicate, move, bind, history, present) without dropping into IDE affordances. "Open to the right" becomes the one sanctioned split for side-by-side reference reading.

## 2. Success criteria

**Pin 4 - rail shell.**
- [ ] P4.1 The rail's 38px tab strip reads Files · Context · Outline (three tabs); Search is gone as a tab.
- [ ] P4.2 Type-to-filter lives inside Files (typing with the tree focused, or a quiet filter affordance, narrows rows live); prior Search behaviours are reachable this way.
- [ ] P4.3 Active tab = white chip 26px radius 8 + e1, 12/600; idle 12/500 `#868B95` hover `#52575F`.
- [ ] P4.4 A quiet ＋ (24px, radius 7, hover bg `#EEF0F3`) sits right of the tabs and creates a new document (name-first birth per plan 42 - the typed name is kept).
- [ ] P4.5 The rail scrolls as one; the SOURCES group label is mono 10/600/.12em `#A3A8B2`.

**Pin 5 - rows.**
- [ ] P5.1 Folder rows 28px: 9px chevron rotating 90° (~150ms), name 12.5/600, right-aligned mono doc-count `#A3A8B2`.
- [ ] P5.2 Doc rows 30px radius 8: 7px status dot (`ok` synced · `attention` pending · `#D5D8DE` plain - the PR-212 precedence ladder preserved for red states), 13px name, ellipsis on overflow.
- [ ] P5.3 Living docs carry the LWD chip (mono 9.5/600 `#5B6DC4` on white, border `#E0E5FB`, radius 5); docs with pending approvals carry the amber count pill (mono 10/600 `#8A6D1A` on `#FDFAF2`, border `#E4DCCB`, radius 999) - never both at once (pending wins).
- [ ] P5.4 Selected row: bg `#F4F5FD`, border `#E0E5FB`, text `#2A2F60`.
- [ ] P5.5 Children indent 14px; hover bg `#F1F2F6`.
- [ ] P5.6 Source rows keep kind glyph + right meta (synced / relative time) per the mock.

**Pin 6 - context menu.**
- [ ] P6.1 Right-click on a doc shows the four groups in order: Open / Open to the right · Rename… / Duplicate / Move to… · Bind sources… / View history / Present · Delete; 208px popover, radius 12, 30px rows, hairline dividers, popover shadow.
- [ ] P6.2 Open to the right opens the doc in a second group with its own product-tab row (contract 43 §3.2); closing its last tab closes the group; no blank group can be left behind (attack: open right, close both docs in every order).
- [ ] P6.3 Rename is inline in the tree (edit in place, Enter commits, Esc cancels); the silent-rename semantics from plan 42 L5 hold (title frontmatter follows per decision, lock sidecar moves with the file).
- [ ] P6.4 Duplicate copies doc + lock sidecar with a distinct name; Move to… moves both and re-points dependents (the existing `moveFile` machinery).
- [ ] P6.5 Bind sources… opens the existing bind flow; View history opens the doc with the History tab; Present triggers the existing Present flow.
- [ ] P6.6 Delete renders `#B5514B` with hover bg `#FBEEEE`, confirms before deleting, warns when dependents exist (existing dependents machinery), and deletes the lock sidecar with the doc.
- [ ] P6.7 Menu styling applies via the restyled native ContextMenuService - no parallel menu implementation.

**Regression.**
- [ ] PT.1 Context and Outline tabs still render their content; outline click still scrolls the editor.
- [ ] PT.2 livingDocs suite 0 failures; `typecheck-client`, `valid-layers-check`, `check-seams.sh` clean; zero core seams.

## 3. Iteration 0

Baseline screenshots (Files with a folder expanded + a living doc selected + a pending doc visible; Context; Outline; the current context menu) into `docs/qa/2026-07-v2/tree/00-baseline/`. Tracking issue "[editor-v2] Plan 46: tree rail" (label `editor-v2`). Grep and record `file:line` for the current TABS const, the minimal-v1 context menu, and the rename/move service seams.

## 4. Slices → PR bundles

- **46-a "tabs + filter + ＋"** (P4.*): fold Search into Files, chip styling, new-doc button.
- **46-b "row anatomy"** (P5.*): dots/chips/pills/selection/indent/twist.
- **46-c "context menu + file ops"** (P6.*, PT.*): menu restyle, inline rename, duplicate/move/delete through the service (additive methods), the sanctioned split.

## 5. Do-not-break

- The status-dot precedence ladder (PR #212) keeps red > yellow > green > grey semantics.
- File ops always move/copy/delete the lock sidecar with the doc and re-point dependents; never a raw fs call from the view.
- `livingDocsService.ts` additive-only; `studio.css`/theme belong to plan 44.
- Filter must not regress keyboard focus into the editor (plan 42 quiet-shell rules).
- No new core seams.

## 6. THE LOOP

```
GOAL: execute Plan 46 (docs/plans/46-tree-rail-loop.md) until bundles a-c are merged or blocked-with-reason, then post the closing report. Run docs/plans/43-editor-v2-spec.md §5 THE PROTOCOL with: loop=tree, worktree /Users/tommy/Sites/abstract-v2-tree, branches v2/tree-<bundle>, evidence under docs/qa/2026-07-v2/tree/. Bundle order a → b → c. Validator emphasis: the blank-group attack on Open to the right (P6.2, every close order), rename/move/delete sidecar integrity on disk (list the folder before/after), dot-vs-pill precedence with a doc that is both living and pending, and filter behaviour with 50+ docs (scale fixture). Known traps: the tree is a WorkbenchObjectTree - restyle, don't fork it; inline rename needs the tree's edit affordance, not a modal; TMPDIR=/tmp; Node 24; typecheck-client only. When bundle c lands, post an unblock note for plan 49 (row-click → source tab pattern is the same family).
```

## 7. Definition of done

All §2 criteria ticked on merged PRs (or blockers recorded); closing screenshots committed; the tracking issue closed with the bundle→PR map; lane B proceeds to plan 47.
