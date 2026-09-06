# 31 - Backlog sequencing after the 2026-09-01 triage

This is the reasoning behind the order, not a checklist. The live state lives in GitHub: the **milestones** hold the waves and their progress, the **P0/P1/P2** labels hold severity, and `ready-for-agent` / `ready-for-human` / `needs-info` hold readiness. Read those for what is left; read this for why it is in that order.

That split is deliberate. The two containers this triage closed - a prediction list (#133) and a thirteen-item polish sweep (#262) - both failed the same way: a checklist in a ticket went stale while the work moved underneath it, and nobody ticked the rows that other waves had quietly fixed. A document that has to be maintained to stay true will not be maintained. This one states judgements that do not expire.

## What the triage found

Forty open issues, none of which had ever carried a triage label. Eleven closed: eight were **already fixed** by the plan-52 and RUN-55 waves and had simply never been closed, in several cases by work that named the issue number in its own commit message or module header. One was a duplicate, and two were containers closed by decision.

The eight already-fixed closes are worth noting as a process signal rather than an accident. Work that fixes a filed defect and does not close it leaves the backlog describing a product that no longer exists, and the cost compounds: every later triage, plan and estimate reads a false picture. The cheapest moment to close an issue is in the PR that fixes it.

## The severity scale

**P0** is reserved for two things: **content or decisions lost with no user gesture**, and **the product asserting something false**. Both are existential for a product whose entire pitch is that you can trust what it tells you about your own documents. A user who loses a heading to an autosave, or reads "approved" for a change that never landed, has learned something about the product that no later polish undoes.

**P1** is a broken journey, a dead end, or a destructive gesture landing on the wrong target. The user can tell something went wrong.

**P2** is a real defect with a visible symptom and no data or trust consequence.

Severity and sequence are kept orthogonal on purpose. Some P1 work is scheduled first because it makes everything after it faster, and inflating its priority to express that would corrupt the scale.

## The waves, and why they are in this order

### 0 · Sharpen the instruments

Four small issues, and they come first because every later wave is validated with tools that currently lie.

The unit suite talks to a **real model** when a port happens to be busy, because the streaming call reaches for a global `fetch` instead of the injected request service (#318). The same defect makes a test hang when the port is free (#304) - one root cause, filed twice from opposite ends, and the second one's stated fix direction was wrong because it was written from the symptom. Three separate sessions in one wave hit this and two mis-attributed it, one reading it as a regression in its own change.

The **privacy canary** - the test that proves document content never leaves the machine - has a suite name that matches neither of the standard validation greps, so in practice only full-suite runs exercise it (#365). A regression in the privacy invariant would survive every ordinary validation pass. That is a hole in the safety net rather than a flake, and it is the reason this sits in wave 0 rather than in polish.

Confirm dialogs render as **native OS dialogs** because the dialog style is never overridden for this window (#370), which makes them invisible to CDP. The confirm step of every bulk verb is therefore unwalkable - and that is the guard on an irreversible bulk apply. It already forced one validator to work around it by deleting files externally, which then made a different defect impossible to isolate.

A suite whose result depends on a free port is not a gate, and a guard that cannot be driven cannot be proven. Fixing four small things here buys confidence in everything that follows.

### 1 · Stop losing data

Two silent data-loss paths are open, and both write without any gesture that could be read as asking for it.

No document write passes the atomic option the file service already supports, so every save has a window where the file is zero bytes on disk (#366). A crash or a kill inside it leaves the document empty, and it widens the blast radius of every other write-path defect. Separately, every write path except approve rebuilds the document from its parsed blocks, so a template-derived document loses its frontmatter the first time a figure auto-applies (#357) - no approval, no reviewer, and on an `auto-apply` document frequently the first write it ever receives.

The change journal's append is a read-modify-write with no atomicity, so two windows appending at the same instant erase a decision with nothing downstream able to detect it (#359). A silently lost decision is the one thing that subsystem exists to make impossible.

#373 belongs here rather than in polish. The heading data loss closed in #319 was fixed by widening a content expression that **enumerates** the atoms it allows, so adding a third atom without updating it reintroduces the same silent loss. A guard costs a few lines and closes the class permanently, and the class has already shipped once.

### 2 · The app tells the truth

Everything here is the product asserting something it has no basis for.

A truncated model stream reads as a **successful** partial reply, so changes get parsed from a half-received body and queued as though the model had finished (#346). The broker already reports the truncation properly; nothing consumes it.

Nothing watches the workspace folder, so a wikilink chip keeps claiming a deleted document exists (#324). The distinction that makes this worth fixing rather than filing is that every other stale-tree symptom is merely out of date, while a resolved chip is a **claim about the world** that the app cannot notice has become false.

A change store that fails to open presents as a project with nothing pending (#360), which is a confident wrong answer rather than a visible failure. A fan-out drop gets named for a reason that did not happen, and drops from batches that ran are discarded when a different batch errors (#341). A door that authenticates but cannot serve still selects itself (#368) - the same shape one level up, and the exact failure the 12 August founder smoke hit.

### 3 · Finish the flagship loop

The middle of the headline journey survived adversarial walking. Its two ends were never walked on a clean profile until this wave.

On a fresh profile the first document has **no export affordance at all**, so the only first run a new user ever gets cannot reach the end of the loop; and completing an export strands them in a raw-HTML editor with no tab and no close control (#333). The Present sheet's controls become unreachable after the first export (#321). A blank document computes to zero pixels wide and cannot be typed into (#320), which is where create-on-click lands the user every time they follow an unresolved link. Closing the last tab leaves a featureless pane with no way back (#299).

These are grouped because they are one experience, not four bugs, and because fixing them separately would mean four passes over the same surfaces.

### 4 · Land the gesture where the user aimed

A chord fires while the user is typing into a webview input, because the gating cannot see inside the iframe - and `Cmd+Backspace` rejects the change *and* destroys the in-progress edit (#335). The chat tab strip has no gesture guard at all, so a click can silently send a message to the wrong conversation (#331): worse than opening the wrong document, because the message goes somewhere and nothing says it went astray. The tree rail's guard is scoped to the double-click interval by design, so ordinary browsing still opens the wrong document (#330) - that one needs a larger invariant, not a bigger timeout.

The rename input has now failed in **three** distinct ways in one wave (#298, after folding in #310's second defect). Its lifecycle is driven by incidental events rather than explicit outcomes, so patching the third symptom would not prevent a fourth. It is fixed once, deliberately, or it comes back.

### 5 · Surfaces and polish

Real defects with visible symptoms and no data or trust consequence. Worth doing, worth doing last.

### Founder-blocked

Five items need a real account, a live walk, or a judgement that cannot be delegated. Three of them are one sitting and would close the model-access evidence gap in a single pass: the PostHog project (#134, a P0 gate item parked since July, whose first step is a few minutes), the live device sign-in that has never been walked end to end (#369), and the tool fixtures that are constructed rather than recorded (#345).

Those last two share a lesson the project has already paid for once. Five acceptance boxes went green on plan 51 while no real call could succeed, because the stub honoured a request shape invented before the backend was ever probed - both sides of the contract were ours, so they agreed with each other. **A stub is only worth the recording it was built from.** Both #369 and #345 exist to retire the remaining places where that is still true.

## Cross-issue relationships worth knowing before starting

These are the pairs where doing the work separately means touching the same seam twice, or fixing half a defect.

- **#318 and #304** are one defect. One fix closes both.
- **#320 and #325** were one defect; #325 is closed as a duplicate. One line of CSS: the prose column is `flex: 0 1 auto`, so it sizes to its content and is merely capped at 720px. Long paragraphs hit the cap and look right, a short document shrink-wraps to 87px, and a blank one to nothing.
- **#366 and #357** both rewrite the document write path.
- **#358 and #359** both rewrite the journal seam.
- **#330 and #331** both want the gesture guard lifted somewhere both rails inherit it. Lifting today's guard verbatim would give the chat strip a rule already known to be too narrow, so the corrected rule and the lift should land together.
- **#310 and #298** meet at rename: #310 is a way to *cause* a rename to fail, #298 is the input surviving the failure. Neither substitutes for the other.
- **#321 and #333** are the same surface, and #333's cleanest fix (stop opening the export result in a second group) resolves #321's trigger as a side effect.
- **#370 unblocks validation** of the bulk confirms and of #324.
