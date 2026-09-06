# Pickup handoff, 6 Sep 2026 - where the project actually is after the Mac migration

**Why this document exists.** Work stopped mid-wave on 4 Sep when the founder migrated development
machines. This is the reconstruction of that state from the repository and the tracker alone, written
so the next session does not have to redo the archaeology. It records what landed, what is stranded,
what the environment switch broke, and what to do first.

**Status:** written 6 Sep 2026. Supersedes nothing; it is a snapshot, not a plan. The plan of record
is still [56-loop-goes-live.md](56-loop-goes-live.md), which at time of writing is **not on `main`** -
see blocker 1.

---

## 1. The short version

Plan 56 ran. Eight of its fifteen tickets merged to `main` in a single day (1-2 Sep), including both
barrier items. Then the run stopped mid-flight: two tickets have finished, unpushed-as-PR work sitting
on branches, three were never started, and roughly twenty-eight new defects filed by the adversarial
panels are sitting in the tracker untriaged.

Separately, and more seriously, **the documentation foundation the whole wave reads from never
merged.** `CONTEXT.md`, the 154 split ADRs, plan 56 itself, both RUN prompts, and the `docs/agents/`
skill configuration all live only on PR [#390](https://github.com/tomFelder/abstract-vscode-spike/pull/390),
which is open and now conflicted. Every agent instruction in the wave says "read `CONTEXT.md` first",
and on `main` that file does not exist.

Four things the machine switch cost are listed in section 4; one of them turned out to be recoverable
in ten minutes and is now closed out. Of the rest, the ProseMirror bundle
build directory currently survives in exactly one place.

---

## 2. What landed on `main`

Eight plan-56 tickets, newest first:

| Ticket | What it did | Commit | PR |
|---|---|---|---|
| #388 | Closing the last tab lands on Project Home, not a blank pane | `1daad75d` | #427 |
| #381 | The loop proposes a targeted change - first end-to-end agentic edit | `fdb0319f` | #424 |
| #385 | Frontmatter survives every non-approve persist | `7e2ba416` | #423 |
| #387 | A blank document accepts typing | `5f4fb70f` | #417 |
| #380 | The loop answers a question about attached documents | `2c916535` | #416 |
| #384 | A bound figure in a heading survives a save, byte-exact on disk | `8dba6164` | #414 |
| #378 | **Barrier P1.** The living-docs source speaks "change", not "proposal" | `131723e2` | #413 |
| #375 | **Barrier P0.** Model traffic routes through `IRequestService` | `ef29bf64` | #406 |

Plus `c9ccc578` (PR #402), the opening walk's findings under `docs/qa/` - that is ticket #376's output.

**Both barriers are down.** P0 (verification is trustworthy) and P1 (the vocabulary rename) are on
`main`, which is what gated both lanes. The loop is wired and has made a real agentic edit end to end
(#381). That is the single biggest thing to know: the wave's central claim is no longer unfalsifiable.

### Tracker hygiene gap

`#384`, `#385`, `#387` and `#388` are **merged on `main` but still open as issues**. Their PRs did not
carry closing keywords. This is the exact failure mode ticket #377 was written to clean up a month
ago, recurring. Anyone reading the tracker today will conclude four fixed things are unfixed.

---

## 3. What is stranded

### 3.1 Finished work sitting on branches with no PR

| Branch | Ticket | Commits | State |
|---|---|---|---|
| `loop56/382-reply-reconciles` | #382 | 2 | Implemented, adversarially attacked, three refutations filed as #425 / #426 / #428 - never resolved |
| `loop56/383-attached-sources` | #383 | 1 | Implemented, no PR, no adversarial round recorded |

`loop56/376-opening-walk` also exists but is a stale duplicate of what squash-merged as #402. It can
be deleted.

#382 matters out of proportion to its size: plan 56 says B1 (#379) **may not close #303 until #382's
A4 receipt reconciliation has merged**. So #382 is the keystone - it blocks the verify-close ticket,
which is what makes the rest of the tracker honest.

### 3.2 Never started

| Ticket | Plan ref | Note |
|---|---|---|
| #379 | B1 | Verify-close #329, #334, #305, #300 with evidence. Waits on #382 for the #303 half. |
| #386 | B4 | Two windows cannot lose a decision (#359, #360) - the journal race |
| #389 | B7 | The flagship journey completes on a fresh profile (#333) |

#374 remains open as the umbrella spec.

**#389 carries a standing instruction from the RUN prompt:** it reports two symptoms (no Present on a
fresh profile's first document, and the journey not completing) that may have independent causes.
Investigate before implementing and split the ticket if they are independent.

### 3.3 Untriaged defect backlog

The wave was designed so that *finding* defects is a first-class output, and it worked - roughly
twenty-eight issues were filed between 1 and 2 Sep by the opening walk and the adversarial panels:

- **From the opening walk (#376):** #391-#401
- **From adversarial panels and later analysis:** #403, #404, #405, #407-#412, #415, #418, #419,
  #421, #422, #425, #426, #428

**None of them carry a label.** No `P0`/`P1`/`P2`, no `ready-for-agent`, no `needs-triage`. They are
invisible to the frontier query the RUN prompt uses to select work, which means the wave's own output
cannot re-enter the wave. This is the highest-leverage cheap fix on the list.

Two of them look gate-relevant on their titles alone and want reading before anything else is
prioritised: **#421** (`parseFrontmatter` is indentation-blind - nested map children overwrite real
top-level scalars) and **#422** (properties-panel field writers destroy a nested frontmatter map).
Both are content-integrity defects in the same area #385 just fixed, which suggests #385 closed one
door in a room with several.

---

## 4. What the machine switch broke

### Blocker 1 (highest) - PR #390 is unmerged and conflicted

State: `open`, `mergeable_state: dirty`, 185 files, based on `431c6103` while `main` has moved eight
commits past it.

It carries:

- `CONTEXT.md` - the canonical glossary, 38 terms. Every agent instruction in plan 56 says to read it.
- `docs/adr/` - the decision log split into 154 individual ADR files, plus ADR 0182 (change absorbs
  proposal) and ADR 0183 (LangGraph is a revisit trigger, not a destination).
- `docs/plans/56-loop-goes-live.md` and both RUN prompts.
- `docs/agents/{domain,issue-tracker,triage-labels}.md` - the configuration that points the engineering
  skills at this repo's tracker, labels and ADR layout.

The consequence is concrete, not theoretical: the wave that just ran executed against documents that
are not in the repository. Anyone cloning `main` today gets the code and none of the reasoning, and
`docs/07-decision-log.md` on `main` is still the 227KB single file whose table was already rendering
broken before the split.

The conflict is expected to be mostly mechanical - the ADR split touched prose while the eight merged
PRs touched source - but the vocabulary sweep did touch docs the merged tickets also edited.

### Blocker 2 - the ProseMirror bundle build directory survives in one place only

`docs/lwd-pm-bundle-build.md` names `/Users/tommy/Sites/.lwd-pm-build` as the **canonical** source for
the vendored ProseMirror bundle, and explicitly warns that the listing reproduced inside that document
"is a snapshot and has drifted" - it is missing the decorations plugin, the `table_block` atom and the
`wikilink` atom.

That directory was on the old Mac. It was rescued into `build/lwd-pm-build/.lwd-pm-build/` by commit
`15812492` on branch **`wip/mac-migration-2026-09`**, and that branch is the only surviving copy.
`src/vs/workbench/contrib/livingDocs/browser/prosemirrorBundle.ts` cannot be honestly rebuilt without
it, and three test suites (`prosemirrorBundle.test.ts`, `boundHeadingSave.test.ts`,
`livingDocWordPaste.test.ts`) load the artifact it produces.

**This should be merged to `main` before anything else touches it.** It is a single-copy asset sitting
on an unmerged WIP branch.

The same branch also carries `.a3-380-screenshots/` - the #380 verification screenshots, which by the
protocol belong under `docs/plans/56-verify/380/`.

### Blocker 3 - `.claude/CLAUDE.md` is gone

`.gitignore:38` ignores `.claude/`, so the repo's Claude Code conventions file was never tracked. It
does not exist on `main`, on the ADR branch, or on the migration branch.

The RUN-56 prompt instructs every implementer to follow "the conventions in `.claude/CLAUDE.md`", and
names some of them inline: Australian English, no em dashes, tabs not spaces, all user-facing strings
externalised through `vs/nls`, never `npm run compile`. Whatever else was in that file is lost.

`.agents/skills/launch-abstract/` is tracked and survived, so the desktop launch skill is intact.

### Blocker 4 (resolved 6 Sep) - the Matt Pocock skills, and where the run can execute

The engineering skills (`implement`, `tdd`, `code-review`, `triage`, `to-tickets`, `grill-with-docs`,
`wayfinder`, ...) are a plugin - `mattpocock/skills` - and they are **not** preinstalled in a cloud
session, nor are they in the org plugin catalogue. They install cleanly, though. Verified 6 Sep in a
cloud container:

```
claude plugin marketplace add mattpocock/skills
claude plugin install mattpocock-skills@mattpocock
```

Two things follow, and the second is the one that matters.

**The install does not survive the container.** A cloud session's container is ephemeral, and the
plugin lands in `~/.claude/settings.json` inside it. Every new cloud session must re-run those two
commands. That belongs in a `SessionStart` hook rather than in anyone's memory.

**A plugin installed mid-session is not visible to that session.** The skill registry is built at
startup, so `Skill("mattpocock-skills:triage")` fails in the session that installed it. A *new*
session sees them.

**The headless pattern works in the cloud.** This was the real open question, because the
[`implement`-driven RUN variant](RUN-56-adversarial-goal-loop.md) drives implementation by shelling
out to `claude -p "/mattpocock-skills:implement ..."`, and that was designed for and verified on the
founder's Mac. It was tested here on 6 Sep against `ask-matt` in a cloud container and the skill
loaded and produced its routing output - the same check the RUN prompt itself records, repeated in the
new environment.

So the constraint is not the environment, it is the paths: the RUN prompt hardcodes
`/Users/tommy/Sites/abstract-vscode-spike`, which needs to become the session's working directory. The
prompt's own reasoning for the headless call still holds - `implement` carries
`disable-model-invocation: true`, so no orchestrator and no sub-agent can reach it through the Skill
tool, and occupying the human turn in a headless session is the only way to run the real skill.

The [agent-native variant](RUN-56-loop-goes-live.md) remains available as the simpler fallback, but it
is no longer the *only* option in a cloud session.

---

## 5. Recommended order

Sequenced so that each step makes the next one cheaper, and so that nothing irreplaceable stays
single-copy for longer than it has to.

**Step 0a - make the skills reproducible.** Add a `SessionStart` hook that runs the two plugin
install commands from blocker 4, and update the RUN-56 prompt's hardcoded `/Users/tommy/Sites/...`
path to the session working directory. Without this, every future session rediscovers blocker 4.

**Step 0b - rescue the single-copy asset.** Merge `wip/mac-migration-2026-09`'s build directory to
`main` (or cherry-pick `15812492`), and file the `.a3-380-screenshots/` files under
`docs/plans/56-verify/380/`. Update `docs/lwd-pm-bundle-build.md` to point at the in-repo path instead
of `/Users/tommy/Sites/.lwd-pm-build`, and drop or clearly date-stamp the drifted inline listing.
Small, mechanical, removes a real risk of permanent loss.

**Step 1 - land PR #390.** Rebase or merge `main` into `docs/vocabulary-and-adr-migration`, resolve,
merge. Nothing downstream is trustworthy until `CONTEXT.md` and `docs/adr/` are on `main`, because
every agent prompt in the wave opens by reading them. The `resolving-merge-conflicts` skill is built
for this shape of conflict.

**Step 2 - close the four merged-but-open tickets.** #384, #385, #387, #388, each with its commit and
PR cited. Five minutes, and it stops the tracker from lying.

**Step 3 - triage the twenty-eight new issues.** Apply `P0`/`P1`/`P2` and the `ready-for-agent` /
`ready-for-human` / `needs-info` states from `docs/agents/triage-labels.md`. This is what the `triage`
skill exists for, and it is the step that lets the wave's own findings re-enter the wave. Read #421
and #422 properly while doing it - they may be gate-blocking.

**Step 4 - finish #382.** Resolve #425, #426 and #428 against `loop56/382-reply-reconciles`, run a
fresh adversarial panel, PR, merge. This unblocks the #303 half of #379.

**Step 5 - #383, then #379, then #386 and #389.** In that order: #383 is already implemented and only
needs its adversarial round; #379 turns the tracker honest; #386 and #389 are fresh builds.

**Step 6 - the gate.** Plan 56 does not close on merged PRs. It closes when the founder runs the #345
smoke checklist on a **packaged desktop build** against a **real folder**, drives an explicit-scope
agentic edit end to end, and confirms the receipt matches what is on disk. Note that packaging is the
only thing that exercises esbuild's loader map, and that has bitten this project before (`2bbadf20`).

---

## 6. Decisions the founder needs to make

1. **Where does the wave run from now on?** Both RUN variants now work in a cloud session (blocker 4),
   so this is a preference rather than a constraint. The trade is cost and supervision: an overnight
   local run is the pattern the prompt was written for and the founder can watch it; a cloud run needs
   the session-start hook and the path fix first, but does not tie up the machine.
2. **Does `.claude/CLAUDE.md` get rebuilt and tracked?** It is currently gitignored by inheritance from
   upstream. If agents are expected to follow it, it cannot be machine-local - that is what just cost
   us the file.
3. **Do #421 and #422 pull into the running wave?** Plan 56's own rule is that anything gate-blocking
   found mid-wave gets pulled in and everything else waits. These are frontmatter data-loss defects in
   the area #385 just touched, so the rule plausibly applies.

---

## 7. Reference - branch inventory

| Branch | Keep? | Why |
|---|---|---|
| `docs/vocabulary-and-adr-migration` | **Yes** | PR #390. The docs foundation. Conflicted. |
| `wip/mac-migration-2026-09` | **Yes** | Only copy of the ProseMirror build directory. |
| `loop56/382-reply-reconciles` | **Yes** | Unmerged #382 work with open refutations. |
| `loop56/383-attached-sources` | **Yes** | Unmerged #383 work, no PR. |
| `loop56/376-opening-walk` | No | Squash-merged as #402. |
| `loop55/*`, `validate/*`, `worktree-agent-*`, `52-*`, `40-*`, `r4-review`, `loop55-b3-local` | No | Plan-55 wave and its worktrees, all merged. Roughly 30 branches. |
| `recovered/*` | Founder's call | Seven branches from an earlier recovery. Unclear whether still needed. |
