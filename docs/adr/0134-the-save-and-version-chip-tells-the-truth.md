---
number: 134
status: "**Done (plan 26 iter 4).** 0 core patches; branch `26-history-tab`."
provenance: "plan 26, iter 4"
source: docs/07-decision-log.md
---

# The save and version chip tells the truth

**The editor toolbar's save/version chip is honest: real snapshot count, live Saving state - the mock `Saved · v14` is gone**

Settled to the plan's recommendation. The toolbar chip renders `Saved` when the document has no saved versions and `Saved · vN` where N is the REAL snapshot count (`getSnapshots(resource).length`, threaded through the render input as `snapshotCount` and re-rendered on every `onDidChange`); it never fabricates a version number. During the 300 ms `pmEdit` debounce window the webview RUNTIME flips the chip's `.tb-saved-text` to `Saving…`; when the edit persists the server re-render restores the honest `Saved [· vN]`. Design-match against the comp's History region: the 10 px mono `VERSION HISTORY` header, the `timelineRow` dots/connectors, the amber `SNAPSHOT` badge on published versions, and the `CURRENT` green badge are all reproduced from the pure render (`>= 90%`, logged to `docs/design-audit/redesign-log.md`). The fabricated-string gate is clean: no `v14`/`v13`/`just now` remains in the History tab or the chip (the only surviving `just now` strings are pre-existing REAL relative-time formatters in `screenRender.ts`/`livingDocPmDecorations.ts`, computed from actual timestamps). **Tier: our-surface, 0 core patches.** Verified: 2 `livingDocRender` unit tests (plain `Saved` + no version number at 0 snapshots; `Saved · v3` at 3) plus the contrib grep gate. Live web pass on `:8080` captured under `docs/plans/26-verify/`.
