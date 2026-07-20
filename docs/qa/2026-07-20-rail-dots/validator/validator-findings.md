# Files-rail status dots, since-last-looked, fast navigation - adversarial VALIDATOR findings (issue #212)

Branch `rail/status-dots-nav` @ `edd2f3e52fbc81d6f46f7b8e635883fc1fe6f0ed`. Independent re-verification of the implementer's work: static gates re-run, live E2E re-driven in a fresh session (`rail-dots-v`, empty seed profile under `/tmp`, own broker on 8090 adopted, workspace `/tmp/rail-dots-v-ws`). Assume-broken posture; the implementer's report and screenshots were treated as claims.

## Verdict: PASS

The change is correct, well-layered, and confined to `contrib/livingDocs/`. All static gates pass at the claimed numbers. Every user-observable navigation surface (type-ahead, find widget, Cmd+P from both focuses, Recent group, MRU order, highlight-on-Reports-copy, collapse, map-prune-on-relaunch) was re-verified live. The two "honest partials" (yellow/red triggered by real service state) remain unverified-live in this environment for the SAME environmental reason the implementer hit (the chat composer is a webview OOPIF that this environment's raw-CDP path could not reliably type into); their render layer is proven live and their semantics are exhaustively unit-tested and correctly data-wired. The one anomaly (Cmd+F find widget) is NOT a defect - see adjudication.

## Static gates (all re-run by the validator)

| Check | Result |
| --- | --- |
| `npm run typecheck-client` | clean |
| `./scripts/test.sh --grep "livingDocs"` | **310 passing / 0 failing** (matches claim) |
| `npm run valid-layers-check` | exit 0 |
| `./scripts/check-seams.sh` | OK - all shell seams intact |
| Diff confined to `src/vs/workbench/contrib/livingDocs/` | confirmed - zero core patches |
| No co-author lines (`git log --format=%B`) | confirmed none |
| `any` in new code / tabs / localized `{0}` placeholders | confirmed clean |
| Disposables (per-row hover in template store; editor-change listener via `_register`) | confirmed |

## Find-widget adjudication (priority target 3) - WIRED, not broken

The plan and the implementer both expected the tree find widget to open on **Cmd/Ctrl+F**, and both noted it "never surfaced". Root cause found by code + live test:

- Upstream VS Code binds `list.find` to **Cmd/Ctrl+Alt+F** and **F3**, gated on `RawWorkbenchListFocusContextKey && WorkbenchListSupportsFind` (`src/vs/workbench/browser/actions/listCommands.ts:861-880`). Cmd/Ctrl+F was NEVER a list/tree find chord in stock VS Code. Cmd+F is not in `NEUTRALISED_IDE_CHORDS` either - it simply has no list binding.
- **Live proof:** with the Files tree focused, `Cmd+F` did nothing (0 find-widget nodes; `v06b-cmdf.png`). `Cmd+Alt+F` opened the tree find widget - a `monaco-inputbox synthetic-focus` appeared, typing "Wee" filtered/highlighted `Weekly Summary` in both Recent and Reports (`v06c-findwidget-cmdaltf.png`).

So `findWidgetEnabled: true` + the `keyboardNavigationLabelProvider` are correctly wired and functional. The plan's requirement ("type-to-filter + find in tree") is satisfied: type-ahead works live and the find widget works via the standard `list.find` chord. **This is a mistaken expectation in the plan/report, not an implementation defect.**

- **Advisory D1 (non-blocking):** discoverability. In this calm/founder shell the stock `Cmd+Alt+F` is an obscure chord and F3 is unlabelled. If the founder specifically wants Cmd+F to open find-in-tree, that needs a livingDocs-owned `KeybindingsRegistry` rule binding `list.find` (or a wrapper command calling `tree.openFind()`) to `Cmd+F` gated on tree focus (`WorkbenchListFocusContextKey`), weight 1000, zero-core-patch - mirroring exactly how the Cmd+P switcher is bound. Not required to meet the plan as written; offer it as a small follow-up.

## Live scenario table (validator's own session)

| Scenario | Status | Evidence |
| --- | --- | --- |
| Grey plain doc + active doc grey + source/unsupported grey dashes | **live PASS** | `v00-initial.png` (Colleague Update active = grey; metrics.csv / old-brief.doc = grey dashes) |
| Type-ahead filter (tree focus) | **live PASS** | keyboard type-nav focused rows; `v06a-typeahead.png` |
| Find widget (Ctrl/Cmd+Alt+F, the real chord) | **live PASS** | `v06c-findwidget-cmdaltf.png` - overlay + filter live |
| Cmd+P switcher from TREE focus | **live PASS** | `v07a-cmdp-treefocus.png` - "Go to document", MRU order (Plain Report first) |
| Cmd+P filter + Enter opens via editor service | **live PASS** | typed "Wee" -> Enter opened Weekly Summary (`v07b-cmdp-opened-weekly.png`) |
| Cmd+P from DOC-EDITOR (ProseMirror webview) focus | **live PASS** | `v07c-cmdp-webviewfocus.png` - chord SURVIVED the webview (active element was `IFRAME.webview`); Cmd+O fallback not required |
| Recent group appears >=2 docs, MRU order, cap, highlight on Reports copy | **live PASS** | `v07a`/`v07c` - Recent above Reports, MRU-reordered on each open, active highlight always on the Reports copy not the Recent copy |
| Map-prune on relaunch (delete doc from disk, relaunch) | **live PASS** | deleted `Plain Report.md`, relaunched same UDD -> rail rendered, no crash, deleted doc pruned (`v08-relaunch-prune-collapse.png`) |
| Recent collapse persistence across relaunch | **unverifiable-live** | launch skill's slim clone excludes `workspaceStorage` where WORKSPACE-scoped state lives, so relaunch reset editor history and the collapse anchor; code path (WORKSPACE/USER, read-once) is sound + the pattern reuses the existing `_collapsedFolders` machinery |
| Since-last-looked green persists across relaunch | **unverifiable-live** (same `workspaceStorage` limitation) | inherited from implementer's `03-*` + unit coverage |
| Four bands render live in THIS build (grey/green/yellow/red) | **live PASS (render layer)** | `v-four-bands-live-css.png` - validator injected the four colour classes onto real native rail rows (non-destructive, auto-reverts); all four oklch bands render distinctly in light mode |
| Yellow via a REAL pending proposal | **unverified-live** | the chat composer is a webview OOPIF; raw-CDP mouse+`insertText` did not focus/land in the ProseMirror composer in this env (same limitation the implementer named). Semantics unit-tested (`railStatus.test.ts`), data-wired (`pendingCount` -> yellow), trailing amber dot removed (confirmed: no `.rail-item-dot` in DOM/CSS) |
| Red via real relink/stale/fanout | **unverified-live** | relink requires an agent round-trip producing `_relinkPrompt` (sets `relink:true`, `livingDocsService.ts:3599`); stale needs a loaded-doc freshness drift; all three are correctly wired to real signals. Render + precedence proven live + unit-tested |
| Context tab keeps `.rail-item-glyph` | **PASS** | `v-context-glyphs.png` (empty-state here; CSS rules for the glyph retained in the diff for chips/pickers) |

## Code review - correctness confirmations

- **Precedence ladder** red > yellow > green > grey is correct and unit-covered including the "red wins over yellow+green" case (`railStatus.ts:65-87`).
- **Green inputs correctly wired** (`livingDocsService.ts:2188-2200`): active doc short-circuits `unseenAgentEdits=0`; audit read from the loaded lock else the tolerant sidecar (`no lock -> [] -> grey`, the L3 rule); `countUnseenAgentEdits` excludes equal-timestamp, `approved`, `rejected`, and `via:'override'`, counts all when the anchor is undefined - all unit-tested.
- **Red inputs correctly wired:** `relinkCount` from `_pending.filter(c => c.relink)`, `stale` from `getFreshness(uri).dirty` (only for loaded docs - truthful partial, commented), `fanoutFailed` from `_fanoutProgress.values().failedDocIds` (which store `resource.toString()`, matching the summary `id`). Verified against real producers.
- **Since-last-looked storage** owned solely by the service (`DOC_LAST_VIEWED_KEY`, WORKSPACE/USER); read-once at construction, corruption-tolerant, pruned to the real doc set only in `listDocuments` (guarded against a transient empty scan wiping anchors), and stamps both outgoing + incoming docs on editor change. Clean.
- **Cmd+P switcher** opens via `IEditorService.openEditor({revealIfOpened,pinned})` (not editorGroups), MRU ranked via `IHistoryService.getHistory()` then alphabetical. Correct.
- **Recent group** reuses the same doc item (same dot) under a distinct `RECENT_FOLDER_ID/leaf:` id prefix (collision-free), capped at 5, hidden below 2; `_highlightActiveDoc` skips the Recent subtree. Unit-tested + live-confirmed.
- **Renderer** resets `RAIL_STATUS_CLASSES` before applying per row (no stale class on recycle); the hover disposable is registered in the per-row template `DisposableStore`. No leak.

## Minor observations (advisory only)

- **D2 (advisory):** `_recordDocViewed` stamps any active `.md` resource, including `.export.md`/`.source.md`/`.template.md` that are NOT summarised docs (`livingDocsService.ts:598`). Harmless - such an anchor is never read (not a doc) and is pruned on the next `listDocuments` scan. Could tighten to the real doc predicate, but self-healing as-is.
- **T4 constructor-param deviation** (the view caches `hoverService` into `_hoverService` after passing it to `super`): sound. `ViewPane`'s base stores it privately; the collaborator closure needs a field reference, and DI-in-constructor is respected (no `IInstantiationService.get` at call time). Acceptable.
- Row height/spacing/typography: the `.rail-tree-leaf` gap stayed `7px`, font unchanged; only the leading glyph slot became the `.rail-status` dot/dash. Matches "typography/spacing out of scope".

## Environmental limitations (why two scenarios stayed unverified-live)

1. **Webview composer typing:** the entire chat/editor surface is a VS Code webview OOPIF. `@playwright/cli` cannot pierce it, and the raw-CDP `Input.dispatchMouseEvent` + `Input.insertText` path (used for clicks in the L2 run) did not focus/land text in the ProseMirror composer at the coordinates tried. Staging a real agent round-trip for yellow, and driving the drift/relink flow for red, both depend on this. This is exactly the honest partial the implementer declared; the validator reached the same wall.
2. **workspaceStorage excluded by the launch clone:** WORKSPACE-scoped state (`docLastViewed`, `_collapsedFolders`) lives under `User/workspaceStorage/`, which the launch skill's slim clone drops, so persistence-across-relaunch of green/collapse cannot be observed live here. The delete-and-prune path WAS observable (it operates on the live map + disk scan) and passed.

## Cleanup

Own Code OSS instances killed (pids 73852, 973), own broker killed (73175, port 8090 free), playwright daemon closed, temp CDP helper scripts removed. No keychain/token files touched (broker adopted on 8090 with a controlled `HOME=/tmp/...`). No real user data altered.
