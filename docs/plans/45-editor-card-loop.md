# Plan 45 - Editor card (Editor v2, lane A)

Spec of record: [43-editor-v2-spec.md](43-editor-v2-spec.md) (pins 7, 8, 9, 10, 11, 12). **Starts after plan 44 merges.** Branch prefix `v2/editor-*`; worktree `/Users/tommy/Sites/abstract-v2-editor`. This is the biggest loop of the wave; its PR-a (numbered gutter + address model) is a dependency gate for plan 47, and its policy editor + sources-as-tabs are soft gates for plan 49 - merge PR-a and PR-c promptly rather than batching.

## 1. Why

The editor card is where the trust story lives: the numbered gutter turns provenance into a shared address vocabulary ("line 6") that chat, review, Home and the Agents ledger all speak; product tabs make sources first-class working surfaces; the Properties panel gives frontmatter a plain-language front door (and closes #122 F11 by putting the per-doc agent policy where a person would look for it).

## 2. Success criteria

**Pin 9 - numbered gutter (PR-a).**
- [ ] P9.1 Gutter column is 70px wide, `flex:none`, left of the 720px reading column; prose x-position is unchanged vs the plan-44 closing baseline.
- [ ] P9.2 Numbers are JetBrains Mono 11px, right-aligned, right edge 22px from the text edge (±1px).
- [ ] P9.3 Idle number colour is exactly `#C6CAD2`.
- [ ] P9.4 One number per Markdown line/block (D1 wrap rule): a paragraph wrapped over 3 visual rows shows one number and blank gutter on rows 2-3 (fixture doc provided in the loop issue).
- [ ] P9.5 A bound line's number renders `#5B6DC4`/600 with a 9px dot to its left.
- [ ] P9.6 A pending-edit block shows an `attention` number (`#8A6D1A`) + 3px vertical bar spanning exactly its rows.
- [ ] P9.7 Hovering a marked number opens the source-peek drawer for that bind; hovering an idle number does nothing.
- [ ] P9.8 Typing latency on the plan-30 scale fixture shows no regression vs baseline (measured; recompute throttled on PM transactions + resize; fall back to per-block line-height arithmetic + idle re-measure if DOM measurement thrashes).
- [ ] P9.9 The address model (43 §3.1) lands in `common/`: persistent refs carry block ids; printed numbers are display-time; a deep link to a deleted block degrades to the doc without scroll and without error (unit-tested).
- [ ] P9.10 The old 30px dot gutter is fully gone (no dead CSS/DOM).

**Pin 11 - proposals addressed by line (PR-a).**
- [ ] P11.1 The inline proposal widget cites the gutter address ("Line 6") in its mono tag row.
- [ ] P11.2 Word-diff colours per spec: add `#E9F6EE`/`#2C8159`; remove `#FBEEEE` strike `#CF5A53`; Approve = accent fill 28px radius 8; Reject = ghost, hover turns `removed`.
- [ ] P11.3 Approving/rejecting still round-trips through the review engine (no new apply path); the rail card shows the same address string.

**Pin 7 - product tabs (PR-b).**
- [ ] P7.1 A 40px tab strip on `#F3F4F7` renders inside the editor card, above the toolbar, in the editor pane host DOM (not inside the webview).
- [ ] P7.2 Active tab: white, 34px, radius 9 9 0 0, border `#E9EAEE` merging into the toolbar edge (no double border), 12.5/600 + 6px status dot + quiet ×.
- [ ] P7.3 Idle tabs 32px text-only 12.5/500 `#868B95`, hover bg `#ECEDF1`; clicking activates.
- [ ] P7.4 Opening a source (from tree SOURCES or Knowledge) adds a ⊞ mono-glyph tab on the same strip showing the source grid; the bottom drawer (pin 10) still works independently.
- [ ] P7.5 Middle-click closes a tab; closing the active tab activates its neighbour; VS Code's own tabs remain `showTabs:'none'`.
- [ ] P7.6 No drag-to-split and no reorder-into-groups exists; >8 tabs overflow into horizontal scroll + an overflow menu.
- [ ] P7.7 The open-tab set persists per-workspace per-group across reload.
- [ ] P7.8 "Open to the right" (plan 46's menu) gets its own tab row in the second group; closing the last tab in a group closes the group (contract 43 §3.2 - build the group-side support even though the menu item ships in plan 46).

**Pin 8 - toolbar (PR-c).**
- [ ] P8.1 Toolbar right side reads exactly: ✦ Ask AI · Properties · ● Saved · v14; nothing else added.
- [ ] P8.2 The Properties button (list glyph + label, 30px radius 8) toggles the panel; active state bg `#F4F5FD`.

**Pin 12 - Properties panel (PR-c).**
- [ ] P12.1 284px inset panel at the editor card's right edge, bg `#FBFCFD`, hairline left border `#EEF0F3`, 44px header row with quiet ×.
- [ ] P12.2 Fields render per spec: TITLE · CREATED/UPDATED (mono 11.5) · STATUS chip · TAGS chips + dashed ＋ · BOUND SOURCES rows (click → drawer) · AGENT POLICY; labels mono 9.5 UPPER .12em `#A3A8B2`.
- [ ] P12.3 Title, status and tags EDITS write back to the doc's frontmatter on disk (verified by reopening the raw file); created/updated/bind counts read from the lock and are truthful.
- [ ] P12.4 AGENT POLICY renders and edits the per-doc three-tier policy via the shared plain-language policy editor component in `common/` (43 §3.4) - this closes **#122 F11** (the autonomy control, no duplicate UI).
- [ ] P12.5 "Edit raw YAML →" opens the raw view of the doc.
- [ ] P12.6 Panel open state persists per-doc; the 720px reading column re-centres in the remaining width when open (measured).

**Pin 10 - regression hold (PR-d).**
- [ ] P10.1 Bound figures: atom styling per spec, round-trip to `[label](bind:key)` intact; click opens the drawer at 52-54% with the referenced row in `#F4F5FD`; never a second editor group.
- [ ] P10.2 Hover provenance peek shows "then vs now" values with api/mcp fallbacks named as fallbacks (**#122 F13**, the editor-side share).
- [ ] P10.3 livingDocs suite 0 failures; `typecheck-client`, `valid-layers-check`, `check-seams.sh` clean; zero new core seams from this loop.

## 3. Iteration 0

Baseline screenshots (editor on a living doc with ≥1 bound figure, ≥1 pending proposal, drawer open, and the plan-30 scale fixture) at both viewports into `docs/qa/2026-07-v2/editor/00-baseline/`. File the tracking issue "[editor-v2] Plan 45: editor card" (label `editor-v2`), listing bundles a-d and cross-linking #122 (F11/F13 boxes). Commit the wrap-rule fixture doc (a paragraph long enough to wrap at 720px) into `living-docs-sample/`.

## 4. Slices → PR bundles

- **45-a "numbered gutter + addresses"** (criteria P9.*, P11.*). Replaces the margin-dot decoration in the PM bundle; address model in `common/`; proposal-widget citations. **Merge promptly - plan 47 waits on this.**
- **45-b "product tabs"** (P7.*). Tab model in the service (additive), tab row in `livingDocEditor.ts` host DOM, source-viewer input for sources-as-tabs.
- **45-c "Properties panel"** (P8.*, P12.*). Frontmatter read/write API on the service (additive); shared policy editor component; toolbar entry. Closes #122 F11.
- **45-d "fit and finish"** (P10.*). Drawer/figure regression, F13 hover peek, recenter maths, scale-fixture perf evidence.

## 5. Do-not-break

- The PM bundle rebuild recipe is `docs/lwd-pm-bundle-build.md`; `prosemirrorBundle.test.ts` must round-trip before anything stacks on 45-a.
- Everything routes through the review engine; approve/reject paths unchanged.
- `livingDocsService.ts` additive-only; `studio.css`/theme belong to plan 44 (file a request on the umbrella issue for shell tweaks).
- No new core seams (the wave budget lives with plan 44).
- Do not regress: undo across approve (#122 F6 shipped), source drawer, export/present, cold-start light path.

## 6. THE LOOP

```
GOAL: execute Plan 45 (docs/plans/45-editor-card-loop.md) until bundles a-d are merged or blocked-with-reason, then post the closing report. Run docs/plans/43-editor-v2-spec.md §5 THE PROTOCOL with: loop=editor, worktree /Users/tommy/Sites/abstract-v2-editor, branches v2/editor-<bundle>, evidence under docs/qa/2026-07-v2/editor/. Bundle order a → (b ∥ c) → d; merge a and c as soon as they PASS (47 and 49 wait on them) and post an unblock note on the umbrella issue. Validator emphasis: the wrap-rule fixture (P9.4), prose-never-shifts (P9.1 vs baseline), scale-fixture latency (P9.8) measured not asserted, frontmatter round-trip on disk (P12.3), and that no second editor group can be conjured outside the sanctioned split. Known traps: the PM bundle is base64-in-TS (decision 43) - follow docs/lwd-pm-bundle-build.md and re-run prosemirrorBundle.test.ts; webview-internal tabs would flicker - the tab row lives in the pane host DOM (43 §3.2); TMPDIR=/tmp; Node 24; typecheck-client only.
```

## 7. Definition of done

All §2 criteria ticked on merged PRs (or blockers recorded); #122 gets a comment ticking F11 and the F13 editor-side box with PR links; the address model + policy editor are documented (one paragraph each) in the tracking issue for plans 47/49 to consume; closing screenshots committed.
