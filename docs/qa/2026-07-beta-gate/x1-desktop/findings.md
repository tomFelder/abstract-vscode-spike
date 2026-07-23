# X1 / F19 desktop cold-reopen proof (#121)

Beta-gate file-reality wave (#245), 23 Jul 2026. Adversarial validator (Opus 4.8) against the packaged app `/Users/tommy/Sites/VSCode-darwin-arm64/Abstract.app`, app commit `accc01ed569659feaf2e762d163aee63593b9ade` (= origin/main exactly; compiled bundle contains `dedupeAudit`, the F19 rehydration - no rebuild needed). Isolated `--user-data-dir`/`--extensions-dir`, driven over CDP on :9224. Screenshots beside this file (17 PNGs).

## Criteria

| # | criterion | verdict | measurement |
|---|---|---|---|
| 1 | approve persists to .md | **PASS** (fixture route) | `Board Note.md` b-3: "Momentum is steady..." -> "On plan, no surprises."; md sha256 `10b1f701...` -> `9efb932d...` |
| 2 | approve appends lock audit | **PASS** (fixture route) | `Board Note.lock.json` audit[] len 0 -> 1, entry byte-faithful to `_entry()` (time/docTitle/blockId=b-3/action=approved/oldText/newText/via=heuristic); lock sha256 `c92edb40...` -> `7b869c4e...` |
| 3 | cold-reopen doc content | **PASS (LIVE)** | fresh user-data-dir relaunch; Board Note renders "On plan, no surprises." (`13-coldreopen-doc.png`); disk is the only possible source |
| 4 | cold-reopen History rehydration (F19) | **PASS (LIVE)** | History tab rehydrated from on-disk audit[] (`14b-history.png`): "Approved ... Board Note / b-3 ... heuristic · 6m ago"; post-reopen disk hashes byte-identical to fixture (read-only load path) |
| 5 | Saved chip consistency | **PASS (steady state)** | inner-frame DOM read `savedChip: "Saved"` across cold reopen; the transient "Saving -> Saved · vN" animation only appears during a live approve |

## Route: model-free fixture for 1/2, live for 3/4/5

The live in-app model approve is definitively blocked in this environment, with the root cause measured:

- Broker (`lwd-model-broker.sh`, OpenRouter, `openai/gpt-4.1-mini`) genuinely healthy: `/healthz` 200, `POST /v1/messages` returns a real completion.
- The app persistently showed "Model unavailable"; the broker access log recorded ZERO requests from the app across relaunches, chat sends, and explicitly picking "Use the included model".
- **Root cause: the broker binds IPv4-only (`HOST='127.0.0.1'`); `localhost` resolves to `::1` first on this host.** `curl http://[::1]:8090` -> 000; `curl http://127.0.0.1:8090` -> 200. The app's default `http://localhost:8090` therefore targets `::1` and never connects.
- Setting `livingDocs.modelProxyUrl=http://127.0.0.1:8090` in the isolated profile did NOT repair it - the app issued no broker request at all (needs root-causing alongside the bind fix).
- The OpenAI-OAuth backend is also dead here: `~/.abstract/openai-oauth.json` expired 2026-07-20.
- No in-UI proposal path works model-free (chat/onboarding need the model; the impact pass needs lock `claims`, and the sample ships `claims: {}`), so criteria 1/2 used the byte-faithful pre-approved lock fixture - the route the #121 thread explicitly sanctions.

## Consequence

The actual #121 residual (cold-reopen survival + F19 rehydration) is proven live in the packaged app. The one thing not exercised live is the write moment during a real in-app approve (unit red-green already exists: plan 40 B1, 22 passing). The broker reachability defect gets its own fix loop in this wave (`beta-gate/broker-localhost`); after it lands, a live approve + relaunch re-probe closes the gap honestly.

Cleanup: app + broker killed, `/tmp/x1-*` removed, shipped `living-docs-sample` verified pristine.
