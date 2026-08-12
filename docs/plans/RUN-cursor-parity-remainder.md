# RUN - the Cursor-parity remainder (plan 52, after the 12 Aug re-cut)

**Status:** authored 12 Aug 2026, after PRs #288/#292/#293 merged. **Umbrella:** #289. **Plan:** `docs/plans/52-cursor-parity-loop.md`, as amended by §1 below. **Protocol:** decision 174. **Paste §7 into a fresh session.**

## 1. What changed since plan 52 was authored

Plan 52 was written on 3 Aug against a mental model that the editor-v2 wave (plans 43-49, merged 21-23 Jul) and plan 50 had already overtaken. A live walk on 12 Aug found **WP-A - the declared "centrepiece" - already shipped**: proposals already render as in-place red-strike/green diffs in the ProseMirror surface with per-change Approve/Reject, an "Approve all in this doc" bar, kind + confidence + rationale + source chips, a `Line N` address, and amend-before-approve. Evidence: `docs/plans/52-verify/a-inline-diffs/PRE-BUILD-FINDING.md`.

The founder ratified a re-cut: **the wave's centre is B / D / F**, not A. Since then:

| | State |
|---|---|
| **WP-B** - workspace chat tabs | **Merged (#293).** Sessions, tab strip, Cmd+T, workspace persistence. Residuals below. |
| **WP-D1** - Files rail as a plain tree | **Merged (#292).** The "Reports" wrapper is gone. D2/D3 remain (#291). |
| **WP-A** | Re-scoped to A1/A2/A3 (#290). Not started. |
| **WP-F, C, E, G** | Untouched. |

**The single most important lesson, and the first instruction of every work package below: walk the live app before you build anything.** Plan 52's own centrepiece was already done. Assume every remaining row may be partly built until you have seen the current behaviour with your own screenshot.

## 2. Roles

Three roles, per decision 174. **You are the orchestrator: you plan, dispatch, adjudicate, and never implement.**

- **Implementer** - an Opus sub-agent working in a git worktree. Builds one work package, pushes with before/after screenshots embedded on the PR.
- **Adversarial validator** - an independent Opus sub-agent that **never sees the implementer's conversation**. It rebuilds from the branch, launches the real desktop app, and re-walks the package's journeys: golden path plus off-path probes (relaunch + `cat` the file on disk, empty state, broker-down, cancel/Esc, twice-in-a-row, rapid switching, hostile input). **It is the only party that ticks a box**, and only with a screenshot or a transcript as evidence. A validator that only reads the diff has failed; say so and re-dispatch.
- Implementer and validator argue **on the PR**, in comments, not in private. Max 3 fix rounds, then park honestly with notes on the umbrella.

## 3. One pathway at a time

**Run the queue strictly in order. One work package in flight at a time.** Finish it - merged or honestly parked - before opening the next. This is deliberate: the last run showed that a stale premise costs more than serial execution does, and a single lane keeps every validator walking a tree that actually matches `main`.

Within a package you may fan out sub-agents for genuinely independent probes (e.g. three validators taking different lenses), but never run two work packages concurrently.

## 4. The queue

Each row: read the plan's own acceptance, **walk the live app first**, then build. Open a per-WP issue linked to #289 before starting, and a draft PR carrying that WP's acceptance as an unticked checklist.

1. **WP-F - Tabs behave like VS Code's.** Single-click in the tree opens a **preview tab** (italic title, reused by the next preview open); editing the doc or double-clicking pins it. Right-clicking a tab shows the document context menu (the tree's menu - Open to the Right, Rename, Duplicate, Move, Bind Sources, View History, Present, Delete - plus Close / Close Others). `abstractTabStrip.ts` currently handles only click/middle-click.
2. **WP-A1 - kill the duplication.** The rail still repeats a pending proposal's prose verbatim *and* carries its own competing `Apply`/`Reject` while the same change renders inline in the document. Demote the rail card to a compact pointer that scrolls to its change. Two live controls for one change is the "doesn't feel trustworthy" complaint that started this wave.
3. **WP-D2/D3** (#291). D2: Recents leaves the tree for its own compact strip, cap 5. D3: Sources moves into the Context tab - which today is per-document, so this needs a workspace-level sources section that keeps the Assets bucket, the freshness states and the row actions. Do not lose those.
4. **WP-B residuals** (#289). (a) Persist chat message **bodies**, not just tab metadata - today a relaunch restores the strip but not the transcripts. (b) A design pass on the empty and many-tab states (the first tab squeezes to `N…` at three tabs in a narrow rail). (c) Surface `getChatSessionsMentioning` - the API is built and tested, nothing shows it.
5. **WP-C - [[Wikilinks]].** Per plan 52 §2 row C. The PM bundle rebuild recipe is `docs/lwd-pm-bundle-build.md`; the offline build dir is `/Users/tommy/Sites/.lwd-pm-build` and was verified byte-identical to the shipped bundle on 12 Aug, so it is safe to rebuild from.
6. **WP-E - Find & replace in the editor.** Per plan 52 §2 row E.
7. **WP-G + A2 + A3 - the small truths.** Outline-doesn't-load repro (fix or record a non-repro with evidence); History states what it records; **measured** approval-latency numbers before/after; keyboard chords for accept / reject / accept-all, picked against VS Code collisions and recorded on the PR.

If the night runs out mid-queue, stop cleanly: park the current package with notes on #289 and leave the tree clean.

## 5. Environment traps - all of these cost real time on 12 Aug

- `export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"` (node 24) and `export TMPDIR=/tmp` (or the app dies with `listen EINVAL` on the 103-char socket path).
- **Build with `npm run compile` before launching.** `launch.sh` does not rebuild a stale `out/`. (The repo's CLAUDE.md discourages `npm run compile` for typechecking - use `npm run typecheck-client` for that - but compile is the launch recipe.)
- The launch skill is at **`.agents/skills/launch-abstract/scripts/launch.sh`** (renamed from `launch/` on 12 Aug).
- **The slim profile clone EXCLUDES `User/workspaceStorage/`, which is exactly where `StorageScope.WORKSPACE` lives.** To prove workspace-scoped persistence across a relaunch you must reseed: `launch.sh --full --source-user-data-dir <previous run's user-data> -- <workspace>`. Without `--full` a persistence test will look like a failure when the code is fine.
- **Model-backed walks use the OpenRouter door**: `export LWD_BACKEND=openrouter`. Never the founder's OAuth bundle. (The subscription door works as of #288, but the included door is the cheap, deterministic harness.)
- The right rail often opens on the **Review** tab; click **Chat** before concluding the chat UI is missing.
- **The webview is an out-of-process iframe.** `@playwright/cli`'s `tab-list` will not show it. Find it with `curl -s http://127.0.0.1:<cdpPort>/json` and take the entry whose `type` is `iframe`, then drive it over a raw CDP WebSocket (`Runtime.evaluate`). Inside that target, the app's DOM is under `document.getElementById('active-frame').contentWindow.document`.
- `fill`/`type` silently fail on Monaco - use `scripts/monaco-paste.sh`. For a plain `<textarea>` (the rail composer, the Home ask box), set the value through the native setter and dispatch a bubbling `input` event, then a `keydown` Enter.
- Native Electron confirm dialogs are invisible to CDP - drive them with `osascript` and screenshot the before/after states instead.
- Commit with `--no-verify` (husky stages-on-fail).
- `gh pr merge` and `git checkout <existing-branch>` may be **denied by the permission classifier**. Branch with `git checkout -b <new> origin/main`, which is allowed. If a merge is blocked, push the branch, open the PR, and say so - do not work around it.
- **Never open a PR against `microsoft/vscode`.** Every PR goes to `tomFelder/abstract-vscode-spike`.

## 6. Code traps in this codebase

- **`livingDocsService.ts` conflates identities.** `_deliverChatReply` uses one local for both the chat maps and `this._docs.get(id)`. Re-keying it wholesale silently broke every proposal on 12 Aug - typecheck was clean and only an existing `restoreSnapshot` test caught it. When you touch chat plumbing, name the document key and the session key separately.
- **Disposables:** in any method called repeatedly (every `_render*` in the rails), register to `this._renderDisposables`, never `this._register` - the latter leaks per render.
- Service dependencies come from the constructor only, never `IInstantiationService` at call time.
- `livingDocsService.ts` changes route through you as **additive methods**; no signature churn across lanes.
- Core-patch budget: **0**. The tab strip, rails and editor are fork-owned. Escalate on #289 if that proves wrong rather than patching core.
- Run the touched suites on post-merge `main` after every merge (`./scripts/test.sh --grep "..."`), not just on the branch.

## 7. RUN (paste into a fresh session)

Execute the **Cursor-parity remainder** (`docs/plans/RUN-cursor-parity-remainder.md`) until its §4 queue is complete or honestly parked, as one continuous unattended run. Work through the night. You are the orchestrator: plan, dispatch, adjudicate, **never implement**. Implementers and adversarial validators are separate Opus sub-agents (`model: "opus"`); a validator never sees its implementer's conversation.

Read §1-§6 of that file first - especially §5 and §6, which are hard-won and will otherwise cost you hours.

Work the §4 queue **strictly one package at a time**: never two in flight. Per package: (1) **walk the live app and screenshot the current behaviour before writing any code** - plan 52's own centrepiece turned out to be already built, so treat every row as possibly-already-done until you have seen it; (2) open the per-WP issue linked to #289 and a draft PR carrying its acceptance as an unticked checklist; (3) dispatch an Opus implementer in a worktree, which pushes with before/after screenshots on the PR; (4) dispatch an independent Opus adversarial validator that rebuilds, launches the real desktop app, re-walks the golden path plus off-path probes, and is the **only** party that ticks a box, with screenshots or transcripts as evidence. Implementer and validator argue in PR comments. Max 3 fix rounds, then park with notes on #289. Squash-merge on PASS; if the merge is blocked by the permission classifier, push, open the PR, and record it. Rebase the next package off post-merge `main` and re-run the touched suites there.

Validation is the product. A validator that only reads the diff has failed - re-dispatch it. A latency claim needs measured numbers. A persistence claim needs a `--full` reseeded relaunch (§5). A "no regression" claim needs the off-path probes actually walked.

Report honestly: if a package turns out to be already built, say so with evidence and re-scope it rather than rebuilding it; if something is half-done, leave it unticked and write down why. Conclude with a closing summary on #289 - every PR, every walk verdict, everything parked - and leave the working tree clean with no app or broker processes running. Iteration budget 40. No checkpoints, no AskUserQuestion.
