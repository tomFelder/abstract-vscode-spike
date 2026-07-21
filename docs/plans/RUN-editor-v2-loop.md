# RUN - Abstract Editor v2 wave (paste this into a fresh chat)

This is the master orchestration prompt for the Editor v2 wave: [43-editor-v2-spec.md](43-editor-v2-spec.md) (spec + protocol) executed through plans [44](44-elevation-shell-loop.md)-[49](49-screens-knowledge-agents-loop.md). It uses the three-role architecture from [RUN-p0-p1-completion-loop.md](RUN-p0-p1-completion-loop.md): one Fable orchestrator (the session itself), Opus 4.8 implementer sub-agents, independent Opus 4.8 adversarial validator sub-agents - with the exchange living on open PRs. Paste the block below verbatim into a fresh session. The wave can also be run one loop at a time by pasting each plan's §6 goal prompt instead.

---

Execute the **Abstract Editor v2 wave** on this fork until the product matches the ratified design, as one continuous unattended run.

The spec of record is `docs/plans/43-editor-v2-spec.md`; the pixel source is `docs/design/abstract-editor-v2/`; the per-loop plans are `docs/plans/44-elevation-shell-loop.md` through `docs/plans/49-screens-knowledge-agents-loop.md`. The orchestration protocol you follow for every loop is **plan 43 §5 THE PROTOCOL** - three roles (you orchestrate and never implement; implementers and validators are Opus 4.8 sub-agents, `model: "opus"`), draft PR opened by you with the loop's success criteria as an unticked checklist, implementer pushes + posts before/after screenshots, adversarial validator measures numerically and is the ONLY party that ticks boxes, 3 fix rounds then park, squash-merge on PASS.

**Step 0 (bootstrap).** Verify plans 43-49 are on `main` (they are committed with the docs wave). File the umbrella tracking issue "[editor-v2] Wave umbrella: plans 44-49" (label `editor-v2`). Then land the **pre-step PR** if not already merged: mechanically split `screenRender.ts` into `screenRenderShell.ts` + one module per screen (zero behaviour change, snapshot tests unchanged) and delete the dead `docHasEarnedLiving` `hasSiblingLock` branch (#211 item 3). Small PR, implementer + validator, same protocol.

**Sequencing (plan 43 §4).**
1. **Plan 44 (elevation shell) runs alone and merges first.** Nothing branches until it is on `main`.
2. Then up to **3 lanes**: lane A = plan 45 (editor card - longest, start immediately); lane B = plan 46 (tree rail) then plan 47 (right rail - gated on plan 45 bundle-a being merged); lane C = plan 48 (Home + Templates - gated on the pre-step PR) then plan 49 (Knowledge + Agents).
3. Merge early, merge often: 45-a and 45-c unblock other lanes - do not batch them. After any merge, every live lane rebases before its next push.
4. File ownership is law (plan 43 §4 matrix): `studio.css` + theme belong to plan 44 all wave; `livingDocsService.ts` is additive-methods-only for everyone; contention = STOP and route through you.

**Budgets.** Iteration budget 40 (one iteration = one dispatch-validate-adjudicate cycle; a fix round counts). Core-seam budget: the two sanctioned seams in plan 43 §6, both belonging to plan 44 - a third anywhere = park and escalate. ≤3 concurrent code-web instances machine-wide. If the budget nears exhaustion, prioritise: 44 > 45-a > 46-c (context menu) > 45-c > the rest, and park with honest notes.

**No checkpoints, no questions.** Never AskUserQuestion; recover from build breaks, port clashes and webview timing yourself (the plans carry the known traps). Stop conditions: every loop's criteria ticked-or-blocked, or budget spent.

**Conclude with** the wave closing audit (plan 43 §6.5): screenshot all five surfaces on final `main` at 1440×900 + 1760×1000 side-by-side with the mock, commit to `docs/qa/2026-07-v2/99-closing/`, post the summary on the umbrella issue (every PR: number/title/loop/state; every parked gap; seams taken; absorbed issues closed: #211 items, #122 F11/F12/F13-share, #131 surfaces), update the merge-tax ledger's PENDING rows to their landed state, and send a push notification - the founder is likely away. The whole run must be reviewable from the PR record alone.

---

## Notes for whoever runs this

- Expected shape: ~18 PRs (44 ≈ 3, 45 ≈ 4, 46 ≈ 3, 47 ≈ 2-3, 48 ≈ 3, 49 ≈ 3) plus the pre-step split PR, most merged during the run, all screenshot-carrying with validator-ticked checklists.
- The riskiest units are plan 44's two seams (part margins, titlebar height - try CSS-only first, take the constant patch like `ACTIVITYBAR_WIDTH` if the layout disagrees) and plan 45-a (PM bundle rebuild - recipe `docs/lwd-pm-bundle-build.md`, `prosemirrorBundle.test.ts` must round-trip before anything stacks).
- Pixel standard: exact hex, ±1px lengths, ramp-not-face for type (plan 43 §3.6). The validator measures with getComputedStyle/getBoundingClientRect - "looks right" is not evidence.
- Model backend for live verification: OpenRouter (`LWD_BACKEND=openrouter`, decision 44). #120 (ChatGPT-subscription call) is known-open; no loop fails on it.
- The desktop smoke (macOS traffic-light inset on the new header, decision 71 precedent) stays a founder task; flag it in the closing summary.
