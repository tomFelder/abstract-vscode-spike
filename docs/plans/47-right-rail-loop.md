# Plan 47 - Right rail (Editor v2, lane B second)

Spec of record: [43-editor-v2-spec.md](43-editor-v2-spec.md) (pins 13, 14). **Starts after plan 44 AND plan 45 bundle-a (line addresses) have merged.** Branch prefix `v2/rail-*`; worktree `/Users/tommy/Sites/abstract-v2-rail`.

## 1. Why

The right rail is the conversation-and-consent surface. v2 keeps its structure (plan 20 §C6) but floats it, trims it to three tabs (Skills folds into the composer's ＋ Skill, finishing the plan 20 Part F decision), teaches Review cards to speak line addresses, and gives the composer a quiet model selector so "which model is doing this" is visible metadata instead of a settings excursion.

## 2. Success criteria

**Pin 13 - rail shell + tabs.**
- [ ] P13.1 The rail is a 392px floating card matching the tree rail's treatment (bg `#FBFCFD`, radius 14, `shadow-rail`; plan 44 provides the card, this loop must not fight it).
- [ ] P13.2 44px tab strip reads Chat · Review · History; the Skills tab is gone; every Skills capability is reachable via the composer's ＋ Skill.
- [ ] P13.3 Active tab = white chip 28px + e1, 12.5/600; idle 12.5/500 `#868B95`.
- [ ] P13.4 Review carries the amber count badge (min-width 16px, `#C99A2E` bg, white 10/600, radius 999) with the live pending count; badge hides at zero.
- [ ] P13.5 Review cards and chat meaning-change cards cite the gutter address ("Line 6 - shortened the momentum sentence") via the 45-a address model; the address navigates/scrolls the editor to the block on click.
- [ ] P13.6 Chat transcript keeps plan 20 §C6 anatomy (user bubble accent-tint with @mention chips; tool-call block mono/`ok`; applied-figure pills; meaning-change card with Review →).

**Pin 14 - composer + model selector.**
- [ ] P14.1 Composer action row order: ＋ Skill · @ · (spacer) · model control · send (28px accent square, radius 8).
- [ ] P14.2 The model control is mono 11px `#868B95` with a 6px health dot + model id + ▾; it reads as metadata (no border/bg until hover).
- [ ] P14.3 Click opens a popover listing the broker's models with included-tier vs own-key grouping (plan 35), the current model checked, and a per-row health dot; selecting switches the model used for the next call.
- [ ] P14.4 The selection persists per-workspace across reload (43 §3.5 key).
- [ ] P14.5 Broker down or model unhealthy: the dot goes `attention`/`removed`, the control names the state in plain words, and chat still fails honestly (no fabricated health). The transient "Model unavailable" flash during surface crossings (#211 item 4) is gone - health state settles without flicker.
- [ ] P14.6 #120 (ChatGPT-subscription call failure) is explicitly OUT of scope: the validator must not fail this loop on it; the selector shows that backend's real state and the loop links #120 in its closing comment.

**Regression.**
- [ ] PV.1 Pending-proposal badge behaviour composes with plan 44's collapsed-rail dot (P2.5): collapsed + pending = dot on toggle; open = badge on tab.
- [ ] PV.2 History tab still rehydrates per its current contract; approve/reject from Review cards unchanged.
- [ ] PV.3 livingDocs suite 0 failures; `typecheck-client`, `valid-layers-check`, `check-seams.sh` clean; zero core seams.

## 3. Iteration 0

Baseline screenshots (Chat with a transcript, Review with ≥1 pending, History, the current Skills tab, composer) into `docs/qa/2026-07-v2/rail/00-baseline/`. Tracking issue "[editor-v2] Plan 47: right rail" (label `editor-v2`), cross-linking #211 (item 4) and #120 (note-and-link). Record `file:line` for the current tab DOM, the Skills tab entry points, and the broker's model-list surface (`scripts/lwd-model-broker*`, Settings screen model picker).

## 4. Slices → PR bundles

- **47-a "tabs + Skills fold + addresses"** (P13.*, PV.1-2): three tabs, badge, Skills → ＋ Skill, line-address citations.
- **47-b "model selector"** (P14.*): the control, the popover (broker list API - additive route if the broker needs one), persistence, honest health states, #211-4 fix.

## 5. Do-not-break

- Approve/reject/tweak flows and their analytics events unchanged; no new apply paths.
- The ＋ Skill affordance must expose everything the Skills tab did (inventory it in iteration 0; nothing silently dropped).
- Model calls keep routing through the broker (decision 14: no credential in the renderer).
- `reviewRailView.ts` is this loop's surface; `livingDocsService.ts` additive-only; shell CSS belongs to plan 44.
- No new core seams.

## 6. THE LOOP

```
GOAL: execute Plan 47 (docs/plans/47-right-rail-loop.md) until bundles a-b are merged or blocked-with-reason, then post the closing report. Run docs/plans/43-editor-v2-spec.md §5 THE PROTOCOL with: loop=rail, worktree /Users/tommy/Sites/abstract-v2-rail, branches v2/rail-<bundle>, evidence under docs/qa/2026-07-v2/rail/. Gate check first: confirm plan 45 bundle-a is on main (the address model in common/) - if not, wait; do not stub addresses. Validator emphasis: the Skills-capability inventory (nothing lost in the fold), address-click navigation to the right block, badge/dot composition with the rail collapsed, model-switch persistence across reload, and the no-flicker health check crossing Editor → Home → Editor with the broker up AND down. Known traps: #120 is a known open bug - report its state, never fail on it; broker restarts take a beat - poll /healthz rather than asserting instantly; TMPDIR=/tmp; Node 24; typecheck-client only.
```

## 7. Definition of done

All §2 criteria ticked on merged PRs (or blockers recorded); #211 gets a comment ticking item 4; #120 gets a state-of-play comment with the selector's behaviour; closing screenshots committed; tracking issue closed.
