# Plan 49 - Screens II: Knowledge + Agents (Editor v2, lane C second)

Spec of record: [43-editor-v2-spec.md](43-editor-v2-spec.md) (K1-K3, A1-A3). **Starts after plan 48's first bundle merges (lane C order); consumes plan 45's policy editor and sources-as-tabs when they reach main (soft gates - stub then rebase).** Branch prefix `v2/screens2-*`; worktree `/Users/tommy/Sites/abstract-v2-screens2`.

## 1. Why

Knowledge answers "what feeds my documents and can I trust it right now" in one table - source, kind, sync, who it feeds, how many binds - with staleness warned, never auto-fixed. Agents is the trust ledger: who works for you, under exactly the three-tier grammar the editor uses, and a chronological account of everything they did, addressed by line. Together they absorb the surface share of #131 (sources affordances) and #122 F12 (freshness labels consistent everywhere).

## 2. Success criteria

**K1 - Knowledge surface.**
- [ ] K1.1 Same no-rails shell (white card on chrome), column max 1180px; 240px filter field filtering rows live.
- [ ] K1.2 Header shows "＋ Add source": a file picker whose result lands in the folder's `sources/` (created on first use) and appears in the table and the tree SOURCES group.
- [ ] K1.3 Summary line counts real sources + dependent binds ("4 sources in this folder · 7 bound figures depend on them.").

**K2 - source table.**
- [ ] K2.1 Bordered table radius 13; header row on `#FBFCFD`, mono 9.5/600/.12em `#A3A8B2`: SOURCE · KIND · SYNC · FEEDS · BINDS (grid 2fr 1fr 1fr 1.4fr 90px).
- [ ] K2.2 SOURCE cell: kind glyph (⊞ table / ◍ transcript / ◇ reference) + name 13.5/600; KIND names the kind in words.
- [ ] K2.3 SYNC cell: 7px dot + relative time; fresh = `ok` green; stale = `attention` "stale · Nd" with the entire row on cream `#FDFAF2`; context-only = grey "context only". Staleness thresholds/labels agree with the drawer and hover-peek everywhere (**#122 F12** - one freshness vocabulary; inventory the surfaces in iteration 0).
- [ ] K2.4 FEEDS cell: accent-tint doc chips; clicking a chip opens that doc.
- [ ] K2.5 BINDS cell: mono count right-aligned, `#4650B8`/600 when >0, `#A3A8B2` em-dash when none.
- [ ] K2.6 Row click opens the source as a product tab (45-b family); if 45-b is not yet on main, row click opens the existing source view and this criterion is re-validated after rebase.
- [ ] K2.7 Rows are real: every source in the folder appears; nothing fabricated; xlsx-derived CSVs (decision 165) show their extraction lineage in the drawer path.

**K3 - health strip.**
- [ ] K3.1 At most ONE attention card renders (the stalest stale source) with working "Re-sync" and "mark as expected" actions (warn, never auto-fix; mark-as-expected persists and calms the row to context-grey semantics honestly).
- [ ] K3.2 One static "HOW BINDING WORKS" explainer card beside it; no dashboards, no charts.
- [ ] K3.3 All-fresh state: no attention card, explainer alone or a quiet all-clear line.

**A1 - Agents surface.**
- [ ] A1.1 Same no-rails shell; the header pill (plan 44's service) shows real agent health ("1 agent active" / "all paused").
- [ ] A1.2 Framing line: "Agents only act on documents that opted in. Every action lands in the ledger below."

**A2 - agent cards.**
- [ ] A2.1 Card anatomy per spec: 34px tinted glyph tile, name 14.5/600, mono status line (`● active · watching N sources` in `ok` / `○ paused` in `#A3A8B2`), working accent toggle (36×20) that pauses/resumes via the existing `setAgentDisabled` seam.
- [ ] A2.2 One-line purpose, then the policy table: rows label + right-aligned coloured value using exactly the three-tier grammar (auto-apply `ok` / ask first `#8A6D1A` / never `#B5514B`); values read from the real `agents.json` policy.
- [ ] A2.3 Footer: mono "runs on" + the agent's real model id (broker list, pin 14) + Edit policy link opening the SHARED plain-language policy editor (43 §3.4 - the same component as Properties; no duplicate UI).
- [ ] A2.4 Paused cards render at 75% opacity; the dashed "＋ New agent" tile opens the existing create flow ("from a skill or from scratch").

**A3 - activity ledger.**
- [ ] A3.1 Bordered chronological list, newest first: mono timestamp (52px col) · 7px status dot (amber waiting / green applied / grey admin) · plain-language sentence · right mono badge (WAITING pill / "auto-applied · reversible" / "by <user>").
- [ ] A3.2 Rows derive from the real event/audit stream (orchestrator runs + lock audits) - the same events behind the editor's trust chips; no fabricated rows; truthful empty state.
- [ ] A3.3 Doc links in sentences cite gutter addresses ("Weekly Summary · line 6") via the 45-a address model; WAITING rows deep-link to that doc's Review tab.
- [ ] A3.4 The list is bounded (most recent ~50) with an honest "older activity in each document's History" line.

**Regression.**
- [ ] KR.1 livingDocs suite 0 failures; `typecheck-client`, `valid-layers-check`, `check-seams.sh` clean; zero core seams; agent run/pause/policy behaviours unchanged beneath the new skin.

## 3. Iteration 0

Baseline screenshots (Knowledge fresh + stale states, Agents with an active + paused agent, the current run log) into `docs/qa/2026-07-v2/screens2/00-baseline/`. Tracking issue "[editor-v2] Plan 49: Knowledge + Agents" (label `editor-v2`), cross-linking #131 (name the exact surface boxes this loop ticks) and #122 (F12). The F12 inventory: list every surface showing freshness (table, drawer, hover-peek, tree SOURCES meta, Home chips) with their current labels, and define the one vocabulary in the issue before 49-a starts.

## 4. Slices → PR bundles

- **49-a "Knowledge"** (K1-K3, F12 vocabulary applied everywhere it appears): table, health strip, add-source, filter.
- **49-b "Agent cards"** (A1, A2): cards, policy table, shared policy editor reuse, toggle.
- **49-c "Activity ledger"** (A3, KR.1): the event read model (additive on service/orchestrator), addresses, deep links.

## 5. Do-not-break

- Trust grammar rendering is EXACTLY the three tiers - no fourth state invented for display.
- Warn-never-auto-fix for staleness; re-sync routes through the existing sync machinery and its audit trail.
- Agent registry semantics unchanged (`agents.json`, decision 152 seams); the ledger reads events, never writes.
- `screenRenderKnowledge/Agents.ts` + additive `agentOrchestrator.ts` are this loop's surfaces; `screenEditor.ts` handlers additive-only (shared with plan 48).
- No new core seams.

## 6. THE LOOP

```
GOAL: execute Plan 49 (docs/plans/49-screens-knowledge-agents-loop.md) until bundles a-c are merged or blocked-with-reason, then post the closing report. Run docs/plans/43-editor-v2-spec.md §5 THE PROTOCOL with: loop=screens2, worktree /Users/tommy/Sites/abstract-v2-screens2, branches v2/screens2-<bundle>, evidence under docs/qa/2026-07-v2/screens2/. Bundle order a → b → c; rebase onto main whenever plan 45 lands its policy-editor or sources-as-tabs PRs and re-validate K2.6/A2.3. Validator emphasis: the F12 sweep (every freshness surface uses the one vocabulary - fail on any straggler), stale-row styling with a genuinely stale fixture (age a source file), mark-as-expected persistence across reload, policy-editor identity (the DOM component in Agents IS the Properties one, not a lookalike), ledger truthfulness (every row traces to a real audit/run event - sample 5 and verify in the lock/agents data), and WAITING deep links landing on the Review tab of the right doc. Known traps: relative times need the injectable clock (test seams), not Date.now in render; the activity read model must not mutate orchestrator state; TMPDIR=/tmp; Node 24; typecheck-client only.
```

## 7. Definition of done

All §2 criteria ticked on merged PRs (or blockers recorded); #131 and #122 get comments naming exactly which boxes this loop ticked (F12 done; #131 surface items done, extraction engine already decision 165); closing screenshots committed; tracking issue closed. With plans 44-49 all closed, run the WAVE closing audit (43 §6.5) and post it on the umbrella issue.
