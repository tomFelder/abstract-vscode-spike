# 21 - Beta v1.0 prioritisation: the journeys, the aha moments, and the real-folder reality

Decided in the founder planning session of 12 Jul 2026. This document answers three questions in one
place: **which journeys and aha moments the beta v1.0 must build**, **where the new file-interop and
folder-organisation work sits** (docx/PDF/xlsx in and out, meaningful subfolders - specified in
[22-file-interop-and-project-layout.md](22-file-interop-and-project-layout.md)), and **what real
users are likely to break** when they open their own folders. It builds on the beta gate
([18-beta-plan.md](18-beta-plan.md)), the aha-path specs ([20-journey-specs-aha-path.md](20-journey-specs-aha-path.md)),
and the journey-walk verdicts ([plans/34-verify/journey-grades.md](plans/34-verify/journey-grades.md)
→ [plans/37-journey-robustness-loop.md](plans/37-journey-robustness-loop.md)).

Each priority tier below is tracked as GitHub issues; the issue map is in §7.

## 1. The gate, restated

> **A stranger can bring a real folder and hit the aha (T4: first approved agent change on their own
> file) without Tom in the room.** ([18](18-beta-plan.md) §1)

The journey walk (plan 34, 9-10 Jul) grades the app against that sentence: of 26 journeys, **7
WALKABLE · 8 FRAGILE · 2 PARTIAL · 9 MISSING**, one severity-1 (X1: approved work lost on reload in
the web build; desktop persists correctly). Gate check: **1 of 5 requirements met** (R1 the walk
itself). The aha is currently not **reachable** (no Project Home landing, no onboarding), not
**observable** (analytics not wired), and not **survivable** on web (X1).

**What §5 of this document changes:** doc 18 §3 deferred migration tooling ("the founder personally
converts each early user's folder"). That stance is revised - the walk plus the cohort reality
(everyone arrives with docx/PDF/xlsx) makes a *minimal* import/export floor part of the beta, not a
fast-follow. The full interop spec is doc 22.

## 2. The journeys the beta must build

The aha path is the priority subset specified with acceptance criteria in
[doc 20](20-journey-specs-aha-path.md). Status from the walk:

| Journey | Job in one line | Grade | What beta v1.0 builds |
|---|---|---|---|
| **1a** Open a project | "Folder of real documents → working in one click" | FRAGILE | Hierarchy preserved (F7), filename fallback (F8), SOURCES section for non-md (F9), docx/PDF visible not skipped (F10 → import, doc 22) |
| **1b** Create a document | "Born with structure, bindings, skills" | FRAGILE | Name kept for blank docs (F3), no prompt-leak (F4), "From sources…" third birth (F17) |
| **1c** Switch projects | "Five projects, one glance" | WALKABLE | Nothing - hold the line |
| **1d** Organise files | "Rename, move, tidy - nothing snaps" | MISSING | Minimal v1: context menu, D6 warn-and-orphan delete, atomic lock-follows-file (F16). Prerequisite for folder conventions (doc 22 §5) |
| **1w** Project Home | "Open and know in 5 seconds what needs me" | MISSING | Minimal v1: land on Home, while-you-were-away, all-clear, whole-project composer, empty-folder front door (F15) |
| **1x** Template from examples | "Learn the pattern from six past docs" | MISSING | Minimal v1: 3-10 docs → named commonalities → skill.md → joins ＋ New (F18) |
| **1e** Chat-rail iterate | THE foundational loop - talk to the doc, see the diff | FRAGILE | **X1 persistence contract on web (F1)**, kill the stock Copilot chat tab (F2/X4) |
| **1f** Judge a proposal | "Decide in 5 seconds; edit, don't just veto" | FRAGILE | Kill the fabricated "85% confidence" (F5) |
| **1g** Autonomy dial | "What may the agent do without asking" | FRAGILE | Three-position dial in the doc header, reusing the Agents policy control (F11) |
| **1h** Undo / history | "Get me back" - highest-leverage journey | FRAGILE | X1 (F1), Cmd+Z across approves (F6), History rehydrates from the on-disk lock (F19) |
| **1p** Provenance peek | The wedge: hover a number, see its source | WALKABLE | Hover peek + "then vs now", freshness consistency (F12/F13) |
| **D26** Onboarding | Two wows, ten minutes, no setup | MISSING | The T5 funnel: demo CSV → report → peek → one diff → approve → "bring a real folder" (plan 38) |
| **1s** Watch/cancel/recover | (off aha path, lifted forward) | FRAGILE | **F14: a model outage must never render as "no changes proposed"** - named error, failed-doc list, surgical retry |

Everything else (1i-1v, 1y-1z, 2b/2c) needs a **floor, not a ceiling**: it may be thin, but it must
not dead-end without explanation ([18](18-beta-plan.md) §2.3). Two floor items are promoted by the
interop decision: **1u export** (docx/PDF unstubbed, doc 22 §3) and **2b first-run orientation**
(the "I read your folder - here's what I found" moment, which the import flow naturally carries).

## 3. The aha moments

Two kinds, deliberately distinct:

**The onboarding wows (T5, seeded data - proves the magic in 10 minutes):**
1. **The provenance peek** (1p): hover a figure in the demo report → source, cell, freshness.
   "X-ray vision." Demos in 5 seconds.
2. **The single inline diff** (1e): one prompted iteration → red/green streams into the exact
   paragraph, proposal card in the document, approve → receipt in the gutter.

**The aha itself (T4, their data):** the first approved agent change **on the user's own file** -
which is only reachable if 1a survives their real folder (hierarchy, titles, sources, docx visible
→ importable) and only meaningful if it **survives a reload** (X1).

**The four killer flows** ([14](14-product-strategy.md) §3) stay the horizon - the morning all-clear
(HABIT), transcript fan-out (DEMO), provenance peek (TRUST), thinking session (JOY). Beta v1.0
builds the trust flow fully, the habit flow's floor (1w), the demo flow's honesty (F14), and ships
the joy flow as the default skills pack ([18](18-beta-plan.md) §2.6).

## 4. The priority order

**P0 - the gate (a stranger hits the aha and it survives):**
1. **F1 + F19** - the X1 persistence contract on web + History rehydration from the lock. The one
   severity-1. (plan 37 tier 0)
2. **F2-F13** - the twelve cheap aha-path off-path fixes (Copilot tab, blank-doc name, prompt leak,
   fake 85%, Cmd+Z, hierarchy, Untitled, SOURCES, docx visibility, dial, freshness, hover peek).
   (plan 37 tier 1)
3. **F14** - the silent-model-outage trust breach on fan-out. (plan 37 tier 2)
4. **F15-F18** - minimal v1 of the four MISSING aha surfaces: Project Home, file ops, "From
   sources…", template wizard. (plan 37 tiers 3)
5. **Model access completed** - issue #120 (ChatGPT-subscription call fails after sign-in) plus the
   capped OpenRouter fallback proven end-to-end. (plan 35)
6. **Analytics** - consent, event dictionary, T5 funnel, guardrails; the aha must be observable.
   (plan 36)
7. **D26 onboarding + survey + feedback verb.** (plan 38)
8. **T1 editor audit** - paste-from-Word/tables/images; a disqualifier check, run pre-beta; paste
   fidelity findings gate, polish doesn't. ([18](18-beta-plan.md) §3)

**P1 - the real-folder reality (the revised stance, spec in doc 22):**
9. **docx → Markdown import** - per-file "Import" on the F10 "not yet imported" affordance;
   originals preserved; images extracted. The cohort lives in Word; a folder of docx that can only
   be *looked at* fails the gate sentence in spirit.
10. **docx + PDF export** - unstub the two "SOON" rows that the audience actually needs (work goes
    out to Word-speaking organisations; [14](14-product-strategy.md) §1). HTML/Markdown stay.
11. **xlsx as a source** - extract sheets to CSV under `data/`, keep the workbook watched, bindings
    point at the extraction. CSV is the canonical tabular format; **not** a database. (doc 22 §4)
12. **PDF as a read-only source** - text extracted for context/knowledge, listed in SOURCES; never
    converted to an editable doc in beta.

**P2 - keeping the project clean (after F16 lands):**
13. **Folder conventions + the Tidy verb** - `data/` `archive/` `working-files/` as soft
    conventions; an agent verb that *proposes* moves through the review grammar, updating lock
    source paths atomically. (doc 22 §5)
14. **Real-folder hardening** - the §6 predictions turned into probes: cloud-sync conflict files,
    external edits while open, encodings/locales, legacy `.doc`, tracked changes.

**P3 - explicitly not beta (held from doc 18 §3):** scale beyond plan 30's 50-doc baseline,
scheduling depth, mobile approvals, org library, conflict UI, full audit chat, Google Docs/Sheets
round-trip, direct xlsx cell binding, editable PDF conversion.

## 5. The revised migration stance (recorded)

Doc 18 §3 deferred T2/T3 migration tooling in favour of founder-led conversion. **Revised 12 Jul
2026:** founder-led conversion remains the *cohort-1 onboarding motion* (it is still the research),
but the product ships the P1 floor because:

- The walk proved silent skipping is the current behaviour (walk 1a: docx/CSV/txt/png all absent) -
  invisible files are worse than unconverted files.
- The gate sentence says "without Tom in the room" - a folder that needs Tom to convert it first
  fails the sentence for cohort 2 onwards, and cohort-1 learnings should land *in the product* as
  they are made, not after.
- Export asymmetry breaks the output loop: the artifact must flow back into what the organisation
  runs on ([14](14-product-strategy.md) §1); Markdown-only export makes the beachhead user
  re-paste into Word by hand every week.

The *shape* of conversion (what fidelity issues matter, which docx constructs appear) is still
learned from founder-led sessions - which is why P1 ships the minimal floor in doc 22, not a
migration suite.

## 6. What real users will break: predictions to hold ourselves to

In the tradition of [04-risks-and-predictions.md](04-risks-and-predictions.md) - written down so we
can score them. When cohort 1 opens their own folders:

1. **Mixed messy folders** (certain): docx/PDF/xlsx everywhere, nested five deep, no naming scheme.
   Covered by F7-F10 + doc 22. The first-run "here's what I found" orientation (2b) is the natural
   home for "3 documents, 2 spreadsheets, 4 files I can import - want me to?".
2. **Cloud-synced folders** (near-certain): OneDrive/Dropbox/iCloud. Conflict copies
   ("`Report (conflicted copy)`"), files-on-demand placeholders that read as empty, sync racing our
   writes. Needs detection + plain-words handling, not corruption.
3. **External edits while open** (likely): the same file open in Word/Obsidian, or edited on
   another machine mid-session. Today raw writes bypass VS Code's dirty/conflict model
   ([04](04-risks-and-predictions.md)) - last-write-wins data loss. Floor: detect external change,
   offer reload/keep, never silently clobber.
4. **Paste from Word** (certain, disqualifier): smart quotes, tables, tracked-changes residue,
   images. This is exactly test T1.
5. **Excel realities** (certain for the wedge user): semicolon-delimited "CSV" from European Excel,
   Windows-1252 encoding, BOM, `$1,234.56` and `(430)` as numbers, dates in three formats, merged
   header cells, the number they want on sheet 3 behind a pivot. Doc 22 §4 sets the parsing floor.
6. **Conversion edge cases** (likely): legacy `.doc`, password-protected docx, docx with tracked
   changes/comments/footnotes. Each must name itself and degrade to the F10 "not yet imported -
   {reason}" state, never mangle silently.
7. **Lock-file confusion** (likely): `Doc.lock.json` visible in Finder/Explorer - users will delete
   it (fine - rebuildable by design, doc 08), email it, or ask what it is. Hide it in our tree,
   answer it in plain words when asked.
8. **Big folders** (eventual): the thousand-file Documents dump. Plan 30's baseline is 50 docs; the
   floor is an honest indexing state, never a hang ([18](18-beta-plan.md) §3 holds - full scale work
   is post-beta).
9. **Filename reality** (likely): unicode, emoji, `&`, 260-char Windows paths, `FINAL v2 (3).docx`.
10. **Model-access failure mid-session** (certain at some rate): #120, cap-hit, outage. The F14 /
    map-D15 grace standard is the answer; a silent failure here is a trust wound measured by the
    guardrails ([15](15-metrics-and-instrumentation.md) §2.4).
11. **Privacy flinch** (likely): "wait - did it just read my whole folder?" Plain-words scope chips
    (1e has them; fan-out must too) and the consent moment ([18](18-beta-plan.md) §2.2) carry this;
    the 1n context-inspector floor is the eventual answer.
12. **Two machines / a shared folder** (occasional): single-player is the chapter-1 stance
    ([14](14-product-strategy.md) §6) - say so in plain words when we detect it, don't corrupt.

## 7. Issue map

All tracked in GitHub (tomFelder/abstract-vscode-spike); the issue list is the operational view of
§4. Pre-existing: **#120** (model access, P0 item 5). Created 12 Jul 2026 alongside this document:
issues for F1+F19, F2-F13, F14, F15, F16, F17+F18, plan-38 onboarding, T1 audit, docx import,
docx/PDF export, xlsx-as-source + PDF-as-source, folder conventions + Tidy verb, and real-folder
hardening. Plans 35/36/37/38 remain the loop vehicles; the issues are the tracking layer the loops
close against.
