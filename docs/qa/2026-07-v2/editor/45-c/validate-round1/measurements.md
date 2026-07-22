# 45-c validation round 1 - live measurements (#224)

Adversarial validation of PR #231 (plan 45, bundle 45-c: Properties panel + shared policy editor). Fresh worktree `abstract-v2-editor` on `v2/editor-c`; Node 24; `TMPDIR=/tmp ./scripts/code-web.sh ./living-docs-sample --port 8081` (bare URL). Live measurements via a headed Chrome driven by Playwright (`getBoundingClientRect` / `getComputedStyle`), on the REAL `Board Note.md` living document.

## Empty-workspace claim - REFUTED

The implementer's comment claims the web memfs mount surfaces an empty workspace ("doc discovery reads no files"), so live geometry was measured on served markup, not the running product. This is false. The workspace loads populated: the Files rail lists Board Note, Appendix, Executive Summary, Project Brief, Market research, Team Notes, Weekly Operating Summary, Wrap Rule Fixture, and the metrics.csv source. Opening `Board Note.md` renders it as a real Living Document PM editor with resolved binds and the shipped toolbar. The full live pass below was run in the running product, on real docs.

The only navigation quirk observed: Cmd+P quick-open did not switch the active PM editor; a single click on the Files-rail row opens the doc reliably. Not a product defect.

## Checks

| Check | Result |
|---|---|
| `npm run typecheck-client` | clean (0 errors) |
| `npm run valid-layers-check` | clean (exit 0) |
| `./scripts/check-seams.sh` | OK - all shell seams intact |
| `./scripts/test.sh --grep "livingDocs"` | 311 passing |
| `./scripts/test.sh --grep "doc policy"` (Shared doc policy suite) | 7 passing |
| `livingDocs Service` suite | 147 passing |
| `Properties frontmatter (plan 45 pin 12)` suite | 7 passing |
| Diff scope | livingDocs contrib only; additive service; zero core seams; no PM bundle change |

## Live measurements on Board Note.md (getBoundingClientRect / getComputedStyle)

| Predicate | Spec | Measured | Verdict |
|---|---|---|---|
| Toolbar right order | Ask AI - Properties - Saved - vN | `tb-ai (✦ Ask AI) - tb-props (☰ Properties) - tb-saved` | PASS |
| Saved chip (web) | honest vN | web-memfs ephemeral "Changes live only in this tab"; vN on persistent path | PASS (adjudicated) |
| Properties button | 30px, radius 8, active bg #F4F5FD | 30px, 8px, active rgb(244,245,253); toggles both ways | PASS |
| Panel width | 284px | 284px | PASS |
| Panel right edge | flush to card | right = viewport right (1074) | PASS |
| Panel bg | #FBFCFD | rgb(251,252,253) | PASS |
| Panel left border | #EEF0F3 1px | rgb(238,240,243) 1px | PASS |
| Header height | 44px | 44px | PASS |
| Field labels | mono 9.5 / 600 UPPER .12em #A3A8B2 | 9.5px/600, ls 1.14px, uppercase, rgb(163,168,178), JetBrains Mono | PASS |
| Fields present | TITLE, CREATED/UPDATED, STATUS, TAGS, BOUND SOURCES, AGENT POLICY | all 7 labels present | PASS |
| CREATED/UPDATED | mono 11.5 | 11.5px JetBrains Mono; "21 Jul 2026" (from file stat) | PASS |
| STATUS chip | ok pill | bg rgb(241,248,243) = #F1F8F3; grey dot when unauthored (truthful) | PASS |
| TAGS | accent-tint chips + dashed ＋ | dashed add button; chips #F4F5FD/#4650B8/#E0E5FB (measured on tagged doc) | PASS |
| BOUND SOURCES | 32px rows on #FFF, real counts, click -> drawer | metrics.csv count 6 (all 6 lock keys), 32px, rgb(255,255,255); click posts reveal | PASS |
| AGENT POLICY | 3 tiers, correct tones | ask-first selected, dot+label rgb(138,109,26) = #8A6D1A (attention) | PASS |
| Edit raw YAML | opens raw view of SAME doc | switches to raw; textarea shows Board Note YAML | PASS |
| Re-centre | reading column re-centres, Δ ≈ 142px | text centre 554 (closed) -> 412 (open), Δ = -142px | PASS |
| Persist across reload | panel state restores | panel open -> full reload + reopen -> restored open | PASS |

## P12.3 on-disk round-trip (independent, against real Board Note.md bytes)

The web build is memfs (issue #121), so panel edits do not reach the real file; the on-disk half of P12.3 was proven directly by running the SHIPPED writers (`withFrontmatterScalar`, `withFrontmatterTag`) against a throwaway copy of the real `living-docs-sample/Board Note.md`, re-reading bytes, then reverting:

```
diskTitle:true  diskStatus:true  diskTag:true
bodyByteUnchanged:true  bindsIntact:true (6 binds)  sourcesPreserved:true
revertedByteExact:true
```

Live-edit wiring separately confirmed in the running product: typing a status in the panel and blurring re-renders the panel with the status set (message -> host writer -> reparse -> re-render). Created/updated read from `_files.stat` (ctime/mtime); bind counts from the lock (6, cross-checked against Board Note.lock.json). The real sample file is untouched (md5 unchanged, git clean).

## Policy-editor reuse audit (for plan 49)

`common/docPolicy.ts` is pure with zero doc-specific coupling (grammar, `coerceDocPolicy`, `docPolicyToneHex`, ordered `DOC_AUTONOMY_LEVELS`). `browser/policyEditorRender.ts` `renderPolicyEditor({ selected, name })` is pure `(model) -> html`, owns no state, posts no messages; `name` disambiguates multiple instances (agent id vs doc id), `CLICK_SELECTOR` + `data-policy-editor` give clean host delegation; `POLICY_EDITOR_STYLE` is inline-once shareable. Fit for reuse.

Caveats to record (not defects for 45-c):
- A pre-existing agent policy control still lives in `screenRenderAgents.ts:174` using a DIFFERENT grammar (`auto-figures`/`ask-before-apply`/`draft-only`, `AgentPolicy` type, a `<select>`). Plan 49 must MIGRATE the Agents cards onto the new shared control, which is a grammar mapping (AgentPolicy -> DocAutonomyLevel), not a drop-in swap. Two policy controls coexist until plan 49 lands; P2 no-duplicate is preserved in intent (one shared component now exists) per the plan ordering + the PR soft-gate note.
- `Doc`-prefixed names (`DocAutonomyLevel`, `DOC_AUTONOMY_LEVELS`) are imported by a non-doc consumer (agent cards) in plan 49; semantically the same grammar, cosmetically doc-flavoured.

#122 F11 satisfied: three positions present (auto-apply/ask-first/never), one shared plain-language control, no duplicate introduced by this PR.
