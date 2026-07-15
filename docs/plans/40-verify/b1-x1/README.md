# B1 / X1 survivability - verification record (issue #121)

Domain: approved work survives a reload; History rehydrates from the on-disk lock. Plan 40 Track B1. Governing spec: docs/20-journey-specs-aha-path.md §1e (persistence contract) / §1h, decision 162 (durable persistence is Electron/desktop-only; the web build is a dev harness that must state its ephemerality honestly), doc 18 §2.3 R4 (survivable).

This is a **confirm + close** pass over what PR #149 already landed, not a rebuild. It records what was verified live vs at unit level, and why the full desktop live check could not run in this environment.

## Contract state: unit-level PASS; desktop live check NOT run here (no model backend). #121 left OPEN.

The persistence + rehydration contract is proven load-bearing at the unit level (red-green), the honest web surfacing is confirmed in code and the web build was confirmed to run live. The one piece that could **not** be exercised in this environment is a live desktop cold-reopen driving the model-produced approve flow, because no model API key (`OPENROUTER_API_KEY` or equivalent) is available here and the onboarding front-door that gates entry to the living-doc editor is model-driven. Per the Track B1 guardrail ("do not close #121 on unverified claims"), #121 stays open with a precise remaining-to-verify note (below).

## What the contract is (decision 162)

1. **Desktop (durable):** approve a change -> the applied text lands in the `.md` on disk and the version is recorded in the `.lock.json` audit, atomically; a reload re-reads the persisted doc; a **cold reopen** rehydrates the History timeline from the on-disk lock `audit[]` (+ snapshots), deduped and newest-first (F19).
2. **Web (ephemeral by design):** the in-memory / File System Access mount drops writes on a full page reload. The app must **say so honestly** rather than show a false "Saved".

## Evidence

### 1. Unit level - PASS, red-green proven (this session, current `main` build)

`./scripts/test.sh --grep "livingDocs History|F19|X1 within-session"` -> **22 passing** (`unit-green.txt`). The two load-bearing service tests live in `src/vs/workbench/contrib/livingDocs/test/browser/livingDocsService.test.ts`:

- **F19 cold-open rehydration (line 436):** seeds a `Weekly Summary.lock.json` on disk with two real `audit[]` entries (as a prior session's approve would leave), constructs a **fresh** service (empty in-memory cache = genuine cold open), `loadDocument`, then asserts `getLock(...).audit` carries both persisted entries in order. This is the rehydration-from-a-lock-fixture the contract needs.
- **X1 within-session write-then-read (line 457):** approves a **deterministic heuristic** candidate (no model probe), then reads the persisted bytes back from the file map - asserts the approved prose is in the `.md` and the `approved` entry is in the lock `audit[]`, so a cold reopen rehydrates it.

Plus the History timeline model + render tests (`livingDocsHistory.test.ts`, `historyRender.test.ts`) covering dedupe by stable identity, newest-first ordering, corrupt-timestamp safety and the honest empty state.

**Red-green (`red-green.txt`):** disabling `dedupeAudit()` in `common/livingDocsHistory.ts` turns the two dedupe/rehydration tests **RED** (2 failing); restoring it turns them **GREEN**. The tests genuinely detect the contract.

### 2. Honest web surfacing - confirmed in code + web build runs live

- The ephemeral notice is rendered by `livingDocRender.ts:876-877`: an amber `⚠ Changes live only in this tab` chip whose tooltip reads "Dev harness: this web build keeps your changes in memory only, so they are lost when you reload or close the tab. The desktop app saves to disk." It is gated on `input.ephemeral`, set to `isWeb` in `livingDocEditor.ts:383-387`, so it can **never** appear in the Electron build (there `isWeb` is false and the normal Saved chip stands).
- The web build was launched live in this session (`./scripts/code-web.sh --port 8084 ./living-docs-sample`, served 200) and **renders** the Abstract workbench (the onboarding front door drew correctly in the browser pane). This confirms the honest-surfacing code path ships in a running web build. Reaching the living-doc editor toolbar to screenshot the chip itself requires the model-driven onboarding demo, which could not run here (no model key), so no editor-toolbar screenshot is included.

### 3. Desktop durable persist + relaunch - previously verified live (10 Jul), path unchanged since

`docs/plans/34-verify/x1-desktop-check.md` recorded a live desktop pass: on the Electron build, approving a change wrote the applied text to `Board Note.md` **and** appended a real `approved` entry to `Board Note.lock.json` `audit[]`, and both **survived a full quit + relaunch into a fresh throwaway profile** (so the only possible source was disk). The persist path (`LivingDocsService._persist` -> `IFileService.writeFile` + `lockStore.write`) is unchanged since. That same doc identified the F19 History-rehydration display gap; **PR #149 fixed exactly that gap**, and the fix is what the F19 unit test above now locks.

## Remaining to verify before #121 can close (precise)

A single live desktop pass on a **full** Electron product build (`out/` + built-in extensions), with a model backend available:

1. Open a real folder, make a model-produced agent change, **approve** -> confirm the `.md` on disk changed and the `.lock.json` `audit[]` gained the `approved` entry (the durable half; last shown live 10 Jul, re-confirm post-#149).
2. **Cold reopen** the doc in a fresh profile -> confirm the **History tab renders the persisted audit timeline** (the F19 fix, so far only unit-verified live-in-UI absent).
3. Confirm the `Saved · vN` chip and snapshots (1h) and a new document (1b) all survive the reload.

Why it could not run in this environment: (a) no model API key, so the onboarding front-door / review-rail approve flow that produces a proposal cannot execute; (b) the launch skill requires the full built product (client + extensions), and only the client transpile was built here. This is not a defect in the fix - it is an environment limit. The deterministic-heuristic approve path (used by the X1 unit test) shows the persist path itself does not require a model, so a future live pass can seed a pre-approved lock fixture or use a heuristic candidate to avoid the model dependency.

## Files
- `unit-green.txt` - the 22-passing contract-test run.
- `red-green.txt` - the dedupe-disabled RED vs restored GREEN demonstration.
