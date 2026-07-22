# Plan 45 - Editor card: iteration 0 (baseline)

Lane A of the Abstract Editor v2 wave (spec [43](../../../../plans/43-editor-v2-spec.md), loop [45](../../../../plans/45-editor-card-loop.md)). This folder captures the "before" state the PR-a/b/c/d validators diff against. Branch `v2/editor-00-baseline`, worktree `/Users/tommy/Sites/abstract-v2-editor`, off `origin/main` at `3ec16a6333e` (post-44 shell: 48px header, chrome bg, floating cards).

## Status of this baseline

**Live capture completed on the 45-a resume run (22 Jul 2026, disk freed to ~31Gi).** The deferred visual + numeric baseline the earlier disk-blocked session could not take is now captured. Screenshots committed in this folder; the live P9.1/P9.8 numbers are recorded under "Live before-numbers" below. The CSS before-numbers table (further down) stands as the source-truth cross-check.

Earlier-session context (kept for the record): the first baseline attempt was blocked by disk exhaustion (411Gi/460Gi used, ~130-400Mi free); `code-web` needs both the served `out/` bundle AND several GB of runtime headroom. That is resolved for this run.

### Live before-numbers (captured 22 Jul 2026, `scripts/lwd-capture.mjs measure`, driven via playwright-core headless Chromium)

Measured on the running web build (`TMPDIR=/tmp ./scripts/code-web.sh ./living-docs-sample --port 8081`), 1440x900:

| Metric | Value | How |
|---|---|---|
| `#pm-root` prose element x | **177.75px** | `getBoundingClientRect().x` on `Weekly Operating Summary` |
| `#pm-root` prose element width | **718.5px** | `getBoundingClientRect().width` |
| `#pm-root` prose element right | **896.25px** | `getBoundingClientRect().right` |
| Prose TEXT left edge (x + 30px pad) | **207.75px** | element x + `paddingLeft:30px` (the reserved dot lane) |
| `.pmwrap` width | 1074px | pane width available for the centred reading group |
| Typing latency, Weekly Summary | median **0.8ms**, p95 **3.4ms** (n=20) | keydown->DOM-mutation sample |
| Typing latency, plan-30 scale fixture (`report-0.md`) | median **0.7ms**, p95 **3.4ms** (n=20) | same, on `./living-docs-scale-sample` |

**P9.1 anchor:** after PR-a widens the lane 30px->70px, the prose TEXT left edge must stay at **207.75px (+/-1px)** and the text right edge at **896.25px**. The 40px of extra lane must come from the layout, never by shifting the prose text.

**P9.8 anchor:** post-change scale-fixture typing latency must not regress past the **median 0.7ms / p95 3.4ms** baseline (measured, not asserted).

What IS delivered here and is fully authoritative:

- The **before numbers** for P9.1 / P9.10, read from the shipped CSS (source of truth, more exact than a screenshot measurement).
- The **grep pointers** every PR-a/b/c/d implementer needs (`file:line`).
- The committed **wrap-rule fixture** (`living-docs-sample/wrap-fixture.md`) that gates P9.4.
- The **plan-30 scale fixture** recipe (the on-disk sample is gitignored; regenerate on demand).

## Re-run recipe (once disk is free)

```
source ~/.nvm/nvm.sh && nvm use 24
cd /Users/tommy/Sites/abstract-v2-editor && npm run compile        # rebuild out/
TMPDIR=/tmp ./scripts/code-web.sh ./living-docs-sample --port 8081  # bare http://localhost:8081/
```

Screenshots to capture at **1440x900** and **1760x1000**, into this folder:

- `editor-{1440,1760}.png` - editor on `Weekly Summary.md` (a bound doc: inline bound figures at line 12 + a bound table).
- `drawer-{1440,1760}.png` - the source drawer open (click a bound figure, opens the fixed bottom drawer at 52-54%).
- `gutter-{1440,1760}.png` - close-up of the current 30px dot gutter (the treatment P9.10 removes).
- `scale-{1440,1760}.png` - a plan-30 scale-sample doc open (relaunch on `./living-docs-scale-sample`, e.g. `report-0.md`).
- `proposal-{1440,1760}.png` - a pending proposal, IF one can be staged (see below).

## Fixtures

### Wrap-rule fixture (committed) - gates P9.4

`living-docs-sample/wrap-fixture.md`. Two paragraphs each long enough to wrap over >=3 visual rows at the 720px reading column, interleaved with short lines and a short list. When the numbered gutter lands (PR-a), P9.4 requires exactly one number on each block's first row and a blank gutter on the wrapped rows below - this doc is the canonical check that numbering follows Markdown blocks, not visual rows.

### Plan-30 scale fixture (gitignored) - for P9.8 latency

Name: **`living-docs-scale-sample/`** at the repo root (confirmed in `scripts/generate-scale-sample.ts` and `docs/plans/30-performance-scale-loop.md:42`). It is gitignored except its generator, so it is a regenerate-on-demand artefact, never committed.

Regenerate: `node scripts/generate-scale-sample.ts 50 4` -> 50 `report-N.md` docs, each with 4 inline `bind:` figures, over 4 shared `metrics-N.csv` sources (~220K total). This session generated it successfully. To measure P9.8 baseline typing latency, launch code-web on this folder, open a `report-N.md`, and sample keydown-to-DOM-update on the ProseMirror surface.

## Before numbers (from the shipped CSS in `livingDocRender.ts` - authoritative for P9.1 / P9.10)

The living-doc editor is a ProseMirror webview. Its reading layout is defined in the CSS embedded in `src/vs/workbench/contrib/livingDocs/browser/livingDocRender.ts`:

| Property | Current value | Source |
|---|---|---|
| Gutter lane width | **30px** (reserved via `.prose` left padding, not a flex column) | `livingDocRender.ts:320` `.pmwrap .prose{...padding-left:30px...}` |
| Prose reading column | **max-width:720px**, `box-sizing:content-box` -> total element 750px | `livingDocRender.ts:320` + comment `:307-311` |
| Prose x-position | **centred** in the pane via `.pmwrap{display:flex;justify-content:center;padding:32px 40px 90px}` | `livingDocRender.ts:319` |
| Prose type | `400 15.5px/1.7 system-ui`, colour `#2a2a31` | `livingDocRender.ts:280` |
| Bound-line dot marker | 9px accent dot at `left:-21px`, `top:.62em`, `background:oklch(0.55 0.13 255)` | `livingDocRender.ts:343` |
| Recently-changed dot | `oklch(0.66 0.16 45)` + amber halo + flash animation | `livingDocRender.ts:345` |
| Pending-edit bar | 3px `oklch(0.66 0.16 45)` bar at `left:-22px`, radius 999 | `livingDocRender.ts:350` |
| Formatting toolbar | 46px, sticky top, white, `border-bottom #eef0f3` | `livingDocRender.ts:204` `.etoolbar` |
| Toolbar right side (current) | mono "Saved" chip only: `.tb-saved` (JetBrains Mono 11px `#bcc0c8`, 6px green `sdot`); ephemeral variant `#9a6b16` for web | `livingDocRender.ts:213-217` |

**P9.1 read:** the prose column is 720px, centred, with a 30px gutter lane to its left (total 750px). PR-a must keep the prose x-position unchanged while widening the lane to 70px (the extra 40px must come from the surrounding layout, not by shifting prose).

**P9.10 read:** the "old 30px dot gutter" to be fully removed = the `.pm-gutter`/`.pm-gutter-recent`/`.pm-edit-bar` decoration CSS (`livingDocRender.ts:342-350`) plus the 30px `.prose padding-left` reservation (`:320`), and the decoration builder in `common/livingDocPmDecorations.ts`.

**P8.1 read:** the current toolbar right side is a lone "Saved" chip. PR-c must land the full `Ask AI · Properties · Saved · v14` order, adding only the Properties control.

Live `getBoundingClientRect` prose x/width and keydown latency samples are the one gap left by the disk blocker; the CSS values above are the ground truth those measurements would confirm.

## Grep pointers (file:line - the code the PR bundles touch)

**Gutter / margin-dot decoration (PR-a target, replaced by the numbered gutter):**
- Decoration CSS: `src/vs/workbench/contrib/livingDocs/browser/livingDocRender.ts:342-350` (`.pm-gutter::before` dot, `.pm-gutter-recent`, `.pm-edit-bar .editp::before` bar).
- Reserved 30px lane: `livingDocRender.ts:320` (`.pmwrap .prose{padding-left:30px}`), layout comment `:306-318`.
- Decoration builder (the `{kind:'dot'|'bar', keys, recent}` spec): `src/vs/workbench/contrib/livingDocs/common/livingDocPmDecorations.ts` (unit tests: `test/browser/livingDocPmDecorations.test.ts:183-309`).
- Gutter hover/click wiring in the RUNTIME: `livingDocRender.ts:572` (`.pm-gutter` click -> `reveal`), `:617-631` (gutter-dot hover provenance resolve), `:712` (decoration payload pushed to webview).

**Proposal inline widget (PR-a P11 target):**
- Widget markup + framing: `livingDocRender.ts:161` (`.pcell` full-width column), `:729-750` (kind tag / `attention` bar / rationale assembly), `:351-371` (`.pm-orig-hidden`, in-place tweak editor, Approve/Reject swap for Save & Approve/Cancel).
- Approve/reject round-trip messages: `livingDocRender.ts:559-564` (`amendApprove`), `:639` (`data-approve` reveal). PR-a must add the "Line N" address to the mono tag row here without changing the apply path.

**Editor pane / host structure (PR-b - native tab row mounts here, above the webview):**
- `src/vs/workbench/contrib/livingDocs/browser/livingDocEditor.ts:73-77` - `createEditor(parent)` builds `.living-doc-editor` container and appends it to the pane `parent`.
- `livingDocEditor.ts:114-127` - `_createWebview()` mounts the webview into `this._container` (`webview.mountTo(this._container, this.window)` at `:124`). The 40px product-tab strip (pin 7 / 43 §3.2) mounts as a native sibling ABOVE this webview mount, inside `.living-doc-editor` - not inside the webview HTML.

**Toolbar right-side items (PR-c P8 target):**
- `livingDocRender.ts:204-217` - `.etoolbar` (46px) and its `.tb-saved` right-aligned chip (`margin-left:auto`). The Present action currently lives in the repurposed titlebar header (`:158`), not the toolbar. PR-c adds the Properties button to this strip to reach `Ask AI · Properties · Saved · v14`.

## Pending-proposal staging - NOT achieved this session

Per `docs/qa/2026-07-20-rail-dots/findings.md`, a live pending proposal needs an agent round-trip through the review-rail webview (model-dependent: `LWD_BACKEND=openrouter` + broker on 8090, then trigger a review flow). That dedicated rail-dots session could not stage a live yellow/pending band either - its item 2 is an honest PARTIAL, proven only at the render + unit layer. This session was blocked earlier, by disk, before a browser could even start, so no attempt reached the model round-trip. #120 (broker auto-start) is known-open and is the usual obstacle; it is not a new failure. When re-run: launch with `LWD_BACKEND=openrouter`, open `Weekly Summary.md`, and trigger a review; if the broker will not start within ~15 min, capture the render-layer proof and note the block, matching the rail-dots precedent.

## Traps hit

- **Disk exhaustion (primary blocker).** `npm install` and `code-web`'s node-download step both ENOSPC'd; at the worst point the tool harness itself could not write command output files under `/tmp`. Reclaimed just enough by clearing `~/Library/Caches/node-gyp` and the aborted-install partials, copying the prebuilt `node` binary from the sibling `abstract-v2-shell` worktree (avoids the ~114M download), and deleting this worktree's own `out/`. The structural fix (prune 39G of stale `agent-*` worktrees) needs orchestrator authorisation.
- **`out/` vs headroom are mutually exclusive** on this disk: with `out/` present (~295M) there is too little free space for the browser; without it the workbench 404s. Capture is not possible until several GB are freed.
- Node 24 via nvm on every shell (`source ~/.nvm/nvm.sh && nvm use 24`); always `TMPDIR=/tmp`; port 8081 is this lane's (siblings use 8082/8083) - never kill other ports' processes.
