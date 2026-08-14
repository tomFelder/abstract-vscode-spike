# 28 - The Abstract design system, round 2

Status: **in force**. Ratified 14 Aug 2026 from the round-2 comp (`docs/design/abstract-redesign/Abstract Redesign Screens.dc.html`).

This document is the rubric for the round-2 repaint. Round 1 (plans 43-49) built the *structure* of the eight screens; round 2 fixes the *system* they are drawn in. The comp's own DS sheet is the source of truth, and `src/vs/workbench/contrib/livingDocs/common/abstractTokens.ts` is that sheet transcribed into code. Nothing below is a suggestion: a colour, size, or radius that is not on this page is a defect.

## The one rule

**Every hue has exactly one meaning.** If you cannot say in four words what a colour means, it is the wrong colour.

| Hue | Means | Never |
|---|---|---|
| Indigo `#4353C9` | Abstract acting | - |
| Green `#1F7A4D` | Applied / fresh / all clear | a button fill |
| Amber `#C77E1F` | Waiting on you | decoration |
| Red `#B3261E` | Removed / failed | decoration |
| Warm neutrals | The paper | to carry meaning |

Two corollaries the comp states outright:

- **A highlight fill only ever means "this span is changing."** Diff spans and WAS/NOW blocks are the only places a fill sits behind running text. Document body reads like paper, never highlighted at rest.
- **There is no permanent status pill.** State appears when it needs you, in one place: the banner. The banner *is* the status.

## Colour

Read the exact values from `abstractTokens.ts`. The ramps:

- **Indigo** - `base #4353C9` · `hover #333FA3` · `tint #EEEFFA` · `tintBorder #C8CBE8` · `underline #B4B9E8` · `onDark #8F94D9`
- **Green** - `base #1F7A4D` · `bg #F0F6F1` · `border #CFE3D4` · `headline #164A31` · `body #4E7059` · `diffBg #E4F2E7` · `diffInk #175B38` · `blockBg #EFF7F1`
- **Amber** - `base #C77E1F` · `bg #FDF6EC` · `border #EAD9BC` · `subtleBg #FDF8EF` · `label #8A5A12` · `headline #6E4A10` · `body #8A6A33` · `hairline #F5F0E4` · `edge #F0E4CC` · `askFirst #B45309`
- **Red** - `base #B3261E` · `diffBg #FBE9E7` · `diffInk #A13527` · `blockBg #FBF1F0` · `blockInk #7C2D22`
- **Paper** (nests outward-in) - `canvas #E4E2DC` → `frame #EFEEE9` → `rail #F9F8F5` → `page #FCFBF9` → `card #FFFFFF`; plus `sunken #F6F5F1` / `sunkenBorder #E9E7E0`, `chip #F1F0EB`, `frameBorder #CFCDC4`, `control #DEDCD5`
- **Hairlines** - `strong #E3E1DA` (between surfaces) · `medium #ECEAE3` (between rows) · `soft #F1F0EB` (within a row)
- **Ink** - `heading #1B1B20` · `body #33322E` · `bodySoft #55534C` · `secondary #6E6C64` · `meta #9B998F` · `onDark #B8B6AE`

The product previously used a **cool blue-grey** neutral ramp. Round 2 is a **warm paper** ramp. This is the single largest visible change, and it is why almost every hex in the renderers moves.

## Type

Two families, two weights. Sans is the system stack; mono is **IBM Plex Mono** (round 1 used JetBrains Mono - it is gone). Weights are **400 and 600 only**; there is no 500.

| Token | Step | Used for |
|---|---|---|
| `greeting` | 34 / 600 / -0.015em | Home greeting |
| `screenTitle` | 28 / 600 / -0.01em | Knowledge, Templates, Agent detail |
| `docHeading` | 21 / 600 | `h3` inside a document |
| `dialogTitle` | 19 / 600 | the New-document sheet and its siblings |
| `bannerHeadline` | 18 / 600 | the state banner, in a state ink |
| `docBody` | 16 / 400 / 1.65 | the paragraph the user is judging |
| `cardTitle` | 15.5 / 600 | a document tile, a template card |
| `cardValue` | 15 / 600 | the answer inside an agent question card |
| `field` | 14.5 / 400 | input values, table cells, source names |
| `rowTitle` | 14 / 600 | a picker row, a birth option |
| `bannerBody` | 14 / 400 / 1.6 | the sentence under a state headline |
| `uiBody` / `uiBodyStrong` | 13.5 / 400 · 600 | buttons, rows, rail text |
| `bodySmall` | 13 / 400 / 1.55 | card descriptions, helper paragraphs |
| `secondary` | 12.5 / 400 | receipts, captions, helper lines |
| `meta` | 12 / 400 | provenance prose, confidence, counts |
| `sectionLabel` | mono 11 / 0.14em | `DOCUMENTS · NEEDS YOU FIRST` |
| `kindBadge` | mono 10.5 / 0.1em | `MEANING · NEEDS YOUR CALL`, `FIGURE` |
| `provenance` | mono 12 | `metrics.csv · week 25 · synced 15 min ago` |
| `provenanceInline` | mono 11.5 | the same facts inside running prose |
| `tableHeader` | mono 10 / 0.12em | `SOURCE · KIND · SYNCED · FEEDS · FIGURES` |

The ladder is dense because the comp is dense, and **the comp's own pixel value wins**. Rounding a comp value onto a coarser step is how a redesign quietly loses its proportions: if a panel says 15.5, use `cardTitle`, not `uiBodyStrong`.

**Mono is reserved** for section labels, kind badges, and provenance facts (file names, cells, synced-when, line numbers, version chips). Never for metadata values or model ids.

**Sentence case everywhere, including buttons.** "Approve all…", not "Approve All". Title-case UI labels are a round-1 artefact and are defects now.

## Shape and space

- **Radii** - 8 controls · 10 inputs · 12-14 cards · 999 pills and dots
- **Spacing** - the 4px scale, no exceptions
- **Stroke** - one 1px hairline, in the three weights above
- **Shadows** - `frame 0 2px 12px rgba(27,27,32,.08)` · `card 0 1px 5px rgba(27,27,32,.08)` · `dialog 0 12px 40px rgba(27,27,32,.28)` · `tooltip 0 8px 24px rgba(27,27,32,.3)` · `drawer 0 -6px 24px rgba(27,27,32,.07)`

## Components

- **Buttons** - one indigo primary; secondary is a `#DEDCD5` hairline on white; a destructive-ish bulk verb renders **quiet (text)** plus a confirm dialog. Never green or red buttons.
- **State** - a dot plus a sentence, in one place. Banner dot 11px, card/row dot 7px, source dot 6px.
- **Kind badges** - mono, coloured by risk. Confidence is a **word** in the meta line ("confidence: high"), never a percentage. Kind also paints the card's 3px left edge.
- **Diff** - word-grain spans up to ~60% of the paragraph rewritten; WAS/NOW blocks past that.
- **Bound figure** - an indigo *underline*, never a fill: `text-decoration-color #B4B9E8`, `text-underline-offset 3px`, `text-decoration-thickness 2px`. Hover shows the peek; click opens the drawer. The `from … · synced …` line is one reusable atom on every card.
- **Receipt row** - time (mono) → what happened (plain words) → state dot. Used in History, agent runs, and Home's while-you-were-away.

## The migration map

The bulk of the repaint is mechanical: the round-1 palette maps onto the round-2 ramps. Apply this map, then fix by meaning anything it does not cover.

### Ink

| Round 1 | Round 2 |
|---|---|
| `#a3a8b2` `#969ba4` `#9aa0aa` `#9a9ea7` `#9a9aa3` `#8a8f98` `#8a8f99` `#9aa0ac` `#8a8a93` `#86868f` `#b0b5be` `#b0b4bc` `#a9aeb8` | `INK.meta #9B998F` |
| `#868b95` `#696e78` `#71767f` `#6a6a73` `#61656c` `#5b616b` `#6b7280` | `INK.secondary #6E6C64` |
| `#52575f` `#4a4f57` `#4a4c54` | `INK.bodySoft #55534C` |
| `#3a3f49` `#3a3f4a` `#33373f` `#3c4250` `#46464e` `#34343c` | `INK.body #33322E` |
| `#1a1c20` `#15171c` `#26292f` `#2c2f36` `#14161a` `#2a2a31` `#15151a` `#15181f` `#23262c` `#23242a` `#2a2c32` `#26262d` `#2a2a31` `#101214` | `INK.heading #1B1B20` |
| `#1f2229` (tooltip surface) | `DARK_SURFACE #1B1B20` |
| `#b7bcc6` (ink on tooltip) | `INK.onDark #B8B6AE` |

### Paper and hairlines

| Round 1 | Round 2 |
|---|---|
| `#edeff3` `#f3f4f7` | `PAPER.frame #EFEEE9` |
| `#f8f9fb` `#fbfbfc` `#fafbfc` `#f7f8fa` `#f7f8fb` `#f7f7f9` | `PAPER.rail #F9F8F5` |
| `#fbfcfd` `#fcfcfd` | `PAPER.page #FCFBF9` |
| `#f4f5f7` `#f6f7f9` `#f4f4f6` `#f4f5f8` `#f3f3f5` `#f2f3f5` `#f0f0f3` `#f0f1f4` | `PAPER.sunken #F6F5F1` |
| `#f1f2f5` `#f1f2f6` `#ececf0` `#ecedf1` `#edeef1` | `PAPER.chip #F1F0EB` |
| `#e9eaee` `#e6e8ec` `#e6e8ed` `#e4e6ea` `#e4e6eb` `#e4e6ec` `#e6e6ea` `#e1e2e8` `#e2e4ea` `#e0e3ea` `#e1e4ea` `#e4e7ee` `#e3e7ef` `#dfe2e8` `#dfe1e6` `#dcdfe6` `#d9dae0` | `HAIRLINE.strong #E3E1DA` |
| `#eceef2` `#eceef3` `#eef0f3` `#eef1f6` | `HAIRLINE.medium #ECEAE3` |
| `#e0e2e8` `#dfe1e7` `#d4d7dd` `#d5d8de` `#d3d8e0` `#d3d6dd` `#d4d7de` `#d7dae2` `#d7d9df` | `PAPER.control #DEDCD5` |
| `#c6cad2` `#bcc0c8` `#cfd3da` `#cdd1d8` `#c2c8d4` `#c2c5cd` `#c2c6ce` `#cdd2dc` `#dde0e7` | `PAPER.frameBorder #CFCDC4` |

### Indigo

| Round 1 | Round 2 |
|---|---|
| `oklch(0.55 0.13 255)` `#5b6dc4` `#5661c9` `#2c5be5` `#2b64d4` `#2a6fdb` | `INDIGO.base #4353C9` |
| `oklch(0.5 0.13 255)` `oklch(0.45 0.13 255)` `#4650b8` `#4e5fb2` `#2a2f60` | `INDIGO.hover #333FA3` |
| `#f4f5fd` `#eef1ff` `#f7f8ff` `#f7f9ff` `#fbfcff` `#f4f6ff` `#eef2fb` `#eef0fb` `#eaf0fa` `#eaf1fd` | `INDIGO.tint #EEEFFA` |
| `#e0e5fb` `#e0e6ff` `#e4e9fb` `#e7eafa` `#e2e8ff` `#d8e0fb` `#d9d7fb` `#c9cff5` `#c3c9f0` | `INDIGO.tintBorder #C8CBE8` |
| `#9aa2e0` `#8a93c4` `#9aa0d0` | `INDIGO.underline #B4B9E8` |
| `#3b4d8f` | `AVATAR_NAVY #23408F` |

### Green

| Round 1 | Round 2 |
|---|---|
| `#2c8159` `#1f7a44` `#1f7a43` `#1f8a5b` `#2f7d55` `#3e9c6b` `#217346` `oklch(0.6 0.13 150)` `oklch(0.55 0.14 150)` `oklch(0.5 0.13 150)` | `GREEN.base #1F7A4D` |
| `#eef7f0` `#e7f3ec` `#eaf3ee` `#e7f5ee` `#f1f8f3` | `GREEN.bg #F0F6F1` |
| `#d7ecdc` `#d3e5da` `#c5e7d0` `#e0ebe3` | `GREEN.border #CFE3D4` |
| `#e9f6ee` `#e7f6ec` | `GREEN.diffBg #E4F2E7` |
| `#f1faf4` | `GREEN.blockBg #EFF7F1` |
| `#1f5a36` `#5d8a66` | `GREEN.diffInk #175B38` |

### Amber

| Round 1 | Round 2 |
|---|---|
| `#c99a2e` `#e0a63a` `#e0b341` `#d9a62b` `oklch(0.66 0.16 45)` `oklch(0.78 0.1 70)` | `AMBER.base #C77E1F` |
| `#9a6b16` `#8a6d1a` `#7a5a13` | `AMBER.label #8A5A12` |
| `#fdf6e9` `#fdf2dc` `#fbf5e8` `#fef0d6` `#f9edd5` `oklch(0.985 0.02 75)` `oklch(0.97 0.04 75)` `oklch(0.97 0.03 70)` | `AMBER.bg #FDF6EC` |
| `#e4dccb` `#f0e2c4` `#e6dcc2` `#e6c98f` `#d9b76a` `#d9b98e` `#f0d9a8` `#f0dcae` `#f0e5cf` `oklch(0.9 0.05 75)` | `AMBER.border #EAD9BC` |
| `#fdfaf2` `#fbf7ee` `#fffaf1` `#fffdf8` | `AMBER.subtleBg #FDF8EF` |
| `#f0b968` | `AMBER.base #C77E1F` |

### Red

| Round 1 | Round 2 |
|---|---|
| `#b4332f` `oklch(0.55 0.2 25)` | `RED.base #B3261E` |
| `#b5514b` `#cf5a53` `#8a4340` `#8a2f2b` `#7a3a38` `#8a6d6b` | `RED.diffInk #A13527` |
| `#fbeeee` `#fdecec` `#fdf2f2` `#fdf2f1` `#fdf1f0` `#fdeeed` `#faf7f7` | `RED.diffBg #FBE9E7` |
| `#f3c9c6` `#e7c9c6` `#ecc9c6` `#eeced0` `#f0e0e0` `#f0d3d1` `#d98a8a` `#d7a3a0` | `RED.diffInk #A13527` at 1px, or `RED.blockBg #FBF1F0` as a fill |

### Do not touch

`&#128206;` `&#128196;` `&#127970;` and friends are **HTML entities for emoji**, not colours. A naive `#hex` sed will corrupt them. Every replacement must be anchored so it cannot match a character reference.

## Screen-level corrections

Beyond the repaint, the comp calls out a specific correction per screen. Each is stated in the comp itself, on the caption line above the panel:

| Panel | Correction |
|---|---|
| 1a/1b Home | receipts, **one** state banner, demo demoted to a card; the amber banner *becomes* the queue |
| 2a Editor | one canonical decision point; the rail narrates and points; no bulk verbs at n=1 |
| 2b Editor | bulk verbs earn their place at 2+; the rail becomes a ledger; the document stays readable |
| 3a Agent detail | three questions instead of a pipeline: when it runs · what it may touch · what it may do without asking |
| 4a Knowledge | user units ("feeds N figures"), consistent freshness words, no template tokens |
| 4b Templates | outcome copy instead of "1 slot · 0 sources"; a grow-from-examples on-ramp; no rainbow avatars |
| 4c New document | name-first birth, three births, outcome copy on templates, Enter creates blank |
| 4d Provenance | the wedge: click a figure, land on its exact cell; freshness words identical everywhere |

## How "pixel perfect" is judged

A surface passes when, against its comp panel:

1. Every colour is a token from `abstractTokens.ts` - no literal hex in a renderer.
2. Every type step is on the ladder above; no JetBrains Mono, no weight 500.
3. Radii, hairline weights, and the 4px spacing scale hold.
4. The copy matches the comp's words, in sentence case.
5. The screenshot and the comp panel agree at a glance, and survive a side-by-side look at the details.
