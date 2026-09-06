---
number: 75
status: "**Done (plan 21 iter 3).** 0 core patches; branch `redesign-21-3-skill-composer`."
provenance: "plan 21, iter 3"
source: docs/07-decision-log.md
---

# Skill in the composer reuses the shared report path

**+ Skill in the composer: reuses the shared getSkillReport + runSkillCheck path; no new skill logic**

Added `+ Skill` and `@ Mention` as quiet chip buttons to the Chat composer bar (`reviewRailView.ts: _renderChatComposer`). The `+ Skill` button opens a context menu listing the same skills as the Review disclosure (backed by `getSkillReport(doc)`) and runs the selected skill via `runSkillCheck(doc, id)` - the identical method the `data-skill-run` buttons in `_appendChecks` call. This is a second entry-point to the shared path, not new logic. The `@ Mention` button inserts `@` into the textarea so the user can type to autocomplete a file mention. Composer box styling updated to match the C6 comp: accent-tinted border `#d9d7fb`, 13px radius, subtle lifted shadow. Placeholder updated to "Ask about this document, or run a skill...". Send button sized to 28x28. Chip style: muted `#868b95`, border `#e6e8ec`, 8px radius. Confirmed live: tabs are exactly Chat/Review/History (no Skills tab); Review badge shows count; `+ Skill` is disabled (opacity 0.45) for non-living docs and enabled for living docs; clicking a skill from the picker runs it (rail re-renders on `onDidChange`, confirming the path fired). Design-match: 87% vs the C6 comp composer region. Remaining -13: working-set row and Attach chips (plan 18 decisions 60-63, not in the minimal comp clip) add visual weight; these are intentional product features, not style errors.
