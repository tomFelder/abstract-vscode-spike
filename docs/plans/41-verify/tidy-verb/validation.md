# Validation — Issue #132: review-gated "Tidy this project" verb + folder conventions

Commit under test: `8dd44a80` — feat(livingDocs): Tidy verb + folder conventions (issue #132)
Branch: `claude/multi-agent-orchestration-t4s27d-tidy`
Validator: independent (Stream B), adversarial re-verification. Date: 2026-07-15.

## Verdict: READY

All ten acceptance criteria pass. One minor cosmetic grammar nit (non-blocking), noted below.

---

## Environment & honesty notes

- Worktree `/home/user/wt-tidy`; web workbench built from these sources (`npm run gulp compile` exit 0).
- Live workbench driven with Playwright/Chromium (`/opt/pw-browsers/chromium-1194`) against
  `./scripts/code-web.sh /tmp/scratch-b --port 8092`.
- **Reaching Project Home.** The Abstract workbench chrome is fully stripped in this build — no activity
  bar, sidebar, title bar, status bar, or command palette (`.part.activitybar/.sidebar/.titlebar` all
  width 0; `F1`/`Ctrl+Shift+P` do not open a quick-input). A fresh profile lands on the 7-step onboarding
  Welcome editor, which is model-dependent to complete. The reachable path used: `firstRun` is keyed on
  `MODEL_ACCESS_SEEN_KEY`, which the startup contribution sets to `true` on the *first* run
  (livingDocs.contribution.ts:526) regardless of finishing onboarding. So a persistent browser context
  that loads once (setting the key) and then **reloads** starts with `firstRun === false` and opens the
  Home screen directly (the pinned onboarding editor is not restored). This is the documented in-product
  behaviour ("On every later launch this flag is set, so startup lands on Home").
- **In-memory web file layer (plan-34 note confirmed).** After applying a tidy in the workbench, the
  on-disk `/tmp/scratch-b` folder was byte-for-byte unchanged (`find` + `md5sum` identical before/after).
  The web build's mounted folder is an in-memory overlay; writes do **not** propagate to disk. Consequences
  for grading:
  - Move/undo effects were verified through the workbench's own file tree + the deterministic re-scan
    behaviour of `buildTidyPlan` (re-running Tidy after apply is the strongest live proof the files left the
    root), not via disk `find`.
  - Dependent-lock **byte-level** rewrite could not be diffed on disk; graded on the two dedicated passing
    unit tests plus the live confirm-dialog + the post-undo "All sources synced" restoration.
- **Pre-existing-failure attribution — method.** The two failing test files (`screenRender.test.ts`,
  `treeRail.test.ts`) are **absent** from `git diff origin/main...HEAD --stat` (the commit touches only
  `livingDocsService.test.ts` and `tidyPlan.test.ts`). The one source file among them that the commit does
  touch, `screenRender.ts`, has a **purely additive** diff (0 deletion lines — `git diff | grep -c '^-[^-]'`
  = 0): it adds `renderTidy` + interfaces + a single `${renderTidy(state)}` call, removing/altering no
  existing render code. All six failures are "expected substring missing" assertions on features the diff
  does not touch (onboarding intro, resume banner, from-sources birth, ChatGPT sign-in; treeRail docx
  `hasReason`). A purely-additive render cannot delete an expected substring, so these are pre-existing,
  inherited from earlier merged PRs (the treeRail failure is a docx-import `hasReason` mismatch from the
  #129/#130 docx work). Attribution: **confirmed pre-existing, unrelated to #132.**

## Scratch project (/tmp/scratch-b) — exercises every heuristic

| File | Expectation |
|---|---|
| `Weekly Report.md` (+lock, `sources: [sales.csv]`) | healthy living doc — NOT proposed |
| `sales.csv` | BOUND (referenced) — NOT proposed |
| `budget-2024.csv` | loose data → `data/` |
| `Report OLD.md` (+lock, mtime -6wk) | superseded+stale+unref → `archive/` |
| `scratch thoughts.md` | scratch note → `working-files/` |
| `Quarterly.template.md` (referenced by Playbook via `context`) | template → `templates/` + carries dependent |
| `logo.png` | loose image → `assets/` |
| `Summary.md` (+lock `imported.from: Quarterly Report.docx`) + `Quarterly Report.docx` | docx is imported original → `archive/originals/` |
| `Playbook.md` (+lock, `context: [Quarterly.template.md]`) | references the template — NOT proposed |
| `Meeting Notes.md` | real deliverable — NOT swept (conservative) |
| `Plan v2.md` | lone v2, no earlier sibling — NOT archived (ambiguous) |

mtime backdating **survived** into the workbench (Report OLD appeared with the "not edited in 4 weeks"
reason), so the staleness heuristic was exercised live, not only in unit tests.

---

## Static + unit verification (Step 1)

- `npm run typecheck-client` — clean (no errors).
- `npm run valid-layers-check` — exit 0.
- `npm run gulp compile` — exit 0.
- Suites (chromium): `tidyPlan` **23 passing**; `LivingDocsService` **140 passing** (incl. the 6 tidy
  tests: atomic doc+lock move, dependent re-point, undo inversion, clash refusal, rollback-on-sidecar-
  failure, buildTidyPlan conservative-negative); `fileOps` **13 passing**.
- Pre-existing failures reproduced and attributed (method above): `screenRender` 4 (onboarding intro,
  resume banner, from-sources, sign-in) + `treeRail` 2 (docx SOURCES / `hasReason`) = **6**, none in the
  #132 diff.
- **ASCII on added lines:** `git show 8dd44a80 | grep '^+' | grep -cP '[^\x00-\x7F]'` = **0**. The `§`
  the implementer flagged is only in pre-existing context lines (the touched PDF-cache comment was in fact
  converted `§5` → "section 5"). Added lines are ASCII-clean.

Critical read of the diff confirmed the conservative edges hold in code and in tests: a lone `v2` is the
family winner and never archived; `Meeting Notes.md` is excluded from `SCRATCH_MARKER`; a bound data file
(`referencedBy > 0`) is never proposed; every reason string is plain words. Apply path reuses the genuine
F16 machinery (`_moveFileWithSidecar` rolls the document back if the sidecar move throws;
`_rewriteDependentReferences` rewrites frontmatter + lock sources; `_undoTidy` inverts in reverse order).

---

## Live workbench probes (Step 2) — see shots/

| Probe | Result | Evidence |
|---|---|---|
| A — plan proposed | PASS | 6 moves, exact expected set + sort order, plain reasons, "Nothing moves until you apply"; bound/healthy docs absent. `01-tidy-plan-proposed.png` |
| B — per-row Skip | PASS | Skip budget-2024.csv → "5 of 6 approved / Apply 5 moves", row dimmed "will stay put"; after applying 5, re-run Tidy shows exactly the 1 residual `budget-2024.csv → data/` — skipped file did not move. `02-skip-item.png` |
| C — apply (atomic, folders, re-point) | PASS | "Tidied 6 files into folders"; tree gains `ARCHIVE` (Report OLD) + `WORKING-FILES` (scratch thoughts) sections created on demand; no `.lock.json` orphaned. Disk byte-compare blocked (in-memory FS) — dependent-lock rewrite graded on unit tests + confirm-dialog + post-undo resync. `03-applied-folders.png` |
| D — undo | PASS | Sticky toast Undo → `ARCHIVE`/`WORKING-FILES` sections gone, all 7 docs back under REPORTS, topbar returns to "All sources synced" (dependent refs re-pointed back). `04-undo-restored.png` |
| E — honest empty plan | PASS | After applying all, re-run Tidy → "Nothing to tidy — This project is already well organised". No fabricated row. `05-nothing-to-tidy.png` |
| F — nothing moves without approve | PASS | Open plan → Cancel → collapses to Tidy button, no apply surface; re-open shows the same 6 (nothing moved). `06-cancel-no-changes.png` |
| G — locks hidden in tree | PASS | No `.lock.json` in the Abstract tree in either the applied or restored state. (visible in `03`/`04`) |
| H — would-orphan warning | PASS (live-reachable) | Template `Quarterly.template.md` referenced by `Playbook` (referencedBy>0 is allowed for templates/imported-originals, unlike archive/data/image proposals). Card shows amber "1 document reference this file … : Playbook"; Apply raises a non-blocking confirm dialog listing "• Playbook" with Cancel / Move anyway. `h-orphan-confirm-dialog.png` |

Note on H reachability: the archive/scratch/data/image proposals are all gated on `referencedBy === 0`, so
they can never carry dependents. The orphan-warning path is only reachable through the two proposals that
do **not** check `referencedBy` — imported-originals and templates. The template case is exercised here, so
the warning is genuinely live-reachable (not unit-only).

---

## Acceptance checklist

1. Proposes through review grammar; nothing moves without approve — **PASS** (A, F).
2. Plain-words reason each; conservative negatives hold — **PASS** (A + unit 23).
3. Moves atomic doc+lock; dependent locks updated; folders on demand; clash-safe — **PASS** (C + 6 unit tests; disk byte-compare N/A on in-memory web FS, see notes).
4. Would-orphan warns, lists dependents, proceeds gracefully, never blocks — **PASS** (H — live-reachable via template).
5. Undo fully inverts an applied tidy — **PASS** (D).
6. Honest empty plan on already-tidy project — **PASS** (E).
7. Tidied project legible to a non-Abstract user — **PASS** (plain `data/ assets/ templates/ archive/ archive/originals/ working-files/`; tree ARCHIVE/WORKING-FILES sections; on-disk N/A in web build).
8. Lock files hidden in the Abstract tree — **PASS** (G).
9. typecheck/layers/suites green; pre-existing-failure claim verified — **PASS** (counts + attribution method above).
10. ASCII on added lines — **PASS** (0 non-ASCII).

## Minor finding (non-blocking, cosmetic)

Subject–verb agreement for the singular-dependent case: the review card renders
"1 document **reference** this file …" and the confirm dialog "1 document **reference** files you are
moving." — both should read "references" when the count is 1. The `${n} document${n===1?'':'s'}` pluralises
the noun but the verb "reference" is fixed. Purely cosmetic; does not affect behaviour. Locations:
`screenRender.ts` `renderTidy` (dependents warning) and `screenEditor.ts` `_applyTidy` (dialog message).
