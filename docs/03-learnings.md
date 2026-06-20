# 03 — Learnings (what worked, what didn't, surprises)

The one-line conclusion of the whole spike: **the engine maps cleanly onto VS Code and is proven;
the shell is where the fork fights back.**

## What worked well

- **The engine reuse thesis held.** Building the agent -> derive -> classify -> diff -> approve ->
  audit -> provenance loop on top of VS Code's services was fast and clean. `ILanguageModelsService`
  for the model, `IRequestService` for HTTP, `IFileService`, the webview EditorPane, `ViewPane` for
  the rail, and `renderMarkdown` for generic Markdown all dropped in with little friction.
- **A thin, purpose-built agent orchestration was the right call.** We did NOT use VS Code's generic
  chat-edit session handler (it's code-edit-shaped). A small bespoke loop modelled the
  "re-derive bound blocks -> figure-vs-meaning -> propose -> fan out" shape naturally.
- **The webview document surface is the part that already feels like a word processor.** Because the
  editor area is our own HTML, the document itself reads right — it's everything *around* it that
  reads as an IDE.
- **`renderMarkdown` reuse** gave correct, sanitized generic Markdown for free (XSS-safe, no
  hand-rolled parser).
- **The live API binding was the standout success.** A real `api.github.com` fetch filling a
  `{cell}` template proved "bound to an API, not just a file" end-to-end — and it even worked in the
  network-sandboxed web build because GitHub sends permissive CORS.
- **Multi-doc fan-out fell out cleanly** once the service was re-keyed by resource — a single
  Refresh propagating to every bound doc, grouped in the rail, is genuinely compelling for the
  beachhead use case (one source, many reports).
- **The calm shell is ~80% free.** Workspace settings alone (modernUI, hidden activity bar / tabs /
  menu / status, indigo accent) get most of the way to "not an IDE," with zero source patches and
  full reversibility.
- **Tooling discipline paid off.** Type-check + headless unit tests + chrome-devtools visual verify
  on the web build made it possible to iterate confidently without a GUI.

## What didn't work / was harder than hoped

- **The last 20% of de-IDE-ing is the expensive 20%** — and it's exactly the part users notice. The
  file tree, view-pane chrome, title bar, group/close affordances, command palette, context menus,
  and keybindings are all unmistakably VS Code and resist settings-level change. See
  [04](04-risks-and-predictions.md) and [06](06-design-notes.md).
- **`product.json` rebrand is awkward.** Display-name changes are cached by the running web server
  (need a restart), and a *real* rebrand (binary/data-dir) means changing `applicationName`/
  `dataFolderName`, which moves the user-data dir — a documented footgun we deliberately avoided.
- **The `.living.md` format is caught between two worlds** — not clean enough to be "just Markdown"
  (it smuggles bindings in HTML comments, shows `{cell}` on disk, keeps provenance in a sidecar) and
  not structured enough for rich WYSIWYG. This is now an explicit open question
  ([05](05-open-questions.md)).
- **The editor doesn't yet feel like a full editor.** `contenteditable` on non-bound prose is a
  start, but it's not a real WYSIWYG (no rich toolbar, block operations, lists/tables editing,
  selection model). It reads as a preview you can poke, not a document you author.
- **Provenance dots are visually wrong.** They sit inline and indent the prose; they should live in
  a detached left gutter. Captured as a concrete redesign ([06](06-design-notes.md)).
- **The header / document-title area looks "funky"** vs the design — needs a review against the
  Workbench hi-fi.

## Surprises / gotchas worth remembering

- **Node 24.15.0 is mandatory** (`.nvmrc`; preinstall enforces major===24). The machine otherwise
  has Node 22 + 25. Also needed `git-lfs` for the initial checkout.
- **`./scripts/test.sh` runs against compiled `out/`**, not source — so a test only sees a change
  after the `npm run watch` build has recompiled it. Poll the compiled `.js` before running tests.
  (The persistent watch can also silently die — restart `npm run watch` if `out/` goes stale.)
- **The web build is network-sandboxed (CSP)** for webview content, but the *workbench* request
  service can still reach permissive-CORS endpoints (GitHub) — which is why the live API demo worked
  without the desktop build.
- **`?folder=/static/mount` doesn't work** in `@vscode/test-web`; open the workspace at the base URL
  (it mounts as `[Test Files]`). The web FS is in-memory — writes don't touch disk, which kept the
  sample clean during verification.
- **Repo hygiene blocks commits** on: spaces-as-indent (tabs only, even inside template literals —
  use single left-aligned strings), non-ASCII in source (use HTML entities/ASCII), and the `in`
  operator (`local/code-no-in-operator` — use `Object.prototype.hasOwnProperty.call`). DI rule:
  non-service ctor args BEFORE `@IService` args.

## The meta-learning

A lightweight fork spike was an **excellent** way to evaluate this cheaply: it answered "is the
engine real?" (yes) and "how hard is the shell?" (hard in a specific, now-quantified way) without
committing to a production architecture. That is exactly what a research spike is for.
