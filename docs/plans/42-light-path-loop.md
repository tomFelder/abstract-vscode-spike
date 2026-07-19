# Plan 42 - The light path: editor-first cold start (drop the human guardrails, keep the agent's)

**Status:** ratified by the founder 20 Jul 2026 (this plan is the ratification record; see the delta notes duty in section 7). **Merge policy for this run:** validator-gated auto-merge - once a bundle's validator passes, open the PR with screenshots, then squash-merge to main and delete the branch. The founder reviews on main afterwards.

## 1. Why (the mandate)

The app feels too heavy at first touch. The riskiest assumption in the whole thesis is not the trust grammar - it is whether a non-technical person feels value on *their own document* fast enough to form the habit ([23](../23-validation-thesis-and-value-hypotheses.md), [24](../24-beta-success-memo.md)). Today's first-run is optimised for a scripted demo instead: a 7-step walkthrough, a model-access decision, an optional survey, and a bundled demo doc all sit between "app opens" and "I typed a word into my own file". The governing principle for this plan: **guardrails attach to the agent's hands, never to the user's.** Diff/approve/provenance on agent edits is the wedge and is untouchable; ceremony on plain human editing is friction and gets removed. This re-sequences the entry path in the ratified journey specs ([20](20-journey-specs-aha-path.md) group A entry, [21](21-beta-v1-prioritization.md) onboarding ordering); the walkthrough and demo survive but stop being gates.

## 2. Metrics this plan optimises

- **TTFK (time-to-first-keystroke)**: cold open with a real folder to a typed character in one of the user's own documents. Target: <=10 seconds, <=2 interactions, 0 decisions demanded.
- **Steps-to-editing**: count of screens + clicks + forced decisions on that path. Baseline is measured in iteration 0; the closing report shows before/after.
- **Unharmed**: time-to-first-approved-proposal (the aha metric) must not regress - the AI door has to be one obvious action away at all times.

## 3. Iteration 0 - baseline + issues (do this first, it gates everything)

Drive the current build (fresh profile, launch skill, workspace = a copy of a real markdown folder, e.g. `docs/`). Record every screen, click, and forced decision from cold open until a character is typed into a user document; screenshot each step; commit the audit to `docs/qa/2026-07-20-light-path/00-baseline/` with a `baseline.md` table (step, surface, decision demanded, seconds). Then file one GitHub issue per slice below (labels: `enhancement` + priority as marked, title prefix `[light-path]`), each carrying its slice text verbatim plus the baseline evidence link. Post the issue numbers into a comment table at the top of the run's tracking issue (create one umbrella issue `[light-path] Plan 42 run tracker`).

## 4. The slices (each becomes one issue and one PR bundle)

### L1 - Editor-first cold start (P0)

Opening the app with a folder lands in the editor surface with a document open and focused (most recently opened doc, else the first doc, else a new untitled markdown doc with the cursor placed), not the Welcome walkthrough. The walkthrough becomes a dismissible card/entry point ("See a 90-second demo") reachable from Home and first-run, never a gate; "See It Work" keeps working when invoked. Opening the app with no folder lands in a blank untitled document with a visible "Open a folder" affordance, not a wizard. AC: fresh profile + folder -> cursor blinking in an editable doc with <=2 interactions and 0 forced decisions; walkthrough reachable and dismissible; review-rail mount no longer depends on having completed onboarding (the known restored-profile mount quirk dies here).

### L2 - Model access moves to first AI use (P0)

No model/account decision on the entry path. The first time the user invokes the agent (send in chat, run a skill, any AI door) with no backend configured, the sign-in vs included-model choice renders inline in the chat rail at that moment; picking one proceeds with the original request without losing the typed prompt. The "few quick questions" survey leaves the critical path entirely and lives only on the Model access settings screen. AC: cold start never shows model UI; first AI action with no backend shows the inline choice and then answers (included-model path live-verified with the broker); the settings screen still offers both doors; the typed prompt survives the sign-in round trip.

### L3 - Markdown-first, "living" is earned (P1)

Plain markdown is the default citizen everywhere on the entry path: new doc = plain `.md`, no locks/birth-sheet/Living Document ceremony or vocabulary before the user meets an agent. A doc upgrades to living (lock file, provenance machinery) only when the first source is bound or the first agent edit is accepted, silently, at that moment. Copy audit on the entry path: no "Living Document", "lock", "birth sheet", or "sources" language visible before first AI/source use. AC: create + edit + save a new doc with zero living-doc artefacts on disk; bind a source or accept an agent edit -> lock appears and History/provenance work from that point; Context/Outline/History rails still truthful for both states (post-#181 behaviour preserved).

### L4 - Quiet shell on entry (P1)

The right rail starts collapsed when there is nothing for it to say (no pending review, no chat history for this doc). It expands automatically on first AI invocation or when a review arrives, and thereafter respects the user's manual choice (persisted, reusing the rail width/persistence machinery from #173). A slim affordance (icon or edge tab) keeps the AI door one click away while collapsed. AC: cold open on a plain doc shows editor + left rail only; invoking chat expands the rail with the composer focused; pending reviews force it open; manual collapse/expand persists across restart.

### L5 - Frictionless human edits (P1, mostly verification + removal)

Typing never triggers ceremony: no snapshot prompts, no review of the user's own edits, no confirmation dialogs on the editing path; autosave stays as-is and History accumulates silently in the background so trust is there when looked for. Audit the editing surface for any prompt/toast/dialog reachable by plain typing, saving, renaming, or closing and remove or defer each (list every one found in the PR, with its disposition). AC: a 10-minute freewriting session on a plain doc produces zero prompts/toasts/dialogs; History still shows the session's implicit versions for a living doc; nothing in the trust grammar for agent edits changes.

## 5. Do-not-break constraints (binding on every bundle)

- The agent-edit trust grammar (diff, approve, provenance, review rail behaviour for proposals) is untouchable. If a slice seems to require weakening it, stop and record a blocker instead.
- Ratified strategy docs (12, 14, 15, 23, 24, 25) are not re-litigated. This plan amends the *sequencing* in docs 20/21 only.
- Zero new core patches preferred; the merge-tax ledger count is 6 - if a core patch is genuinely unavoidable, record it in `docs/plans/03-merge-tax-ledger.md` in the established format and justify it in the PR.
- Light mode only (#180), calm shell, and the #171/#172/#173 nav behaviour stay intact. The livingDocs test suite is at 0 failures on main - it stays at 0; extend tests where behaviour changes (snapshot-style, per repo learnings).
- Every PR embeds before/after screenshots (raw.githubusercontent links to files committed under `docs/qa/2026-07-20-light-path/<bundle>/`), cites its issue, and uses no co-author lines in commits.

## 6. THE LOOP - goal prompt for a fresh session

When the founder says "implement docs/plans/42-light-path-loop.md", the session runs this loop verbatim. You are the orchestrator; do not implement in the main loop - dispatch sub-agents and gate quality between them. Use the loop/goal mechanism you have (self-paced wakeups; sub-agent completion notifications are the wake signal).

```
GOAL: execute Plan 42 (docs/plans/42-light-path-loop.md) until every slice L1-L5 is merged to main or has a recorded blocker on its issue, then post the closing report.

SETUP FACTS (verified 2026-07-16, re-verify cheaply if anything fails):
- Repo /Users/tommy/Sites/abstract-vscode-spike, branch main. Node 24 required: `source ~/.nvm/nvm.sh && nvm use 24` (shell defaults to v22 and preinstall fails).
- Per-bundle isolation: `git worktree add /Users/tommy/Sites/abstract-lp-<slice> -b <branch> main`, then `npm install` and one-shot `npm run compile` in the worktree. NEVER `npm run compile` for iteration - use `npm run typecheck-client`. Remove each worktree when its bundle merges (disk fills fast; check `df -h` when in doubt).
- Live E2E via the launch skill at .claude/skills/launch/SKILL.md. ALWAYS prefix launches with `TMPDIR=/tmp` (default macOS temp path exceeds the unix-socket limit and launch fails EINVAL). Unique playwright session name per agent. Kill instances and remove temp profiles when done; macOS tolerates ~2-3 concurrent instances.
- Tests: `./scripts/test.sh --grep "livingDocs"` - expectation on main is 0 failures. `npm run valid-layers-check` and `./scripts/check-seams.sh` must stay clean.
- If a sub-agent dies with a session-limit message: probe with a trivial haiku agent; if agents work again, respawn as a RESUME agent pointed at the worktree (read `git status`/`git diff` critically first - the diff is claims, not facts). If genuinely blocked, schedule a wakeup past the reset time and park.

LOOP (2 lanes max, one bundle per lane):
0. First iteration only: run Plan 42 iteration 0 (baseline audit + file the issues + umbrella tracker). The baseline agent needs the launch skill and a fresh profile.
1. For each slice in order L1, L2, L3, L4, L5 (L1 and L2 may run as the first two lanes concurrently; L3-L5 fill lanes as they free; if two slices in flight would touch the same files heavily, serialise them and say so):
   a. TIGHTEN: re-read the slice text and its issue; write the implementer prompt with exact code pointers (grep first; the entry path lives in src/vs/workbench/contrib/livingDocs/browser/ - screenEditor/screenRender for Welcome/Home/onboarding, livingDocs.contribution.ts for defaults and rail visibility, reviewRailView.ts for the rail, livingDocsService.ts for onboarding state and model status).
   b. IMPLEMENT: opus sub-agent in the bundle worktree. It must: read the issue + this plan's slice + constraints section; keep the diff surgical; typecheck + targeted tests green; live E2E with before/after screenshots committed under docs/qa/2026-07-20-light-path/<slice>/; report structured raw data; NOT open a PR.
   c. VALIDATE: separate adversarial opus sub-agent, fresh eyes, instructed to refute: re-run checks, independently drive the live app against the slice's AC (especially the TTFK path: fresh profile, count interactions), attack edge cases (no-folder open, restored profile, model unconfigured, broker down for L2, review-pending for L4), commit its own evidence. Verdict PASS/FAIL with defects.
   d. FAIL -> spawn a fix-round agent with the validator's findings; re-validate (focused re-check is fine when the fix is prescribed). Loop until PASS or 3 rounds; at 3, record the blocker on the issue and move on.
   e. PASS -> open the PR (title `feat/fix(livingDocs): ... (#issue)`, body: what/why, validation story including anything the validator caught, screenshot table with raw.githubusercontent links, non-blocking advisories). Then squash-merge with branch delete. If checks are red ONLY from known-infra macOS runner-allocation failures (~3s failures), that is not a real red. After merging, fetch main in remaining lanes' worktrees and rebase/resolve before their PRs.
   f. Remove the merged bundle's worktree. Pick up the next slice.
2. After L1-L5: run the CLOSING AUDIT - repeat iteration 0's measurement on final main (same folder, fresh profile), produce the before/after table (TTFK, steps, decisions), commit to docs/qa/2026-07-20-light-path/99-closing/, and post it as the closing comment on the umbrella issue.
3. Ratification hygiene: append delta notes to docs/20-journey-specs-aha-path.md and docs/21-beta-v1-prioritization.md ("entry re-sequenced by plan 42 on <date>: walkthrough demoted to optional, model access deferred to first AI use - see docs/plans/42-light-path-loop.md") and add plan 42 to the docs/README.md plans row. Include these in the last bundle's PR or a final docs-only PR.
4. Report to the founder: slices merged (PR links), blockers recorded, the before/after metric table, and anything discovered that belongs in a future plan. Send a push notification when done - the founder is likely away.
```

## 7. Definition of done

All five slices merged (or blocked-with-reason on their issues), the closing audit shows TTFK <=10s / <=2 interactions / 0 forced decisions against the measured baseline, the aha path still completes end to end (walkthrough invoked manually -> demo -> approve still works), docs 20/21 carry the delta notes, docs/README.md indexes this plan, and the livingDocs suite is still at 0 failures on main.
