# Plan 42 - Light-path closing audit (final main)

**Date:** 2026-07-20
**Build:** `main` @ `7cc382c524c` (all five slices merged: L1 #202, L2 #205, L3 #206, L4 #209, L5 #208, plus test fix #207)
**Workspace:** a copy of the repo's `docs/` folder (128 docs; the two pre-existing `.lock.json` artefacts were removed so the folder starts as clean plain markdown, matching a real user's folder) at `/tmp/light-path-closing-docs`
**Profile:** fresh/empty user-data-dir (cold start), launched via the launch skill with `TMPDIR=/tmp`
**Method:** driven with `@playwright/cli` over CDP for the workbench shell; the livingDocs webview OOPIF driven with raw CDP `Input.dispatchMouseEvent`/`Input.dispatchKeyEvent` at device-pixel coordinates (DPR 1), the technique recorded in [02-l2/findings.md](../02-l2/findings.md). Same measurement method as [iteration 0](../00-baseline/baseline.md).

This is the mirror of iteration 0 on final main. The metric being optimised is **TTFK (time-to-first-keystroke)**: cold open with a real folder to a typed character in one of the user's *own* documents, targets `<=10s`, `<=2 interactions`, `0 forced decisions`.

## Before/after metric table

| Metric | Baseline (`3bbe7ddd1c4`) | Closing (`7cc382c524c`) | Plan 42 target | Met? |
| --- | --- | --- | --- | --- |
| **TTFK** (cold open -> keystroke in own doc) | Gated behind the 7-step Welcome walkthrough; realistic hands-on path ~25-40s of reading/clicking through the demo before an own doc is even reachable | Cold open lands directly in the user's own doc (`00 - Overview`) with the editor focused; **1 click** into the body + type. A few seconds of app time. | `<=10s` | **Yes** |
| **Steps-to-editing** (screens + clicks + forced decisions) | **5**: 1 forced screen (Welcome walkthrough) + 1 forced decision (See It Work vs Model Access) + 3 clicks (See It Work -> own doc in Files rail -> click into body) | **1**: cold open is already in the own doc; a single click into the editor body to place the caret, then type | `<=2 interactions` | **Yes** |
| **Forced decisions on the path** | **1** (See It Work vs Model Access & a Few Questions, the only two actions on the opening surface) | **0** (no walkthrough, no model UI, no survey on the entry path) | `0` | **Yes** |
| **Aha path** (time-to-first-approved-proposal - the "unharmed" metric) | Available via the walkthrough; the diff/approve/provenance grammar intact | **Unharmed.** Reachable from the Home demo card in 3 clicks (demo card -> See It Work -> Approve); demo report generates a bound figure + a single reviewable proposal; approve applies it, ~20-30s app time | must not regress | **Yes - completes** |

All three TTFK targets are met, and the aha path still completes end to end.

## Step table (folder open, cold open to a keystroke in an own doc)

| Step | Surface shown | Interaction required | Decision demanded? | ~Seconds | Screenshot |
| --- | --- | --- | --- | --- | --- |
| 1 | **Editor, own doc open + focused** - cold open lands straight in the editor surface with `00 - Overview` (the first doc in the user's folder) open and rendered, the left Files rail populated, and the **right review rail collapsed** (quiet shell - width 0). No walkthrough, no gate, no model UI. | App opens directly here. | **No** | 0 (app lands here) | `step1-cold-open.png` |
| 2 | **First keystroke in own doc** - clicking once into the editor body places the caret; typing `ZZ-CLOSING-KEYSTROKE ` lands inline in the user's own document body. **Zero toasts, zero dialogs** (verified `0|0` in the workbench DOM); the review rail stayed collapsed; **no `.lock.json` was created** for the plain doc (living is earned, not born - L3). | 1 click into the body + type | **No** | ~2s | `step2-typed-in-own-doc.png` |

**Net:** the first keystroke in an *own* document is **1 interaction and 0 forced decisions** away, versus the baseline's 3 clicks behind a forced walkthrough and a forced decision. The designed path is now the fast path.

## No-folder cold-open variant (L1)

Cold-opening with a **fresh profile and no folder** lands in a **blank untitled markdown document** with the cursor blinking on line 1 (`step3-nofolder-cold-open.png`) - not a wizard. The left nav rail (Home / Editor / Templates / Knowledge / Agents) is present. Clicking **Home** shows a clean empty state: *"Open a folder to begin - Living Documents works on a folder of Markdown files on your computer. Open one to see its documents, sources and agents - everything stays on disk."* with a prominent **"Open folder..."** button (`step4-nofolder-home.png`). The "Open a folder" affordance is one click away on Home, exactly the L1 AC.

## Aha path (the "unharmed" definition-of-done clause)

From the folder-open instance, invoked manually from Home:

| Beat | What happened | Screenshot |
| --- | --- | --- |
| Home | The walkthrough is a **dismissible card**, not a gate: *"See a 90-second demo - Watch Abstract keep a figure bound to its source and turn one prompt into a single reviewable edit"* with a **"See a 90-Second Demo"** button and an X to dismiss. Home also shows the Ask-this-project composer, Tidy, "Everything is in sync", and the project card (128 docs). | `aha1-home.png` |
| Walkthrough | Clicking the demo card opens the 7-step Welcome walkthrough on demand ("Two Wows, Ten Minutes, No Setup", **See It Work** / **Model Access & a Few Questions**, analytics-on note). | `aha2-walkthrough.png` |
| See It Work | Generates the **Demo Report**: a Numbers table bound to `demo-metrics.csv` and a "Note to the board" carrying an inline agent proposal - red/green diff ("we continue to track" -> "tracking"), tagged **MEANING CHANGE - NEEDS YOUR CALL / High**, with **Edit / Approve changes / Reject**. Header shows "1 change here" + "Approve all in this doc". | `aha3-see-it-work.png` |
| Approve | Clicking **Approve changes** applies the edit: the section reads the clean approved text ("Momentum steady; tracking plan with no surprises this week."), the diff clears, the header flips to **Saved**, and the walkthrough handoff toast appears ("Nice - that is the sample. Now bring a real folder... **Bring a real folder**"). | `aha4-approved.png` |

**Time-to-first-approved-proposal:** ~20-30s of app time; **3 clicks** on the genuine path (demo card -> See It Work -> Approve). The agent-edit trust grammar (diff, meaning-change tag, provenance to `demo-metrics.csv`, approve/reject) is fully intact - **unharmed**.

## Reproduction

1. `source ~/.nvm/nvm.sh && nvm use 24`
2. Copy `docs/` to `/tmp/light-path-closing-docs`; delete any `*.lock.json` so the folder starts as plain markdown.
3. `TMPDIR=/tmp` + launch skill with a fresh (empty) source profile on that folder for the folder-open case, and with no folder arg for the no-folder case.
4. Folder open: click once into the editor body, type -> keystroke lands in the own doc (0 decisions, 1 interaction). No folder: land in a blank untitled doc; Home -> "Open folder...". Aha: Home -> "See a 90-Second Demo" -> "See It Work" -> "Approve changes".
