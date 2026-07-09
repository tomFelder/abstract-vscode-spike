# Plan 34 - Journey walk: environment record

This file records the exact environment the iteration-1 walk ran against, plus any environment repairs made (per the plan's "assess, don't fix" rule, only environment repairs are permitted, and they are logged here).

## Date and machine

- Walk date: 2026-07-09
- Platform: macOS (darwin 25.6.0), Apple Silicon
- Repo: /Users/tommy/Sites/abstract-vscode-spike
- Branch: 34-journey-walk
- Node: v24.15.0 (via nvm at $HOME/.nvm/versions/node/v24.15.0/bin)

## Web build

- Served by `./scripts/code-web.sh ./living-docs-sample` (already running at walk start, PID family 11226/11228/11317).
- URL: http://localhost:8080
- Correct entry point is the bare `http://localhost:8080/` - it opens the mounted `living-docs-sample` (title "/ [Test Files]", Home shows "Living Docs Sample - 7 docs · 1 source") with the full Workspace/Home/Editor/Templates/Knowledge/Agents nav.
- Environment gotcha found and logged: navigating to `http://localhost:8080/?folder=/static/mount` loads a broken workspace - the File System Access handle is not registered, so every read/write throws `No file system handle registered (/static)`, the Home shows the project as "0 docs", and `[livingDocs] agents write failed`. This is an entry-URL artefact, not a product journey failure; the bare URL is used for the walk. (Screenshot 00-home-initial.png and 1a-1-switch-folder.png were taken against that broken mount before the correct URL was found; they are retained as evidence of the gotcha, not of a journey grade.)
- HTTP 200 confirmed on http://localhost:8080/ at walk start.
- Driven with the chrome-devtools MCP (new_page/navigate_page/take_snapshot/click/fill/take_screenshot/evaluate_script).

## Model backend (proxy)

- Local Anthropic-shaped proxy on http://127.0.0.1:8090 backed by OpenRouter, model `anthropic/claude-sonnet-4.6`.
- Process: `node scripts/lwd-anthropic-proxy.js` (PID 13877 at walk start).
- Health: `GET /` returns 404 (expected - it only serves specific paths); `POST /v1/messages` with a minimal body returned HTTP 200 with a real completion, so live model calls work.
- Restart command if it dies: `export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH" && LWD_BACKEND=openrouter OPENROUTER_MODEL="anthropic/claude-sonnet-4.6" ./scripts/lwd-anthropic-proxy.sh > /tmp/lwd-proxy.log 2>&1 &`

## Test folders

Three folders per the plan:

1. Golden path: the shipped `./living-docs-sample` (mounted as `/static/mount`). Contents: Weekly Summary.md, Team Notes.md, Board Note.md, Board Note.lock.json, market-research.md, metrics.csv, agents.json, a `brief/` subfolder (Project Brief.md, Executive Summary.md, Appendix.md), and a `templates/` folder with 3 `.template.md` files.

2. Empty folder: `/tmp/abstract-walk-empty` (created empty for empty-state probes).

3. Messy real-world folder: `/tmp/abstract-walk-messy` - 15 files with the required variety:
   - Nested subfolders: `subfolder-a/`, `subfolder-a/deep/`, `reports/2025/`
   - Odd-formatted Markdown: `notes-odd.md` (no space after #, runs of spaces, tabs, mixed bullets, trailing spaces), `messy-two.md` (leading blank lines, mixed `* + -` bullets), `subfolder-a/plain.md` (no heading, run-on paragraph), plus `access-policy.md`, `subfolder-a/backup-policy.md`
   - CSV: `metrics.csv`, `reports/extra.csv`
   - Plain text: `readme.txt`, `subfolder-a/deep/log.txt`
   - Image: `logo.png` (1x1 PNG)
   - `.docx`: `report.docx` (real Office Open XML, made with `textutil -convert docx`)
   - `.doc`: `legacy.doc` (real legacy Composite Document, made with `textutil -convert doc`)
   - Three plain md: `reports/2025/report-{1,2,3}.md`

   To open a different folder in the web build: `pkill -f "code-web"` then `export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH" && ./scripts/code-web.sh <folder> > /tmp/code-web.log 2>&1 &`, wait for HTTP 200 on :8080. The living-docs-sample mount is restored at the end of the walk.

## Environment repairs made during the walk

(Recorded here as they happen; none are product code changes.)

- Folder creation at setup time (empty + messy).
- Proxy restart: the proxy was deliberately killed once (`pkill -f lwd-anthropic-proxy`) to run the model-error probe on the chat rail, then restarted with the documented command. HTTP 200 on `/healthz` confirmed after restart.
- Folder swaps: `code-web` was restarted three times to point the mount at `/tmp/abstract-walk-messy` (T3 + off-path), then `/tmp/abstract-walk-empty` (empty state), then back to `./living-docs-sample`. The sample folder was verified byte-identical afterwards (same 9 entries, Board Note.md still contains the original "Momentum is steady…" text). No test document leaked onto the sample folder on disk.

## Known environment limits (not graded as product failures)

- The native OS folder picker (journey 1a frame 2) is not reachable in the web build - "Open folder" in a browser cannot invoke the macOS file dialog the way the desktop build can. Where a journey depends on the native picker, it is noted "not walkable in web, needs desktop pass" rather than graded as a product failure.
</content>
</invoke>
