# Plan 43 - Abstract Editor v2: the spec of record

**Status: ratified 21 Jul 2026 (Tom, this session). This is a spec, not a loop.** The loops that implement it are plans 44-49; the master run prompt is [RUN-editor-v2-loop.md](RUN-editor-v2-loop.md). Read this doc first; every loop doc references it instead of restating pixels.

## §0 Status + pixel source

The pixel source is the committed mock at [`docs/design/abstract-editor-v2/`](../design/abstract-editor-v2/) (`Abstract Editor v2.dc.html` + `support.js` + three Obsidian reference screenshots). It shows the Editor surface (pins 1-14), Home (H1-H3), Templates (T1-T3), Knowledge (K1-K3) and Agents (A1-A3), each with an engineering handoff ledger.

Rule of precedence, same clause as plan 20: **when the mock and this doc disagree, this doc wins.** Validators screenshot-diff against the mock but tick criteria against §2 below.

The direction is "Obsidian-informed shell in Abstract's light palette": the white paper editor floats visually above a darker chrome, panels read as cards, and the file tree / properties / context-menu affordances borrow Obsidian's calm patterns (see the reference screenshots) without copying its dark skin.

## §1 Relationship to plan 20

[Plan 20](20-abstract-ui-redesign-handoff.md) Part B stays canonical for every token it defines. This pass adds or changes only the following:

| Token | Value | Use |
|---|---|---|
| `chrome` | `#EDEFF3`, border `#DDE0E7` | the app frame background the panels float on (replaces `panel` as the outermost bg) |
| `tabwell` | `#F3F4F7` | the product tab-strip background inside the editor card |
| `gutter-idle` | `#C6CAD2` | idle line numbers (quieter than `faint` - invisible until useful) |
| `shadow-rail` | `0 8px 28px -14px rgba(20,22,28,.22)` | tree rail + right rail floating shadow (plus e1) |
| `shadow-editor` | `0 12px 36px -16px rgba(20,22,28,.26)` | editor card shadow, top of the stack (plus e1) |
| `card-border` | `#E9EAEE` | floating panel borders (the existing `line` value, pinned for cards) |

**§C2 revision record (decision 168).** Plan 20 §C2 said "30px provenance gutter, no line numbers". That is superseded: the gutter becomes a **70px line-numbered rail** (pin 9 below), Tom-approved as a deliberate design change (the Obsidian learning: numbers give chat, review, proposals and the activity ledger a shared address vocabulary - "line 6"). Plan 20 §C1 (header) and §C6 (right rail) are also revised by pins 2/13/14. Everything else in plan 20 Part C stands.

**Type note.** The mock renders Instrument Sans. Per plan 20 Part B the ramp is what matters, not the face; `system-ui` remains the shipping choice. Validators must not fail type criteria on face rendering differences (see tolerances, §3.6).

## §2 The pins (the criteria quarry)

Each loop doc derives its §2 success criteria from these. "Tier" follows the merge-tax discipline (plan 03): our-surface = livingDocs contribution / webview bundle / service; core = shared workbench, budgeted in §6.

### Editor surface (plans 44-47)

**Pin 1 - Elevation model.** Chrome (window bg) `#EDEFF3`, one step darker than `hairline`. Three work panels float on it with **12px gaps**: tree rail + right rail on `#FBFCFD`, editor on `paper #FFFFFF`. Radius **14** (cards), border `#E9EAEE`. Shadows: rails `shadow-rail`; editor `shadow-editor`; both + e1. The white paper is the visual focus. `.monaco-editor-background` stays opaque `#FFFFFF` (never transparent). *Tier: 1 small core CSS seam (part backgrounds/margins) - log it.*

**Pin 2 - Rail toggles in the header.** Two 28px icon buttons at the header's far left / far right collapse the tree rail and right rail (never a floating chevron mid-editor). Icons: panel glyph with the filled half indicating which side. Keybindings **⌘\\** and **⌘⇧\\**. Collapse animates width→0 + fade over **150ms ease**; state persists per-workspace (storage service). When the right rail is collapsed and a proposal is pending, the Review badge count moves onto the toggle button (8px amber dot) - trust-grammar force-open is no longer needed. *Tier: our-surface.*

**Pin 3 - Icon-nav on chrome.** The 76px labeled nav (plan 25 build) keeps its items but loses its `panel` background - items sit directly on the `#EDEFF3` chrome. Active item = **60px white chip, radius 10, e1**, glyph + label `accent-hover #4650B8`. Idle = `muted #868B95`, hover `slate`. 18px stroke glyphs, 10px/500 labels (active label 600). Settings pinned bottom. *Tier: our-surface (CSS only).*

**The 48px header (part of pin 1/2's shell).** Full-width, height **48px**, border-bottom `#E2E4EA`, on chrome. Left: rail toggle, 22px accent logo tile "A" (radius 6), workspace name 13.5/600 `#1A1C20`, `/` separator `#C6CAD2`, current surface/doc 13.5 `#868B95`. Right (per surface): sync pill (26px, `ok` bg/border/dot, e.g. "All sources synced") or agent-health pill, surface action button (30px, e.g. "＋ Open folder" / "＋ New template" / "＋ Add source"), 27px avatar circle (navy `#3B4D8F`), right rail toggle. One row only; replaces every per-webview top bar.

**Pin 4 - Tree rail: floating panel, 3 tabs + ＋.** 264px floating card (`#FBFCFD`, radius 14, `shadow-rail`). **38px tab strip**: Files · Context · Outline (Search folds into Files as type-to-filter - 3 tabs read calmer than 4). Active tab = white chip (26px, radius 8, e1, 12/600); idle 12/500 `muted`, hover `slate`. A quiet ＋ (new document, 24px, radius 7) sits right of the tabs. The whole rail scrolls as one; the SOURCES group keeps its mono UPPER label (10px / .12em / `faint`). *Tier: our-surface.*

**Pin 5 - Collapsible tree, status at a glance.** Folder rows: **28px**, chevron (9px, rotates 90°, 150ms) + 12.5/600 name + mono doc-count right-aligned (`faint`). Doc rows: **30px, radius 8**, 7px status dot (`ok` = synced · `attention` = changes waiting · `#D5D8DE` = plain) + 13px name + right meta: **LWD chip** (mono 9.5/600 `accent` on `#FFF`, border `#E0E5FB`, radius 5) for living docs, or an amber count pill (mono 10/600 `#8A6D1A` on `#FDFAF2`, border `#E4DCCB`, radius 999) for docs with pending approvals. Selected row = `accent-tint #F4F5FD` bg + `#E0E5FB` border, text `accent-ink`. Children indent **14px**. *Tier: our-surface (VS Code tree widget, restyled).*

**Pin 6 - Full right-click menu on documents.** 208px popover, radius 12, popover shadow, 6px padding, 30px rows, hairline dividers. Groups: **Open / Open to the right** · **Rename… / Duplicate / Move to…** · **Bind sources… / View history / Present** · **Delete** (`removed-ink #B5514B`, hover bg `#FBEEEE`). "Open to the right" is the ONE sanctioned split (side-by-side reference reading) and may never leave a blank group: closing the last editor in a group closes the group. Delete confirms; Rename is inline in the tree. *Tier: our-surface (native ContextMenuService, restyled).*

**Pin 7 - Product tabs (product tabs, not IDE tabs).** **40px strip on `tabwell #F3F4F7`** inside the editor card; VS Code's tab strip stays disabled (`showTabs: 'none'`). Active tab = white, **radius 9 9 0 0**, 34px tall, 1px border `#E9EAEE` merging into the toolbar edge, 12.5/600 + 6px status dot + quiet ×. Idle tabs 32px, text-only 12.5/500 `muted`, hover bg `#ECEDF1`. Sources (e.g. metrics.csv) open as tabs too - same surface, ⊞ mono glyph. No drag-to-split, no reorder-into-groups; overflow scrolls horizontally; middle-click closes; cap visible tabs ~8 then overflow menu. Coexists with the bottom source drawer (pin 10): drawer = quick provenance peek, tab = working in the source. *Tier: our-surface; possibly 1 core seam if the group header is replaced (avoid - see §3.2).*

**Pin 8 - Toolbar unchanged, plus Properties.** The pared 44px toolbar ships as-is (borderless Paragraph ▾, B/I, • list, 1. ordered, ❝ quote, via `LWDPM.cmd`; no underline). Right side gains one control: **Properties** (list glyph + label, 30px, radius 8; active bg `accent-tint`), toggling pin 12. Order: ✦ Ask AI · Properties · ● Saved · v14. Nothing else is added - the calm-toolbar rule holds. *Tier: our-surface.*

**Pin 9 - Numbered gutter (the annotation rail; revises plan-20 §C2, decision 168).** The 30px dot-only gutter becomes a **70px line-numbered** gutter. Numbers: JetBrains Mono **11px**, right-aligned, **22px** from the text edge, idle `gutter-idle #C6CAD2`. Numbering follows the D1 wrap rule: **one number per Markdown line/block**; wrapped visual rows show blank gutter. Provenance rides the numbers: a **bound** line's number turns `accent #5B6DC4`/600 with a 9px dot to its left; a **pending-edit** block gets an `attention` number (`#8A6D1A`) + a 3px vertical bar (`#C99A2E`, radius 999) spanning its rows. Hover a marked number → source-peek drawer. Numbers give chat/review a shared address ("line 6") - used in proposal cards, Home cards, and the Agents activity ledger. Implement as a PM gutter decoration column (`flex:none`, left of the 720px doc column; prose never shifts). *Tier: our-surface.*

**Pin 10 - Bound figures + source drawer (unchanged).** Bound figures stay per plan 20 §C2: non-editable PM atom, text `#4650B8`/500, 2px dotted underline `#9AA2E0`, round-trips to `[label](bind:key)`. Click → fixed bottom source drawer (52-54%, z-25, referenced row in `accent-tint`) - never a second editor group. *Tier: shipped, no change (regression-hold).*

**Pin 11 - Inline proposal, addressed by line.** Word-diff in the document (add `#E9F6EE`/`#2C8159`, remove `#FBEEEE` strike `#CF5A53`) + attention widget (border `#E4DCCB`, bg `#FDFAF2`, radius 10) with mono tag ("MEANING CHANGE · NEEDS YOUR CALL"), one-line rationale, **Approve** (accent fill, 28px, radius 8) / **Reject** (ghost, border `#E6E8EC`, hover `removed`). New: the widget and the rail card both cite the gutter address ("Line 6"). *Tier: our-surface.*

**Pin 12 - Properties panel (frontmatter without the YAML).** **284px inset panel inside the editor card** (right edge, `rail #FBFCFD` bg, hairline left border `#EEF0F3`) - Obsidian's Properties, Abstract-calm. 44px header row ("Properties" 12.5/600 + quiet ×). Reads/writes the doc's YAML frontmatter + lock.json: TITLE · CREATED / UPDATED (mono 11.5) · STATUS chip (`ok` pill) · TAGS (accent-tint chips + dashed ＋) · BOUND SOURCES (32px rows on `#FFF`, bind counts; click → drawer) · AGENT POLICY (plain-language, per-doc "ask me first"). Footer link: "Edit raw YAML →" (mono 11, `muted`) opens the raw view - plain front door, pro back door. Toggled from the toolbar (pin 8); state per-doc. Field labels: mono **9.5px UPPER .12em `faint`**. The 720px reading column re-centres in the remaining width when open. *Tier: our-surface (+ parseLivingDoc frontmatter API).*

**Pin 13 - Right rail: floating, same 3 tabs.** 392px floating card (`#FBFCFD`, radius 14, `shadow-rail`), 44px tab strip: **Chat · Review · History** (the Skills tab folds into the composer's ＋ Skill, completing plan 20 Part F). Review carries an amber count badge (16px min, `#C99A2E` bg, white 10/600). Tab treatment matches the tree rail (white chip 28px + e1 active). Content per plan 20 §C6, plus line-address references (pin 11). *Tier: our-surface.*

**Pin 14 - Composer model selector.** The composer (12px padding card, `#FFF`, border `#E6E8EC`, radius 12) gains a quiet model control on its action row: mono **11px**, `muted`, green health dot (6px) + model id + ▾. Click → popover listing the broker's models (included tier vs own-key, per plan 35), current checked, health per row. Selection persists per-workspace. Row order: **＋ Skill · @ · (spacer) · model · send** (28px accent square, radius 8). *Tier: our-surface (+ lwd-model-broker list API).*

### Home (plan 48)

**H1 - Surface.** No rails render on Home - one white surface floats on chrome with the editor-card shadow; reading column **max 1080px**, padding 64px 48px 80px. Greeting row baseline-aligned: title "Good morning, Tom." 30/600/-0.02em nowrap flex:none + mono date 13 `faint` flex:none. Summary line 14 `muted` ("2 documents need you · everything else is in sync."). Header swaps Present for **"＋ Open folder"**.

**H2 - NEEDS YOU cards.** Mono section label (10/600/.12em `faint`). Max 2 cards, 3px accent top-border, radius 13, e1. Anatomy: 8px attention pulse dot (opacity 1↔.35, 2.4s ease) + name 14.5/600 + mono amber "N TO APPROVE" pill; one-line plain-language reason citing the gutter address ("line 6"); accent **Review** button (30px, radius 8) deep-linking to the doc with the Review tab open; mono freshness stamp (10.5 `faint`).

**H3 - ALL DOCUMENTS grid.** 4-col grid, gap 12. Card (radius 13, `#FBFCFD`, border `#E9EAEE`; hover `accent-tint` + `#E0E5FB`): 26px two-letter avatar (plan 20 avatar palette) + 13/600 name + status chip (needs you / in sync / markdown - 20px pills) + mono source count. Dashed "＋ New document" tile last (`#C6CAD2` dash, hover accent). Reads the open folder (decision 39: the folder IS the project - no fixture cards). Empty state: one line, one button, nothing else.

### Templates (plan 48)

**T1 - Surface + filter.** Same no-rails shell (white card on chrome), column max **1180px**. Title row carries a quiet **240px filter field** (32px, `#FBFCFD`, border `#E9EAEE`, radius 9; type-to-filter, no separate search page). Header button: "＋ New template". Sub-line: "Start a living document from a pattern. Sources bind after creation."

**T2 - Template cards.** YOUR TEMPLATES: 3-col grid, gap 14. Card radius 13, e1, hover border `#9AA2E0` + lifted shadow. **110px skeleton thumbnail** (bg `#F6F7F9`, border-bottom `#EEF0F3`): grey bars (`#D5D8DE` title, `#E9EAEE` prose) = prose, accent-tint bars (`#E0E5FB`) = bind slots - the thumbnail literally shows where live data lands; render from the template's PM doc, no screenshots. Body: name 14/600 + LWD chip, one-line description naming the expected source, mono meta "N bind slots · used N×" (10 `faint`), accent **Use** button (26px, radius 7). Use = duplicate into the open folder with binds empty → doc opens with a "bind sources" nudge in the tree row. Dashed tile: "＋ Save current doc as template" (writes to `.abstract/templates/`).

**T3 - Starters row.** 4 built-ins, quieter cards (`rail` bg, no thumbnail, radius 13): name 13/600 + one-line purpose 12 `muted`. Blank living doc · Project brief · Meeting notes · Metrics digest. Visually subordinate so YOUR TEMPLATES stays the hero. Static manifest.

### Knowledge (plan 49)

**K1 - Surface.** Same no-rails shell, 1180px; header button "＋ Add source" (file picker into the folder's `sources/`); 240px filter field. Summary line counts sources + dependent binds ("4 sources in this folder · 7 bound figures depend on them.").

**K2 - Source table (the heart).** Bordered table (radius 13). Header row on `#FBFCFD`: mono 9.5/600/.12em `faint` - SOURCE · KIND · SYNC · FEEDS · BINDS (grid 2fr 1fr 1fr 1.4fr 90px). Rows 13px, padding 13px 18px, hairline dividers, hover `#F6F7F9`. SOURCE: kind glyph (⊞ table / ◍ transcript / ◇ reference, mono `accent` or `faint`) + name 13.5/600. SYNC: 7px dot + relative time (`ok` fresh · `attention` "stale · 9d" with the whole row on cream `#FDFAF2` · grey "context only"). FEEDS: accent-tint doc chips (click opens that doc). BINDS: mono count, `accent`/600 when >0, `faint` dash when none. Row click opens the source in an editor tab (pin 7).

**K3 - Health strip.** At most one attention card (stale source: "pipeline.csv hasn't changed in 9 days but Executive Summary cites it. Re-sync or mark as expected." - trust grammar: warn, never auto-fix) beside one static "HOW BINDING WORKS" explainer card. No dashboards, no charts - the table already tells the story.

### Agents (plan 49)

**A1 - Surface.** Same no-rails shell, 1180px. Header pill switches to agent health ("1 agent active", `ok` pill). Framing line states the trust contract: "Agents only act on documents that opted in. Every action lands in the ledger below."

**A2 - Agent cards.** Card radius 13, e1: 34px tinted glyph tile (radius 10, `accent-tint` border `#E0E5FB` active / `#F6F7F9` paused) + name 14.5/600 + mono status line (10px: `● active · watching 2 sources` in `ok` / `○ paused` in `faint`) + accent toggle switch (36×20, knob 16). Body: one-line purpose 12.5, then the **policy table** - the same three-tier trust grammar as the editor, each row label + right-aligned value: auto-apply (`ok`) / ask first (`attention` ink `#8A6D1A`) / never (`removed-ink #B5514B`) - so policy reads identically everywhere. Footer (hairline top): mono "runs on" + model id (from the broker, pin 14's list) + **Edit policy** link → the same plain-language policy editor as the doc Properties panel. Paused card at **75% opacity**. Dashed "＋ New agent" tile (280px, "from a skill or from scratch").

**A3 - Activity ledger.** Bordered list (radius 13), flat chronological, newest first. Row: mono timestamp (10.5 `faint`, 52px col) · 7px status dot (amber waiting / green applied / grey admin) · plain-language sentence 13px with deep links citing gutter addresses ("Weekly Summary · line 6") · right-aligned mono badge (amber "WAITING" pill / green "auto-applied · reversible" / grey "by Tom"). WAITING rows deep-link to the doc's Review tab. This is the audit trail behind the editor's trust chips - same events, calendar view.

## §3 Shared contracts (cross-lane conflict killers)

Settle these here so parallel lanes never negotiate mid-flight.

1. **Line-address model.** One address per Markdown line/block (D1 wrap rule). Persistent references (chat history, ledger entries, proposal records) carry **block/claim ids**, never printed numbers; the displayed "line 6" string is computed at render time from the current doc. Deep links resolve by id and recompute the shown number; a link whose block is gone degrades to the doc without scroll, never errors. Owner: plan 45 (PR-a); consumers: plans 47, 48, 49.
2. **Tab strip ↔ editor groups.** The product tab row is Abstract's own DOM, rendered in the editor pane host (native DOM above the webview - not inside the webview HTML, which would flicker on doc switch). One tab row per editor group. "Open to the right" (pin 6) creates a second group with its own tab row; closing the last tab in a group closes the group; no other split path exists. VS Code tabs stay `showTabs: 'none'`. Tab model lives in the service, persisted per-workspace per-group. Sources open via a lightweight source-viewer input in the same pane family. Owner: plan 45; consumer: plan 46 (context menu), plan 49 (row-click opens source tab).
3. **Header content service.** The 48px header is one full-width surface (titlebar part repurposed, decision 170) with a small per-surface content API: breadcrumb tail, right-side pill, right-side action button, rail-toggle visibility (Editor shows both toggles; screens show neither rail toggle), badge counts. Owner: plan 44; consumers: all.
4. **Shared plain-language policy editor.** One component renders the three-tier policy grammar (auto-apply / ask first / never) and its editor. It lives in `livingDocs/common/` + a browser renderer; built by plan 45 (Properties AGENT POLICY, absorbing #122 F11), reused verbatim by plan 49 (agent cards' Edit policy). No duplicate policy UI (principle P2).
5. **Persistence keys.** Per-workspace via `IStorageService`: `livingDocs.v2.treeRailCollapsed`, `livingDocs.v2.rightRailCollapsed`, `livingDocs.v2.tabs.<groupId>`, `livingDocs.v2.model`. Properties-panel open state is per-doc (`livingDocs.v2.props.<docId>`).
6. **Pixel tolerances.** Colours exact to the hex. Lengths/spacing/radii ±1px (anti-aliasing, rounding). Shadows exact strings. Type: sizes/weights/line-heights per the ramp; the rendered face is `system-ui` (not the mock's Instrument Sans) and never a failure. Motion: duration/easing verified by code inspection plus one live observation; no frame-perfect assertions. Grid/column: the 720px reading column and 264/392 rail widths are exact; grid redistribution slack from the workbench layout is acceptable to ±12px on rails only (record the measured value).
7. **`livingDocsService.ts` discipline.** Four loops touch it: **additive methods only** - new methods and new interfaces, no refactors of existing signatures, no moving code. Every lane rebases onto main after any other lane merges (protocol step 8).

## §4 The wave map

| Plan | Loop | Pins | Owns (sole writer) | Absorbs | ~PRs |
|---|---|---|---|---|---|
| [44](44-elevation-shell-loop.md) | Elevation shell (**sequential, first**) | 1, 2, 3 + header | `studio.css` (all wave), theme json, `livingDocs.contribution.ts` defaults/keybindings, new `abstractHeader.ts`, sanctioned core seams, `check-seams.sh` | - | 3 |
| [45](45-editor-card-loop.md) | Editor card | 7, 8, 9, 10, 11, 12 | `livingDocRender.ts`, `livingDocEditor.ts`, address model + policy editor in `common/` | #122 F11, F13 (partial) | 4 |
| [46](46-tree-rail-loop.md) | Tree rail | 4, 5, 6 | `treeRailView.ts`, `treeRailFilesTree.ts`, `common/treeRail*` | - | 3 |
| [47](47-right-rail-loop.md) | Right rail | 13, 14 | `reviewRailView.ts`; broker model-list route | #211 item 4 (not #120) | 2-3 |
| [48](48-screens-home-templates-loop.md) | Screens I | H1-3, T1-3 | `screenRenderHome.ts`, `screenRenderTemplates.ts` | #211 items 1-2 | 3 |
| [49](49-screens-knowledge-agents-loop.md) | Screens II | K1-3, A1-3 | `screenRenderKnowledge.ts`, `screenRenderAgents.ts`, `agentOrchestrator.ts` (additive) | #131 surfaces, #122 F12 | 3 |

**Dependency edges.** 44 → everything (lanes branch from main only after 44 merges). 45-PR-a (gutter + address model) → 47 (Review cards cite addresses). 45 (policy editor, sources-as-tabs) → 49, soft: 49 may start on its Knowledge table and card layout, stubbing the deep-link/tab targets until 45's PRs merge, then rebase. Pre-step PR (the `screenRender.ts` split, see §6) → 48 and 49.

**Lane schedule (max 3 concurrent lanes; ~2-3 code-web instances is the machine limit).**

```
main:   docs commit → pre-step PR → PLAN 44 (sequential) → merge
lane A: PLAN 45 (longest; its PR-a merges early)
lane B: PLAN 46 → then PLAN 47 (after 45-PR-a)
lane C: PLAN 48 → then PLAN 49
```

**File-ownership matrix.** A lane never edits a file another loop owns; it files a request on the loop's tracking issue instead. `studio.css` and the theme json belong to plan 44 for the whole wave (post-44 tweaks = one-line PRs routed through the orchestrator). `screenEditor.ts` message handlers are shared between 48/49: additive handlers only, rebase on conflict.

## §5 THE PROTOCOL (run per loop; referenced by every loop doc's §6)

The three-role architecture (per [RUN-p0-p1-completion-loop.md](RUN-p0-p1-completion-loop.md), adapted to a PR-resident exchange):

**Roles.**
- **ORCHESTRATOR** - the session itself (Fable). Plans, dispatches, gates, merges. Never writes feature code, never reads large source files, never verifies surfaces itself; it deals in sub-agent reports and PR state.
- **IMPLEMENTER** - sub-agent, `model: "opus"` (Opus 4.8), high effort. One per PR bundle, in the loop's worktree (`git worktree add /Users/tommy/Sites/abstract-v2-<loop> -b v2/<loop>-<bundle> main`; Node 24: `source ~/.nvm/nvm.sh && nvm use 24`; `npm install`; one-shot `npm run compile`, then ONLY `npm run typecheck-client` for iteration).
- **VALIDATOR** - a separate adversarial sub-agent, `model: "opus"`, fresh eyes each round, never talks to the implementer, never fixes code. Its instruction is to **refute**, not confirm.

**Context handed to the implementer (exact list).** The loop doc (whole); plan 43 §1-§3 plus the §2 pins for the bundle; the bundle's success-criteria subset; the mock path `docs/design/abstract-editor-v2/`; exact code pointers (the orchestrator greps first and cites `file:line`); the loop's do-not-break section; the evidence duty below. The implementer does NOT open the PR - the orchestrator opens it so the checklist body is canonical.

**PR mechanics (the exchange lives on the open PR).**
1. The orchestrator opens a **draft PR** from the bundle branch early. Title `feat(livingDocs): v2 <loop> - <bundle> (#issue)`. Body: what/why + the bundle's success criteria as **unticked GitHub task-list items with their IDs** + a "Rounds" section.
2. **IMPLEMENT.** The implementer pushes commits and posts ONE PR comment per round: a before/after screenshot table (images committed under `docs/qa/2026-07-v2/<loop>/<bundle>/round<N>/`, linked via raw.githubusercontent), the checks it ran (`npm run typecheck-client`, `./scripts/test.sh --grep "livingDocs"`, `npm run valid-layers-check`, `./scripts/check-seams.sh`), and a per-criterion self-assessment. Screenshots: `TMPDIR=/tmp ./scripts/code-web.sh ./living-docs-sample` driven via the launch skill / chrome-devtools, viewport 1440×900 for product truth plus 1760×1000 for mock comparison; let the service worker register; unique session name per agent.
3. **VALIDATE.** The validator (a) re-runs every check itself; (b) drives the live app against each criterion, **measuring numerically** - `getBoundingClientRect` / `getComputedStyle` for every px/hex predicate, never eyeballing a number; (c) opens the committed mock HTML in a same-size tab and captures matching frames side-by-side; (d) attacks the loop's named edge list; (e) commits its own evidence under `.../<bundle>/validate-round<N>/`. Then it **edits the PR body** (`gh pr edit --body`): ticks ONLY criteria it verified, appending a short evidence note after each tick - `(measured 70px; validate-round2/gutter.png)` - and posts a `VALIDATION ROUND N` comment: **PASS**, or **FAIL** with a numbered defect list (criterion id, expected vs measured, repro).
4. **FAIL** → the orchestrator dispatches a fix-round implementer with the defect list (focused re-validation is fine when the fix is prescribed). Cap: **3 rounds**; at 3, record the blocker on the loop's tracking issue, park the PR as draft, move on.
5. **PASS** (all boxes ticked) → the orchestrator marks ready and squash-merges with branch delete (validator-gated auto-merge, plan-42 policy; the founder reviews on main). Known-infra CI failures (macOS runner allocation ~3s fails) are not a real red. Every other live lane then fetches main and rebases before its next push.
6. **Tolerances** are §3.6. Docs win over pixels: if the mock and this doc disagree, §2 is the criterion.
7. **Evidence duty (both agents).** Screenshots committed to `docs/qa/` (never only in comments); raw measurements in the comment; no co-author lines on commits; commit messages cite the issue; Australian English, no em dashes, tabs not spaces, nls-externalised strings, disposables registered.
8. **STOP / ESCALATE.** Round cap breached; a change would exceed the §6 core-seam budget; a do-not-break constraint would bend; two lanes need the same file. Post the blocker on the loop issue, notify the founder (push notification), park.
9. **Session hygiene.** Kill instances + temp profiles when done; ≤3 concurrent code-web instances machine-wide; if a sub-agent dies on session limits, probe with a trivial agent, then respawn a RESUME agent that reads `git status`/`git diff` critically (the diff is claims, not facts).

## §6 Wave definition of done + seam budget

**Core-seam budget: max 2 small seams for the whole wave** (decision 169): (1) part backgrounds/margins CSS for the elevation model; (2) the titlebar height constant for the 48px header. Each must be minimal, fail-soft, logged in [03-merge-tax-ledger.md](03-merge-tax-ledger.md) with a re-pin check, and asserted in `scripts/check-seams.sh`. A third seam = STOP/ESCALATE.

**Pre-step PR (gates lanes C):** mechanically split `screenRender.ts` into `screenRenderShell.ts` (shared helpers) + one module per screen, zero behaviour change, snapshot tests unchanged; and delete the production-dead `docHasEarnedLiving` `hasSiblingLock` branch (#211 item 3).

**The wave is done when:**
1. All six loops' success criteria are ticked by validators on merged PRs (or carry recorded blockers on their issues).
2. Absorbed issue items are closed or commented with exactly which boxes each PR ticked (#211 items 1-4, #122 F11/F12/F13-partial, #131 surface items).
3. The merge-tax ledger carries the final seam entries (≤2) with re-pin checks, and `check-seams.sh` passes.
4. Decision-log entries 167-174 stand; plan 20 carries its delta banner; docs/README.md and docs/plans/README.md index plans 43-49.
5. A closing audit screenshots all five surfaces on final main (1440×900 + 1760×1000), committed to `docs/qa/2026-07-v2/99-closing/`, side-by-side with the mock frames.
6. The livingDocs suite is at 0 failures on main; `typecheck-client`, `valid-layers-check` and `check-seams.sh` are clean.
7. The standing founder note: a 2-minute manual desktop smoke (decision 71 precedent) - the web harness is the validated path; the titlebar/header work specifically needs a desktop look (macOS traffic-light inset, plan 44 criterion).
