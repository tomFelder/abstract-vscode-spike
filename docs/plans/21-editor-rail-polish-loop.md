# Plan 21 — Editor & rail polish (provenance gutter · reading ramp · ＋Skill composer)

> **For agentic workers:** implement with `superpowers:subagent-driven-development` (fresh
> sub-agent per iteration, keep context clean). Each iteration is a small, live-verified,
> stacked PR off `main`. Spec of record: [[20-abstract-ui-redesign-handoff]] (Parts B, C2, C6,
> E rows 2/3/5). When the pixels and the handoff disagree, the handoff wins.

**Goal:** Finish the three remaining low-risk, our-surface polish items so the editor and the
right rail exactly match the redesign: a real provenance **gutter** (not inline dots that shift
prose), the **4b sans reading ramp** at final sizes, and a **＋ Skill** affordance in the chat
composer (rail stays exactly three tabs).

**Architecture:** All changes are inside the `livingDocs` contribution - the `livingDocRender`
webview (`src/vs/workbench/contrib/livingDocs/browser/livingDocRender.ts`), the PM decoration
builder (`.../common/livingDocPmDecorations.ts`), and the right rail
(`.../browser/reviewRailView.ts`). No core patches expected. TDD any deterministic logic in the
decoration builder; verify all visual states live.

## Global constraints (from the spec)

- Colours are meaning only, verbatim from Part B: bound = `accent` `oklch(0.55 0.13 255)`;
  pending/edited = `attention` `oklch(0.66 0.16 45)`; do not introduce a competing accent.
- No em dash in any UI copy. Australian English in copy.
- `typecheck-client` + `valid-layers-check` must be clean before any PR.
- Every PR: before/after screenshots **and** a side-by-side against the matching region of
  `Abstract - UI Redesign.dc.html`, posted in the PR body/comments.
- Screenshots → `docs/plans/21-verify/`. Log decisions in `docs/07-decision-log.md` (continue
  from the current tail).

## Current state (audited on main)

- **Row 1 (header 48px) and Row 4 (fixed source drawer) are already DONE** - do not touch them
  beyond what these three items require. Header: `livingDocRender.ts:117,494`. Drawer:
  `livingDocRender.ts:210,544`.
- **Gutter markers exist but are wrong shape:** `livingDocRender.ts:273-275` paints an 8px dot at
  `left:-20px` inside `.pmwrap` padding; there is **no dedicated gutter column** and **no bar** for
  multi-line edits; hover is not wired to source-peek. Marker data:
  `common/livingDocPmDecorations.ts:102-142` (`buildPmDecorationSpec` → `IPmGutterMarker[]`).
- **Reading ramp is close:** `livingDocRender.ts:234-236` - body `400 15px/1.7 system-ui` at 720px
  (good), but **H1 is 27px (want 30)** and **H2 is 20px (want 16)**.
- **Rail is already 3 tabs** (Chat/Review/History) with a Review count badge
  (`reviewRailView.ts:96-110`); Skills is already a collapsed disclosure, **not** a tab. The
  composer (`reviewRailView.ts:470-533`) has `@ Mention` but **no `＋ Skill`** affordance.

## Iteration plan (each iteration = one stacked PR off `main`)

### Iteration 1 — Provenance gutter (Row 2)
Target (C2): a **30px** `flex:none` gutter column to the LEFT of the 720px reading column - the
markers live in that column so **the prose is never shifted**. In the gutter:
- a **9px dot**, vertically centred on a **source-bound** line, colour `accent`;
- a **3px vertical bar** spanning the rows of a **multi-line edited** paragraph, colour
  `attention`;
- **no line numbers** anywhere;
- **hover** a marker → open the existing source-peek drawer for that binding/source.

Do:
1. Restructure the doc layout so `.pmwrap` is a flex row: `[30px gutter][720px prose]`, gutter
   `flex:none`, prose centred within remaining space (keep the current 720px max + centring).
2. Move marker rendering from the `-20px` padding trick into real widget decorations positioned in
   the gutter column. Reuse `IPmGutterMarker` from `common/livingDocPmDecorations.ts`; add a
   `kind: 'dot' | 'bar'` and, for `bar`, the row span (start/end block) so a multi-line edited
   paragraph gets a bar covering its rows. **TDD `buildPmDecorationSpec`** for the new
   dot-vs-bar + span logic (pure function, deterministic - unit-test it).
3. Wire `mouseenter` on a marker to the same `reveal` message the bound figure already fires
   (`livingDocRender.ts:341`), so hovering the gutter opens source-peek.

Gate: bound lines show a gutter dot; a multi-line edit shows a bar; **the prose column does not
shift** when markers appear/disappear; hovering a marker opens the source drawer. Verify live with
a bound doc (`living-docs-sample/brief/Project Brief.md`) and a doc with a pending multi-line edit.

### Iteration 2 — Reading ramp final sizes (Row 3)
Target (Part B type table): H1 **30px** / 1.12 / 600 / `-0.02em`; H2 **16px** / 1.3 / 600; body
**15.5-16px** / 1.7 / 400; column max **720px** (already correct). Sans only, no serif.

Do: update `.prose` / `.prose h1` / `.prose h2` in `livingDocRender.ts:234-236` to the exact ramp.
Leave the font family (`system-ui` fallback) as is - the ramp is what matters.

Gate: H1 renders 30/600 with tight tracking; H2 16/600 (visibly a section heading, not a
sub-title larger than body would suggest); body reads like Docs/Notion at 720px. Screenshot a
doc with H1 + H2 + body + a bound figure.

### Iteration 3 — ＋ Skill in the composer (Row 5)
Target (C6 Chat): the composer row shows, left to right, a placeholder, **＋ Skill**, **@ Mention**,
and an accent send button. Selecting **＋ Skill** lets the user pick and run a document skill from
the composer (reuse the skill list that currently backs the Review-tab disclosure at
`reviewRailView.ts:259-293` - do not duplicate the source of skills).

Do:
1. Add a `＋ Skill` button to the composer (`reviewRailView.ts:470-533`) beside the existing
   `@ Mention` control, styled as a quiet chip (Part B controls: 8-9px radius, `slate` text).
2. On click, present the available skills (same list as the disclosure); selecting one composes/
   runs it through the existing skill-run path.
3. Confirm the rail is still **exactly** Chat/Review/History (no Skills tab regressed in) and the
   Review badge still shows the pending count.

Gate: exactly three tabs; `＋ Skill` is visible in the composer and a skill is runnable from there;
Review badge intact. Screenshot the composer with the skill picker open.

## Acceptance criteria (verified live, then design-matched)

- [ ] 30px gutter column; 9px bound dot; 3px multi-line bar; no line numbers; **prose not shifted**;
      hover opens source. _(iter 1)_
- [ ] H1 30/600/-0.02em, H2 16/1.3/600, body 15.5-16/1.7 at 720px, sans only. _(iter 2)_
- [ ] Composer has `＋ Skill` + `@ Mention` + accent send; a skill runs from the composer; rail is
      exactly Chat/Review/History with the Review count badge. _(iter 3)_
- [ ] `typecheck-client` + `valid-layers-check` clean; **0 core patches**.
- [ ] Each surface scores ≥ 90% against its region of `Abstract - UI Redesign.dc.html` in the
      design-match pass (see Verify).

## Verify approach

`npm run watch`; `./scripts/code-web.sh ./living-docs-sample/brief` (:8080) + OpenRouter proxy
:8090; drive the webview with chrome-devtools (let the SW register, no `ignoreCache`).
**Design-match loop** per iteration: screenshot the live surface, pull the matching screen region
from `Abstract - UI Redesign.dc.html` (`DesignSync get_file`, project
`d198ca07-9eef-4d05-96e1-b383e6c19c03`), compare against Part B tokens + the C2/C6 px specs, score,
and iterate until ≥ 90% or clearly diminishing returns; log scores to
`docs/design-audit/redesign-log.md`. Then open the PR with before/after + comp side-by-side.

---

## Kickoff (this plan is driven by the master loop prompt; see `docs/plans/RUN-abstract-redesign-loop.md`)
