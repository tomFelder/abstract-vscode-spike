# 06 — Design notes (intent vs reality)

The visual target is the **"Agentic Workbench" Direction 01 — Workbench hi-fi** (Claude Design
project `d198ca07-9eef-4d05-96e1-b383e6c19c03`). The spike's shell does not yet match it. This doc
records the known UI/UX gaps and Tom's specific design intent so the next pass can act on them. All
of these are wired into [plans/02-studio-de-ide-handoff.md](plans/02-studio-de-ide-handoff.md).

---

## D1 — Provenance gutter redesign (detach the dots from the prose)

### Problem (today)
The colored provenance dots render **inline with the sentence**, which pushes the text in and reads
as document indentation. They look like part of the body, not metadata about it.

### Intent (Tom's spec)
The dots/markers belong in a **true left gutter**, well left of the document column, visually
**detached** from the body — so the prose column is never shifted by them.

Add a **line-numbered gutter**, with these rules:
- Each **document line** gets a number in the gutter.
- A line that **wraps** across 2-3 visual rows does **NOT** increment the number — the wrapped
  continuation rows show a **blank gap**; the number only advances on a real new line.
- A **dot** appears in the gutter beside a **bound / edited** line.
- If an edit spans a **multi-line paragraph**, the marker **blends into a vertical bar** spanning
  those gutter rows (indicating the change touches several lines) — rather than a single dot.
- **Hover** a gutter marker still **pulls up** the provenance (reveal source / detail), as today.

### Sketch
```
 gutter        document column
 ┌────┐
 │ 1 ●│  Revenue grew 18% week-on-week to $48.6k MRR, on 427     <- bound line: dot in gutter
 │    │  new signups. Churn eased to 2.4%.                        <- wrapped: blank gutter, no number
 │ 2  │  Growth remained steady this week.                        <- plain line: number only
 │ 3 ┃│  A multi-line commentary paragraph whose edit            <- multi-line edit: bar, not dot
 │   ┃│  spans several wrapped rows, so the marker becomes
 │   ┃│  a vertical bar across the affected gutter rows.
 └────┘
```

### Notes
This is **our own webview surface** (low risk, no core patch). The detached gutter also moves us
closer to the "document, not code" feel — but note the line-number gutter is itself a slightly
code-editor metaphor; check against the hi-fi whether numbers or a subtler marker rail is wanted.

---

## D2 — Header / document-title area looks "funky"

Tom reports "something super funky going on with the header and how we're displaying the
documents." The current `livingDocRender` top bar (brand row + crumb + status pill + toggle /
export / refresh buttons) and the document title block were assembled pragmatically, not to spec.

**Action:** review the header, the document title block, and how the document is seated in the
editor area **against the Workbench hi-fi** and correct the discrepancies. Wired into ITEM C of the
next plan.

---

## D3 — The calm shell: "calm by subtraction" vs "calm by construction"

The Studio skin (item 5) hides IDE chrome via settings — **calm by subtraction**. It gets ~80% of
the way and is reversible, but it leaves the IDE's *interaction grammar* underneath (panes, groups,
view containers, palette, drag-to-split). The design intent is **calm by construction**: a shell
that was built to be a word processor.

Tom's explicit guidance for how to approach the shell:
- **Far less flexibility, less UI information, less customization** than VS Code exposes.
- **No** draggable panes/panels, **no** split editors, **no** "reopen editor with," **no** command
  palette surfaced to the user.
- The reference points are **Microsoft Word, Google Docs, Notion** — light-touch, gentle, opinionated.
- "Currently this editor feels far too customizable, like the VS Code product, than what I'd like."

The next pass should therefore **remove optionality**, not just hide chrome — and where removing it
requires fighting core, log that as evidence toward greenfield (see [05](05-open-questions.md) Q3).

---

## D4 — The document surface is the part that already works

Worth stating positively: because the document is rendered in our own webview, the **document
itself** already reads like a word processor. The gap is entirely the surrounding shell (left rail =
file tree, view-pane chrome, header, group/close affordances). The next pass should bring the
*surrounding* shell up to the document's level — and pixel-align the document + review rail to the
hi-fi (ITEM D of the next plan).
