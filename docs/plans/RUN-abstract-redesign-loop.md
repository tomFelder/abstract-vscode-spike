# RUN — Abstract UI Redesign overnight loop (paste this into a fresh chat)

This is the master orchestration prompt. It drives plans 20-25 as an autonomous, self-paced,
overnight loop that lands several stacked PRs, each with review images. Paste the
block below verbatim (it is also reproduced in the chat hand-off).

> **Bootstrap:** these plan docs live on the branch **`abstract-redesign-plans`** (which is
> `main` + these docs, opened as a PR). Start the loop by checking out that branch, then stack
> each feature branch **off `abstract-redesign-plans`** so the plans stay present in the tree;
> target PRs at `main` and, when landing, merge bottom-up. (Do **not** rely on `main` alone -
> the plans are not on `main` until the docs PR merges.)

---

/goal Implement the **Abstract UI Redesign** on the Abstract / Living Documents VS Code fork
(`/Users/tommy/Sites/abstract-vscode-spike`), matching the companion pixels
`Abstract - UI Redesign.dc.html` to the spec of record in
`docs/plans/20-abstract-ui-redesign-handoff.md`. Where the pixels and the handoff disagree, the
handoff wins. The product is a calm, project-first document tool for competent knowledge workers;
provenance and reviewability are the moat. Do not regress the calm shell or the review engine from
plans 16-19.

/loop Run as an overnight, self-paced loop using **sub-agents per task** to keep this context clean
(`superpowers:subagent-driven-development`: fresh sub-agent per iteration, two-stage review between
iterations). First check out **`abstract-redesign-plans`** (the branch holding these plans on top
of `main`). Then work the plans **in this order**, each as its own set of small stacked feature
branches off `abstract-redesign-plans`, PR'd to `main`:

  1. `docs/plans/21-editor-rail-polish-loop.md`  (provenance gutter · reading ramp · ＋Skill)
  2. `docs/plans/22-project-home-loop.md`         (NEEDS YOU · ALL PROJECTS)
  3. `docs/plans/23-project-wide-fanout-loop.md`  (the fan-out hero + ISMS sample)
  4. `docs/plans/24-cross-document-review-loop.md`(cross-doc review surface)
  5. `docs/plans/25-labeled-nav-loop.md`          (76px labeled nav; the likely core seam)

For **each iteration** of each plan:
  - Read the plan and the spec (`20-...`). Settle any "decisions to settle" with a recommended
    default and proceed if unattended (I am asleep) - record the decision in
    `docs/07-decision-log.md` (continue from the current tail).
  - Build the smallest reviewable slice. Follow the repo rules in `.claude/CLAUDE.md` (tabs, DI in
    constructors, externalized strings, disposables, layering). **Reuse before rebuild** - audit
    what already renders before writing anything (esp. the review engine and PM decorations).
  - Keep it contrib/our-surface where possible. Take a **minimal core patch only where a plan says
    it is likely** (plan 25 nav), and **log every core touch** in
    `docs/plans/03-merge-tax-ledger.md` + the decision log.
  - **Verify live, do not eyeball code.** `npm run watch`; run the app with
    `./scripts/code-web.sh <sample>` (:8080; use `./living-docs-sample/brief` for editor/home,
    `./living-docs-sample-isms` for fan-out/review) + the OpenRouter proxy on :8090; drive the
    webview with the **chrome-devtools MCP** (it reaches inside the webview iframe; let the service
    worker register, no `ignoreCache` reloads). Confirm the plan's acceptance gate with screenshots.
  - **Design-match pass:** pull the matching screen from the comp
    (`DesignSync method:get_file`, projectId `d198ca07-9eef-4d05-96e1-b383e6c19c03`, path
    `Abstract - UI Redesign.dc.html`), screenshot the live surface, compare against the Part B
    tokens + the relevant Part C px spec, **score it, and keep iterating on that surface until it
    scores ≥ 90% or hits clearly diminishing returns.** Log each score + the gap backlog to
    `docs/design-audit/redesign-log.md` (reuse the `docs/design-audit/` harness conventions).
  - Before opening the PR: `npm run typecheck-client` and `npm run valid-layers-check` must be
    **clean**.
  - **Open a PR off `main`** (stacked; when landing, merge bottom-up so branches don't cascade -
    plans 18/19 hit this). The PR **must** embed images: a **before/after** of the live surface
    **and** a **side-by-side against the comp region**. Put the acceptance-gate checklist + the
    design-match score in the PR body. Screenshots also saved under `docs/plans/<NN>-verify/`.

Keep going across plans for several hours. If a plan's decision genuinely can't be defaulted
safely, park that iteration, leave a clear note in the PR/plan, and move to the next independent
iteration rather than stalling. At the end, post a single summary comment: every PR opened, its
design-match score, and any core patch logged. Everything should be reviewable from PR images in
the morning.

**Guardrails (do not violate):**
  - **Real data only** - never fabricate the ISMS 38-changes numbers; project surfaces render from
    the real open folder + real agent-run/pending state, with truthful empty/idle states (the
    plan-17 "drop fake v14" rule).
  - **Reuse the review engine** - no new approve/reject logic in plans 23/24.
  - **No em dash** in UI copy; Australian English; title-style caps on nav/menu labels.
  - Don't regress plans 16-19 (calm shell, working set, fan-out engine, 3-tier + editor-led review).

---

## Notes for whoever runs this

- The three quick wins (plan 21) are independent and safe - land them first for immediate felt-gain.
- Plans 23 and 24 are coupled: the fan-out's "Review across the project →" targets the plan-24
  surface; build 23 with an interim route to the Review rail, then finalise the link when 24 lands.
- Plan 25 is the riskiest (core layout). It is last on purpose; keep the patch minimal and logged.
- Expected result: ~8-12 stacked PRs (plan 21 ≈ 3, plan 22 ≈ 2, plan 23 ≈ 5-6, plan 24 ≈ 5-6,
  plan 25 ≈ 4-5), each with review images.
