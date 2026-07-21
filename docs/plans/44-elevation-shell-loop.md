# Plan 44 - Elevation shell (Editor v2, the sequential opener)

Spec of record: [43-editor-v2-spec.md](43-editor-v2-spec.md) (pins 1, 2, 3 + the 48px header). **This loop runs alone and merges to main before any other v2 lane branches.** Branch prefix `v2/shell-*`; worktree `/Users/tommy/Sites/abstract-v2-shell`.

## 1. Why

The whole v2 read - "the white paper floats above the tool" - is carried by the shell: darker chrome, floating cards, one real header. Every other loop's pixels sit on these surfaces, so this lands first and owns `studio.css` + the theme for the entire wave. It also deletes the per-webview top bars, which every surface currently draws for itself - one header, drawn once.

## 2. Success criteria (copied verbatim into each PR body; only the validator ticks)

**Pin 1 - elevation.**
- [ ] P1.1 Window/app frame background is `#EDEFF3` on every surface (Editor, Home, Templates, Knowledge, Agents).
- [ ] P1.2 Tree rail, editor and right rail render as three floating cards with 12px gaps between them and 12px inset from the frame edges (±1px).
- [ ] P1.3 Cards: radius 14, border `#E9EAEE`; rails bg `#FBFCFD`, editor bg `#FFFFFF`.
- [ ] P1.4 Computed shadows: rails `0 8px 28px -14px rgba(20,22,28,.22)` + e1; editor `0 12px 36px -16px rgba(20,22,28,.26)` + e1.
- [ ] P1.5 `.monaco-editor-background` computes to opaque `#FFFFFF` (no transparency anywhere under the paper).
- [ ] P1.6 Resize sashes still work between panels (drag changes rail width; no dead zones wider than the 12px gap).
- [ ] P1.7 At most ONE new core CSS seam taken for part backgrounds/margins; it is logged in the merge-tax ledger with a re-pin check and asserted in `check-seams.sh`.

**Header.**
- [ ] PH.1 One full-width 48px header spans the frame above nav + rails + editor; border-bottom `#E2E4EA`; bg chrome.
- [ ] PH.2 Left cluster: 22px accent "A" logo tile (radius 6) + workspace name 13.5/600 `#1A1C20` + `/` `#C6CAD2` + current surface/doc 13.5 `#868B95`; breadcrumb updates when the active doc/surface changes.
- [ ] PH.3 Right cluster per surface via the header content service (43 §3.3): sync pill (Editor/Home/Knowledge), agent-health pill (Agents), "＋ Open folder" (Home), "＋ New template" (Templates), "＋ Add source" (Knowledge); 27px avatar circle.
- [ ] PH.4 The per-webview top bars in `livingDocRender` and the screen renders are gone; no double-header on any surface.
- [ ] PH.5 If the titlebar height needed a core constant change, it is the wave's second and final sanctioned seam, logged + seam-gated; otherwise note "CSS-only" on the ledger row.
- [ ] PH.6 Desktop note recorded for the founder smoke: on macOS desktop the left toggle clears the traffic-light inset (code inspection + one screenshot if a desktop build is cheap; otherwise a written check in the PR).

**Pin 2 - rail toggles.**
- [ ] P2.1 Two 28px icon buttons at the header's far left/right; panel glyph with filled half indicating side; hover bg `#E2E4EA`.
- [ ] P2.2 ⌘\ toggles the tree rail; ⌘⇧\ toggles the right rail; the stock split-editor chord on ⌘\ no longer fires (neutralised via keybinding registration, weight 1000).
- [ ] P2.3 Collapse animates width→0 + fade ~150ms ease; expand restores prior width.
- [ ] P2.4 Collapsed state persists per-workspace across reload (storage keys per 43 §3.5).
- [ ] P2.5 With the right rail collapsed and ≥1 pending proposal, an 8px amber dot rides the right toggle; it clears when the rail opens; the old force-open behaviour is retired.
- [ ] P2.6 ⌘B keeps its dual role (Bold in editor focus; tree-rail toggle in shell focus) - no regression.

**Pin 3 - icon-nav on chrome.**
- [ ] P3.1 The 76px nav has no panel background - items sit on `#EDEFF3`.
- [ ] P3.2 Active item = 60px white chip, radius 10, e1; glyph + label `#4650B8`; label 10/600.
- [ ] P3.3 Idle items `#868B95`, hover `#52575F`; labels 10/500; 18px stroke glyphs; Settings pinned bottom.
- [ ] P3.4 Navigation between all five surfaces still works from the nav (no dead items after the top-bar removal).

**Regression sweep.**
- [ ] PR.1 All five surfaces screenshot cleanly at 1440×900 and 1760×1000 with no clipped panels, scrollbar collisions or white-on-white seams.
- [ ] PR.2 livingDocs suite 0 failures; `typecheck-client`, `valid-layers-check`, `check-seams.sh` clean.

## 3. Iteration 0 (gates the loop)

Drive current main (`TMPDIR=/tmp ./scripts/code-web.sh ./living-docs-sample`), screenshot all five surfaces at both viewports into `docs/qa/2026-07-v2/shell/00-baseline/`, and file the loop tracking issue (label `editor-v2`, title "[editor-v2] Plan 44: elevation shell") listing the three PR bundles. Record where today's top bars come from (grep `withTopBar` and the livingDocRender top-bar builder) with `file:line` in the issue.

## 4. Slices → PR bundles

- **44-a "tokens + elevation".** New tokens (43 §1) into the theme + `studio.css`; chrome bg; floating cards + gaps + shadows; the part backgrounds/margins seam if CSS-only insetting fails (try the inner-inset trick first: paint the part bg chrome, inset a rounded shadowed card inside via styleOverrides); `check-seams.sh` assertions; ledger row. Criteria P1.*.
- **44-b "the header".** `abstractHeader.ts` contribution repurposing the titlebar part; header content service (43 §3.3); rail toggles + keybindings + persistence + badge dot; top-bar removal in `livingDocRender.ts` + screen renders (surgical deletions only - these files are otherwise owned by plans 45/48/49). Criteria PH.*, P2.*.
- **44-c "nav on chrome + sweep".** Icon-nav CSS; five-surface regression sweep at both viewports; closing baseline for the lanes. Criteria P3.*, PR.*.

## 5. Do-not-break

- Trust grammar and the review engine untouched; no new approve/apply paths.
- Zero regressions to plan 42's light path (cold start lands in the editor; quiet shell).
- Seam budget: this loop may take at most the TWO sanctioned seams (43 §6); a third = STOP.
- `livingDocsService.ts`: additive methods only.
- Real data only; truthful states; tabs; nls strings; disposables registered; no em dashes; Australian English.

## 6. THE LOOP

Paste into a fresh session (or run via the master prompt [RUN-editor-v2-loop.md](RUN-editor-v2-loop.md)):

```
GOAL: execute Plan 44 (docs/plans/44-elevation-shell-loop.md) until bundles 44-a, 44-b, 44-c are merged to main or carry recorded blockers, then post the closing report on the tracking issue. Run docs/plans/43-editor-v2-spec.md §5 THE PROTOCOL with: loop=shell, worktree /Users/tommy/Sites/abstract-v2-shell, branches v2/shell-<bundle>, evidence under docs/qa/2026-07-v2/shell/. One lane only (this loop is sequential and everything queues behind it - bias to finishing over polishing; park P-level disputes as follow-ups on the issue rather than burning rounds). Validator emphasis: measure every shadow/colour/gap numerically; attack rail collapse persistence across reload, ⌘\ vs split-editor, badge-dot behaviour with a pending proposal staged, and all five surfaces for double-headers. Known traps: default macOS TMPDIR breaks launches (always TMPDIR=/tmp); Node 24 via nvm; never `npm run compile` for iteration; part internals may set explicit px sizes on children - if the inset-card trick clips, take the sanctioned margins seam instead of fighting CSS.
```

## 7. Definition of done

All §2 criteria ticked on merged PRs; the ledger carries the seam rows (≤2) with re-pin checks; `check-seams.sh` extended and green; baseline + closing screenshots committed; the tracking issue closed with the bundle→PR map; lanes A/B/C unblocked (a note on the umbrella issue that 45/46/48 may branch).
