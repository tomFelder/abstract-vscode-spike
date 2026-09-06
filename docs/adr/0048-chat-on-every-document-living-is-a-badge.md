---
number: 48
status: "**Done (plan 15 iter 6).** Dropped the `isLiving` chat gate in exactly two places — `sendChatMessage` (`!state.doc.isLiving` → `!state`) and `reviewRailView._activeDoc()` (any known doc, not just living) — so chat + the rail attach to every open `.md`. The data affordances stay `isLiving`-gated (Skills via `getSkillReport`/`applySkillFix`, freshness/sync bar, figure highlight + source-peek, `@mention` chips); the proposal→in-PM-diff→`approve`/`_persist` path was already doc-agnostic, so it was a pure gate removal. Tier: **our-surface, 0 core patches.** F7 verified live (web: fresh folder+doc via Explorer → PM → chat generate-list + follow-up edit → accept, doc stays plain) and the desktop real-disk smoke (a fresh `Notes.md` + accepted chat insert re-read from disk)."
provenance: "plan 15"
source: docs/07-decision-log.md
---

# Chat on every document; living is a badge

**Chat is available on every document; "living" is a data-binding badge, not a gate on chat**

F7 (chat from a *freshly created* doc) needs chat to work the moment a doc exists. Once PM is the one surface, chat can attach to any `.md`. Two product framings: (a) chat on every doc — "living" means only "bound to data" (badge per decision 39), the core loop is always available; (b) a doc stays plain until a source/bind is added, gating chat behind that step. Tom's call: **(a)** — cleanest loop and best product story; F7 = create doc → chat "generate top-10" → accept → continue, with no setup ceremony.
