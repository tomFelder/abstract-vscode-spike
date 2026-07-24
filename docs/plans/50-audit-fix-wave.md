# Plan 50 - The audit fix wave (issues #252-#262)

**Status:** authored 24 Jul 2026, ready to run. **Umbrella:** #263. **Evidence base:** the full 26-journey desktop audit at [../qa/2026-07-24-ux-audit/00-report.md](../qa/2026-07-24-ux-audit/00-report.md) (8 Opus agents, 214 screenshots, two adversarial verification passes). **Run prompt:** [RUN-audit-fix-loop.md](RUN-audit-fix-loop.md).

## 1. What this wave is

The audit's verdict: the golden paths are strong (both former severity-1s cured), and the off-path failures collapse into five root causes - redesigns shipping renders without doors, stale document identity, approve-only persistence, honesty enforced unevenly one step off the path, and the stock shell one click away. This wave fixes those causes, not just the symptoms. Journey-completeness-over-feature-count (doc 16) is the governing rule: **a work package is done when its journeys re-walk clean on desktop, not when its code merges.**

No new surfaces are invented here. Everything restores, wires, or hardens what already exists. Where a fix would require new product design (e.g. a full Abstract settings surface), the package takes the minimal honest floor and notes the rest for the roadmap.

## 2. Work packages

Each package = one issue (the issue carries findings, repro, evidence refs, acceptance floor), one-to-few PRs, and a named journey re-walk that decides done. WP order within a lane is binding; lanes run in parallel.

| WP | Issue | Root cause attacked | Journeys that must re-walk clean |
|---|---|---|---|
| **A - Reconnect the agents** | #252 (P0) | doors dropped in redesign | 1j, 1t WALKABLE; 1s error/cancel states now live-exercised (F14 on a populated project, cancel mid-run); 1q reschedule of an existing agent |
| **B - One document identity** | #253 + #248 | stale `this._resource` | approve-all-in-doc applies via the D132 confirm; audit `docTitle` correct after tab switches; regression test pinned |
| **C - Provenance is the product** | #254 + #255 | editor v2 stole the click; onboarding claims unearned wow | 1p figure-click → drawer (+ hover peek, keyboard route); D26 Wow-1 completes only on a real peek and UI/`events.log` agree |
| **D - Negative verbs persist** | #258 | approve-only `_persist` | reject + This-Was-Wrong survive relaunch; reject-reason captured; History row counts stable across relaunch |
| **E - Policy is enforced** | #257 | UI-only dial | all three positions enforced live in chat (and in agent runs once A lands); "Never" refuses with a named reason |
| **F - Paste fidelity** | #256 | weaker clipboard converter | T1 re-run: Word table/headings paste as structure, lossy-but-honest notice on real drops |
| **G - Honest model door** | #259 | UI asserts what backend denies | Model access states one serving door from live broker state, incl. the signed-in-but-falling-back truth (#120 stays open, but the screen stops lying about it) |
| **H - Front doors agree** | #261 | empty-vs-populated render split | empty folder → front door; ask-the-project on populated Home; one new-doc dialog behind both doors; D2 landing implemented or re-decided in the log |
| **I - Shell floor** | #260 | stock chrome one click away | gear/Settings/palette/Accounts curated to the floor described in the issue; Cmd+Shift+N lands on Home |
| **J - Polish sweep** | #262 | assorted one-step-off texture | the issue's checklist, tickable across any wave PR; whatever remains is parked with notes |

## 3. Sequencing and lanes

**PR 0 (this PR):** plan 50 + RUN prompt + the full audit evidence (`docs/qa/2026-07-24-ux-audit/`) + README index update. Docs only.

Then up to **3 concurrent lanes** (≤3 desktop instances machine-wide - the Crashpad limit):

- **Lane 1 - service truth** (owns `livingDocsService.ts`): **B → D → E**. B first because its identity fix changes what D/E read; D and E are small once B lands.
- **Lane 2 - editor webview** (owns the ProseMirror/webview editor code + `livingDocWordPaste.ts`): **C → F**.
- **Lane 3 - screens** (owns `screenRender*.ts`): **A → H → G**. A is the P0 and starts immediately.
- **Lane 4 - shell** (workbench chrome; starts only after a lane frees): **I**, then any remaining **J** items.

File ownership is law (plan 43 discipline): `livingDocsService.ts` belongs to lane 1 - lanes 2/3 needing a service change route it through the orchestrator as an additive method. Merge early, merge often; every live lane rebases after any merge. **Core-patch budget: 0** - a fix that needs a patch outside the Abstract contribs/fork-owned files = park and escalate on the umbrella.

If budget runs short, priority: **A > B > C > F > E > D > G > H > I > J.**

## 4. Protocol

Three roles per plan 43 §5, unchanged: the orchestrator (the session) never implements; **implementers and adversarial validators are separate Opus sub-agents** (`model: "opus"`). Per PR: orchestrator opens a draft PR with the WP's acceptance floor as an unticked checklist → implementer pushes with before/after screenshots → the validator - who did not see the implementation conversation - re-walks the journeys **in the running desktop app** and is the only party that ticks boxes. 3 fix rounds then park. Squash-merge on PASS. Every PR references #263 and its WP issue; issues close only on validator-confirmed PASS.

**Validators validate the journey, not the diff.** The audit's method is the standard: golden path, then the off-path probes (reload/relaunch + `cat` the file on disk, empty state, broker-down, cancel/Esc, twice-in-a-row, wrong-door discoverability). A validator that only reads code has failed.

### Desktop-verification traps (from the audit run - all confirmed)

- `export TMPDIR=/tmp` before `launch.sh` or the app dies with `listen EINVAL` (IPC sock path >103 chars). `export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"` first.
- Launch via `.claude/skills/launch/SKILL.md` (isolated profile/ports, unique `PW_SESSION`, `monaco-paste.sh`; `fill`/`type` silently fail on Monaco). Each agent copies `living-docs-sample` to its own `/tmp` workspace.
- Native Electron confirm dialogs (bulk approve, delete) are invisible to CDP - confirm via `osascript` `System Events keystroke return`, and screenshot the before/after states instead of the dialog.
- Webview iframes are separate CDP targets (`tab-list` → `tab-select`); ProseMirror internals need real-DOM event dispatch inside `#active-frame`. a11y-ref clicks mostly work elsewhere - exhaust routes before declaring a control dead.
- `~/.abstract/events.log` is global across instances - filter by your instance's distinct_id.
- The broker auto-starts and self-respawns ~2s after kill; broker-down probes must block respawn or move fast. Do not touch `~/.abstract/openai-oauth.json`.
- Build with `npm run compile` (node 24) before launching; `launch.sh` does not rebuild stale `out/`.

## 5. Budgets and stop conditions

Iteration budget **30** (one iteration = dispatch → validate → adjudicate; fix rounds count). ≤3 desktop instances. Stop when: every WP's checklist is ticked-or-parked, or budget spent. Parking is honest: unticked boxes stay unticked, with a note on the WP issue.

## 6. Closing audit

On final `main`: one fresh adversarial validator re-walks the audit's regressed set end-to-end (1j, 1t, 1s, 1p + D26, 1f/1h reject persistence, 1g enforcement, T1 paste, model access, front doors) on a clean profile, updates the scoreboard table in a new `docs/qa/2026-07-24-ux-audit/99-closing/re-grades.md` (same columns as 00-report §Scoreboard), commits closing screenshots beside it, posts the wave summary on #263 (every PR, every parked gap, journey re-grades before → after), and sends a push notification. The run must be reviewable from the PR record alone.
