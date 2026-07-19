# Plan 42 - Light-path baseline audit (iteration 0)

**Date:** 2026-07-20
**Build:** `main` @ `3bbe7ddd1c4` (no source changes; stock current build)
**Workspace:** a copy of the repo's `docs/` folder (80 markdown files, a stand-in for a real user's markdown folder) at `/tmp/light-path-baseline-docs`
**Profile:** fresh/empty user-data-dir (cold start), launched via the launch skill with `TMPDIR=/tmp`
**Method:** driven with `@playwright/cli` over CDP; each distinct surface screenshotted.

This audit records the baseline that Plan 42 ([docs/plans/42-light-path-loop.md](../../../plans/42-light-path-loop.md)) improves against. The metric being optimised is **TTFK (time-to-first-keystroke)**: cold open with a real folder to a typed character in one of the user's *own* documents, with the targets `<=10s`, `<=2 interactions`, `0 forced decisions`.

## Metric summary (baseline, folder open)

| Metric | Baseline value | Plan 42 target |
| --- | --- | --- |
| **TTFK** (cold open -> keystroke in own doc) | Gated by the 7-step walkthrough; realistic hands-on-keyboard path is **3 clicks** through the demo before an own doc is even reachable, ~25-40s of reading/clicking (the walkthrough is designed to run ~10 minutes end-to-end). | `<=10s` |
| **Steps-to-editing** (screens + clicks + forced decisions) | **1 forced screen** (Welcome walkthrough) + **1 forced decision** (See It Work vs Model Access) + **3 clicks** (See It Work -> own doc in Files rail -> click into editor body) = **5** | `<=2 interactions`, `0 decisions` |
| **Forced decisions on the path** | 1: "See It Work" vs "Model Access & a Few Questions" presented as the only two actions on the opening surface | 0 |

**Forced decisions list (baseline):**
1. On cold open the only surface is the Welcome walkthrough (Step 1 of 7). The user must choose between **See It Work** (start the scripted demo) and **Model Access & a Few Questions** (the model/account decision + survey). There is no "just start editing" affordance and no own document open. This is the decision Plan 42 L1/L2 remove from the entry path.

## Step table (folder open, "See It Work" route to editing an own doc)

| Step | Surface shown | Interaction required | Decision demanded? | ~Seconds | Screenshot |
| --- | --- | --- | --- | --- | --- |
| 1 | **Welcome walkthrough** - "Welcome to Abstract / the two-wow, ten-minute path". A 7-dot progress rail: Start -> Demo -> Wow 1 -> Wow 2 -> Approve -> **Your Folder** -> Aha. Card: "Two Wows, Ten Minutes, No Setup" with buttons **See It Work** and **Model Access & a Few Questions**. The user's own folder is loaded but nothing is open in an editor. | App opens directly here (no editor, no own doc). Read + choose an action. | **Yes** - See It Work vs Model Access | 0 (app lands here) | `step1-cold-open.png` |
| 2 | **Demo editor** - clicking See It Work drops straight into the full editor surface with a bundled **Demo Report** doc (`Demo Report 12.md`) open, the left Files rail populated, and the right **Review rail expanded** showing pending agent proposals ("Approve & apply"). This is a demo doc, not one of the user's own files. | Click "See It Work" | No (but this is demo content, not the user's) | ~5-10s | `step2-after-see-it-work.png` |
| 3 | **Own doc open** - clicking a real file in the Files rail ("00 - Overview") opens the user's own markdown in the editor. The right Review rail is **still expanded** carrying the demo's pending proposals (quiet-shell / L4 issue: the rail does not collapse when there is nothing for this doc to say). | Click the own doc's tree item in the Files rail | No | ~3-5s | `step3-own-doc-opened.png` |
| 4 | **First keystroke in own doc** - clicking into the editor body and typing a character lands it. **Zero toasts, zero dialogs, zero snapshot prompts** appeared on typing/saving (L5 - frictionless human edits - already largely holds on this path). | Click into editor body + type | No | ~2s | `step4-typed-in-own-doc.png` |

**Net:** the first keystroke in an *own* document is 3 clicks and one forced decision away, behind a walkthrough that is explicitly framed as a "ten-minute" scripted demo over bundled content. Nothing forces the user to reach their own folder before step 6 ("Your Folder") of the guided flow; the fast path above (bail out of the demo into the Files rail) is a workaround, not the designed path.

## No-folder cold-open variant (L1)

Cold-opening with a **fresh profile and no folder** lands on the **exact same Welcome walkthrough** (Step 1 of 7), not a blank untitled document with an "Open a folder" affordance (`nofolder-1-cold-open.png`). There is no editable document and no visible "Open Folder" button on this surface - the walkthrough is the gate in the no-folder case too. This is precisely the case L1 calls out: no-folder open should land in a blank untitled doc with a visible "Open a folder" affordance, not a wizard.

The sibling **Model access** surface (reached via "Model Access & a Few Questions" from the walkthrough) presents the sign-in-vs-included-model choice plus a **"A few quick questions"** survey ("Which frontier model is your daily driver?") on the entry path (`nofolder-2-model-access.png`). This is the L2 target: no model/account decision or survey on the entry path; defer the choice to first AI use and move the survey to the settings screen only.

## Observations relevant to the slices

- **L1 (editor-first cold start):** both folder and no-folder cold opens land on the 7-step Welcome walkthrough, never in an editor with a doc focused. The walkthrough is a gate, not a dismissible card. The **review rail is mounted/expanded off the demo** even after switching to an own doc (see step 3) - the restored-profile / review-rail mount coupling L1 mentions is observable here: the rail's contents are driven by the onboarding demo rather than by the currently open doc.
- **L2 (model access):** the model/account choice + "A few quick questions" survey sit one click off the opening surface, as a peer of "See It Work". Note the seed keychain carried a "Signed in to ChatGPT" state through even an empty profile clone, so the choice UI still renders but shows a signed-in state; the decision surface itself is what matters for the baseline.
- **L3 (markdown-first, living is earned):** on disk in the workspace, only the bundled **Demo Report** docs carry `.lock.json` living-document artefacts (12 of them; `Demo Report 12.lock.json` was (re)generated at this session's launch, confirming the demo ships/writes locked docs at onboarding). The user's own `00-overview.md` had **no** lock file even after being opened and typed into - so plain markdown stays plain until an agent touches it, which is the L3 direction. The residual L3 work is the entry-path *vocabulary/ceremony* (the demo introduces "sources synced", locks, provenance before the user has met an agent on their own content).
- **L4 (quiet shell):** the right Review rail is expanded from the moment the demo starts and stays expanded when the user opens their own plain doc, even though there is no pending review or chat history for that doc (steps 2->3). Baseline shell is not quiet on entry.
- **L5 (frictionless human edits):** typing into the user's own plain doc produced **zero** prompts, toasts, or dialogs (verified: 0 toasts, 0 dialogs in the workbench after the keystroke). L5 is mostly verification + removal; nothing obviously fires on the plain-typing path today, but the full audit (rename/save/close) is the slice's job.

## Reproduction

1. `source ~/.nvm/nvm.sh && nvm use 24`
2. Copy `docs/` to `/tmp/light-path-baseline-docs`.
3. `TMPDIR=/tmp` + launch skill with a fresh (empty) source profile on that folder for the folder-open case, and with no folder arg for the no-folder case.
4. Drive with `@playwright/cli`; the fast path to an own-doc keystroke is: See It Work -> click an own doc in the Files rail -> click into the editor -> type.
