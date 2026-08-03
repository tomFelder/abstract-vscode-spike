# Plan 53 - Strip back: a document tool, not an IDE in a trench coat

**Status:** authored 3 Aug 2026; run after plan 52 (founder call: core loop first, then the full cut). **Decision:** 181. **Protocol:** decision 174. **Run prompt:** §6 below.

## 1. What this wave is

The packaged app is **1.39GB**. Cursor is 1.26GB; Antigravity is 441MB. Abstract ships ~108 built-in extensions - C++/Java/Python/Go/Rust language features, debuggers, terminal suggest, notebook renderers - none of which a document tool needs, plus whatever the default build carries in locales, sourcemaps and node modules. Founder target: **smaller than Antigravity (<441MB)**, reached from first principles, without regressing a single journey. The prior de-IDE work (plan 02, plan 33, WP-I) stripped chrome; nobody has ever stripped the package.

Also in this wave: the issue-hygiene debt from the audit fix wave, because a clean tracker is part of a clean product (decision 163: issues are the single source of operational truth).

## 2. Work packages

| WP | What |
|---|---|
| **A - Extension cut** | Inventory `extensions/` with evidence: instrument a golden-path desktop session and record which built-in extensions ever activate. Propose a keep-list (expected shape: the Abstract theme/styling carriers, anything the livingDocs contrib or broker path actually touches, and nothing else) as a PR-comment table - every cut row names why it's safe, every kept row names who uses it. Cut via the build's compilation/package lists (revertible), not `rm`. The packaged app must boot clean: zero missing-extension errors in the log, zero broken commands in the curated palette. |
| **B - Package size ledger** | Build the darwin-arm64 package before and after; `du`-profile the top contributors (Electron framework is the irreducible floor - name its size honestly; then node_modules shipped, locales, out/ sourcemaps, ffmpeg, ripgrep, extension node_modules). Land `docs/plans/53-verify/size-ledger.md`: before → after per cut, the final number against 441MB, and a named list of what was NOT cut and why. If the target proves unreachable without core risk, the ledger says so with the residual path - honest parking beats a broken build. |
| **C - Issue hygiene** | #253 and #255 appear fixed by merged wave-50 PRs: live-verify each repro on current main and close with evidence, or reopen with the failing walk. Post the #263 closing summary the umbrella still owes (every wave-50 PR, parked gaps, re-grades). Sweep #262's remaining checklist - tick with evidence, fix the cheap ones, park the rest with notes. |

## 3. Sequencing

**A → B** in one lane (B measures A's result; interleave cut → measure → cut). **C** runs parallel in a second lane from day one - it needs a desktop build but no packaging. Core-patch budget: **1 small seam** pre-authorised for the build manifest if the package task needs a fork-owned exclusion list it doesn't have; anything more is stop-and-escalate on the umbrella (the build pipeline is upstream-shaped; decision 159 froze syncs, so build edits are cheap to hold but must stay legible).

## 4. Acceptance floor

- [ ] A keep/cut table exists on the PR with per-row evidence (activation log or dependency trace), and the cut is expressed in build config, revertible by one revert.
- [ ] The packaged app from the cut build walks the full golden path on a clean profile: open folder → edit → chat (OpenRouter door) → inline-diff accept → export md - screenshot-evidenced.
- [ ] `53-verify/size-ledger.md` shows the before number (~1.39GB), each cut's yield, the final number, and the honest residual list. Final < 441MB, or the ledger names exactly what stands between us and it.
- [ ] Packaged-app cold-start time recorded before/after (a strip this size should show up; regressions investigated).
- [ ] #253 and #255 closed-with-evidence or reopened-with-repro; #263 carries its closing summary; #262 fully swept (ticked, fixed, or parked with notes).

## 5. Verification traps

Plan 50 §4 applies for any desktop walking. Wave-specific: packaging is slow - batch cuts before rebuilding, and keep ONE packaging lane (parallel packaged builds fight over caches); `npm run gulp vscode-darwin-arm64` needs node 24 and a clean `out/`; test the PACKAGED .app from a clean profile, not the dev launch - dev launches load extensions differently and will lie about activation; the LFS push gotcha (light-path run) bites on large binary evidence - keep size evidence as text ledgers + small screenshots.

## 6. RUN (paste into a fresh session)

Execute **plan 53** (`docs/plans/53-strip-back-loop.md`) until its §4 floor is ticked or honestly parked, as one continuous unattended run. You are the Fable orchestrator: plan, dispatch, adjudicate, never implement. Implementers and adversarial validators are separate Opus sub-agents (`model: "opus"`); a validator never sees its implementer's conversation.

Step 0: create the wave umbrella issue (title "Strip back: package cut + issue hygiene (plan 53)", body = §2 + §4), read plan 50 §4 and §5 above. Lane 1: WP-A/B as an interleaved cut-measure loop - implementer proposes the keep/cut table as a PR comment first, orchestrator sanity-checks it against §2's shape before any cut lands, then cut → package → measure → repeat; the adversarial validator independently packages final main, re-measures (never trusts the implementer's number), boots the packaged app on a clean profile and walks the §4 golden path with screenshots, and is the ONLY party that ticks boxes. Lane 2: WP-C - the validator role does the live re-verification of #253/#255 personally (walk the original repro from each issue on current main) before any close. Max 3 fix rounds per PR, then park. Squash-merge on PASS.

Honesty rules this wave: a size number without a reproducible measurement command next to it doesn't count; a cut that survives typecheck but was never booted packaged doesn't count; closing an issue without walking its repro doesn't count. Conclude by posting the ledger's final table on the umbrella with the before/after numbers, and push-notify the founder with the headline number. Iteration budget 20. No checkpoints, no AskUserQuestion.
