# Full UX/QA audit - 2026-07-24 (desktop, HEAD 071ac26582b)

Eight Opus agents drove the real Electron build (fresh compile at HEAD) through all 26 beta journeys plus the new surfaces (D26 onboarding, model access, file interop, editor v2, shell integrity), each in an isolated instance with its own workspace copy. Six group walks + two adversarial verification passes for contested findings. Every claim below traces to a live walk, an on-disk check, or a named source location; 214 screenshots under the group `shots/` folders. Baseline for comparison: `docs/plans/34-verify/journey-grades.md` (9 Jul).

**The owner's hypothesis going in - "the golden path is robust, one step off it isn't" - is confirmed, with precision:** the golden paths are now genuinely strong (including the two former severity-1s, both cured), but the off-path failures cluster into five root causes rather than being diffuse polish debt. Fixing those five would close most of what this audit found.

## Headlines

1. **X1 is dead on desktop.** Approved work writes to disk immediately and survives full kill+relaunch (verified independently by three agents: core-loop, cross-doc, automation). New docs land on disk. The single severity-1 of the beta gate era is RESOLVED.
2. **A new severity-1 replaced it: the v2 Agents redesign severed every run entry point (CD-1).** No route exists to open an existing agent's detail canvas (Run now, run log, schedule editor) and no button launches the project-wide fan-out on a populated project. Confirmed live by two independent agents and at source level: nothing emits `data-msg="openAgent"`; `runProject` has zero emitters; the "Ask this project" composer renders only on the empty-project front door. The wedge demo (1j) and agent management (1t) are BLOCKED; the F14 error-recovery fix and safe-cancel UI are built but unreachable behind it.
3. **The wedge journey (1p provenance) half-regressed in Editor v2.** Clicking a bound figure no longer opens the source drawer - it enters table cell-edit mode and exposes raw `bind:` markup. The drawer still exists in full depth, but only via an unlabelled ~6px gutter dot (not keyboard-reachable, no hover hint on the figure itself). The product's own footer copy still promises "click one to trace it back to the source".
4. **Onboarding claims a wow it doesn't deliver.** D26 is otherwise the best surface in the product (see Delightful), but Wow-1 ("trace a figure") auto-advances to complete without any provenance peek firing - `_onbSeeItWork()` records the first-diff step immediately and `provenance-peek` is never recorded. A stranger is told they saw the magic when they didn't - and per (3) the natural figure-click wouldn't deliver it anyway.
5. **Trust bookkeeping has a persistence asymmetry.** `approve()` persists; `reject()` does not (pushes the audit row in memory, never calls `_persist` - confirmed at source). Reject rows, reviewed-context state, and "This Was Wrong" flags all vanish on relaunch. Plus every audit entry stamps the wrong `docTitle` (the tab open at launch) into the lock on disk.

---

## Scoreboard - all journeys, prior grade → today

Rubric: WALKABLE / FRAGILE / BLOCKED / MISSING; owner axis: BREAKS / INCOMPLETE / PARTIAL / RESOLVED / COMPLETE / DELIGHTFUL / MISSING.

| Journey | 9 Jul | Today | Owner axis | Note |
|---|---|---|---|---|
| 1a Open a project | FRAGILE | WALKABLE | PARTIAL | Messy-folder fixed (hierarchy, sources, docx import door); empty-folder open lands on a bare blank editor |
| 1b New document | FRAGILE | WALKABLE | RESOLVED | Name honoured, on disk, From-sources present, brief leak gone; but the Workspace "+" opens a poorer name-only dialog that hides templates |
| 1c Switch projects | WALKABLE | WALKABLE | COMPLETE | |
| 1d Organise files | MISSING | WALKABLE | PARTIAL | Context menu built (rename persists on disk); delete-with-dependents guard unverified (native dialog) |
| 1w Project Home | MISSING | FRAGILE | PARTIAL | Real front door built; but populated projects still land in the editor, and the project chat composer renders only on empty projects |
| 1x Template from examples | MISSING | MISSING | INCOMPLETE | Manual editor + "save doc as template" exist; the from-examples wizard (the journey's subject) does not |
| D26 Onboarding | - | WALKABLE | DELIGHTFUL* | Two-wow wizard, real model, resumable; *Wow-1 false completion (sev-2) |
| 2b First-run orientation | MISSING | WALKABLE | RESOLVED | |
| 1e Chat-rail iterate | FRAGILE (sev-1) | WALKABLE | COMPLETE | X1 gone; Stop control present (verified: red ■ during streaming, Esc cancels) |
| 1f Judge a proposal | FRAGILE | WALKABLE | PARTIAL | Tweak excellent (`via:tweaked`); fixed-85% gone; but no reject reason, and reject rows don't persist |
| 1g Policy dial | FRAGILE | FRAGILE | INCOMPLETE | Dial exists, actuates, persists to frontmatter (`policy:`) - but **nothing enforces it**: `getDocPolicy` has one caller (the dial's own render); "Never change this doc" still yields proposals |
| 1h Undo/history/versions | FRAGILE (sev-1) | FRAGILE | PARTIAL | History truthful and approve rows persist; Cmd+Z across approve still does nothing; restore-a-version not built (only the wrong-flag); reject rows vanish |
| 1i One chat, three docs | WALKABLE | WALKABLE | COMPLETE | Ledger, granularities, disk persistence all verified |
| 1j Project fan-out | WALKABLE | **BLOCKED** | **BREAKS** | CD-1: no entry point on a populated project |
| 1k Cross-doc review | WALKABLE | FRAGILE | PARTIAL | Per-card approve applies to disk (verified); "Approve all in this doc" (editor bar) is a silent no-op (stale `this._resource`); rail "Approve all" works via native confirm |
| 1l Parallel chats | MISSING | MISSING | MISSING | |
| 1m Pull files into chat | WALKABLE | WALKABLE | PARTIAL | Add-menu + chips real; folder cost preview, right-click/drag routes absent |
| 1n Context inspector | PARTIAL | MISSING | MISSING | No per-task inspector, sizes, heavy-context warning, or pre-flight recap |
| 1o Knowledge library | FRAGILE | FRAGILE | PARTIAL | Table real; freshness contradiction confirmed (mtime "17m ago" vs lock `syncedAt` 26 days vs rail "live") |
| 1p Provenance peek | WALKABLE | FRAGILE | PARTIAL | **Regressed**: figure click → cell-edit + raw markup; drawer (full depth, verified) only via unlabelled gutter dot; hover peek only on the dot; no then-vs-now |
| 1y Doc sources rail | MISSING | MISSING | PARTIAL | Rail with verbs/freshness exists; watched-doc change-hooks (the journey's subject) absent |
| 2c Ask-the-project | - | - | PARTIAL | Data-grounded but uncited, doc-scoped, still proposes; and the composer only renders on empty projects |
| 1q Schedule a document | FRAGILE | WALKABLE† | PARTIAL | **Unattended cron firing works** (observed live, VIA=cron, persisted); †but only settable during agent creation (CD-1 blocks reschedule); no doc-header "Keep current" on-ramp |
| 1r Morning inbox | PARTIAL | PARTIAL | PARTIAL | Document-level needs-you queue with counts now built; no auto-applied-overnight rollup on Home, no notifications/badges |
| 1s Watch, cancel, recover | FRAGILE | BLOCKED | INCOMPLETE | F14 fixed (named model-outage error + failed-doc list + Retry failed - verified in code and once live by cross-doc); the surface is behind CD-1 |
| 1t Manage agents | WALKABLE | **BLOCKED** | **BREAKS** | Regression: roster is read-mostly (pause + edit-policy only); existing agents can never be opened, run, or duplicated |
| 1z Usage & cost | MISSING | FRAGILE | PARTIAL | Real day-level $ meter on Model Access (US$X of US$1.00); no per-agent spend, no context ring, starved-run UI behind CD-1 |
| 1u Present/export/publish | FRAGILE | WALKABLE | PARTIAL | docx (real Word styles, pandoc-clean), PDF, HTML with embedded images (PR #249 verified) all real; Present silently no-ops after an export (focus stolen by the export tab) |
| 1v Audit trail | MISSING | WALKABLE | PARTIAL | Visual who/what/when/via History persisted to lock; conversational interrogation has no data source (chat denies what the lock plainly records) |
| X4 Stock Copilot chat | BLOCKED-class | - | RESOLVED | Title-bar Copilot tab gone; only the Abstract rail remains |

New surfaces (no prior grade): **docx import** COMPLETE (provenance, kept/dropped honesty, byte-identical asset extraction; blockquote flattening + in-editor raw image markdown are polish gaps) · **xlsx→CSV** COMPLETE (provenance sidecar, honest broker-down error) · **PDF-as-context** PARTIAL (toast fires; context edge never persisted to lock) · **Tidy verb** INCOMPLETE (code-present, no discoverable entry) · **T1 paste-from-Word** FRAGILE (below) · **Editor v2 wrap/skeleton** COMPLETE/DELIGHTFUL · **Model access screen** PARTIAL (door confusion, below) · **Data-flow one-pager in-product** COMPLETE · **Consent** COMPLETE (decline honoured, verified per-distinct-id) · **External-edit floor (PR #250)** COMPLETE across all probes · **Broker auto-start (+self-respawn)** RESOLVED/COMPLETE · **Shell de-IDE** PARTIAL (below) · **Multi-window** PARTIAL (new window = bare blank editor).

---

## What BREAKS (ranked)

**S1. CD-1 - Agents machinery walled off (breaks 1j, 1t; strands 1s, 1q-reschedule, starved-run UI).** The detail canvas (`renderAgentCanvas`: Run now, RUN LOG, schedule editor, flow graph, policy dial, fan-out strip) renders only when `state.openAgentId` is set, which only create/duplicate do. Exhaustively probed live: card clicks, ledger rows, right-click, keyboard, command palette (no "Run" command exists). A freshly created agent is stranded the moment you navigate away. The fan-out's only other door (`renderHomeComposer` → `askProject`) renders solely on the empty-project front door. `goAgents` still carries a comment referencing the removed run button. Evidence: automation/shots, cross-doc/shots.

**S2 findings, in rough priority order:**

1. **"Approve all in this doc" is a silent no-op** (editor bar). `approveAllDoc` filters pending changes by a stale `this._resource` that mismatches the pending changes' docId → `getPendingForDoc` matches nothing; no dialog, no error, nothing applied. Same stale-identity root cause writes the **wrong `docTitle` into every audit entry on disk** (three agents hit it independently: "Appendix — Design Tokens" stamped on Board Note / Demo Report approvals). One bug family, two trust wounds. (verify-actuation/findings.md, shots 09; repro: open two docs, approve in the second.)
2. **1p figure-click regression + D26 Wow-1 false completion** (headlines 3-4). Together they hollow out the wedge: the onboarding tells a stranger they saw provenance; the editor can't deliver it by the advertised gesture. (verify-provenance, shots 02-09.)
3. **T1 paste-from-Word silently mangles tables** (the #128 pre-beta disqualifier check). A Word-HTML table pastes as the run-on paragraph `NameValueAlpha100Beta200`; a pasted H1 glues onto the previous line. No lossy-but-honest notice. The docx *import* path converts the identical table correctly to GFM - the clipboard path (`livingDocWordPaste.ts`) uses a weaker converter. (output-interop, shots.)
4. **Policy dial persisted but never enforced.** `policy: never` on disk; chat still proposes edits to that doc. The dial is UI-only - `getDocPolicy`'s sole caller renders the checkmark. A user who dials "Never change this doc" is not protected. (verify-actuation shot 04.)
5. **`reject()` never persists** - reject audit rows, reviewed-context state, and This-Was-Wrong flags all evaporate on relaunch (source-confirmed: `approve()` ends in `_persist`; `reject()` doesn't). The way-back journey's bookkeeping is approve-only. (verify-provenance claim 5.)
6. **Model access misstates the serving door.** "Serving you now: The included model" and "Signed in to ChatGPT" both green simultaneously while the broker reports `signedIn:true, backend:openrouter` - the #120 subscription-call failure surfaced as contradictory UI. A user cannot tell which door answers, or that their sign-in is being silently bypassed. (trust-shell shot 04.)
7. **Stock-shell leaks one step off the golden path.** Bottom-left gear = raw VS Code Manage menu; "Settings" = the full stock settings editor (worst collision: it's where a user would look for the analytics/model toggles); command palette un-curated (the entire Developer:/breakpoint family); Accounts menu stock. Dev shortcuts (Cmd+Shift+E/G/D/X, Cmd+J, Ctrl+`) are properly neutralised - the leaks are all mouse-reachable chrome. (trust-shell shots 02-03, 13-14.)
8. **The project's front door contradictions.** Opening a populated project lands in the editor, not Project Home (map-D2); opening an *empty folder* lands on a bare blank editor with no tree and no orientation; "ASK THIS PROJECT" exists only where there is nothing to ask about. (cold-start shots 13-16.)

## What's INCOMPLETE / PARTIAL (surface exists, job can't finish or has real gaps)

- **1g**: dial without enforcement (above). **1h**: no undo-across-approve, no restore-a-version. **1x**: no from-examples wizard. **1v**: no conversational audit (chat denies what the lock records). **1z**: no per-agent/per-chat spend, no context ring. **1r**: no overnight-rollup/notifications. **2c**: no cited read-only mode. **1y**: no watched-doc hooks. **1n**: no context inspector at all (the trust promise "no hidden context, prune before it acts" has no surface). **Tidy**: unreachable. **PDF context**: edge not persisted. **Feedback verb**: works end-to-end with correct privacy split (hash to analytics, plain note to founder log - verified) but the flag itself is fire-and-forget, re-flaggable forever.
- **Sticky working set** (sev-2 adjacent): attached docs silently apply to every later chat turn; users can approve into docs they didn't mean to touch.
- **Freshness labels contradict across surfaces** (library mtime vs lock syncedAt vs rail "live").
- **Multi-window**: Cmd+Shift+N lands on a broken bare editor.
- **New-doc doors inconsistent**: the Workspace "+" hides the template on-ramp the Home tile has.

## What's RESOLVED (verified, vs the 9 Jul baseline and QA waves)

X1 approved-work-lost-on-reload (the sev-1) · broker manual-start P0 (auto-start + self-respawn, dual-stack) · fabricated History/version chip (stayed fixed) · blank-doc name discarded · template-brief leak · "From sources…" missing · messy-folder flattening + non-md dropped (now: hierarchy, Sources section, docx "Import as Document" with provenance) · 1d context-menu missing · fixed-85% confidence · X4 stock-Copilot chat tab · F14 fan-out swallowed error (in code; behind CD-1) · unattended cron firing (live, VIA=cron) · needs-you queue with counts · usage meter existence · export images (inline data-URIs verified) · docx/PDF export (real, pandoc-clean) · external-edit floor (all probes incl. delete + pending-proposal interactions).

## What's COMPLETE (survived off-path probes)

1c project switching · 1e core loop incl. Stop + broker-down named error · 1i multi-doc granularities · docx import · xlsx→CSV · consent single-source-of-truth with honoured decline · data-flow one-pager in-product · external-edit floor · small-window/zoom behaviour · dev-shortcut neutralisation.

## What's DELIGHTFUL (call-outs worth protecting)

- **D26 onboarding**: polished 7-step, two-wow, real-model, real-persistence wizard that resumes at the exact step after relaunch. The beta gate's core promise, landing (modulo the Wow-1 bug).
- **Tweak** (decision 131): in-place edit → Save & Approve, audited `via:tweaked`; the audit `via` taxonomy generally (`model`/`tweaked`/`heuristic`/`external-overwrite-kept`).
- **External-edit banner intelligence**: warns specifically about unsaved pending proposals before reload.
- **The cron truth chain**: schedule in plain words → fires unattended → truthful VIA=cron run-log row → persisted to disk.
- **Numbered-gutter wrap rule**: pixel-correct across wrapped blocks.
- **docx import honesty**: kept/dropped toast + `sourceHash` provenance from birth; original untouched.
- **Fan-out named-error + surgical retry** (once reachable again).
- **The in-product data-flow card**: calm, plain-words, and honest to the point of saying what *isn't* built. (One leak: the footer shows a repo path `docs/27-data-flow-one-pager.md` as dead monospace text.)

## What's MISSING (no surface)

1l parallel chats · 1n context inspector · 1x from-examples wizard · 1y watched-doc hooks · restore-a-version · conversational audit · cited ask-the-project · per-agent spend · OS notifications · doc-header "Keep current" on-ramp · reject-reason capture · then-vs-now provenance comparison · connector catalogue/auth/test-fetch and source-conflict surfaces (1o).

---

## Root-cause patterns (first principles)

1. **Redesigns ship renders, not journeys.** The three worst findings (CD-1, 1p click regression, empty-vs-populated Home composer) are all cases where a v2 render path landed without re-walking the journeys through it - the machinery survives, the doors got dropped. A "journey walk after every redesign PR" gate would have caught all three.
2. **Stale document identity in the editor surface.** One captured-at-open `this._resource`/title causes both the approve-all no-op and the on-disk docTitle mislabels. Fix once.
3. **Persistence asymmetry: only the happy verb persists.** approve persists; reject/flag/reviewed-context don't. Anything that records a *negative* judgment is currently memory-only - which quietly biases the audit trail toward "the model was right".
4. **Honest states exist but honesty isn't yet a contract.** The product's best surfaces say true things (kept/dropped, VIA=cron, named outages); the worst silently claim (Wow-1 completion, "Approve all" no-op, paste mangling, "Serving you now" contradiction). The design principle is right; enforcement is uneven exactly one step off the golden path.
5. **The shell is still two products.** Abstract chrome is close to spec (35px vs pinned 48px header is the one pixel deviation found), but stock VS Code remains one mouse-click away at the gear/Settings/palette/Accounts, and a new window is a bare stock editor.

## Method notes / env gotchas (for the next run)

- `TMPDIR=/tmp` required before `launch.sh` (IPC sock path >103 chars → `listen EINVAL`).
- Native Electron confirm dialogs (bulk approve, delete) are invisible to CDP - drive via `System Events keystroke return`, or hand-test. They're also a design inconsistency against the custom chrome.
- Webview iframes are separate CDP targets; a11y-ref clicks mostly work, ProseMirror internals need real-DOM event dispatch inside `#active-frame`.
- `~/.abstract/events.log` is global across instances - filter by distinct_id.
- Subagent writes of `findings.md` were blocked by a harness hook; full findings live in the agents' returned reports (compiled here) + `verify-actuation/findings.md`; shots are on disk per group.
- Not reached this run (honest list): delete-dependency guard (native dialog), at-cap/budget-paused live state, ChatGPT door actually serving (#120 untouched, real auth preserved), dark-theme conformance, 50-doc scale fan-out, first-run consent modal (profile pre-consented), Google-export SOON doors.
