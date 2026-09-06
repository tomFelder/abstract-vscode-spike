# 23 - The validation thesis: users from first principles, value hypotheses, and the open founder questions

Recorded from the founder session of 12 Jul 2026. This document does three jobs: (§1) records
founder context not yet captured in [14-product-strategy.md](14-product-strategy.md), (§2-3) works
from **first principles in the target user's shoes** to hypothesise what they will pay for, and
(§5) asks the uncomfortable SaaS questions the beta must answer. It is written to be quoted at
future planning sessions; the value hypotheses in §3 are deliberately **falsifiable** so the beta
can kill or confirm them.

## 1. Founder context, recorded (new since doc 14)

- **The origin proof:** a year of successful dogfooding in Cursor - strategy docs, reports and
  policies, whole folders managed at a time, by a technical user driving agents directly. The
  product thesis is a *transfer* claim: the workflow is proven; only the harness is inaccessible.
- **The validation arc, explicitly:** the beta is a **local Electron fork to validate the problem
  beyond the founder**. If it validates → raise → team → **greenfield, cloud-first, collaborative**
  rebuild. The fork is a validation vehicle, not the product. (Consistent with doc 14 §6
  chapters; the new sharpness is that chapter 2 is a *rebuild*, not an evolution.)
- **The team pain behind chapter 2:** the founder's own team cannot collaborate on documents while
  using the powerful *local* harnesses (Claude Code, Codex); the cloud chat tools are collaborative
  but far weaker. "Local-agent power with cloud collaboration" is the chapter-2 wedge - noted:
  the beta, being single-player, does **not** test this (§5 Q7).
- **The long-horizon north star:** realtime feedback - stream in writing and thought, coach and
  suggest back out; an assisted flow state. Out of beta scope; recorded so the interaction grammar
  (changes, review, provenance) is checked against "could this run live" when designed.
- **The self-awareness that motivates this doc:** the founder is a technical early adopter and
  knows it - "I can't build the product for me." The beta market is **tech-savvy, non-technical,
  document-heavy, frontier-AI-frustrated** (doc 14 §2.1). Every priority call must be re-derived
  from that user, not from what the founder would enjoy building.

## 2. First principles: a week in the target user's life

Take the chief-of-staff/ops face (the wedge face, doc 14 §2.2) and the PM/consultant faces, and
walk their actual current workflow honestly. Their tools: Word/Docs + ChatGPT/Claude in a browser
tab. What they experience today:

1. **The copy-paste tax.** Every AI assist is: copy doc → paste into chat → prompt → copy result →
   paste back → re-format → fix what it broke. Ten times a day. The chat never sees the folder.
2. **Regeneration roulette.** Ask for one tighter paragraph; get a whole regenerated document with
   three other silent changes. They have learned to distrust *apply*; they diff by eyeball or not
   at all.
3. **Context evaporation.** Each session starts from zero. The strategy context lives in their
   head and twelve files the model has never seen. Long chats degrade and hallucinate and they
   don't know why ("nobody should have to understand context windows", doc 14 §2.1).
4. **The Sunday-night pack.** The recurring report is re-assembled by hand from other people's
   numbers - the same document surgery every week, high stakes, zero leverage.
5. **Version chaos and fear.** `FINAL v2 (3).docx`, tracked changes across three emailed copies,
   and the standing terror of shipping a stale number to a board or an auditor.
6. **The capability itch (what makes them *our* segment).** They have felt frontier models be
   brilliant, they suspect there is 10x more available, they have heard of Claude Code/Cursor,
   and the terminal is a hard wall. They don't want prompts; they want the *harness*.

**Addition (12 Jul 2026) - the services face.** A fifth face joins the doc-14 archetypes: the
**services operator** (agency / consultancy / professional services) whose business runs on
**quotes, proposals, SOPs, and project/service documents**. Template-born, high volume, assembled
from the last one plus new client specifics; margin rides on speed-to-quote and consistency. This
is the purest test of the template on-ramp (1b) and the from-examples wizard (1x, issue #126 -
"here are six past quotes, learn the pattern"), and it strengthens VP3 (recurring cadence per
*client* rather than per week) and VP5/VP6. Watch for this face in the survey's "what do you make
weekly" answers - if it clusters, the template library becomes an acquisition channel
([14](14-product-strategy.md) §6 chapter 3's template/skill sharing arrives earlier).

**First-principles adoption laws for this user** (each maps to build priorities):

- **Law 1 - The first session must beat their current workflow, visibly, on their own work.**
  Not a demo on our data: the aha is on *their* file (T4). Anything that delays or breaks the
  first ten minutes is the top of the backlog by definition. → D26, plan 37, doc 21 P0.
- **Law 2 - Zero new mental models.** Folder, document, track-changes-style review, templates.
  Every concept we add (locks, bindings, agents) must wear plain words or stay invisible. → P5.
- **Law 3 - It must speak the org's language on day one.** Their output is judged in Word. In
  without conversion pain, out as .docx/PDF - or the product is a cul-de-sac they visit, not a
  place they work. → doc 22, the revised migration stance (doc 21 §5).
- **Law 4 - Trust is the product.** Never lose work (X1), never change meaning silently (F14,
  review grammar), always show receipts (1p). One violated expectation costs more than ten
  features earn. → the walk's fix list.
- **Law 5 - The harness is the value; package it.** This user will not engineer loops or write
  skills. They buy *outcomes with receipts*: a weekly-report agent, an interview-me skill, a
  consistency sweep. Raw model access is what they already have; packaged expertise is what
  they're missing. → templates + skills pack + agents with policy.
- **Law 6 - Calm earns residence.** They will *live* here hours a day only if it feels like a
  minimal modern editor, not an IDE wearing a costume. Aesthetic simplicity is an adoption
  feature, not polish. → plan 33 shell integrity, the design system.

## 3. Value-prop hypotheses (falsifiable)

Each names the promise in the user's words, the mechanism, the beta test, and the kill signal.
Ordered by how directly the beta can test them.

**VP1 - "It edits my document, it doesn't regenerate it."**
Precise, reviewable diffs into a persistent doc - the anti-regeneration-roulette.
*Test:* change approve/tweak rate (guardrail band 5-25% tweak+reject), repeat 1e sessions per
user. *Kill signal:* users copy text back out to ChatGPT to iterate.

**VP2 - "I never ship a stale number."**
Bindings + provenance + the reconcile-before-export gate. Reputation insurance.
*Test:* sources bound per user, `provenance_peeked` frequency, export-gate saves ("Fix first"
clicks). *Kill signal:* users don't bind sources at all - documents stay unbound prose (then the
wedge is wrong and VP1/VP5 lead).

**VP3 - "Monday takes 90 seconds, not Sunday night."**
The recurring pack: template + bindings + agent run + morning all-clear.
*Test:* week-over-week repeat runs of the same doc (the north-star habit, doc 15); time-to-all-clear.
*Kill signal:* single-shot usage - docs created once, never re-derived. This is the **retention**
hypothesis and the one the raise narrative leans on (§5 Q9).

**VP4 - "The whole folder is the context."**
Cross-document work: one instruction, N docs, receipts (fan-out, cross-doc review).
*Test:* fan-out runs per user; docs-per-run; 1k review completion. *Kill signal:* all sessions are
single-doc - then multi-doc agency is a demo, not a need (and the compliance face is a services
story, not a product one).

**VP5 - "I think better here."**
The thinking session: interview-me, stress-test, brainstorm - the ITE promise wearing a skill.
*Test:* skill invocations per user per week; do users return to *think* (docs born in-product) or
only to *maintain* (docs imported)? *Kill signal:* the skills pack goes untouched - joy stays a
founder story.

**VP6 - "It speaks Word."**
Interop: their folder in, their org's formats out (doc 22).
*Test:* imports per new user in session one; export-format split (docx/PDF vs markdown). This is a
*multiplier* hypothesis - it doesn't earn love alone, but its absence caps every other VP.
*Kill signal:* none for beta (it is table stakes); the interesting data is which direction
dominates (import-heavy = migration product; export-heavy = authoring product).

**VP7 - "Local-agent power, cloud collaboration" (chapter 2 - not testable in beta).**
The founder team's own pain. Recorded as the raise thesis; the beta can only *survey* for it
(add to the onboarding survey: "do you work on documents alone or with a team? what breaks?").

**Willingness-to-pay hypothesis:** the wedge buyer pays like they pay for Cursor/ChatGPT -
**~$20-40/seat/month, self-serve, expensed** - because the value story is time (VP3) plus
reputation insurance (VP2) on work their job depends on. The compliance/fund faces later justify
team pricing (per doc 14 §5, bundled allowance). *Beta test:* the survey + a founding-member
pre-order fake door (§5 Q8). *Kill signal:* enthusiastic free usage with zero pre-order conversion.

## 4. What this changes in the build order (delta to doc 21)

Doc 21's P0 list stands - every item maps to Laws 1/3/4. Adjustments from this analysis:

1. **The thinking-skills pack rises.** It is the only VP5 test and already gates per doc 18 §2.6;
   it must land *with* cohort 1, not after. Even two skills (interview-me, stress-test) make the
   ITE story testable. (It was implicit in doc 21; it is now explicit P0, tracked with plan 38.)
2. **The onboarding survey gains two questions** (VP7, WTP): team-vs-solo document work, and a
   price-anchor question. Cheap, and it feeds the raise narrative directly.
3. **Instrument the VP kill signals** as first-class dashboard cuts in plan 36: bound-vs-unbound
   docs (VP2), repeat-run rate (VP3), single-vs-multi-doc sessions (VP4), skills touched (VP5),
   import/export direction (VP6). The beta's job is to *sort the VPs*, not just count events.
4. **Import leads export within P1.** Session-one experience is import-shaped (their folder), and
   VP6's session-one test needs it; export completes the loop for week-one.
5. **Shell calm (Law 6) is a standing acceptance bar,** not a one-off plan: every P0 fix PR checks
   "does this still read as a minimal editor?" (plan 33's checklist is the tool).

### 4b. The doc-set test (the VP4 dogfood benchmark, 12 Jul 2026)

A lived founder example, adopted as the standing acceptance benchmark for VP4: **this repo's own
`docs/` folder - 24+ interlinked documents - opened as an Abstract project.** In Word you'd open
them one by one; the test is that Abstract makes the *set* the unit of work:

1. **Ask the set:** from Project Home, a question whose answer spans many files ("what have we
   decided about model access, and where?") returns a **cited** answer - file + section receipts,
   not model memory. (2c made real; the citation gap is the walk's named finding.)
2. **Edit the set from one prompt:** "we renamed the product - update every doc" produces a
   reviewable **cross-document change set** (1j fan-out → 1k review), approved at any granularity,
   never a blind find-and-replace.
3. **Steer the set:** tools, skills and agent instructions are reachable from the same front door
   (the Agents/Templates surfaces, 1t - already WALKABLE).

The machinery exists (1j and 1k graded WALKABLE); the missing piece is precisely the **front door**
- the whole-project composer with cited read-only answers (F15, issue #124). The test is cheap to
run weekly and is the honest measure of "the folder is the context": **when managing these docs is
easier inside Abstract than in this coding harness, VP4 is proven.**

## 5. The founder questions (the SaaS startup lens)

Asked plainly, because the docs exist to survive politeness. Each has a "cheapest way to learn".

**Q1 - What result kills the idea?** Cohort 1 is friends (doc 18 §4) - the kindest possible
audience. Define the *disconfirming* thresholds now, before data arrives: e.g. "if fewer than X of
10 users run the same document twice by week 4 (VP3), the wedge is wrong." Without pre-registered
kill criteria, a friendly beta will validate anything.

**Q2 - Are you validating the problem or the artefact?** A year of Cursor dogfooding validates the
*workflow for you*. The fork validates whether *others* adopt it. But the stated plan (validate →
raise → greenfield rebuild) means the beta's real deliverables are **learnings that transfer**:
the journey grammar, the review/provenance mechanics, the funnel numbers, the VP ranking - not the
code. Cheapest de-risk: write the "what must be true to raise" memo now (a page: target funnel
numbers, retention bar, WTP evidence) so every beta week is checked against it.

**Q3 - Is "tech-savvy non-technical" a segment or a corridor?** People in that posture may be
*passing through* - either toward technical (they'll end up in Cursor anyway) or toward the mass
market (they'll wait for Word Copilot to be good enough). The segment is real only if it is
*stable and reachable*. The onboarding survey + where cohort 2 comes from (can you acquire these
users repeatably, outside your network?) is the test. Watch CAC-shaped signals even in a
hand-onboarded beta: how many warm intros does one activated user cost?

**Q4 - The platform squeeze is the scariest slide in the deck.** OpenAI/Anthropic/Microsoft are
all moving toward documents (Canvas, Artifacts, Cowork, Copilot in Word). Doc 14 §7's answers
(trust grammar, multi-doc agency, files-on-disk) are good *product* answers; the *business* answer
must be speed to a defensible position: recurring bound documents create switching costs (your
locks encode a year of provenance nobody else can reconstruct). That argues for VP2/VP3 depth over
breadth - and for not spending beta months on anything a platform vendor gives away next quarter.

**Q5 - Single founder, VS Code fork: where does the time go?** The merge-tax ledger discipline is
excellent, but every upstream sync and Electron-packaging yak is time not spent on validation.
Since chapter 2 is a rebuild anyway: **freeze upstream syncs for the beta window** unless a
security fix forces one, and treat the fork as a disposable instrument. (Q3 of doc 05 is resolved
- the fork is the vehicle; this just caps its maintenance budget.)

**Q6 - The beta is single-player, but your sharpest stated pain is collaborative.** The team-pain
story (local power vs cloud collaboration) is the chapter-2 raise thesis, and the beta produces
*zero evidence* for it. Two cheap partial tests: (a) the survey questions in §4.2; (b) a
"share a read-only link" fake door on the Present modal - clicks are demand signal for
publish-and-comment (D25) without building it.

**Q7 - Free beta = zero WTP signal.** Doc 14 §5 decides pricing shape but the beta as planned
never tests it. Add one honest fake door: a **Founding member - $15/mo, locks your price, first
cloud seats** page linked from the app. Even 3 conversions from 10 users says more than any survey
answer. (Fake doors must be honest: take real commitments only if you intend to honour them.)

**Q8 - T4 is activation, not value.** The gate sentence (doc 18 §1) is right for *readiness*, but
the raise should hang on **week-4 repeat use of the wedge loop** (VP3's north-star habit, doc 15),
not on aha counts. Recommend: gate the *beta* on T4, gate the *raise* on retention - and say so in
the Q2 memo so the two aren't conflated under deadline pressure.

**Q9 - Who is the buyer when this grows up?** The faces split: PM/consultant/CoS are self-serve
seats; compliance and fund-ops are B2B sales with procurement. The greenfield architecture bets
(multi-tenant, permissions, audit) differ by which leads. The beta can tag every activated user
by face and watch which one *retains* - let that pick the chapter-2 go-to-market, not the demo
appeal (the ISMS demo is spectacular but quarterly-cadence, doc 14 §2.2).

**Q10 - Is "realtime coaching" a differentiator or a distraction?** As a north star it is
motivating; as a roadmap item it competes with the wedge for identity. Recommendation: keep it
out of all beta-era public narrative (site, onboarding) - a product that is "trusted documents"
*and* "flow-state coach" is two products in the user's head. Revisit at the raise with VP5 data
in hand: if thinking sessions retain, the coaching arc is the natural sequel and the data will
say so.

## 6. Status and resolutions (founder, 12 Jul 2026)

§3's hypotheses and §5's questions are inputs to: plan 36 (dashboard cuts, §4.3), plan 38 (survey
additions, §4.2; skills pack), and the pre-raise memo (Q2). The build order of record remains
[21-beta-v1-prioritization.md](21-beta-v1-prioritization.md); this document is the *why* behind it
and the list of things the beta must learn, not just ship.

The founder resolved the §5 questions same-day (decision-log 156-160):

- **Q1/Q2/Q8 → decided.** The "what must be true" memo exists as
  [24-beta-success-memo.md](24-beta-success-memo.md) - the beta answers **success and growth**,
  not just activation; beta gates on T4, the raise gates on the memo's retention + growth bars
  (decision 157).
- **Q6 → held.** The share-a-read-only-link fake door is deferred; the survey's team-vs-solo
  question still ships (decision 160).
- **Q7 → decided, upgraded.** WTP is tested with a *real* payment event: free OpenRouter included
  tier to check it out, OpenAI OAuth for real usage, then one or two **charged metered API routes
  as a beta fast-follow** (decision 158; memo §4).
- **Q5 → decided.** Upstream syncs frozen for the beta window, security-only exception
  (decision 159).
- **Q10 → decided.** Realtime coaching stays out of beta-era narrative; future feature
  (decision 160).
- **New (same session):** the hidden `.abstract/` project folder for skills/knowledge/runs/config
  (decision 156; layout in [22](22-file-interop-and-project-layout.md) §5).
- Q3 (segment vs corridor), Q4 (platform squeeze), Q9 (buyer identity) remain **watch items**
  measured by the memo's growth section and the per-face retention cut.
