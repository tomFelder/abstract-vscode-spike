# 16 - Principles: product, design, engineering

One document for the rules that outrank any individual plan. Product principles P0-P10 were ratified in Journey Map v4 ([13-journey-map-ratification.md](13-journey-map-ratification.md)); the design and engineering principles consolidate doc 12 §2, the spike's decision log, and the 9 Jul 2026 planning session. New work must not regress any of these; a plan that needs to break one must say so explicitly and get the conflict ratified first.

## 1. Product principles (P0-P10, ratified)

**P0 - Trust above all.** The generation must be correct - and feel **more reliable than Claude Desktop or ChatGPT**. That is the bar, and it is why every other principle exists: grounding in sources (P4), receipts (P8), review gates (P3), honest confidence labels. When correctness and speed conflict, correctness wins. When correctness and delight conflict, correctness **is** the delight.

- **P1 - Progressive disclosure.** Surface a capability only when the user's situation calls for it. Depth is earned, never dumped.
- **P2 - No duplicate pathways.** If a job already has a clean route, don't build a second one for v1 (e.g. D20: templates already cover recurring creation).
- **P3 - Everything routes through review.** Chat, fan-out, agents, hooks, thinking skills - one review grammar, no second-class writes.
- **P4 - No hidden context.** What the agent sees is always inspectable before it acts (task context in the tab, doc sources in the rail).
- **P5 - Plain words.** "While I'm away…", not cron; "heavy context", not token counts. Git-shaped mechanics stay internal (D7's commit is a metaphor, never UI copy).
- **P6 - Files are the truth.** Plain, portable, rebuildable - the user can always walk away with their folder. The escape hatch is the sales pitch.
- **P7 - Calm by default.** Mechanical work happens silently with receipts; only judgement calls interrupt a human.
- **P8 - Receipts over promises.** Every change carries who/what/why/when; undo works everywhere, including across approves.
- **P9 - The human dials autonomy.** Trust is granted per doc and per agent (D9), never assumed - and can be taken back.
- **P10 - Boring excellence first.** The editor must feel Word-grade (paste, tables, images) before any magic matters - weakness here disqualifies everything else (test T1).

**Calibration note (9 Jul 2026):** the P5 bar is set for the eventual mass-market floor. The beta cohort is tech-savvy and AI-fluent ([14-product-strategy.md](14-product-strategy.md) §2.1); during beta, power showing through (the words "skills" and "agents", a context ring, a usage meter) is acceptable and even attractive. P5 governs *mechanics* (no cron strings, no token counts, no git verbs), not *nouns*.

## 2. Design principles

Consolidated from doc 12 §2, doc 06 and decisions 19-42; binding since the redesign.

- **Calm by construction.** One document surface, no splits ever; IDE optionality removed at the source, not hidden by settings. Layout is a product decision, not a user choice.
- **One editor.** ProseMirror is the single surface for every `.md`, plain or living. "Living" is a badge, not a gate.
- **One review grammar everywhere.** The change card (change kind, confidence label, old/new, source + freshness, one-line why, Approve/Tweak/Reject) is the same in chat edits, fan-outs, agent runs, hooks and - later - human suggestions. Nothing new to learn per surface.
- **Colour only ever means something.** Green = applied/ok, amber = waiting/stale, red = failed/rejected; decoration is never ornamental.
- **Real data only.** No fabricated counts, no fake versions, no dead buttons without a "Soon" label. The demo is the product.
- **Design the feeling, not just the screen.** The morning all-clear feels like inbox-zero; the provenance peek feels like x-ray vision; delight is relief, not fireworks.
- **Word/Docs muscle memory wins ties.** Name-first document birth, familiar formatting affordances, no concepts imported from developer tooling into UI copy.

## 3. Engineering principles

- **Journey-completeness over feature-count.** *(New, 9 Jul 2026 - the broken-alpha lesson.)* Plans 26-33 all merged, yet the app breaks one step off the golden path; plan-completion is not journey-completion. The unit of "done" is a **walkable journey**: empty states, error states, off-path recovery and unhappy paths included, validated against the journey's acceptance criteria (Journey Map task ②). A feature that only works when driven correctly is not shipped; it is staged.
- **Everything routes through the review engine.** The engineering mirror of P3: one change model, one approve path, one audit trail. No component writes to a document around it.
- **Build at the product layer, portable by default.** Features (undo, history, snapshots, review API) are built on our own surfaces (PM history + lock + audit), not deep VS Code internals, so they survive the local → cloud rebuild (chapter 2 in doc 14). D23's portable approve-act is the template.
- **Honest engineering economics.** Core patches are counted, one-line, fail-soft, and logged in the merge-tax ledger (plans/03). The ledger stays live for as long as the fork does.
- **Atomicity is engine truth, not UI copy.** "Never half-applied" (1s), "a starved run pauses and resumes, never dies" (D15) - these are invariants the engine enforces, with the UI merely reporting them.
- **Real data only, in engineering form.** No sample fallbacks in production paths; an empty state is an empty state, an error is an error with the source and the affected docs named (1s frame 3: never "the agent errored").
- **Spec the merge, not just the feature.** Where concurrent state meets (user edits during a run - D22, D8; colliding threads - D11), the merge behaviour is specified explicitly before build, because unspecified merges become data-loss bugs (decision 68's lesson).
- **Instrument as you build.** New surfaces emit their metric-tree events ([15-metrics-and-instrumentation.md](15-metrics-and-instrumentation.md)) from day one; the audit trail is the analytics substrate, so this is usually free.
- **Test what the user does, not what the code has.** Snapshot-style assertions on journeys beat many precise assertions on internals; webview layers get coverage before new webview scope lands.

## 4. How to use this document

When a plan is drafted: check its scope against P0-P10 and the persona. When a design is proposed: check it against §2 and the four killer flows. When an implementation is reviewed: check it against §3 - especially journey-completeness, review-engine routing and portability. When two principles conflict in practice: P0 wins, then the more specific principle wins; record the tension in the decision log either way.
