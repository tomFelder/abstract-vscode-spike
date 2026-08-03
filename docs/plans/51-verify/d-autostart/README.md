# Plan 51 WP-D - cold auto-start evidence

The umbrella box: *"from a fresh launch with zero env vars and a fake HOME, the supervisor spawns (or adopts) the broker, `/healthz` answers within seconds, and the sign-in door is reachable within 5s of the app settling."* In-webview clicking is a known environment gap (the webview CDP wedge, disclosed by the WP-B validator), so the evidence here is **process-level (healthz probes, logs, timings) + a settled workbench screenshot**, not in-webview clicks.

## 1. Zero-config cold start with a fake HOME (`coldstart-transcript.txt`)

A harness spawned `scripts/lwd-model-broker.js` **exactly as `LivingDocsBrokerService._spawn` does** - `cwd = appRoot`, `env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }`, stdio piped - but with **every broker-relevant env var stripped** (`LWD_BACKEND`, `OPENROUTER_API_KEY[_FILE]`, `LWD_DAILY_BUDGET_USD`, `LWD_OPENAI_*`, `OPENROUTER_URL`, `LWD_SPEND_CLOCK_FILE`, `LWD_ALLOWED_ORIGINS`, `LWD_PROXY_*`) and `HOME` pointed at a fresh `/tmp/wpd-coldstart-home-*`. This is a genuine zero-config cold start.

Result:

- `/healthz` answered in **59 ms** with the honest zero-config state: `{ ok:false, backend:"openrouter", reason:"unconfigured", signedIn:false }` - no key, no bundle, so the door is truthfully unconfigured (the renderer stays on its heuristic path).
- The sign-in door (`/auth/openai/status`) answered in **59 ms** with `{ ok:true, state:"signed-out" }` - reachable, and honest.
- `within5s: true` (both far under the 5-second bar).
- The fake HOME's `.abstract` was **never created** - the real `~/.abstract/openai-oauth.json` and the founder's key file were never read or written. The broker's own log confirms its store path resolved *into the fake HOME* (`/tmp/wpd-coldstart-home-*/.abstract/openai-oauth.json`).

## 2. Real desktop launch - the supervisor spawns + reaches healthy (`supervisor-log.txt`)

A real Code OSS desktop launch (via the `launch` skill, sample workspace) with port 8090 cleared first, so this is a genuine spawn (not an adopt). The Electron **main-process supervisor** log:

```
15:30:00.708  [livingDocsBroker] spawning broker: node .../scripts/lwd-model-broker.js (cwd .../abstract-vscode-spike)
15:30:00.897  [livingDocsBroker] [lwd-proxy] listening on localhost (dual-stack ::):8090 (backend selection dynamic, serving openai-oauth now)
15:30:01.215  [livingDocsBroker] broker healthy on 127.0.0.1:8090
```

Spawn -> listening in **~189 ms**; spawn -> confirmed-healthy in **~507 ms**. Live `/healthz` and `/auth/openai/status` both answered 200 immediately after. (This launch used the developer's real `$HOME`, so it reports `signedIn:true` from the real bundle - that is the real-machine behaviour, and it is why the fake-HOME zero-config proof in §1 is run separately as a *process*-level harness that never touches the real store.)

## 3. Settled workbench (`workbench-coldstart.png`)

The workbench screenshot after the app settled: the Abstract Home screen renders cleanly - "All sources synced", the project greeting, the Ask composer, and the documents grid - with the broker auto-started behind it. No manual terminal step; the model service is up because the main process supervised it on launch.

## Reproduction

```bash
export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"   # node 24
# §1 (the harness /tmp/wpd-coldstart.js is a throwaway; the transcript is the artefact)
# §2/§3
export TMPDIR=/tmp
lsof -ti :8090 | xargs -r kill -9        # clear the port so it is a spawn, not an adopt
.claude/skills/launch/scripts/launch.sh -- ./living-docs-sample
grep livingDocsBroker /tmp/code-oss-dev/*/code.log
```
