---
number: 60
status: "**Settled (plan 18 iter 1).** To build."
provenance: "plan 18, D-A"
source: docs/07-decision-log.md
---

# A working set is not a source

**A working set is a separate concept from sources**

Sources (the `@`-chips) are *data bindings* (csv/api) the doc reads from; a working set is *the documents an instruction should edit*. Overloading the source chips would conflate "read from" and "edit", and a folder chip would be ambiguous. The composer gets a distinct "Add documents…/Add folder…" affordance yielding edit-target doc chips on their own row; sources stay where they are.
