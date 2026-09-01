# Architecture decision records

One file per decision. Each record states what was decided, why, and where it stands, and carries the decision's number, status, provenance and (where the row had one) date in YAML frontmatter.

These were migrated out of [`../07-decision-log.md`](../07-decision-log.md), which had grown into a single 154-row table. That page is now the **index** and remains the tie-breaker on any doc conflict; the records themselves live here.

## Numbering

- **Four digits, zero-padded, matching the decision number exactly.** Decision 159 is `0159-freeze-upstream-vs-code-syncs-for-the-beta.md`. Four digits because the log is already live at 181 and still growing.
- **Numbers are stable and are never reused or renumbered.** They are cited by number in prose across the docs corpus and in code comments under `src/`, so the number is the durable handle; the slug is only there to make the file readable.
- **Gaps are intentional.** Numbers 102-109, 112-119 and 139-149 were reserved while drafting and never used. There is no missing record behind them.
- **New records continue the sequence from 0182.** Add the file here, then add a row to the index in [`../07-decision-log.md`](../07-decision-log.md).

## Format

An ADR can be a single paragraph. That is a floor, not a ceiling: several of these carry long rationales and none of that was trimmed in the migration.

```md
---
number: 182
status: Decided
provenance: plan 56
date: 2026-09-01
source: docs/07-decision-log.md
---

# A short noun phrase naming the decision

What was decided.

Why.
```

`provenance` and `date` are omitted entirely when the record has none. `status` is deliberately free text rather than an enum: the log records real states like "Done (plan 21 iter 1); 0 core patches" and "Reversed by 20", and flattening those would lose information.

## Related

- [`../07-decision-log.md`](../07-decision-log.md) - the index of all decisions, and the tie-breaker on doc conflicts.
- [`MIGRATION-TITLES.md`](MIGRATION-TITLES.md) - the review table from the migration: every original statement excerpt beside the title written for it.
- [`../../CONTEXT.md`](../../CONTEXT.md) - the glossary of domain terms.
- [`../26-glossary-and-id-index.md`](../26-glossary-and-id-index.md) - the docs-side glossary and the index of every id system in the repo.
