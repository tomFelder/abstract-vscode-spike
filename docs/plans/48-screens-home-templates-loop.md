# Plan 48 - Screens I: Home + Templates (Editor v2, lane C first)

Spec of record: [43-editor-v2-spec.md](43-editor-v2-spec.md) (H1-H3, T1-T3). **Starts after plan 44 AND the pre-step screenRender split have merged.** Branch prefix `v2/screens1-*`; worktree `/Users/tommy/Sites/abstract-v2-screens1`.

## 1. Why

Home is the on-ramp and the "needs you" triage surface; v2 makes it one calm white card on chrome with at most two attention cards and an honest folder-backed grid - and it closes the plan-42 residuals (#211 items 1-2: product-vocabulary empty-state copy, no on-surface open-folder cue). Templates makes patterns first-class: skeleton thumbnails that literally show where live data lands, and a save-current-doc door so templates come from work, not from admin.

## 2. Success criteria

**H1 - Home surface.**
- [ ] H1.1 Home renders no rails - one white card (radius 14, `shadow-editor`) floating on chrome beside the icon-nav; reading column max 1080px, padding 64/48/80.
- [ ] H1.2 Greeting row baseline-aligned: "Good morning/afternoon/evening, <name>." 30/600/-0.02em nowrap + mono date 13 `#A3A8B2`; no wrap collision at 1440×900.
- [ ] H1.3 Summary line 14 `#868B95` states the truthful needs-you count ("2 documents need you · everything else is in sync." / all-clear equivalent).
- [ ] H1.4 The header (plan 44's) shows "＋ Open folder" on Home.
- [ ] H1.5 No-folder state: one plain-words line + one "Open a folder" button on the surface itself, no product vocabulary ("Living Documents"/"sources"/"agents" absent) - closes **#211 items 1-2**.

**H2 - NEEDS YOU.**
- [ ] H2.1 Mono section label NEEDS YOU (10/600/.12em `#A3A8B2`); max 2 cards; overflow ("+N more") links to the Review surface.
- [ ] H2.2 Card anatomy: 3px accent top border, radius 13, e1; 8px pulse dot (opacity 1↔.35, 2.4s); name 14.5/600; mono amber "N TO APPROVE" pill; one-line plain-language reason citing the gutter address ("...waiting on your call at line 6") from real pending data.
- [ ] H2.3 The accent Review button deep-links into the doc with the Review tab open and scrolls to the addressed block (45-a address model).
- [ ] H2.4 Mono freshness stamp shows the real last-refresh relative time.
- [ ] H2.5 Zero-pending state: the NEEDS YOU section is absent entirely (no empty shell).

**H3 - ALL DOCUMENTS.**
- [ ] H3.1 4-col grid (gap 12) reads the real open folder (decision 39); cards: 26px two-letter avatar (plan 20 palette), name 13/600, status chip (needs you `attention` / in sync `ok` / markdown `muted` - 20px pills), mono source count.
- [ ] H3.2 Hover = `#F4F5FD` bg + `#E0E5FB` border; click opens the doc.
- [ ] H3.3 Dashed "＋ New document" tile last; creates via the name-first flow.
- [ ] H3.4 Status chips agree with the tree rail's dots/pills for the same docs (one truth).

**T1 - Templates surface.**
- [ ] T1.1 Same no-rails shell, column max 1180px; title row carries a 240px filter field (32px, radius 9) that filters cards live; header shows "＋ New template".
- [ ] T1.2 Sub-line: "Start a living document from a pattern. Sources bind after creation."

**T2 - template cards.**
- [ ] T2.1 YOUR TEMPLATES 3-col grid; card radius 13, e1; hover border `#9AA2E0` + lifted shadow.
- [ ] T2.2 110px skeleton thumbnail rendered from the template's parsed doc: grey bars for prose (`#D5D8DE` title / `#E9EAEE` body), accent-tint bars (`#E0E5FB`) positioned where bind slots occur - no screenshots, no canned art.
- [ ] T2.3 Body: name 14/600 + LWD chip; one-line description naming the expected source; mono meta "N bind slots · used N×" from real data (usage count from the lock/`fromTemplate` lineage; honest "used 0×").
- [ ] T2.4 Use duplicates the template into the open folder with binds empty, opens the new doc, and the doc's tree row carries a "bind sources" nudge until a source is bound.
- [ ] T2.5 The dashed "＋ Save current doc as template" tile writes the active doc to `.abstract/templates/` (binds emptied to slots), and the new template appears in the grid.
- [ ] T2.6 Templates from both `templates/*.template.md` (existing discovery) and `.abstract/templates/` appear; no duplicates.

**T3 - starters.**
- [ ] T3.1 STARTERS row: 4 quieter cards (rail bg, no thumbnail): Blank living doc · Project brief · Meeting notes · Metrics digest, each with its one-line purpose; visually subordinate to YOUR TEMPLATES.
- [ ] T3.2 Each starter creates the corresponding doc through the existing review-safe creation path.

**Regression.**
- [ ] HR.1 livingDocs suite 0 failures; `typecheck-client`, `valid-layers-check`, `check-seams.sh` clean; zero core seams; screen webview CSP/Trusted-Types rules hold.

## 3. Iteration 0

Baseline screenshots (Home with pendings, Home all-clear, Home no-folder fresh profile, Templates) at both viewports into `docs/qa/2026-07-v2/screens1/00-baseline/`. Tracking issue "[editor-v2] Plan 48: Home + Templates" (label `editor-v2`), cross-linking #211 (items 1-2). Verify the pre-step split landed (`screenRenderHome.ts` exists); if not, STOP and flag the umbrella issue.

## 4. Slices → PR bundles

- **48-a "Home"** (H1-H3, HR.1): the redesign + #211 absorption; deep links stub-tolerant until 45-a is on main (plain open-doc until then, upgraded in 48-c if needed).
- **48-b "Template cards + skeletons"** (T1, T2.1-T2.3, T3): visual layer + filter + starters.
- **48-c "Template flows"** (T2.4-T2.6 + H2.3 upgrade): Use/save-as-template through the service (additive), the bind-sources nudge, address-aware deep links.

## 5. Do-not-break

- Decision 39: the folder IS the project - no fixture cards, no multi-project dashboard.
- Plan 42's light path: cold start still lands in the editor, NOT on Home; Home stays an on-ramp you visit, not a gate.
- Truthful states everywhere: real counts, real freshness, honest "used 0×", absent sections over empty shells.
- `screenRenderHome/Templates.ts` are this loop's surfaces; `screenEditor.ts` handlers additive-only (shared with plan 49); shell CSS belongs to plan 44.
- No new core seams.

## 6. THE LOOP

```
GOAL: execute Plan 48 (docs/plans/48-screens-home-templates-loop.md) until bundles a-c are merged or blocked-with-reason, then post the closing report. Run docs/plans/43-editor-v2-spec.md §5 THE PROTOCOL with: loop=screens1, worktree /Users/tommy/Sites/abstract-v2-screens1, branches v2/screens1-<bundle>, evidence under docs/qa/2026-07-v2/screens1/. Gate check first: the pre-step screenRender split must be on main. Bundle order a → b → c. Validator emphasis: the three Home states (pendings / all-clear / no-folder on a FRESH profile - count the words, product vocabulary is a fail per #211), chip-vs-tree-dot agreement (H3.4), skeleton thumbnails derived from a template you author during validation (not the fixtures), save-as-template round trip (save, see card, Use it, bind a source, doc becomes living), and the light path (cold start must still land in the editor). Known traps: screen webviews enforce CSP/Trusted Types - build HTML through the existing sanitised builders; usage counts must come from real lineage, never a hardcoded N; TMPDIR=/tmp; Node 24; typecheck-client only.
```

## 7. Definition of done

All §2 criteria ticked on merged PRs (or blockers recorded); #211 gets a comment ticking items 1-2 with PR links; closing screenshots committed; tracking issue closed; lane C proceeds to plan 49.
