# Plan 20 — Abstract UI Redesign: Design Implementation Handoff (spec of record)

> **This is the master spec** for the Abstract UI Redesign work. Plans 21-25 are the
> executable loop-plans that implement it, row by row, as stacked PRs off `main`.
>
> **Companion pixels:** `Abstract - UI Redesign.dc.html` in the claude.ai/design project
> `d198ca07-9eef-4d05-96e1-b383e6c19c03`. Pull it with the `DesignSync` MCP
> (`method:get_file`, that projectId, path `Abstract - UI Redesign.dc.html`) for pixel
> comparison during the design-match loop. **When this doc and the pixels disagree, this doc
> wins** - fix the pixels.
>
> **Build/verify mechanics** (unchanged from plans 18-19): `npm run watch` +
> `./scripts/code-web.sh ./living-docs-sample/brief` (http://localhost:8080) driven by the
> chrome-devtools MCP (it reaches inside the webview iframe; let the service worker register,
> no `ignoreCache` reloads); OpenRouter proxy on :8090 for the model. `typecheck-client` +
> `valid-layers-check` must stay clean. Any core patch is minimal and logged in
> `docs/plans/03-merge-tax-ledger.md` + `docs/07-decision-log.md`.

---

*One document for the engineering team: the product intent, the exact design specs, and the code changes to make them real. Chosen document identity: **4b Clean (sans)**.*

Companion pixels: **`Abstract - UI Redesign.dc.html`**. When this doc and the pixels disagree, **this doc wins** — fix the pixels.

---

# Part A — Product context (the why)

**What Abstract is.** A document tool where the documents stay current by themselves. You bind a document to real sources (CSV, brief, live API, transcript, other docs); an agent keeps it up to date by proposing changes you can see, trust, and approve; and every AI-touched fact traces back to exactly where it came from. Substrate: a fork of VS Code you should never feel — a real **ProseMirror** editor inside a shell stripped to a calm document app. Format: clean `<doc>.md` + generated `<doc>.lock.json` (binding + dependency graph). **The unit of work is the project — which is just a folder.**

**Who it's for.** A competent knowledge worker who already lives in documents — PM, product lead, consultant, analyst, ops owner. *Not* the AI-nervous first-timer. We raised the floor on purpose and accept that it drops the most novice segment. The bar: *someone good with documents feels powerful on day one, and the whole team can adopt it.* Floor = open a project, see what needs you, act with one obvious step. Ceiling = multi-source binding, project-wide agent runs, full audit.

**The five principles** (use these to resolve any ambiguity):
1. **Calm by construction** — Word/Docs/Notion, not an IDE with the chrome hidden. Remove *optionality* (no palette, no resizable panes, no split editors), not just chrome.
2. **The project is the unit** — a folder of documents that move together; editing *across* a project is the strength.
3. **Provenance is the moat** — every AI-touched fact traces to its source.
4. **Propose, don't auto-apply** — figures may auto-apply (reversible); meaning changes always wait.
5. **Calm by default, powerful on demand** — every power feature has a plain-language front door and a pro back door.

**Business framing.** The defensible wedge is *trustworthy automated editing of documents you're accountable for* — recurring, source-linked reports and policy sets (the canonical hard case: a consultant maintaining a 24-doc ISMS from meeting transcripts). Adoption is gated by trust, not by generation quality; the design spends its budget on making changes legible and reversible.

> Full narrative lives in `Abstract - Product & Design Brief.md`. Part A here is the condensed version so this handoff stands alone.

---

# Part B — Design system (exact tokens)

### Color
Copy these verbatim. Accent is expressed in `oklch` (matches the existing theme) with a hex fallback.

| Token | Value | Use |
|---|---|---|
| `accent` | `oklch(0.55 0.13 255)` ≈ `#5B6DC4` | primary actions, active nav, **and** bound/source marks |
| `accent-hover` | `oklch(0.47 0.13 255)` ≈ `#4650B8` | hover/pressed, bound-figure text |
| `accent-ink` | `#2A2F60` | text on accent tint |
| `accent-tint` | `#F4F5FD` / border `#E0E5FB` | selected rows, chips, source pills |
| `paper` | `#FFFFFF` | document + cards |
| `rail` | `#FAFBFC` | tree-rail, right rail |
| `panel` | `#F6F7F9` | icon-nav, toolbars, tool-call blocks |
| `canvas` | `#F8F9FB` | home background |
| `line` | `#E6E8EC` / `#E9EAEE` | borders |
| `hairline` | `#EEF0F3` | inner dividers |
| `faint` | `#A3A8B2` | metadata, placeholders |
| `muted` | `#868B95` | secondary labels |
| `slate` | `#52575F` | secondary text, quiet buttons |
| `body` | `#26292F` | document body text |
| `ink` | `#1A1C20` | UI headings |
| `display` | `#14161A` | document titles |
| `ok` (synced/added) | `oklch(0.6 0.13 150)` ≈ `#2C8159`; bg `#EEF7F0`; border `#D7ECDC`; label `#5D8A66` | applied figure, "synced", additions |
| `attention` (inferred/approve) | `oklch(0.66 0.16 45)` ≈ `#C99A2E`; ink `#8A6D1A`; bg `#FDFAF2`; border `#E4DCCB` | meaning-change, "needs your eyes" |
| `removed` | `oklch(0.58 0.17 25)` ≈ `#CF5A53`; ink `#B5514B`; bg `#FBEEEE` | deletions |

**Rule:** color is reserved for meaning (change / source / confidence / status). Never decorative. One accent hue does triple duty (action + source + bound) — do not introduce a competing accent.

Project avatars (2-letter, `#FFF` text): blue `oklch(0.55 0.13 255)` · navy `#3B4D8F` · teal `#0E7C66` · purple `#5A3EA8` · amber `#B5642A`.

### Type — **4b Clean (sans document)**
The document body is a **sans** (chosen over the serif 4a). Three roles:

| Role | Family | Size / line-height / weight | Notes |
|---|---|---|---|
| Document title (H1) | UI sans | 30px / 1.12 / 600, `-0.02em` | reading column |
| Document H2 | UI sans | 16px / 1.3 / 600 | section headings |
| Document body | UI sans | 15.5–16px / 1.7 / 400 | reading column **max 720px** |
| UI (buttons/tabs/labels) | UI sans | 12.5–14px / 1 / 500–600 | chrome |
| Metadata | mono | 10.5–13px / 1 / 400–600, labels UPPER `.1–.12em` | bindings, counts, timestamps, section labels |

**Font choice.** UI sans = a crisp neutral grotesk. Recommended: a loaded face (the mock uses *Instrument Sans*); `system-ui` remains an acceptable fallback and is the lowest-risk shipping choice — the ramp above is what matters, not the specific face. Mono = keep **JetBrains Mono** (current) or move to IBM Plex Mono; either is fine. No serif is required anywhere now that 4b is chosen.

### Space · radius · elevation
- **Space:** 4px base — 4 / 8 / 12 / 16 / 24 / 40 / 64.
- **Radius:** controls 8–9px · cards 13–14px · frames/modals 16px · pills 999px.
- **Elevation:** e1 card `0 1px 2px rgba(20,22,28,.05)` · e2 lifted `0 24px 50px -28px rgba(20,22,28,.34)` · drawer `0 -16px 40px rgba(20,22,28,.14)` · popover `0 22px 48px -20px rgba(20,22,28,.4)`.
- **Motion:** 150ms ease for hover/press; the "live/pending" pulse is opacity 1↔.35 over 2.4s; the working spinner 0.8s linear.

---

# Part C — Per-surface specs (px-exact, mapped to code)

### C1 · The shell
| Region | Size | Contents | Code surface |
|---|---|---|---|
| **Header** | height **48px**, bg `rail`, border-bottom `line` | left: 20px accent logo + `Project` crumb + doc title (`muted`); right: synced pill · quiet `↻ Refresh` · `↗ Present` · 27px avatar. **One row only.** | `livingDocRender` top bar |
| **Icon-nav** | width **76px**, bg `panel` | 60px-wide items, 18px stroke glyph + 10px label: Home · Editor · Templates · Knowledge · Agents; account + settings pinned bottom. Active = white chip, `accent-hover` glyph, e1. | activity-bar / nav |
| **Tree-rail** | width **264px**, bg `rail`, 38px tab strip | tabs **Files · Context · Outline**; folder → docs (status dot + name + change-count; living docs carry an `LWD` chip) → `SOURCES` group. | tree-rail `ViewPane` |
| **Editor** | fill | 44px pared toolbar + document | `livingDocRender` / PM |
| **Right rail** | width **392px**, bg `rail`, 44px tab strip | tabs **Chat · Review · History** (Review carries a count badge). | right-rail contribution |

### C2 · The editor (the heart)
- **Toolbar (44px):** `Heading ▾` · divider · **B** · *I* · divider · • list · 1. ordered · ❝ quote · (right) quiet `✦ Ask AI` + `● Saved · v14`. **No underline** (not in Markdown). Wire through `LWDPM.cmd(view, name)`.
- **Reading column:** max **720px**, centered in the editor pane, with a **30px gutter** to its left (`flex:none`).
- **Provenance gutter (30px):** a **9px dot** (centered) beside a bound line; a **3px vertical bar** spanning the rows of a multi-line edited paragraph. Colors: bound = `accent`; pending/edited = `attention`. **No line numbers.** Hover a marker → source-peek.
- **Bound figure:** inline non-editable atom, text `accent-hover` (`#4650B8`), `border-bottom: 2px dotted` at ~40% accent (`#9AA2E0`). Round-trips to `[label](bind:key)`.
- **Inline proposal (meaning change):** rendered *in the document* as a word-diff — addition `bg #E9F6EE / #2C8159`, removal `bg #FBEEEE / strike #CF5A53` — with a widget beneath: an `attention` tag ("Meaning change · needs your call") + one-line rationale + **Approve** (accent) / **Reject** (ghost).
- **Source-peek drawer:** `position: fixed; left:0; right:0; bottom:0; height:52–54%; z-index:25;` border-top `line`, drawer shadow. Header = source chip + one-line context + **Sync to report** (accent, filled) + close. Body = the source (e.g. CSV) with the referenced row highlighted in `accent-tint`. **The document stays full-width; never open a second editor group.**

### C3 · Project home (the on-ramp)
Header + 76px nav + content on `canvas`. Greeting (H1) + one summary line. **NEEDS YOU** = up to 2 prominent cards (accent top-border, pulse dot, primary Review button, `N TO APPROVE` amber chip). **ALL PROJECTS** = compact grid (avatar + name + health/approval badge + mono `N docs · M sources`). Empty state (no folder) = a single calm "Open a folder to begin." **The folder is the project.**

### C4 · Project-wide agent (the ceiling)
Header + command strip (avatar + the instruction in reading type + attached source chip + `Whole project`) + body: left = **decisions understood** (source-line → "N documents affected"); right = **sub-agent swarm** — a 4-col grid of 24 doc tiles, each `✓ N changes` (accent tint) / spinner `reviewing…` / `· no change` (muted) — with a progress bar. Bottom bar = `38 changes in 12 documents · 3 working · 9 unchanged` + **Review across the project →**.

### C5 · Cross-document review
Header + left **doc-nav rail** (292px: `12 docs · 38 changes`, progress bar, list with ✓ reviewed / ● current / ○ pending + counts) + center **review column** (doc title + per-change cards: the change in context, a source chip `decision · line NN`, a confidence chip `● High` / `◐ Inferred`, and **Accept / Tweak / Reject**) + a sticky doc action bar (`Accept all N here` · `Next: … →`). Batch-accept is legitimate here; each change still carries source + confidence.

### C6 · Right rail (Chat · Review · History)
- **Chat:** the run transcript — user bubble (accent tint) with `@mention` source chips; agent replies with a `panel` tool-call block (`✓ Read metrics.csv · 12 rows` in mono/`ok`), applied-figure pills (`ok`), and a meaning-change card (`attention`) with `Review →`. Composer at bottom: placeholder + **＋ Skill** + **@ Mention** + accent send. (Skills lives here now — see Part F.)
- **Review:** the pending changes for the active doc, grouped; strong empty state ("Nothing waiting — sources are in sync").
- **History:** human-labeled versions ("Monday's refresh"), each answering *what changed and why*.

---

# Part D — Implementation notes (the code changes)

Tiering follows your merge-tax discipline: **our-surface** = `livingDocs` contribution / `livingDocRender` webview / service; **core-patch** = shared workbench. Target stays *minimal & logged*.

1. **Header → one 48px row** *(our-surface, `livingDocRender`)*. Delete the second toolbar row from row 1; move formatting into the 44px toolbar (C2). Remove the `Download` button (relocate into Present's menu or a `⋯`). Keep: brand/crumb, synced pill, a quiet `↻ Refresh`, `↗ Present`, avatar. This closes the "funky header" (D2) directly.
2. **Provenance gutter → PM decorations** *(our-surface)*. Render a 30px `flex:none` gutter column left of the 720px doc. For each source-bound block, a **widget decoration** paints a 9px dot; for a multi-line edited block, a 3px bar spanning its rows. No line numbers. Hover handler opens source-peek. (Replaces the inline dots that shift the prose — D1/D6.)
3. **Reading type ramp** *(our-surface CSS)*. Apply the Part-B `.prose` ramp — sans body 15.5–16/1.7, 720px column, H1 30/600. This *is* the identity now; 4b means no serif — the same UI sans, reading-tuned.
4. **Source-peek → fixed bottom drawer** *(our-surface)*. Remove every `SIDE_GROUP` editor open; render the source as a `position:fixed` drawer pinned to the webview bottom (C2). One filled **Sync to report** in the drawer header. **Never leave a blank editor group** (kills the #1 abrasion, D5).
5. **Right rail → 3 tabs** *(right-rail contribution)*. Reduce to Chat / Review / History; move Skills to a **＋ Skill** affordance in the Chat composer. Matches the comp's three-tab rail (D6).
6. **Project surfaces** *(our-surface + home/agents contributions)*. Home dashboard (C3) replaces the current one; the project-wide fan-out (C4) and cross-document review (C5) are the project-scale views reached from the nav / the Home "Review" actions and the agent run.
7. **Labeled 76px nav** *(likely 1 core seam / `styleOverrides`)*. Restoring the labeled icon-nav over VS Code's ~48px unlabeled activity bar fights the one-icon-per-container model — expect a small CSS/core pass here; log it in the merge-tax ledger (this is the one item likely to need a core touch).

---

# Part E — Build order + acceptance gates

Highest felt-gain first; 1–5 are our-surface / low-risk.

| # | Ship | Acceptance gate | Plan |
|---|---|---|---|
| 1 | Header → one 48px row; pared toolbar | Only one bar above the doc; format commands still work via `LWDPM.cmd`; no Download button in row 1 | **DONE on main** |
| 2 | Provenance gutter (dots + bars) | Bound lines show a gutter dot; a multi-line edit shows a bar; **prose column is not shifted**; hover opens source | Plan 21 |
| 3 | `.prose` reading ramp (4b sans) | Body 15.5–16/1.7 at 720px; titles 30/600; reads like Docs/Notion, not a code editor | Plan 21 |
| 4 | Source-peek → fixed drawer | Clicking a bound figure opens the bottom drawer over the full-width doc; **no second editor group ever appears** | **DONE on main** |
| 5 | Rail → 3 tabs; Skills → ＋ | Exactly Chat/Review/History; a skill is runnable from the composer | Plan 21 |
| 6 | Project home + fan-out + cross-doc review | Home reads from the open folder; a project-wide run fans out and lands in cross-doc review with source + confidence per change | Plans 22, 23, 24 |
| 7 | Labeled 76px nav | Nav shows labels; secondary surfaces don't render squeezed; ledger entry recorded | Plan 25 |

---

# Part F — Decisions (now resolved)

- **Document identity → `4b` Clean (sans).** The document body is the UI sans, reading-tuned (Part B). No serif. *(Locked by Tom, this session.)*
- **Skills tab → folded into Chat's `＋ Skill`.** Rail is three tabs.
- **Auto-apply default → "Ask me first" per document.** Figures may auto-apply; meaning changes always wait. Revisit per-doc once trust is established.
- **Nav → labeled 76px icon-nav + single tree-rail** is the intended calm nav (accept the one likely core seam).

---

*Ship Part E top-to-bottom. Each row is independently shippable and independently valuable — you never have to land the whole thing to feel the gain.*
